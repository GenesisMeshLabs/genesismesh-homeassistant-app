import { capabilities, type Capability } from './device-actions.js';
export { capabilities, type Capability } from './device-actions.js';
export type ParticipantKind = 'person' | 'agent' | 'machine' | 'device' | 'service';

export interface Principal {
  id: string;
  kind: ParticipantKind;
  credentialSha256: string;
  expiresAt: string;
  attestationId: string;
  resources: string[];
  enabled: boolean;
  capabilities?: Capability[];
}
export interface Resource {
  id: string;
  name: string;
  entityId: string;
  kind: string;
}
export interface PolicyRef { id: string; version: number; digest: string }
export interface RuntimeConfig {
  homeId: string;
  dataDir: string;
  authority: {
    url: string;
    publicKey: string;
    audience: string;
    sovereignId: string;
    operatorKeyId: string;
    operatorKeyFile: string;
    executorId: string;
    executorKeyId: string;
    executorKeyFile: string;
    expectations: { capability: Capability; policies: PolicyRef[] }[];
  };
  homeAssistant: { url: string; tokenFile: string };
  principals: Principal[];
  resources: Resource[];
}

interface IntentBase { requestId: string; resourceId: string; expiresAt: string }
export interface ActionIntent extends IntentBase { capability: Capability; parameters: Record<string, string | number> }
export interface Observation { state: string; attributes: Record<string, string | number | boolean>; observedAt: string }
export interface CompiledAction {
  requestId: string;
  subjectId: string;
  subjectKind: ParticipantKind;
  homeId: string;
  resource: Resource;
  capability: Capability;
  expiresAt: string;
  parameters: Record<string, string | number>;
  command: { domain: string; service: string; data: Record<string, string | number | boolean> };
  digest: string;
}
export type CommandState = 'reserved' | 'denied' | 'blocked' | 'dispatching' | 'accepted' | 'observed' | 'outcome_unknown';
export type EvidenceState = 'none' | 'pending' | 'acknowledged' | 'needs_attention';
export interface Operation {
  id: string;
  requestId: string;
  subjectId: string;
  subjectKind: ParticipantKind;
  resourceId: string;
  capability: Capability;
  digest: string;
  commandState: CommandState;
  evidenceState: EvidenceState;
  decisionId: string | null;
  evidenceId: string | null;
  policyFailures: string[];
  reason: string;
  createdAt: string;
  updatedAt: string;
  observation?: Observation;
}

const id = { type: 'string', pattern: '^[a-z0-9][a-z0-9_.:-]{0,79}$' } as const;
const path = { type: 'string', minLength: 1, maxLength: 4096 } as const;
const digest = { type: 'string', pattern: '^[a-f0-9]{64}$' } as const;
const key = { type: 'string', pattern: '^[A-Za-z0-9+/]{43}=$' } as const;
const text = { type: 'string', minLength: 1, maxLength: 200 } as const;
const date = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$' } as const;
const object = (properties: object, required: string[]) => ({ type: 'object', additionalProperties: false, properties, required });

export const configSchema = object({
  homeId: id, dataDir: path,
  authority: object({
    url: path, publicKey: key, audience: key, sovereignId: text,
    operatorKeyId: text, operatorKeyFile: path, executorId: text,
    executorKeyId: text, executorKeyFile: path,
    expectations: { type: 'array', minItems: 1, maxItems: 64, items: object({
      capability: { enum: capabilities },
      policies: { type: 'array', minItems: 1, maxItems: 16, items: object({
        id: text, version: { type: 'integer', minimum: 1 }, digest,
      }, ['id', 'version', 'digest']) },
    }, ['capability', 'policies']) },
  }, ['url', 'publicKey', 'audience', 'sovereignId', 'operatorKeyId', 'operatorKeyFile', 'executorId', 'executorKeyId', 'executorKeyFile', 'expectations']),
  homeAssistant: object({ url: path, tokenFile: path }, ['url', 'tokenFile']),
  principals: { type: 'array', minItems: 1, maxItems: 256, items: object({
    id, kind: { enum: ['person', 'agent', 'machine', 'device', 'service'] },
    credentialSha256: digest, expiresAt: date, attestationId: text,
    resources: { type: 'array', uniqueItems: true, maxItems: 256, items: id }, enabled: { type: 'boolean' },
    capabilities: { type: 'array', uniqueItems: true, minItems: 1, maxItems: 64, items: { enum: capabilities } },
  }, ['id', 'kind', 'credentialSha256', 'expiresAt', 'attestationId', 'resources', 'enabled']) },
  resources: { type: 'array', minItems: 1, maxItems: 256, items: object({
    id, name: text, entityId: { type: 'string', pattern: '^[a-z_][a-z0-9_]*\\.[a-z0-9_]+$' },
    kind: { type: 'string', pattern: '^[a-z_][a-z0-9_]*$' },
  }, ['id', 'name', 'entityId', 'kind']) },
}, ['homeId', 'dataDir', 'authority', 'homeAssistant', 'principals', 'resources']);

const base = {
  requestId: { type: 'string', pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' },
  resourceId: id, expiresAt: date,
};
const required = ['requestId', 'resourceId', 'expiresAt', 'capability', 'parameters'];
import { operationParameterSchema } from './device-actions.js';
export const actionSchema = { oneOf: capabilities.map(capability =>
  object({ ...base, capability: { const: capability }, parameters: operationParameterSchema(capability) }, required)) };
