import { canonicalDigest } from 'genesis-mesh-sdk';
import type { Resource, Observation } from './contracts.js';
import { operationOptions, canRead, type ActionOption } from './device-actions.js';
import { AppError } from './errors.js';

export interface InventoryResource extends Resource {
  state: string; available: boolean; readable: boolean; operations: ActionOption[]; reason?: string;
  areaId?: string; areaName?: string; deviceId?: string; deviceName?: string; registryId?: string;
}
export function serviceSet(value: unknown): Set<string> {
  if (!Array.isArray(value)) throw new AppError('home_unavailable', 'Home Assistant returned an invalid action catalog.', 503);
  const result = new Set<string>();
  for (const item of value) if (item && typeof item.domain === 'string' && /^[a-z_][a-z0-9_]*$/.test(item.domain) && item.services && typeof item.services === 'object') {
    for (const service of Object.keys(item.services)) if (/^[a-z_][a-z0-9_]*$/.test(service)) result.add(`${item.domain}.${service}`);
  }
  return result;
}
export function inventory(states: unknown, services: Set<string>): InventoryResource[] {
  if (!Array.isArray(states)) throw new AppError('home_unavailable', 'Home Assistant returned an invalid device inventory.', 503);
  const valid = states.filter((v): v is Record<string, unknown> => !!v && typeof v === 'object' &&
    typeof v['entity_id'] === 'string' && /^[a-z_][a-z0-9_]*\.[a-z0-9_]+$/.test(v['entity_id']));
  if (valid.length > 5000) throw new AppError('inventory_capacity', 'This preview supports an inventory of up to 5,000 entities. No partial list was returned.', 503);
  return valid.map(item => {
    const entityId = String(item['entity_id']), kind = entityId.split('.')[0]!;
    const attributes = item['attributes'] && typeof item['attributes'] === 'object' && !Array.isArray(item['attributes']) ? item['attributes'] as Record<string, unknown> : {};
    const operations = operationOptions(kind, attributes, services);
    const readable = canRead(kind);
    const available = typeof item['state'] === 'string' && !['unknown', 'unavailable'].includes(item['state']);
    const reason = !readable ? 'Private location or free-text data needs a dedicated permission-aware adapter. Visible to the administrator; not available for delegation.'
      : kind === 'scene' || kind === 'script' || kind === 'automation' || kind === 'button' || kind === 'input_button'
        ? 'Status can be shared. Running this could affect other devices; its full action scope needs a dedicated adapter.'
        : operations.length === 1 ? 'Status can be shared. Device controls are not yet supported by a finite adapter or advertised by this integration.'
          : !available ? 'Currently unavailable or unknown. Controls are rechecked before every request.' : undefined;
    return { id: `r-${canonicalDigest(entityId).slice(0, 24)}`, entityId, kind,
      name: String(attributes['friendly_name'] ?? entityId).slice(0, 200),
      state: readable ? String(item['state'] ?? 'unknown').slice(0, 200) : 'Private state',
      available, readable, operations, ...(reason ? { reason } : {}) };
  }).sort((a, b) => a.name.localeCompare(b.name));
}
export function inventorySummary(resources: InventoryResource[]) {
  const domains: Record<string, number> = Object.create(null);
  for (const resource of resources) domains[resource.kind] = (domains[resource.kind] ?? 0) + 1;
  return { total: resources.length, returned: resources.length, truncated: false,
    controllable: resources.filter(r => r.operations.some(op => op.capability !== 'ha.entity.read')).length,
    readable: resources.filter(r => r.readable).length, domains };
}

/** Explicit observation fields; never forward raw HA attributes (URLs, GPS, tokens, pictures). */
export function observeState(resource: Resource, input: Record<string, unknown>): Observation {
  if (!canRead(resource.kind) || input['entity_id'] !== resource.entityId || typeof input['state'] !== 'string') throw new AppError('observation_unavailable', 'The selected status could not be read safely.', 503);
  const attrs = input['attributes'];
  const attributes: Observation['attributes'] = {};
  if (attrs && typeof attrs === 'object' && !Array.isArray(attrs)) {
    for (const key of ['unit_of_measurement', 'device_class', 'temperature', 'current_temperature', 'brightness', 'volume_level', 'is_volume_muted', 'percentage', 'current_position', 'humidity', 'current_humidity', 'battery_level', 'hvac_action']) {
      const value = (attrs as Record<string, unknown>)[key];
      if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.length <= 100 && !/:\/\//.test(value))) attributes[key] = value;
    }
  }
  return { state: String(input['state']).slice(0, 200), attributes, observedAt: new Date().toISOString() };
}
