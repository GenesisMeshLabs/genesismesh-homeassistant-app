import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import {
  GenesisMeshClient, policyDigest, publicKeyFromSeed, seedSigner, verifyEvidenceEvents,
  type BoundaryPolicyIntent,
} from 'genesis-mesh-sdk';
import { configuration, intent } from './helpers.js';
import { Journal } from '../src/journal.js';
import { Authority } from '../src/authority.js';
import { Executor } from '../src/executor.js';
import { HomeAssistant } from '../src/home-assistant.js';
import { createServer } from '../src/server.js';
import { HaSimulator } from './ha-simulator.js';
import { readSigningSeed } from '../src/secrets.js';

test('released Genesis Mesh authority with the finite HA API simulator', async t => {
  const manifestFile = process.env['GM_HA_TEST_FIXTURE'];
  assert.ok(manifestFile, 'Run npm run test:integration to provision a disposable authority.');
  const lab = JSON.parse(readFileSync(manifestFile, 'utf8')) as {
    directory: string; url: string; publicKey: string; sovereignId: string;
    adminKeyId: string; adminKeyFile: string; evaluatorKeyId: string; evaluatorKeyFile: string;
  };
  const admin = new GenesisMeshClient({ baseUrl: lab.url, audience: lab.publicKey,
    signer: seedSigner(readSigningSeed(lab.adminKeyFile), lab.adminKeyId) });
  const { config, tokens } = configuration(join(lab.directory, 'application'));
  const simulator = new HaSimulator();
  t.after(() => simulator.close());
  config.homeAssistant.url = await simulator.start();
  config.authority.url = lab.url;
  config.authority.publicKey = lab.publicKey;
  config.authority.audience = lab.publicKey;
  config.authority.sovereignId = lab.sovereignId;
  config.authority.operatorKeyId = lab.evaluatorKeyId;
  config.authority.operatorKeyFile = lab.evaluatorKeyFile;
  const executorSeed = randomBytes(32).toString('base64');
  config.authority.executorKeyFile = join(lab.directory, 'executor.key');
  writeFileSync(config.authority.executorKeyFile, executorSeed, { mode: 0o600 });
  const publicKey = publicKeyFromSeed(executorSeed);
  await admin.evidenceStore.registerExecutorKey({ key_id: config.authority.executorKeyId,
    public_key: publicKey, executor_sovereign_id: config.authority.executorId, resource_prefix: `ha:${config.homeId}/` });

  const period = { valid_from: new Date(Date.now() - 60000).toISOString(), valid_until: new Date(Date.now() + 3600000).toISOString() };
  const globalIntent: BoundaryPolicyIntent = {
    policy_id: 'home-access', description: 'Exact home and admitted participant resource scope', ...period,
    selector: { capabilities: ['ha.*'] }, gates: [
      { gate_id: 'home', gate_type: 'allowlist.v1', order: 0, config: { path: 'request_parameters.home_id', values: [config.homeId] } },
      { gate_id: 'resource', gate_type: 'attestation_claim.v1', order: 1, config: { path: 'request_parameters.resource_id', claim: 'resources' } },
      { gate_id: 'adapter', gate_type: 'allowlist.v1', order: 2, config: { path: 'request_parameters.adapter', values: ['ha-finite-v1'] } },
      { gate_id: 'intent', gate_type: 'required_parameter.v1', order: 3, config: { path: 'request_parameters.action_digest' } },
    ],
  };
  const climateIntent: BoundaryPolicyIntent = {
    policy_id: 'climate-range', description: 'Heating range 19 to 23 degrees C', ...period,
    selector: { capabilities: ['ha.climate.set_temperature'] }, gates: [
      { gate_id: 'minimum', gate_type: 'min_value.v1', order: 0, config: { path: 'request_parameters.temperature_c', min: 19 } },
      { gate_id: 'maximum', gate_type: 'max_value.v1', order: 1, config: { path: 'request_parameters.temperature_c', max: 23 } },
    ],
  };
  const lightIntent: BoundaryPolicyIntent = {
    policy_id: 'light-state', description: 'Explicit on/off only', ...period,
    selector: { capabilities: ['ha.light.set'] }, gates: [
      { gate_id: 'state', gate_type: 'allowlist.v1', order: 0, config: { path: 'request_parameters.state', values: ['on', 'off'] } },
    ],
  };
  const policies = [];
  for (const policy of [globalIntent, climateIntent, lightIntent]) {
    const signed = await admin.policy.publish(policy);
    await admin.policy.activate(signed.policy_id, signed.version);
    policies.push(signed);
  }
  for (const expectation of config.authority.expectations) {
    expectation.policies = policies.filter(p => p.policy_id === 'home-access' ||
      p.policy_id === (expectation.capability.includes('climate') ? 'climate-range' : 'light-state'))
      .map(p => ({ id: p.policy_id, version: p.version, digest: policyDigest(p) }));
  }
  for (const principal of config.principals) {
    const attestation = await admin.attestation.issue({ subject_id: principal.id, roles: ['role:client'], validity_hours: 1,
      claims: { capabilities: ['ha.climate.set_temperature', 'ha.light.set'], resources: ['heating', 'lamp'] } });
    principal.attestationId = attestation.attestation_id;
  }
  const journal = new Journal(config.dataDir);
  t.after(() => journal.close());
  let evidenceUnavailable = false;
  let authorityUnavailable = false;
  const authority = new Authority(config, journal, readSigningSeed(lab.evaluatorKeyFile), executorSeed,
    async (input, init) => {
      if (authorityUnavailable) throw new TypeError('Simulated authority connection failure');
      if (evidenceUnavailable && String(input).endsWith('/evidence/execution')) {
        return new Response(JSON.stringify({ error: { code: 'test_unavailable', message: 'Simulator outage' } }), { status: 503 });
      }
      return fetch(input, init);
    });
  const home = new HomeAssistant(config.homeAssistant.url, simulator.token);
  const executor = new Executor(config, journal, authority, home);
  const app = createServer(config, executor, journal);
  const send = (body: unknown, kind = 'person') => app.inject({ method: 'POST', url: '/v1/actions',
    headers: { authorization: `Bearer ${tokens[kind]}` }, payload: body as object });
  try {
    await t.test('standard evaluator cannot issue memberships or change policy', async () => {
      await assert.rejects(() => authority.client.attestation.issue({ subject_id: 'not-admitted', roles: ['role:client'] }), error =>
        error instanceof Error && 'status' in error && error.status === 403);
      await assert.rejects(() => authority.client.policy.publish(globalIntent), error =>
        error instanceof Error && 'status' in error && error.status === 403);
    });

    await t.test('person, agent, machine and device each obtain signed policy-bound decisions', async () => {
      for (const kind of ['person', 'agent', 'machine', 'device', 'service']) {
        const response = await send(intent(), kind);
        assert.equal(response.statusCode, 200, response.body);
        const op = response.json();
        assert.equal(op.subjectId, kind);
        assert.equal(op.commandState, 'accepted');
        assert.equal(op.evidenceState, 'acknowledged', response.body);
        const records = await admin.evidenceStore.search({ decision_id: op.decisionId, entry_kind: 'decision' });
        const decision = records.entries[0]!.payload['decision'] as Record<string, unknown>;
        const context = records.entries[0]!.payload['context'] as Record<string, unknown>;
        assert.equal((decision['attestation_binding'] as Record<string, unknown>)['subject_id'], kind);
        assert.equal(context['requester_sovereign_id'], kind);
        assert.equal((context['request_parameters'] as Record<string, unknown>)['action_digest'], op.digest);
      }
      assert.equal(simulator.calls.length, 5);
      assert.deepEqual(simulator.calls[0]!.data, { entity_id: 'climate.living_room', temperature: 21 });
    });

    await t.test('numeric boundaries pass while out-of-range values are signed DENY without dispatch', async () => {
      for (const temperatureC of [19, 23]) {
        assert.equal((await send({ ...intent(), parameters: { temperatureC } })).statusCode, 200);
      }
      const count = simulator.calls.length;
      for (const temperatureC of [18.9, 23.1]) {
        const response = await send({ ...intent(), parameters: { temperatureC } });
        assert.equal(response.statusCode, 403, response.body);
        assert.equal(response.json().commandState, 'denied');
        assert.ok(response.json().policyFailures.length > 0);
        assert.ok(response.json().decisionId);
      }
      assert.equal(simulator.calls.length, count);
    });

    await t.test('light dispatch uses the same policy path and exact supported service', async () => {
      const response = await send({ ...intent(), resourceId: 'lamp', capability: 'ha.light.set', parameters: { state: 'off' } }, 'machine');
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(simulator.calls.at(-1)!.path, '/api/services/light/turn_off');
      assert.deepEqual(simulator.calls.at(-1)!.data, { entity_id: 'light.desk' });
    });

    await t.test('concurrent duplicate client retries dispatch once against real authority', async () => {
      const count = simulator.calls.length;
      const request = intent();
      const responses = await Promise.all([send(request), send(request), send(request)]);
      assert.ok(responses.every(r => r.statusCode === 200), responses.map(r => r.body).join('\n'));
      assert.equal(new Set(responses.map(r => r.json().id)).size, 1);
      assert.equal(simulator.calls.length, count + 1);
    });

    await t.test('an authenticated participant cannot substitute another subject attestation', async () => {
      const principal = { ...config.principals[0]!, attestationId: config.principals[1]!.attestationId };
      const request = intent();
      const { compileAction } = await import('../src/requests.js');
      await assert.rejects(() => authority.run(principal, compileAction(config, principal, request), 'unused', async () => {
        assert.fail('Subject substitution must not enter executor callback.');
      }), /does not match/);
    });

    await t.test('an authority connection failure cannot fall back to unauthorised execution', async () => {
      const count = simulator.calls.length;
      authorityUnavailable = true;
      try {
        const response = await send(intent());
        assert.equal(response.statusCode, 503);
        assert.equal(response.json().commandState, 'blocked');
        assert.equal(simulator.calls.length, count);
      } finally { authorityUnavailable = false; }
    });

    await t.test('a modified signed decision is refused before any HA dispatch', async () => {
      const count = simulator.calls.length;
      const original = authority.client.boundary.evaluate.bind(authority.client.boundary);
      authority.client.boundary.evaluate = async request => {
        const result = await original(request);
        result.decision.context_id = 'substituted-context';
        return result;
      };
      try {
        const response = await send(intent());
        assert.equal(response.statusCode, 503);
        assert.equal(response.json().commandState, 'blocked');
        assert.equal(simulator.calls.length, count);
      } finally { authority.client.boundary.evaluate = original; }
    });

    await t.test('a changed stored parameter fails the signed context digest check', async () => {
      const count = simulator.calls.length;
      const original = authority.client.evidenceStore.search.bind(authority.client.evidenceStore);
      authority.client.evidenceStore.search = async query => {
        const records = await original(query);
        const context = records.entries[0]!.payload['context'] as Record<string, unknown>;
        (context['request_parameters'] as Record<string, unknown>)['temperature_c'] = 22;
        return records;
      };
      try {
        const response = await send(intent());
        assert.equal(response.statusCode, 503);
        assert.equal(response.json().reason, 'request_binding_invalid');
        assert.equal(response.json().evidenceState, 'acknowledged');
        assert.ok(response.json().evidenceId);
        assert.equal(simulator.calls.length, count);
      } finally { authority.client.evidenceStore.search = original; }
    });

    await t.test('policy changes require deliberate expectation update and never silently broaden access', async () => {
      const count = simulator.calls.length;
      const changed = await admin.policy.publish({ ...climateIntent, description: 'Changed policy, not yet accepted by the app' });
      await admin.policy.activate(changed.policy_id, changed.version);
      try {
        const response = await send(intent());
        assert.equal(response.statusCode, 503);
        assert.equal(response.json().reason, 'policy_changed');
        assert.equal(simulator.calls.length, count);
      } finally { await admin.policy.activate(changed.policy_id, 1); }
    });

    await t.test('unavailable target or non-Celsius installation fails before dispatch', async () => {
      const count = simulator.calls.length;
      simulator.unavailable = true;
      assert.equal((await send(intent())).statusCode, 503);
      simulator.unavailable = false;
      simulator.unit = '°F';
      const refused = await send(intent());
      assert.equal(refused.json().reason, 'unsupported_unit');
      assert.equal(refused.json().evidenceState, 'acknowledged');
      assert.ok(refused.json().evidenceId);
      simulator.unit = '°C';
      assert.equal(simulator.calls.length, count);
    });

    await t.test('evidence upload outage keeps accepted action pending, then acknowledges without redispatch', async () => {
      evidenceUnavailable = true;
      const count = simulator.calls.length;
      const request = intent();
      const response = await send(request);
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(response.json().commandState, 'accepted');
      assert.equal(response.json().evidenceState, 'pending');
      assert.equal((await journal.outbox.list()).length, 1);
      evidenceUnavailable = false;
      for (const entry of await journal.outbox.list()) {
        entry.next_attempt_at = null; // Test-only bypass of SDK retry backoff via its public storage interface.
        await journal.outbox.update(entry);
      }
      await executor.flush();
      assert.equal(journal.get(response.json().id)!.evidenceState, 'acknowledged');
      assert.equal((await journal.outbox.list()).length, 0);
      assert.equal((await send(request)).json().id, response.json().id);
      assert.equal(simulator.calls.length, count + 1);
    });

    await t.test('revoking the agent membership produces a new refusal, without another HA call', async () => {
      const count = simulator.calls.length;
      await admin.attestation.revoke(config.principals.find(p => p.kind === 'agent')!.attestationId, { reason: 'Pilot revocation test' });
      const response = await send(intent(), 'agent');
      assert.equal(response.statusCode, 403, response.body);
      assert.equal(response.json().commandState, 'denied');
      assert.equal(simulator.calls.length, count);
    });

    await t.test('a lost HA reply remains unknown and blocks subsequent sends to that resource', async () => {
      simulator.loseReply = true;
      const count = simulator.calls.length;
      const request = { ...intent(), resourceId: 'lamp', capability: 'ha.light.set', parameters: { state: 'on' } };
      const response = await send(request, 'device');
      assert.equal(response.statusCode, 202, response.body);
      assert.equal(response.json().commandState, 'outcome_unknown');
      assert.equal(response.json().evidenceState, 'acknowledged');
      assert.equal((await send(request, 'device')).json().id, response.json().id);
      assert.equal((await send({ ...request, requestId: intent().requestId }, 'machine')).statusCode, 409);
      assert.equal(simulator.calls.length, count + 1);
      simulator.loseReply = false;
    });

    await t.test('the real authority export verifies offline and rejects tampering', async () => {
      const events = await admin.evidenceStore.export();
      const executorKeys = await admin.evidenceStore.listExecutorKeys();
      const result = verifyEvidenceEvents(events, { naPublicKeys: [lab.publicKey], executorKeys });
      assert.equal(result.verified, true, JSON.stringify(result.failures));
      assert.ok(result.executions >= 10);
      const damaged = structuredClone(events);
      damaged.find(e => e.entry.entry_kind === 'execution')!.payload['outcome'] = 'tampered';
      assert.equal(verifyEvidenceEvents(damaged, { naPublicKeys: [lab.publicKey], executorKeys }).verified, false);
    });

    await t.test('real listener health and authenticated catalog work without exposing credentials', async () => {
      await app.listen({ host: '127.0.0.1', port: 0 });
      const address = app.server.address();
      assert.ok(address && typeof address !== 'string');
      const base = `http://127.0.0.1:${address.port}`;
      assert.equal((await fetch(`${base}/health`)).status, 200);
      assert.equal((await fetch(`${base}/v1/resources`)).status, 401);
      const response = await fetch(`${base}/v1/resources`, { headers: { authorization: `Bearer ${tokens['machine']}` } });
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.ok(!text.includes(executorSeed));
      assert.ok(!text.includes(simulator.token));
      assert.ok(!text.includes('credentialSha256'));
    });

    await t.test('the actual CLI loads core-format keys and private config and starts its loopback service', async () => {
      const cliConfig = structuredClone(config);
      cliConfig.dataDir = join(lab.directory, 'cli-application');
      cliConfig.homeAssistant.tokenFile = join(lab.directory, 'ha.token');
      writeFileSync(cliConfig.homeAssistant.tokenFile, simulator.token, { mode: 0o600 });
      const configFile = join(lab.directory, 'private-app-config.json');
      writeFileSync(configFile, JSON.stringify(cliConfig), { mode: 0o600 });
      const child = spawn(process.execPath, ['dist/src/main.js', configFile], {
        env: { ...process.env, GM_HA_PORT: '0' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout!.on('data', data => { output += String(data); });
      child.stderr!.resume();
      const stopped = once(child, 'exit');
      try {
        let base: string | undefined;
        for (let attempt = 0; attempt < 60; attempt++) {
          base = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
          if (base) break;
          assert.equal(child.exitCode, null, 'CLI exited before becoming ready.');
          await delay(50);
        }
        assert.ok(base, 'CLI must report its loopback listener.');
        assert.equal((await fetch(`${base}/health`)).status, 200);
        assert.equal((await fetch(`${base}/v1/resources`)).status, 401);
        const catalog = await fetch(`${base}/v1/resources`, { headers: { authorization: `Bearer ${tokens['machine']}` } });
        assert.equal(catalog.status, 200);
        assert.ok(!output.includes(executorSeed));
        assert.ok(!output.includes(simulator.token));
      } finally {
        child.kill();
        await stopped;
      }
    });
  } finally {
    await app.close();
    await executor.idle();
    await simulator.close();
  }
});
