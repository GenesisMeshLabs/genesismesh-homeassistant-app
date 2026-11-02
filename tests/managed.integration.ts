import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LocalAuthorityInfo } from '../src/local-authority.js';
import { ManagedHome } from '../src/managed-home.js';
import { HomeAssistant } from '../src/home-assistant.js';
import { HaSimulator } from './ha-simulator.js';
import { intent } from './helpers.js';
import { createServer } from '../src/server.js';
import type { ActionIntent, Capability } from '../src/contracts.js';
import { GenesisMeshClient, canonicalDigest, seedSigner } from 'genesis-mesh-sdk';
import { readSigningSeed } from '../src/secrets.js';

test('managed HA home provisions scoped access and survives a normal app update/restart', async () => {
  const local = JSON.parse(readFileSync(process.env['GM_HA_TEST_FIXTURE']!, 'utf8')) as LocalAuthorityInfo;
  const simulator = new HaSimulator(); const url = await simulator.start();
  const directory = join(local.directory, 'managed'); mkdirSync(directory);
  const ha = new HomeAssistant(url, simulator.token);
  let home = new ManagedHome(directory, local, ha);
  let service: ReturnType<typeof createServer> | undefined;
  try {
    await home.initialize(); assert.equal(home.ready, false);
    const catalog = await home.catalog(); assert.equal(catalog.length, 2);
    const heating = catalog.find(r => r.kind === 'climate')!;
    const owner = { id: 'native-owner', name: 'Home owner' };
    await home.configure(owner, catalog.map(r => r.id), 19, 23); assert.equal(home.ready, true);
    const access = await home.addMember('Heating machine', 'machine', [heating.id], 1);
    service = createServer(() => home.serviceRuntime()?.config, { execute: (principal, body) => home.actParticipant(principal.id, body) }, home.journal, 'supervisor');
    const send = (temperatureC: number) => service!.inject({ method: 'POST', url: '/v1/actions',
      headers: { authorization: `Bearer ${access.credential}` }, payload: { ...intent(), resourceId: heating.id, parameters: { temperatureC } } });
    assert.equal((await send(21)).statusCode, 200);
    assert.equal((await send(24)).statusCode, 403);
    await service.close(); service = undefined;
    const subject = home.status().members.find(m => m.id === access.id)!;
    const count = simulator.calls.length;
    await home.close();
    // Simulate a pre-expansion persisted membership without explicit operation fields.
    const previous = JSON.parse(readFileSync(join(directory, 'home.json'), 'utf8'));
    for (const member of previous.members) delete member.principal.capabilities;
    writeFileSync(join(directory, 'home.json'), JSON.stringify(previous));
    home = new ManagedHome(directory, local, ha); await home.initialize();
    assert.equal(home.ready, true); assert.equal(home.status().members.find(m => m.id === access.id)?.expiresAt, subject.expiresAt);
    service = createServer(() => home.serviceRuntime()?.config, { execute: (principal, body) => home.actParticipant(principal.id, body) }, home.journal, 'supervisor');
    assert.equal((await send(22)).statusCode, 200); assert.equal(simulator.calls.length, count + 1);
    await home.revoke(access.id); assert.equal((await send(21)).statusCode, 401);
    assert.equal(simulator.calls.length, count + 1);
    assert.ok(!JSON.stringify(home.status()).includes(access.credential));
    assert.equal(home.status().members.find(m => m.id === access.id)!.legacyLimited, true);

    simulator.extraEntities.push(
      { entity_id: 'switch.fixture', state: 'off', attributes: { friendly_name: 'Test plug', access_token: 'private-fixture-attribute', latitude: 1.2 } },
      { entity_id: 'media_player.fixture', state: 'playing', attributes: { friendly_name: 'Test speaker', supported_features: 5, volume_level: 0.3 } },
      { entity_id: 'sensor.fixture', state: '21', attributes: { friendly_name: 'Test sensor', unit_of_measurement: '°C' } },
      { entity_id: 'scene.fixture', state: 'unknown', attributes: { friendly_name: 'Test scene' } },
    );
    const expanded = await home.catalog(); assert.equal(expanded.length, 6);
    await home.configure(owner, expanded.map(r => r.id), 19, 23);
    const plug = expanded.find(r => r.kind === 'switch')!, speaker = expanded.find(r => r.kind === 'media_player')!;
    const reader = await home.addMember('Read-only observer', 'agent', [plug.id], 1, ['ha.entity.read']);
    const request = (credential: string, resourceId: string, capability: Capability, parameters: ActionIntent['parameters']) => service!.inject({ method: 'POST', url: '/v1/actions',
      headers: { authorization: `Bearer ${credential}` }, payload: { ...intent(), resourceId, capability, parameters } });
    const beforeRead = simulator.calls.length;
    const observation = await request(reader.credential, plug.id, 'ha.entity.read', {});
    assert.equal(observation.statusCode, 200); const observed = observation.json();
    assert.equal(observed.commandState, 'observed'); assert.equal(observed.observation.state, 'off');
    assert.equal(simulator.calls.length, beforeRead); assert.ok(!JSON.stringify(observed).includes('private-fixture-attribute'));
    assert.equal((await request(reader.credential, plug.id, 'ha.switch.set', { state: 'on' })).statusCode, 403);
    assert.equal((await request(reader.credential, speaker.id, 'ha.entity.read', {})).statusCode, 403);
    const admin = new GenesisMeshClient({ baseUrl: local.url, audience: local.publicKey, signer: seedSigner(readSigningSeed(local.adminKeyFile), local.adminKeyId) });
    const receipts = await admin.evidenceStore.search({ decision_id: observed.decisionId, entry_kind: 'execution', limit: 2 });
    assert.equal(receipts.entries.length, 1);
    const payload = receipts.entries[0]!.payload;
    assert.ok(JSON.stringify(payload).includes(canonicalDigest(observed.observation)), 'Signed execution receipt must bind the exact sanitized observation');
    assert.ok(!JSON.stringify(payload).includes('private-fixture-attribute'));
    // Deliberately loosen only the trusted local test config. Signed membership still denies the new capability.
    const localReader = home.serviceRuntime()!.config.principals.find(p => p.id === reader.id)!;
    localReader.capabilities!.push('ha.switch.set');
    const signedDenial = await request(reader.credential, plug.id, 'ha.switch.set', { state: 'on' });
    assert.equal(signedDenial.statusCode, 403); assert.equal(signedDenial.json().commandState, 'denied'); assert.ok(signedDenial.json().decisionId);
    localReader.capabilities = ['ha.entity.read'];
    assert.equal(simulator.calls.length, beforeRead);
    await home.updateMember(reader.id, [plug.id], ['ha.switch.set'], 1);
    assert.equal((await request(reader.credential, plug.id, 'ha.entity.read', {})).statusCode, 403);
    assert.equal((await request(reader.credential, plug.id, 'ha.switch.set', { state: 'on' })).statusCode, 200);
    assert.equal(simulator.calls.at(-1)!.data['entity_id'], 'switch.fixture');
    const media = await home.addMember('Media controller', 'machine', [speaker.id], 1, ['ha.media.volume']);
    assert.equal((await request(media.credential, speaker.id, 'ha.media.volume', { volumePct: 41 })).statusCode, 200);
    assert.equal(simulator.calls.at(-1)!.data['volume_level'], 0.41);
    assert.equal((await request(media.credential, speaker.id, 'ha.media.transport', { action: 'pause' })).statusCode, 403);
    const callsAfter = simulator.calls.length;
    await home.revoke(media.id);
    assert.equal((await request(media.credential, speaker.id, 'ha.media.volume', { volumePct: 42 })).statusCode, 401);
    assert.equal(simulator.calls.length, callsAfter);
  } finally { await service?.close(); await home.close(); await simulator.close(); }
});
