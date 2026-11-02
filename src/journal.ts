import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { canonicalJson, parseJson, type EvidenceOutbox, type OutboxEntry } from 'genesis-mesh-sdk';
import type { CompiledAction, Operation } from './contracts.js';
import { AppError } from './errors.js';
import { definition } from './device-actions.js';

/** One writer per data directory. A separate SQLite exclusive lock is released on process death. */
export class Journal {
  private readonly lock: DatabaseSync;
  private readonly db: DatabaseSync;
  readonly outbox: EvidenceOutbox;

  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.lock = new DatabaseSync(join(directory, 'writer-lock.sqlite'));
    try {
      this.lock.exec('PRAGMA busy_timeout=0; CREATE TABLE IF NOT EXISTS owner (id INTEGER); BEGIN EXCLUSIVE;');
    } catch {
      this.lock.close();
      throw new Error('Another executor owns this data directory, or its writer lock is unavailable.');
    }
    let opened: DatabaseSync | undefined;
    try {
      this.db = opened = new DatabaseSync(join(directory, 'operations.sqlite'));
      this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=1000;');
      const version = this.db.prepare('PRAGMA user_version').get()!['user_version'];
      if (version !== 0 && version !== 1) throw new Error('Unsupported journal schema version.');
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS operations (
          id TEXT PRIMARY KEY, subject TEXT NOT NULL, request_id TEXT NOT NULL,
          digest TEXT NOT NULL, resource TEXT NOT NULL, data TEXT NOT NULL,
          UNIQUE(subject, request_id)
        );
        CREATE TABLE IF NOT EXISTS outbox (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS decisions (operation_id TEXT PRIMARY KEY, data TEXT NOT NULL);
        PRAGMA user_version=1;
      `);
      this.recover();
    } catch (error) {
      // The lock must be released even if opening/migrating the operation DB fails.
      opened?.close();
      this.lock.close();
      throw error;
    }
    this.outbox = {
      add: async entry => {
        this.atomic(() => {
          this.db.prepare('INSERT INTO outbox(id, data) VALUES (?, ?)').run(entry.id, canonicalJson(entry));
          this.linkEvidence(entry, 'pending');
        });
      },
      update: async entry => {
        this.atomic(() => {
          const result = this.db.prepare('UPDATE outbox SET data=? WHERE id=?').run(canonicalJson(entry), entry.id);
          if (result.changes) this.linkEvidence(entry, entry.state === 'dead_letter' ? 'needs_attention' : 'pending');
        });
      },
      remove: async id => {
        this.atomic(() => {
          const row = this.db.prepare('SELECT data FROM outbox WHERE id=?').get(id);
          if (row) this.linkEvidence(parseJson(String(row['data'])) as OutboxEntry, 'acknowledged');
          this.db.prepare('DELETE FROM outbox WHERE id=?').run(id);
        });
      },
      list: async () => this.db.prepare('SELECT data FROM outbox ORDER BY seq').all()
        .map(row => parseJson(String(row['data'])) as OutboxEntry),
    };
  }

  private atomic(work: () => void): void {
    this.db.exec('BEGIN IMMEDIATE');
    try { work(); this.db.exec('COMMIT'); }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  private linkEvidence(entry: OutboxEntry, state: Operation['evidenceState']): void {
    const rows = this.db.prepare("SELECT id FROM operations WHERE json_extract(data, '$.decisionId')=?").all(entry.evidence.decision_id);
    for (const row of rows) this.patch(String(row['id']), { evidenceId: entry.id, evidenceState: state });
  }

  private recover(): void {
    for (const row of this.db.prepare('SELECT data FROM outbox ORDER BY seq').all()) {
      const entry = parseJson(String(row['data'])) as OutboxEntry;
      this.linkEvidence(entry, entry.state === 'dead_letter' ? 'needs_attention' : 'pending');
    }
    for (const op of this.all()) {
      if (op.commandState === 'reserved') this.patch(op.id, {
        commandState: 'blocked', reason: 'restart_before_dispatch',
      });
      if (op.commandState === 'dispatching') this.patch(op.id, {
        commandState: 'outcome_unknown', evidenceState: 'needs_attention', reason: 'restart_during_dispatch',
      });
      if ((op.commandState === 'accepted' || op.commandState === 'observed' || op.commandState === 'outcome_unknown') && !op.evidenceId) {
        this.patch(op.id, { evidenceState: 'needs_attention' });
      }
    }
  }

  all(): Operation[] {
    return this.db.prepare('SELECT data FROM operations ORDER BY rowid').all().map(row => JSON.parse(String(row['data'])) as Operation);
  }

  latest(limit: number): Operation[] {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('Invalid activity limit.');
    return this.db.prepare('SELECT data FROM operations ORDER BY rowid DESC LIMIT ?').all(limit).map(row => JSON.parse(String(row['data'])) as Operation);
  }

  get(id: string): Operation | undefined {
    const row = this.db.prepare('SELECT data FROM operations WHERE id=?').get(id);
    return row ? JSON.parse(String(row['data'])) as Operation : undefined;
  }

  find(subject: string, requestId: string): Operation | undefined {
    const row = this.db.prepare('SELECT data FROM operations WHERE subject=? AND request_id=?').get(subject, requestId);
    return row ? JSON.parse(String(row['data'])) as Operation : undefined;
  }

  reserve(action: CompiledAction): Operation {
    const existing = this.find(action.subjectId, action.requestId);
    if (existing) {
      if (existing.digest !== action.digest) throw new AppError('request_conflict', 'That request ID already names a different action.', 409);
      return existing;
    }
    if (action.capability !== 'ha.entity.read' && this.db.prepare(`SELECT 1 FROM operations WHERE resource=? AND
        json_extract(data, '$.capability') != 'ha.entity.read' AND
        (json_extract(data, '$.commandState') IN ('outcome_unknown', 'dispatching') OR json_extract(data, '$.evidenceState')='needs_attention') LIMIT 1`).get(action.resource.id)) {
      throw new AppError('resource_needs_reconciliation', 'An earlier action on this resource needs review before another can be sent.', 409);
    }
    const now = new Date().toISOString();
    const op: Operation = {
      id: randomUUID(), requestId: action.requestId, subjectId: action.subjectId, subjectKind: action.subjectKind,
      resourceId: action.resource.id, capability: action.capability, digest: action.digest,
      commandState: 'reserved', evidenceState: 'none', decisionId: null, evidenceId: null, policyFailures: [],
      reason: 'awaiting_authority', createdAt: now, updatedAt: now,
      parameters: structuredClone(action.parameters),
      summary: `${definition(action.capability)?.label ?? action.capability}${Object.keys(action.parameters).length ? ` · ${Object.entries(action.parameters).map(([key, value]) => `${key === 'temperature_c' ? 'Temperature °C' : key === 'numeric_setting' ? 'Value' : definition(action.capability)?.parameters.find(p => p.name === key)?.label ?? key}: ${value}`).join(', ')}` : ''}`.slice(0, 500),
    };
    this.db.prepare('INSERT INTO operations(id, subject, request_id, digest, resource, data) VALUES (?, ?, ?, ?, ?, ?)')
      .run(op.id, op.subjectId, op.requestId, op.digest, op.resourceId, JSON.stringify(op));
    return op;
  }

  patch(id: string, changes: Partial<Pick<Operation, 'commandState' | 'evidenceState' | 'decisionId' | 'evidenceId' | 'reason' | 'policyFailures' | 'observation'>>): Operation {
    const op = this.get(id);
    if (!op) throw new Error('Operation does not exist.');
    Object.assign(op, changes, { updatedAt: new Date().toISOString() });
    this.db.prepare('UPDATE operations SET data=? WHERE id=?').run(JSON.stringify(op), id);
    return op;
  }

  keepDecision(id: string, value: unknown): void {
    this.db.prepare('INSERT OR REPLACE INTO decisions(operation_id, data) VALUES (?, ?)').run(id, canonicalJson(value));
  }

  close(): void {
    this.db.close();
    this.lock.close();
  }
}
