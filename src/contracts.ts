export const capabilities = ['ha.climate.set_temperature', 'ha.light.set'] as const;
export type Capability = typeof capabilities[number];
export type ParticipantKind = 'person' | 'agent' | 'machine' | 'device' | 'service';

export interface Principal {
  id: string;
  kind: ParticipantKind;
  credentialSha256: string;
  expiresAt: string;
  attestationId: string;
  resources: string[];
  enabled: boolean;
}
export interface Resource {
  id: string;
  name: string;
  entityId: string;
  kind: 'climate' | 'light';
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
export type ActionIntent = IntentBase & (
  | { capability: 'ha.climate.set_temperature'; parameters: { temperatureC: number } }
  | { capability: 'ha.light.set'; parameters: { state: 'on' | 'off' } }
);
export interface CompiledAction {
  requestId: string;
  subjectId: string;
  subjectKind: ParticipantKind;
  homeId: string;
  resource: Resource;
  capability: Capability;
  expiresAt: string;
  parameters: Record<string, string | number>;
  command: { domain: 'climate' | 'light'; service: string; data: Record<string, string | number> };
  digest: string;
}
export type CommandState = 'reserved' | 'denied' | 'blocked' | 'dispatching' | 'accepted' | 'outcome_unknown';
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
    expectations: { type: 'array', minItems: 1, maxItems: 2, items: object({
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
  }, ['id', 'kind', 'credentialSha256', 'expiresAt', 'attestationId', 'resources', 'enabled']) },
  resources: { type: 'array', minItems: 1, maxItems: 256, items: object({
    id, name: text, entityId: { type: 'string', pattern: '^(climate|light)\\.[a-z0-9_]+$' },
    kind: { enum: ['climate', 'light'] },
  }, ['id', 'name', 'entityId', 'kind']) },
}, ['homeId', 'dataDir', 'authority', 'homeAssistant', 'principals', 'resources']);

const base = {
  requestId: { type: 'string', pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' },
  resourceId: id, expiresAt: date,
};
const required = ['requestId', 'resourceId', 'expiresAt', 'capability', 'parameters'];
export const actionSchema = { oneOf: [
  object({ ...base, capability: { const: 'ha.climate.set_temperature' }, parameters: object({
    temperatureC: { type: 'number', minimum: -50, maximum: 60 },
  }, ['temperatureC']) }, required),
  object({ ...base, capability: { const: 'ha.light.set' }, parameters: object({
    state: { enum: ['on', 'off'] },
  }, ['state']) }, required),
] };
