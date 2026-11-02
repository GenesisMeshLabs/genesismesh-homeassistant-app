import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { commandFor, operationOptions } from '../src/device-actions.js';
import { inventory, inventorySummary, observeState } from '../src/inventory.js';
import { compileAction } from '../src/requests.js';
import { HomeAssistant } from '../src/home-assistant.js';
import { configuration, fixture, intent } from './helpers.js';

test('whole-home inventory includes passive/unsupported domains and explains private state', () => {
  const resources = inventory(['light', 'switch', 'media_player', 'fan', 'vacuum', 'cover', 'sensor', 'binary_sensor', 'scene', 'todo', 'camera', 'lock', 'person', 'input_text'].map(kind => ({
    entity_id: `${kind}.fixture`, state: kind === 'person' ? 'Secret exact location' : 'off', attributes: { friendly_name: `${kind} fixture`, access_token: 'not-for-clients', latitude: 1.25 },
  })), new Set(['light.turn_on', 'light.turn_off']));
  const summary = inventorySummary(resources); assert.equal(summary.total, 14); assert.equal(summary.truncated, false);
  assert.equal(resources.find(r => r.kind === 'scene')!.operations.length, 1);
  assert.match(resources.find(r => r.kind === 'scene')!.reason!, /other devices/);
  assert.equal(resources.find(r => r.kind === 'person')!.readable, false);
  assert.equal(resources.find(r => r.kind === 'person')!.state, 'Private state');
  assert.ok(!JSON.stringify(resources).includes('Secret exact location')); assert.ok(!JSON.stringify(resources).includes('not-for-clients'));
  assert.equal(Object.values(summary.domains).reduce((a, b) => a + b), 14);
});

test('finite commands bind exact services/target and reject target, URL and parameter expansion', () => {
  assert.deepEqual(commandFor('media_player', 'ha.media.volume', 'media_player.fixture', { volumePct: 41 }),
    { domain: 'media_player', service: 'volume_set', data: { entity_id: 'media_player.fixture', volume_level: 0.41 } });
  assert.deepEqual(commandFor('cover', 'ha.cover.move', 'cover.fixture', { direction: 'close' }).service, 'close_cover');
  const { config } = configuration('unused'); const principal = config.principals[0]!;
  principal.capabilities = ['ha.entity.read', 'ha.light.brightness'];
  const base = { ...intent(), resourceId: 'lamp', capability: 'ha.light.brightness' as const, parameters: { brightnessPct: 32 } };
  assert.equal(compileAction(config, principal, base).command.data['brightness_pct'], 32);
  for (const parameters of [{ brightnessPct: 101 }, { brightnessPct: -1 }, { brightnessPct: 32, entity_id: 'light.other' }, { brightnessPct: 32, url: 'https://other.example' }]) {
    assert.throws(() => compileAction(config, principal, { ...base, parameters }));
  }
  assert.throws(() => compileAction(config, principal, { ...base, resourceId: 'heating' }));
});

test('legacy clients do not acquire read or brightness permission with an app upgrade', () => {
  const { config } = configuration('unused'); const principal = config.principals[0]!;
  assert.equal(compileAction(config, principal, intent()).capability, 'ha.climate.set_temperature');
  assert.throws(() => compileAction(config, principal, { ...intent(), capability: 'ha.entity.read', parameters: {} }), /not granted/);
  assert.throws(() => compileAction(config, principal, { ...intent(), resourceId: 'lamp', capability: 'ha.light.brightness', parameters: { brightnessPct: 30 } }), /not granted/);
});

test('native features and entity class narrow controls even when HA advertises a domain service', () => {
  const mediaServices = new Set(['media_player.volume_set', 'media_player.media_play', 'media_player.media_pause', 'media_player.turn_on']);
  assert.deepEqual(operationOptions('media_player', { supported_features: 4 }, mediaServices).map(op => op.capability), ['ha.entity.read', 'ha.media.volume']);
  const options = operationOptions('media_player', { supported_features: 1 }, mediaServices);
  assert.deepEqual(options.find(op => op.capability === 'ha.media.transport')!.parameters[0]!.options, ['pause']);
  const coverServices = new Set(['cover.open_cover', 'cover.set_cover_position']);
  assert.deepEqual(operationOptions('cover', { device_class: 'garage', supported_features: 5 }, coverServices).map(op => op.capability), ['ha.entity.read']);
  assert.equal(operationOptions('cover', { device_class: 'blind', supported_features: 5 }, coverServices).length, 3);
});

test('observation excludes raw private attributes and private free-text/location domains', () => {
  const resource = { id: 'fixture', name: 'Fixture', kind: 'sensor', entityId: 'sensor.fixture' };
  const observed = observeState(resource, { entity_id: resource.entityId, state: '21', attributes: { unit_of_measurement: '°C', latitude: 14.3,
    entity_picture: '/api/camera_proxy/secret', token: 'secret', url: 'https://private.example', device_class: 'temperature' } });
  assert.deepEqual(observed.attributes, { unit_of_measurement: '°C', device_class: 'temperature' });
  assert.ok(!JSON.stringify(observed).includes('secret'));
  assert.throws(() => observeState({ ...resource, kind: 'person', entityId: 'person.fixture' }, { entity_id: 'person.fixture', state: 'Secret address' }));
});

test('fresh native option and number range changes stop the exact command before dispatch', async () => {
  const { config } = configuration('unused'); const principal = config.principals[0]!;
  config.resources.push({ id: 'helper', entityId: 'input_number.fixture', name: 'Number', kind: 'input_number' }); principal.resources.push('helper'); principal.capabilities = ['ha.helper.number'];
  const action = compileAction(config, principal, { ...intent(), resourceId: 'helper', capability: 'ha.helper.number', parameters: { value: 25 } });
  const home = new HomeAssistant('http://127.0.0.1/api', 'fixture-token', async input => new Response(JSON.stringify(String(input).endsWith('/services')
    ? [{ domain: 'input_number', services: { set_value: {} } }] : { entity_id: 'input_number.fixture', state: '10', attributes: { min: 0, max: 20, step: 1 } })));
  await assert.rejects(home.preflight(action), /outside the device-supported range/);
});

test('read evidence failure does not fence physical writes, and observing never clears an uncertain write fence', async t => {
  const f = fixture(t); const principal = f.config.principals[0]!;
  principal.capabilities = ['ha.entity.read', 'ha.climate.set_temperature'];
  f.governance.failAfterAction = true;
  const observed = await f.executor.execute(principal, { ...intent(), capability: 'ha.entity.read', parameters: {} });
  assert.equal(observed.commandState, 'observed'); assert.equal(observed.evidenceState, 'needs_attention'); assert.equal(f.home.sent.length, 0);
  f.governance.failAfterAction = false;
  const written = await f.executor.execute(principal, intent()); assert.equal(written.commandState, 'accepted');
  f.home.outcome = 'outcome_unknown'; await f.executor.execute(principal, intent());
  const readAfter = await f.executor.execute(principal, { ...intent(), capability: 'ha.entity.read', parameters: {} }); assert.equal(readAfter.commandState, 'observed');
  await assert.rejects(f.executor.execute(principal, { ...intent(), requestId: randomUUID() }), /needs review/);
});

test('climate modes use their native allowlist without accidentally requiring a temperature', async () => {
  const { config } = configuration('unused'); const principal = config.principals[0]!;
  principal.capabilities = ['ha.climate.mode'];
  const action = compileAction(config, principal, { ...intent(), capability: 'ha.climate.mode', parameters: { mode: 'heat' } });
  let modes = ['off', 'heat'];
  const adapter = new HomeAssistant('http://127.0.0.1/api', 'fixture-token', async input => new Response(JSON.stringify(String(input).endsWith('/services')
    ? [{ domain: 'climate', services: { set_hvac_mode: {} } }] : { entity_id: 'climate.living_room', state: 'off', attributes: { hvac_modes: modes } })));
  await adapter.preflight(action); modes = ['off'];
  await assert.rejects(adapter.preflight(action), /no longer supports/);
});

test('native helper and fan step values are enforced before dispatch', async () => {
  for (const [kind, capability, params, attrs, service] of [
    ['input_number', 'ha.helper.number', { value: 3 }, { min: 0, max: 20, step: 2 }, 'set_value'],
    ['fan', 'ha.fan.speed', { percentage: 30 }, { percentage_step: 25, supported_features: 1 }, 'set_percentage'],
  ] as const) {
    const { config } = configuration('unused'); const principal = config.principals[0]!;
    config.resources.push({ id: 'step-fixture', entityId: `${kind}.fixture`, name: 'Step fixture', kind }); principal.resources.push('step-fixture'); principal.capabilities = [capability];
    const action = compileAction(config, principal, { ...intent(), resourceId: 'step-fixture', capability, parameters: params });
    const adapter = new HomeAssistant('http://127.0.0.1/api', 'fixture-token', async input => new Response(JSON.stringify(String(input).endsWith('/services')
      ? [{ domain: kind, services: { [service]: {} } }] : { entity_id: `${kind}.fixture`, state: 'off', attributes: attrs })));
    await assert.rejects(adapter.preflight(action), /device-supported step/);
  }
});
