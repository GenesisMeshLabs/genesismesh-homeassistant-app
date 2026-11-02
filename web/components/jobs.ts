import { readCapability, type Resource } from './models.js';

export type Purpose = 'observer' | 'media';
export const purposes: { id: Purpose; title: string; description: string; name: string }[] = [
  { id: 'observer', title: 'Keep an eye on my home', description: 'Let an existing Home Assistant workflow read selected measurements. It cannot change devices.', name: 'Home observer' },
  { id: 'media', title: 'Give a media helper limits', description: 'Control playback on selected speakers and set a maximum volume.', name: 'Media helper' },
];
export const purposeCapabilities = (purpose: Purpose, resources: Resource[]) => {
  const supported = new Set(resources.flatMap(resource => resource.operations.map(operation => operation.capability)));
  const wanted = purpose === 'observer' ? [readCapability] : purpose === 'media'
    ? [readCapability, 'ha.media.transport', 'ha.media.volume'] : [];
  return wanted.filter(capability => supported.has(capability));
};
export const purposeMatches = (purpose: Purpose, resource: Resource) => purpose === 'observer' ? resource.readable
  : purpose === 'media' ? resource.kind === 'media_player' && resource.operations.some(operation => operation.capability.startsWith('ha.media.'))
    : resource.kind === 'light' && resource.operations.some(operation => operation.capability.startsWith('ha.light.'));

export interface DeviceGroup { key: string; name: string; resources: Resource[] }
export interface RoomGroup { name: string; devices: DeviceGroup[] }
export function groupHome(resources: Resource[]): RoomGroup[] {
  const rooms = new Map<string, Map<string, DeviceGroup>>();
  for (const resource of resources) {
    const area = resource.areaName || resource.area || 'Other devices';
    let devices = rooms.get(area); if (!devices) { devices = new Map(); rooms.set(area, devices); }
    const key = resource.deviceId || `entity:${resource.id}`;
    let device = devices.get(key);
    if (!device) { device = { key, name: resource.deviceName || resource.name, resources: [] }; devices.set(key, device); }
    device.resources.push(resource);
  }
  return [...rooms].sort(([a], [b]) => a === 'Other devices' ? 1 : b === 'Other devices' ? -1 : a.localeCompare(b))
    .map(([name, devices]) => ({ name, devices: [...devices.values()].sort((a, b) => a.name.localeCompare(b.name)) }));
}
