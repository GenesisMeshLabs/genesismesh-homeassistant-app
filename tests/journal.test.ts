import test from 'node:test';
import assert from 'node:assert/strict';
import { Journal } from '../src/journal.js';
import { compileAction } from '../src/requests.js';
import { configuration, intent, testDirectory } from './helpers.js';
import { ExecutionRecorder, seedSigner, type OutboxEntry } from 'genesis-mesh-sdk';
import { randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';

test('journal reservation survives restart and never replenishes a dispatched request', t => {
  const dir = testDirectory(t);
  const { config } = configuration(dir);
  const action = compileAction(config, config.principals[0]!, intent());
  let journal = new Journal(dir);
  const operation = journal.reserve(action);
  journal.patch(operation.id, { commandState: 'dispatching' });
  journal.close();
  journal = new Journal(dir);
  try {
    const recovered = journal.reserve(action);
    assert.equal(recovered.id, operation.id);
    assert.equal(recovered.commandState, 'outcome_unknown');
    assert.equal(recovered.evidenceState, 'needs_attention');
    assert.throws(() => journal.reserve(compileAction(config, config.principals[0]!, intent())));
  } finally { journal.close(); }
});

test('a reservation interrupted before dispatch is blocked on restart and never retried', t => {
  const dir = testDirectory(t);
  const { config } = configuration(dir);
  const action = compileAction(config, config.principals[0]!, intent());
  let journal = new Journal(dir);
  const operation = journal.reserve(action);
  journal.close();
  journal = new Journal(dir);
  try {
    assert.equal(journal.reserve(action).commandState, 'blocked');
    assert.equal(journal.get(operation.id)!.reason, 'restart_before_dispatch');
  } finally { journal.close(); }
});

test('a second writer cannot open the same data directory', t => {
  const dir = testDirectory(t);
  const journal = new Journal(dir);
  try { assert.throws(() => new Journal(dir), /Another executor/); }
  finally { journal.close(); }
});

test('a closed or unwritable journal cannot reserve another operation', t => {
  const dir = testDirectory(t);
  const { config } = configuration(dir);
  const journal = new Journal(dir);
  journal.close();
  assert.throws(() => journal.reserve(compileAction(config, config.principals[0]!, intent())));
});

test('the writer exclusion also holds across separate Node processes', async t => {
  const dir = testDirectory(t);
  const journal = new Journal(dir);
  try {
    const result = await promisify(execFile)(process.execPath, [resolve('dist/tests/lock-probe.js'), dir], { windowsHide: true });
    assert.equal(result.stdout.trim(), 'writer-refused');
  } finally { journal.close(); }
});

test('SDK outbox entries and operation delivery survive restart and acknowledge together', async t => {
  const dir = testDirectory(t);
  const { config } = configuration(dir);
  let journal = new Journal(dir);
  const action = compileAction(config, config.principals[0]!, intent());
  const op = journal.reserve(action);
  journal.patch(op.id, { commandState: 'accepted', decisionId: 'storage-test-decision', evidenceState: 'pending' });
  const recorder = new ExecutionRecorder({ executorSovereignId: 'test-executor',
    signer: seedSigner(randomBytes(32).toString('base64'), 'storage-test-signer') });
  const evidence = await recorder.record({
    decision: { decision_id: 'storage-test-decision', context_id: 'storage-test-context', agreement_id: 'storage-test-basis' },
    executed_capability: action.capability, outcome: 'success',
  });
  const entry: OutboxEntry = { id: evidence.evidence_id, evidence, state: 'pending', attempts: 0,
    queued_at: new Date().toISOString(), next_attempt_at: null, last_error: null };
  await journal.outbox.add(entry);
  journal.close();
  journal = new Journal(dir);
  try {
    assert.equal((await journal.outbox.list()).length, 1);
    assert.equal(journal.get(op.id)!.evidenceId, evidence.evidence_id);
    assert.equal(journal.get(op.id)!.evidenceState, 'pending');
    // The SDK removes an outbox entry only after admission; this tests that storage contract, not a fabricated NA acknowledgement.
    await journal.outbox.remove(entry.id);
    assert.equal((await journal.outbox.list()).length, 0);
    assert.equal(journal.get(op.id)!.evidenceState, 'acknowledged');
  } finally { journal.close(); }
});

test('a pre-dispatch failure with dead-letter evidence fences the resource too', t => {
  const dir = testDirectory(t);
  const { config } = configuration(dir);
  const journal = new Journal(dir);
  try {
    const op = journal.reserve(compileAction(config, config.principals[0]!, intent()));
    journal.patch(op.id, { commandState: 'blocked', evidenceState: 'needs_attention' });
    assert.throws(() => journal.reserve(compileAction(config, config.principals[0]!, intent())), /needs review/);
  } finally { journal.close(); }
});
