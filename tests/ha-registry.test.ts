import test from 'node:test';
import assert from 'node:assert/strict';
import { groupInventory } from '../src/ha-registry.js';
import { inventory } from '../src/inventory.js';

test('native grouping resolves entity override, child area inheritance, cycles and unassigned devices without changing permission IDs', () => {
  const source = inventory(['one', 'two', 'three', 'four'].map(name => ({ entity_id: `sensor.${name}`, state: '1', attributes: { friendly_name: name } })), new Set());
  const grouped = groupInventory(source, {
    areas: [{ area_id: 'living', name: 'Living room' }, { area_id: 'kitchen', name: 'Kitchen' }],
    devices: [{ id: 'parent', name: 'Speaker', area_id: 'living' }, { id: 'child', name: 'Left channel', parent_device_id: 'parent' },
      { id: 'loop', parent_device_id: 'loop' }],
    entities: [{ id: 'entry1', entity_id: 'sensor.one', device_id: 'child' }, { entity_id: 'sensor.two', device_id: 'child', area_id: 'kitchen' },
      { entity_id: 'sensor.three', device_id: 'loop' }],
  });
  assert.equal(grouped.find(r => r.entityId === 'sensor.one')!.areaName, 'Living room');
  assert.equal(grouped.find(r => r.entityId === 'sensor.one')!.registryId, 'entry1');
  assert.equal(grouped.find(r => r.entityId === 'sensor.two')!.areaName, 'Kitchen');
  assert.equal(grouped.find(r => r.entityId === 'sensor.three')!.areaName, undefined);
  assert.equal(grouped.find(r => r.entityId === 'sensor.four')!.deviceId, undefined);
  assert.deepEqual(grouped.map(r => r.id), source.map(r => r.id));
});
