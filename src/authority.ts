import {
  attestationDigest, canonicalDigest, canonicalJson, ExecutionRecorder, GenesisMeshClient, governedAction,
  policyDigest, seedSigner, verifyAttestationSignature, verifyBoundaryDecision, verifyPolicySignature,
  type ActionReport, type BoundaryDecision, type BoundaryPolicy, type MembershipAttestation,
} from 'genesis-mesh-sdk';
import type { CommandState, CompiledAction, EvidenceState, Principal, RuntimeConfig } from './contracts.js';
import { AppError } from './errors.js';
import { Journal } from './journal.js';
import { decisionParameters } from './requests.js';

export interface VerifiedAction {
  decisionId: string;
  beforeDispatch(): Promise<void>;
}
export interface GovernanceResult {
  authorized: boolean;
  decisionId: string;
  evidenceId: string | null;
  evidenceState: EvidenceState;
  policyFailures: string[];
}
export interface Governance {
  run(principal: Principal, action: CompiledAction, operationId: string,
    act: (verified: VerifiedAction) => Promise<ActionReport<CommandState>>): Promise<GovernanceResult>;
  flush(): Promise<{ id: string; state: EvidenceState }[]>;
}

export class Authority implements Governance {
  readonly client: GenesisMeshClient;
  private readonly recorder: ExecutionRecorder;
  private readonly keys: string[];

  constructor(private readonly config: RuntimeConfig, private readonly journal: Journal,
    operatorSeed: string, executorSeed: string, fetcher = globalThis.fetch) {
    this.keys = [config.authority.publicKey];
    this.client = new GenesisMeshClient({
      baseUrl: config.authority.url, audience: config.authority.audience,
      signer: seedSigner(operatorSeed, config.authority.operatorKeyId), timeout: 3000,
      outbox: journal.outbox,
      fetch: (input, init) => fetcher(input, { ...init, redirect: 'error' }),
    });
    this.recorder = new ExecutionRecorder({
      executorSovereignId: config.authority.executorId,
      signer: seedSigner(executorSeed, config.authority.executorKeyId),
    });
  }

  private async policies(action: CompiledAction): Promise<BoundaryPolicy[]> {
    const expected = this.config.authority.expectations.find(e => e.capability === action.capability)?.policies;
    if (!expected?.length) throw new AppError('policy_expectations_missing', 'This action has no configured policy expectations.', 503);
    const active = await this.client.policy.active();
    if (!active.policy_set_healthy || active.enforcement !== 'required') {
      throw new AppError('policy_unhealthy', 'The authority must require a healthy policy set before this app can act.', 503);
    }
    return expected.map(ref => {
      const found = active.active.find(p => p.policy_id === ref.id && p.version === ref.version);
      if (!found || policyDigest(found.policy) !== ref.digest || !verifyPolicySignature(found.policy, this.keys)) {
        throw new AppError('policy_changed', 'The expected access policy changed. Review its configuration before trying again.', 503);
      }
      return found.policy;
    });
  }

  private async attestation(principal: Principal): Promise<MembershipAttestation> {
    const record = await this.client.attestation.get(principal.attestationId);
    if (record.attestation.subject_id !== principal.id || !verifyAttestationSignature(record.attestation, this.keys)) {
      throw new AppError('identity_binding_invalid', 'The participant identity does not match its trusted attestation.', 403);
    }
    return record.attestation;
  }

  /** Bind the full stored context to the signed decision and the exact compiled HA operation. */
  private async context(decision: BoundaryDecision, action: CompiledAction, principal: Principal, contextId: string): Promise<unknown> {
    const records = await this.client.evidenceStore.search({ decision_id: decision.decision_id, entry_kind: 'decision', limit: 2 });
    const event = records.entries.length === 1 ? records.entries[0] : undefined;
    const context = event?.payload['context'] as Record<string, unknown> | undefined;
    if (!context || canonicalJson(event?.payload['decision']) !== canonicalJson(decision) ||
        canonicalDigest(context) !== decision.policy_binding?.context_digest ||
        context['context_id'] !== contextId || context['attestation_id'] !== principal.attestationId ||
        context['agreement_id'] !== principal.attestationId || context['parent_kind'] !== 'attestation' ||
        context['requester_sovereign_id'] !== principal.id || context['provider_sovereign_id'] !== this.config.authority.sovereignId ||
        context['requested_capability'] !== action.capability ||
        canonicalJson(context['request_parameters']) !== canonicalJson(decisionParameters(action)) ||
        canonicalJson(context['attributes']) !== canonicalJson({ participant_kind: principal.kind }) ||
        context['context_freshness_seq'] !== 0) {
      throw new AppError('request_binding_invalid', 'The authority decision does not match this exact request.', 503);
    }
    const requestedAt = Date.parse(String(context['requested_at']));
    if (!Number.isFinite(requestedAt) || requestedAt > Date.now() + 1000 || Date.now() - requestedAt > 10_000) {
      throw new AppError('request_context_stale', 'The evaluated request is too old to execute.', 503);
    }
    return context;
  }

  async run(principal: Principal, action: CompiledAction, operationId: string,
    act: (verified: VerifiedAction) => Promise<ActionReport<CommandState>>): Promise<GovernanceResult> {
    const policies = await this.policies(action);
    const attestation = await this.attestation(principal);
    const contextId = `ha:${action.digest}`;
    const verification = { operatorPublicKeys: this.keys, expectedPolicies: policies, expectedAttestation: attestation };
    const result = await governedAction(this.client, this.recorder, {
      attestation_id: principal.attestationId, requested_capability: action.capability,
      context: { context_id: contextId, requester_sovereign_id: principal.id,
        provider_sovereign_id: this.config.authority.sovereignId,
        request_parameters: decisionParameters(action), attributes: { participant_kind: principal.kind } },
      resource_id: action.capability === 'ha.entity.read' ? `ha:${action.homeId}/observations/${operationId}` : `ha:${action.homeId}/${action.resource.id}`,
      resource_action: action.capability === 'ha.entity.read' ? 'create' : 'update', verify: verification,
      // Deliberately no breakGlass: an outage or DENY never opens the executor.
    }, async decision => {
      // Even a verified callback that stops during context/preflight checks can
      // produce SDK failure evidence; associate it before any such check fails.
      this.journal.patch(operationId, { decisionId: decision.decision_id });
      const context = await this.context(decision, action, principal, contextId);
      this.journal.keepDecision(operationId, { decision, context, policies, attestation });
      return act({
        decisionId: decision.decision_id,
        beforeDispatch: async () => {
          await this.policies(action);
          const current = await this.client.attestation.get(principal.attestationId);
          const verified = verifyBoundaryDecision(decision, verification);
          if (!verified.accepted || !verified.authorized || current.status !== 'active' ||
              !verifyAttestationSignature(current.attestation, this.keys) || attestationDigest(current.attestation) !== attestationDigest(attestation) ||
              Date.now() >= Date.parse(current.attestation.expires_at) ||
              Date.now() >= Date.parse(principal.expiresAt) || Date.now() >= Date.parse(action.expiresAt) ||
              Date.now() - Date.parse(decision.decision_made_at) > 10_000) {
            throw new AppError('authorization_stale', 'Access changed or expired before dispatch. No action was sent.', 403);
          }
        },
      });
    });
    if (result.authorized && !result.evidence) {
      throw new AppError('execution_evidence_missing', 'The action needs an evidence review before further execution.', 503);
    }
    return {
      authorized: result.authorized, decisionId: result.evaluation.decision.decision_id,
      evidenceId: result.evidence?.evidence_id ?? null,
      evidenceState: !result.authorized ? 'none' : result.submission ? 'acknowledged'
        : result.queued?.state === 'dead_letter' ? 'needs_attention' : 'pending',
      policyFailures: result.summary.enforced_failures.map(failure => failure.gate),
    };
  }

  async flush(): Promise<{ id: string; state: EvidenceState }[]> {
    const result = await this.client.evidenceStore.flushPending();
    return [
      ...result.admitted.map(e => ({ id: e.id, state: 'acknowledged' as const })),
      ...result.dead_lettered.map(e => ({ id: e.id, state: 'needs_attention' as const })),
    ];
  }
}
