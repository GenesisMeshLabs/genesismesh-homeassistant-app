import type { Governance } from './authority.js';
import type { ActionIntent, Operation, Principal, RuntimeConfig } from './contracts.js';
import type { HomeExecutor } from './home-assistant.js';
import { AppError } from './errors.js';
import { Journal } from './journal.js';
import { compileAction } from './requests.js';

/** Serialize both dispatches and evidence chains; no uncertain operation is automatically retried. */
export class Executor {
  private tail: Promise<unknown> = Promise.resolve();
  private queued = 0;

  constructor(private readonly config: RuntimeConfig, private readonly journal: Journal,
    private readonly authority: Governance, private readonly home: HomeExecutor) {}

  private async exclusive<T>(work: () => Promise<T>): Promise<T> {
    if (this.queued >= 32) throw new AppError('executor_busy', 'The executor is busy. Try again later.', 429);
    this.queued++;
    const result = this.tail.then(work);
    this.tail = result.catch(() => undefined);
    try { return await result; } finally { this.queued--; }
  }

  async execute(principal: Principal, intent: ActionIntent): Promise<Operation> {
    return this.exclusive(async () => {
      // The queue may have outlived a credential or intent.
      if (!principal.enabled || Date.now() >= Date.parse(principal.expiresAt)) {
        throw new AppError('unauthenticated', 'This participant credential expired.', 401);
      }
      const action = compileAction(this.config, principal, intent);
      const existing = this.journal.find(principal.id, action.requestId);
      const operation = this.journal.reserve(action);
      if (existing) return operation;
      try {
        const result = await this.authority.run(principal, action, operation.id, async verified => {
          this.journal.patch(operation.id, { decisionId: verified.decisionId });
          await this.home.preflight(action);
          await verified.beforeDispatch();
          if (Date.now() >= Date.parse(action.expiresAt) || Date.now() >= Date.parse(principal.expiresAt)) {
            throw new AppError('authorization_stale', 'The request expired before dispatch. No action was sent.', 403);
          }
          this.journal.patch(operation.id, { commandState: 'dispatching', evidenceState: 'pending', reason: 'waiting_for_home' });
          const outcome = await this.home.dispatch(action);
          this.journal.patch(operation.id, { commandState: outcome, reason: outcome === 'accepted' ? 'ha_accepted_unconfirmed' : 'ha_response_unknown' });
          return {
            value: outcome, outcome: outcome === 'accepted' ? 'success' : 'partial',
            outcome_detail: outcome === 'accepted' ? 'Home Assistant accepted the command; physical result unconfirmed.' : 'Command response unknown; do not retry automatically.',
            execution_parameters: {
              subject_id: principal.id, participant_kind: principal.kind, action_digest: action.digest,
              command_status: outcome, entity_id: action.resource.entityId, adapter: 'ha-finite-v1', rotatable: false,
            },
          };
        });
        this.journal.patch(operation.id, {
          decisionId: result.decisionId, evidenceId: result.evidenceId, evidenceState: result.evidenceState, policyFailures: result.policyFailures,
          ...(!result.authorized ? { commandState: 'denied' as const, reason: 'authority_denied' } : {}),
        });
      } catch (error) {
        const current = this.journal.get(operation.id)!;
        if (current.commandState === 'reserved') {
          this.journal.patch(operation.id, {
            commandState: 'blocked',
            reason: error instanceof AppError ? error.code : 'authority_unavailable_or_unverified',
          });
        } else {
          this.journal.patch(operation.id, {
            commandState: current.commandState === 'dispatching' ? 'outcome_unknown' : current.commandState,
            evidenceState: 'needs_attention', reason: 'outcome_or_evidence_needs_review',
          });
        }
      }
      return this.journal.get(operation.id)!;
    });
  }

  async flush(): Promise<void> {
    return this.exclusive(async () => {
      const updates = await this.authority.flush();
      for (const update of updates) {
        for (const op of this.journal.all()) {
          if (op.evidenceId === update.id) this.journal.patch(op.id, { evidenceState: update.state });
        }
      }
    });
  }

  async idle(): Promise<void> { await this.tail; }
}
