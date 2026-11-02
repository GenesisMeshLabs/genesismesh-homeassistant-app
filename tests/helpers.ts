import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import type { TestContext } from 'node:test';
import type { ActionReport } from 'genesis-mesh-sdk';
import type { Governance, GovernanceResult, VerifiedAction } from '../src/authority.js';
import type { CommandState, CompiledAction, Principal, RuntimeConfig } from '../src/contracts.js';
import { credentialDigest } from '../src/identity.js';
import { Journal } from '../src/journal.js';
import { Executor } from '../src/executor.js';
import { createServer } from '../src/server.js';
import type { HomeExecutor } from '../src/home-assistant.js';

export function testDirectory(t: TestContext, beforeCleanup?: () => Promise<void> | void): string {
  const root = resolve('temp');
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(join(root, 'unit-'));
  t.after(async () => {
    await beforeCleanup?.();
    if (dirname(resolve(dir)) !== root) throw new Error('Refusing cleanup outside the test root.');
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

export function configuration(dataDir: string): { config: RuntimeConfig; tokens: Record<string, string> } {
  const tokens: Record<string, string> = {};
  const principals = (['person', 'agent', 'machine', 'device', 'service'] as const).map(kind => {
    const token = randomBytes(32).toString('base64url');
    tokens[kind] = token;
    return { id: kind, kind, credentialSha256: credentialDigest(token), enabled: true,
      expiresAt: new Date(Date.now() + 3600000).toISOString(), attestationId: `attestation-${kind}`, resources: ['heating', 'lamp'] };
  });
  return { tokens, config: {
    homeId: 'test-home', dataDir,
    authority: {
      url: 'http://127.0.0.1:19443', publicKey: Buffer.alloc(32).toString('base64'), audience: Buffer.alloc(32).toString('base64'),
      sovereignId: 'TEST', operatorKeyId: 'evaluator', operatorKeyFile: 'not-used', executorId: 'home-executor',
      executorKeyId: 'executor', executorKeyFile: 'not-used', expectations: [
        { capability: 'ha.climate.set_temperature', policies: [{ id: 'climate', version: 1, digest: 'a'.repeat(64) }] },
        { capability: 'ha.light.set', policies: [{ id: 'light', version: 1, digest: 'b'.repeat(64) }] },
      ],
    },
    homeAssistant: { url: 'http://127.0.0.1:18123/api', tokenFile: 'not-used' },
    principals,
    resources: [
      { id: 'heating', name: 'Living-room heating', kind: 'climate', entityId: 'climate.living_room' },
      { id: 'lamp', name: 'Desk lamp', kind: 'light', entityId: 'light.desk' },
    ],
  } };
}

export class FakeGovernance implements Governance {
  calls = 0;
  allowed = true;
  outage = false;
  failAfterAction = false;
  beforeDispatch = async () => {};
  async run(_principal: Principal, _action: CompiledAction, _operationId: string,
    act: (verified: VerifiedAction) => Promise<ActionReport<CommandState>>): Promise<GovernanceResult> {
    this.calls++;
    if (this.outage) throw new Error('Simulated authority outage, never a real authorization.');
    if (this.allowed) await act({ decisionId: 'test-decision', beforeDispatch: this.beforeDispatch });
    if (this.failAfterAction) throw new Error('Simulated record failure.');
    return { authorized: this.allowed, decisionId: 'test-decision', evidenceId: this.allowed ? 'test-evidence' : null,
      evidenceState: this.allowed ? 'acknowledged' : 'none', policyFailures: this.allowed ? [] : ['test/range'] };
  }
  async flush() { return []; }
}

export class FakeHome implements HomeExecutor {
  sent: CompiledAction[] = [];
  checked = 0;
  outcome: 'accepted' | 'outcome_unknown' = 'accepted';
  preflightError: Error | null = null;
  async preflight() {
    this.checked++;
    if (this.preflightError) throw this.preflightError;
  }
  async dispatch(action: CompiledAction) { this.sent.push(action); return this.outcome; }
}

export function fixture(t: TestContext) {
  let release = async () => {};
  const dir = testDirectory(t, () => release());
  const { config, tokens } = configuration(dir);
  const journal = new Journal(dir);
  const governance = new FakeGovernance();
  const home = new FakeHome();
  const executor = new Executor(config, journal, governance, home);
  const app = createServer(config, executor, journal);
  release = async () => { await app.close(); await executor.idle(); journal.close(); };
  const send = (body: unknown, kind = 'person', extraHeaders = {}) => app.inject({
    method: 'POST', url: '/v1/actions', headers: { authorization: `Bearer ${tokens[kind]}`, ...extraHeaders }, payload: body as object,
  });
  return { dir, config, tokens, journal, governance, home, executor, app, send };
}

export function intent() {
  return { requestId: randomUUID(), resourceId: 'heating', capability: 'ha.climate.set_temperature' as const,
    expiresAt: new Date(Date.now() + 60000).toISOString(), parameters: { temperatureC: 21 } };
}
