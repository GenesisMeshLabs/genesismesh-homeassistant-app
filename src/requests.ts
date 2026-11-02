import { canonicalDigest } from 'genesis-mesh-sdk';
import type { ActionIntent, CompiledAction, Principal, RuntimeConfig } from './contracts.js';
import { AppError } from './errors.js';
import { Ajv } from 'ajv';
import { actionSchema } from './contracts.js';
import { commandFor, legacyCapabilities } from './device-actions.js';

const validIntent = new Ajv({ strict: true }).compile(actionSchema);

export function compileAction(config: RuntimeConfig, principal: Principal, intent: ActionIntent): CompiledAction {
  if (!validIntent(intent)) throw new AppError('invalid_request', 'Choose a supported action and its exact parameters.');
  const expiry = Date.parse(intent.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= Date.now() || expiry > Date.now() + 120_000) {
    throw new AppError('intent_expired', 'Requests must expire within the next two minutes.');
  }
  const resource = config.resources.find(r => r.id === intent.resourceId);
  if (!resource || !principal.resources.includes(resource.id)) {
    throw new AppError('resource_not_shared', 'This resource is not shared with this participant.', 403);
  }
  if (!(principal.capabilities ?? legacyCapabilities).includes(intent.capability)) throw new AppError('operation_not_shared', 'This operation was not granted to this participant.', 403);
  const parameters: Record<string, string | number> = intent.capability === 'ha.climate.set_temperature'
    ? { temperature_c: intent.parameters['temperatureC']! }
    : intent.capability === 'ha.helper.number' ? { numeric_setting: intent.parameters['value']! } : { ...intent.parameters };
  let command: CompiledAction['command'];
  try { command = commandFor(resource.kind, intent.capability, resource.entityId, intent.parameters); }
  catch { throw new AppError('unsupported_action', 'This action is not supported for the selected resource.'); }
  const body = {
    version: 1, adapter: 'ha-finite-v1', home_id: config.homeId, requester: principal.id, kind: principal.kind,
    request_id: intent.requestId, resource_id: resource.id, entity_id: resource.entityId,
    capability: intent.capability, parameters, command, expires_at: intent.expiresAt,
  };
  return {
    requestId: intent.requestId, subjectId: principal.id, subjectKind: principal.kind, homeId: config.homeId,
    resource: structuredClone(resource), capability: intent.capability, expiresAt: intent.expiresAt,
    parameters, command, digest: canonicalDigest(body),
  };
}

export function decisionParameters(action: CompiledAction): Record<string, unknown> {
  return {
    ...action.parameters, home_id: action.homeId, resource_id: action.resource.id,
    entity_id: action.resource.entityId, action_digest: action.digest, adapter: 'ha-finite-v1',
    expires_at: action.expiresAt,
  };
}
