import { canonicalDigest } from 'genesis-mesh-sdk';
import type { ActionIntent, CompiledAction, Principal, RuntimeConfig } from './contracts.js';
import { AppError } from './errors.js';

export function compileAction(config: RuntimeConfig, principal: Principal, intent: ActionIntent): CompiledAction {
  const expiry = Date.parse(intent.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= Date.now() || expiry > Date.now() + 120_000) {
    throw new AppError('intent_expired', 'Requests must expire within the next two minutes.');
  }
  const resource = config.resources.find(r => r.id === intent.resourceId);
  if (!resource || !principal.resources.includes(resource.id)) {
    throw new AppError('resource_not_shared', 'This resource is not shared with this participant.', 403);
  }
  const climate = intent.capability === 'ha.climate.set_temperature';
  if ((climate && resource.kind !== 'climate') || (!climate && resource.kind !== 'light')) {
    throw new AppError('unsupported_action', 'This action is not supported for the selected resource.');
  }
  const parameters: Record<string, string | number> = climate
    ? { temperature_c: intent.parameters.temperatureC }
    : { state: intent.parameters.state };
  const command: CompiledAction['command'] = climate
    ? { domain: 'climate', service: 'set_temperature', data: { entity_id: resource.entityId, temperature: intent.parameters.temperatureC } }
    : { domain: 'light', service: intent.parameters.state === 'on' ? 'turn_on' : 'turn_off', data: { entity_id: resource.entityId } };
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
