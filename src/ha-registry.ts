import type { InventoryResource } from './inventory.js';

type Entry = Record<string, unknown>;
export interface Registries { areas: Entry[]; devices: Entry[]; entities: Entry[] }

/** Registry metadata is display context, never a dynamic permission selector. */
export function groupInventory(resources: InventoryResource[], data: Registries): InventoryResource[] {
  const devices = new Map(data.devices.map(d => [d['id'], d]));
  const entities = new Map(data.entities.map(e => [e['entity_id'], e]));
  const areas = new Map(data.areas.map(a => [a['area_id'], a]));
  const text = (v: unknown) => typeof v === 'string' && v.length <= 200 ? v : undefined;
  const deviceArea = (device: Entry | undefined, visited = new Set<unknown>()): unknown => {
    if (!device || visited.has(device['id'])) return undefined;
    visited.add(device['id']);
    return device['area_id'] ?? deviceArea(devices.get(device['parent_device_id']), visited);
  };
  return resources.map(resource => {
    const entity = entities.get(resource.entityId);
    const device = devices.get(entity?.['device_id']);
    const areaId = text(entity?.['area_id'] ?? deviceArea(device));
    const areaName = text(areas.get(areaId)?.['name']);
    const deviceId = text(device?.['id']);
    const deviceName = text(device?.['name_by_user'] ?? device?.['name']);
    const registryId = text(entity?.['id']);
    return { ...resource, ...(areaId ? { areaId } : {}), ...(areaName ? { areaName } : {}),
      ...(deviceId ? { deviceId } : {}), ...(deviceName ? { deviceName } : {}), ...(registryId ? { registryId } : {}) };
  });
}

/** One bounded read-only WebSocket session. Failure leaves ungrouped inventory. */
export async function readRegistries(url: string, token: string): Promise<Registries> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const values = new Map<number, Entry[]>();
    let finished = false;
    const done = (error?: Error) => {
      if (finished) return; finished = true; clearTimeout(timer); ws.close();
      if (error) reject(error); else resolve({ areas: values.get(1)!, devices: values.get(2)!, entities: values.get(3)! });
    };
    const timer = setTimeout(() => done(new Error('Home registry unavailable.')), 5000);
    ws.addEventListener('error', () => done(new Error('Home registry unavailable.')));
    ws.addEventListener('close', () => { if (!finished) done(new Error('Home registry unavailable.')); });
    ws.addEventListener('message', event => {
      try {
        const raw = String(event.data); if (raw.length > 8 * 1024 * 1024) throw new Error('Registry too large.');
        const message = JSON.parse(raw) as Entry;
        if (message['type'] === 'auth_required') ws.send(JSON.stringify({ type: 'auth', access_token: token }));
        else if (message['type'] === 'auth_ok') {
          ['config/area_registry/list', 'config/device_registry/list', 'config/entity_registry/list'].forEach((type, i) => ws.send(JSON.stringify({ id: i + 1, type })));
        } else if (message['type'] === 'auth_invalid') throw new Error('Registry access unavailable.');
        else if (message['type'] === 'result') {
          if (message['success'] !== true || !Array.isArray(message['result']) || message['result'].length > 10000) throw new Error('Invalid registry.');
          values.set(Number(message['id']), message['result'].filter((v): v is Entry => !!v && typeof v === 'object' && !Array.isArray(v)));
          if ([1, 2, 3].every(id => values.has(id))) done();
        }
      } catch { done(new Error('Home registry unavailable.')); }
    });
  });
}
