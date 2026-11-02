import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, intent } from './helpers.js';
import { createServer } from '../src/server.js';

test('client usage callback runs only after bearer authentication and operation summaries preserve intent', async t => {
  const f = fixture(t); const visits: string[] = [];
  const tracked = createServer(f.config, f.executor, f.journal, 'standalone', async id => { visits.push(id); });
  t.after(() => tracked.close());
  assert.equal((await tracked.inject({ url: '/health' })).statusCode, 200);
  assert.equal((await tracked.inject({ url: '/v1/resources' })).statusCode, 401);
  assert.deepEqual(visits, []);
  assert.equal((await tracked.inject({ url: '/v1/resources', headers: { authorization: `Bearer ${f.tokens['machine']}` } })).statusCode, 200);
  assert.deepEqual(visits, ['machine']);
  const response = await f.send(intent());
  assert.match(response.json().summary, /Temperature °C: 21/);
  assert.deepEqual(response.json().parameters, { temperature_c: 21 });
});

test('all participant classes use the same executor without sharing subject attribution', async t => {
  const f = fixture(t);
  for (const kind of ['person', 'agent', 'machine', 'device', 'service']) {
    const response = await f.send(intent(), kind);
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().subjectKind, kind);
    assert.equal(response.json().subjectId, kind);
    assert.equal(response.json().commandState, 'accepted');
  }
  assert.equal(f.home.sent.length, 5);
  assert.equal(new Set(f.home.sent.map(a => a.subjectId)).size, 5);
});

test('a DENY and an authority outage never reach the HA adapter', async t => {
  const f = fixture(t);
  f.governance.allowed = false;
  const denied = await f.send(intent());
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.json().commandState, 'denied');
  assert.deepEqual(denied.json().policyFailures, ['test/range']);
  f.governance.outage = true;
  const unavailable = await f.send(intent());
  assert.equal(unavailable.statusCode, 503);
  assert.equal(unavailable.json().commandState, 'blocked');
  assert.equal(f.home.sent.length, 0);
  assert.equal(f.home.checked, 0);
});

test('extra subject, attestation, service, target and parameter fields are rejected rather than stripped', async t => {
  const f = fixture(t);
  for (const extra of [ { subjectId: 'other-person' }, { attestationId: 'other-attestation' }, { service: 'shell_command.run' }, { entity_id: 'light.all' } ]) {
    assert.equal((await f.send({ ...intent(), ...extra })).statusCode, 400);
  }
  assert.equal((await f.send({ ...intent(), parameters: { temperatureC: 21, hvac_mode: 'off' } })).statusCode, 400);
  for (const temperatureC of ['21', true, null, [], {}]) {
    assert.equal((await f.send({ ...intent(), parameters: { temperatureC } })).statusCode, 400);
  }
  assert.equal(f.governance.calls, 0);
  assert.equal(f.home.sent.length, 0);
});

test('missing credentials, browser origins and malformed or oversized JSON cannot act', async t => {
  const f = fixture(t);
  assert.equal((await f.app.inject({ method: 'POST', url: '/v1/actions', payload: intent() })).statusCode, 401);
  assert.equal((await f.send(intent(), 'person', { origin: 'https://unexpected.example' })).statusCode, 403);
  const headers = { authorization: `Bearer ${f.tokens['person']}`, 'content-type': 'application/json' };
  for (const payload of ['{"resourceId":"one","resourceId":"two"}', '{"parameters":{"temperatureC":NaN}}', '{"x":' + ' '.repeat(5000) + '1}']) {
    assert.ok([400, 413].includes((await f.app.inject({ method: 'POST', url: '/v1/actions', headers, payload })).statusCode));
  }
  assert.equal(f.home.sent.length, 0);
});

test('unknown resources, wrong domains, expired intents and far-future intents do not evaluate', async t => {
  const f = fixture(t);
  assert.equal((await f.send({ ...intent(), resourceId: 'unknown' })).statusCode, 403);
  assert.equal((await f.send({ ...intent(), resourceId: 'lamp' })).statusCode, 400);
  for (const expiresAt of [new Date(Date.now() - 1).toISOString(), new Date(Date.now() + 300000).toISOString(), 'this-is-not-a-date-at-all']) {
    assert.equal((await f.send({ ...intent(), expiresAt })).statusCode, 400);
  }
  assert.equal(f.governance.calls, 0);
});

test('concurrent duplicates and later retries return one reserved operation and send once', async t => {
  const f = fixture(t);
  const request = intent();
  const results = await Promise.all(Array.from({ length: 8 }, () => f.send(request)));
  assert.ok(results.every(r => r.statusCode === 200));
  assert.equal(new Set(results.map(r => r.json().id)).size, 1);
  assert.equal(f.home.sent.length, 1);
  assert.equal(f.governance.calls, 1);
  const changed = await f.send({ ...request, parameters: { temperatureC: 22 } });
  assert.equal(changed.statusCode, 409);
  assert.equal(f.home.sent.length, 1);
});

test('resource catalog and operation status are restricted to the authenticated participant', async t => {
  const f = fixture(t);
  const result = await f.send(intent());
  const headers = { authorization: `Bearer ${f.tokens['agent']}` };
  const other = await f.app.inject({ method: 'GET', url: `/v1/operations/${result.json().id}`, headers });
  assert.equal(other.statusCode, 404);
  const own = await f.app.inject({ method: 'GET', url: `/v1/operations/${result.json().id}`, headers: { authorization: `Bearer ${f.tokens['person']}` } });
  assert.equal(own.statusCode, 200);
  const catalog = await f.app.inject({ method: 'GET', url: '/v1/resources', headers });
  assert.equal(catalog.json().participant.kind, 'agent');
  assert.equal(catalog.json().participant.assurance, 'app-bearer-possession');
  assert.ok(!catalog.body.includes('entityId'));
  assert.ok(!catalog.body.includes('attestation'));
  assert.equal(catalog.headers['cache-control'], 'no-store');
});

test('unknown HA outcome is not retried and fences later actions on that resource', async t => {
  const f = fixture(t);
  f.home.outcome = 'outcome_unknown';
  const request = intent();
  const unknown = await f.send(request);
  assert.equal(unknown.statusCode, 202);
  assert.equal(unknown.json().commandState, 'outcome_unknown');
  assert.equal((await f.send(request)).json().id, unknown.json().id);
  assert.equal((await f.send(intent())).statusCode, 409);
  assert.equal(f.home.sent.length, 1);
});

test('post-action evidence failure preserves accepted command and fences further actions', async t => {
  const f = fixture(t);
  f.governance.failAfterAction = true;
  const result = await f.send(intent());
  assert.equal(result.json().commandState, 'accepted');
  assert.equal(result.json().evidenceState, 'needs_attention');
  assert.equal((await f.send(intent())).statusCode, 409);
  assert.equal(f.home.sent.length, 1);
});

test('preflight and stale authorization failure never dispatch', async t => {
  const f = fixture(t);
  f.home.preflightError = new Error('Private upstream diagnostic must not appear in response');
  const result = await f.send(intent());
  assert.equal(result.statusCode, 503);
  assert.ok(!result.body.includes('Private upstream'));
  f.home.preflightError = null;
  f.governance.beforeDispatch = async () => { throw new Error('revoked while queued'); };
  assert.equal((await f.send(intent())).statusCode, 503);
  assert.equal(f.home.sent.length, 0);
});

test('light requests compile only the two explicit on/off services', async t => {
  const f = fixture(t);
  for (const state of ['on', 'off']) {
    const response = await f.send({ ...intent(), resourceId: 'lamp', capability: 'ha.light.set', parameters: { state } });
    assert.equal(response.statusCode, 200);
  }
  assert.deepEqual(f.home.sent.map(a => a.command.service), ['turn_on', 'turn_off']);
  assert.deepEqual(f.home.sent[0]!.command.data, { entity_id: 'light.desk' });
});
