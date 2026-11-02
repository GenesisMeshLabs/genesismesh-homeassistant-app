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
  let home = new ManagedHome(directory, local, ha, 'fixture-mesh');
  let service: ReturnType<typeof createServer> | undefined;
  try {
    await home.initialize(); assert.equal(home.ready, false);
    const catalog = await home.catalog(); assert.equal(catalog.length, 2);
    const heating = catalog.find(r => r.kind === 'climate')!;
    const owner = { id: 'native-owner', name: 'Home owner' };
    await home.configure(owner, catalog.map(r => r.id), 19, 23); assert.equal(home.ready, true);
    const access = await home.addMember('Heating machine', 'machine', [heating.id], 1);
    assert.equal(home.status().members.find(m => m.id === access.id)!.connection.state, 'not_connected');
    assert.equal(home.status().connectionGuide.baseUrl, 'http://fixture-mesh:8098');
    service = createServer(() => home.serviceRuntime()?.config, { execute: (principal, body) => home.actParticipant(principal.id, body) }, home.journal, 'supervisor', id => home.noteClientVisit(id));
    assert.equal((await service.inject({ url: '/v1/resources', headers: { authorization: `Bearer ${access.credential}` } })).statusCode, 200);
    assert.equal(home.status().members.find(m => m.id === access.id)!.connection.state, 'active');
    assert.ok(home.status().members.find(m => m.id === access.id)!.connection.lastRequestAt);
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
    home = new ManagedHome(directory, local, ha, 'fixture-mesh'); await home.initialize();
    assert.equal(home.ready, true); assert.equal(home.status().members.find(m => m.id === access.id)?.expiresAt, subject.expiresAt);
    service = createServer(() => home.serviceRuntime()?.config, { execute: (principal, body) => home.actParticipant(principal.id, body) }, home.journal, 'supervisor', id => home.noteClientVisit(id));
    assert.equal(home.status().members.find(m => m.id === access.id)!.connection.state, 'active');
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
      { entity_id: 'input_number.fixture', state: '5', attributes: { friendly_name: 'Test numeric helper', min: 0, max: 20, step: 1 } },
    );
    const expanded = await home.catalog(); assert.equal(expanded.length, 7);
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
    const numericResource = expanded.find(r => r.kind === 'input_number')!;
    const numeric = await home.addMember('Numeric helper controller', 'machine', [numericResource.id], 1, ['ha.helper.number']);
    const numericResult = await request(numeric.credential, numericResource.id, 'ha.helper.number', { value: 7 });
    assert.equal(numericResult.statusCode, 200); assert.equal(numericResult.json().commandState, 'accepted');
    assert.match(numericResult.json().summary, /Value: 7/);
    assert.deepEqual(numericResult.json().parameters, { numeric_setting: 7 });
    assert.equal(simulator.calls.at(-1)!.data['value'], 7);
    const media = await home.addMember('Media controller', 'machine', [speaker.id], 1, ['ha.media.volume']);
    assert.equal((await request(media.credential, speaker.id, 'ha.media.volume', { volumePct: 41 })).statusCode, 200);
    assert.equal(simulator.calls.at(-1)!.data['volume_level'], 0.41);
    assert.match(home.status().activity[0]!.summary!, /Volume %: 41/);
    assert.equal((await request(media.credential, speaker.id, 'ha.media.transport', { action: 'pause' })).statusCode, 403);
    await home.updateMember(media.id, [speaker.id], ['ha.media.volume'], 1, { maxVolumePct: 40 });
    assert.equal(home.status().members.find(m => m.id === media.id)!.limits.maxVolumePct, 40);
    const callsBeforeLimit = simulator.calls.length;
    const tooLoud = await request(media.credential, speaker.id, 'ha.media.volume', { volumePct: 41 });
    assert.equal(tooLoud.statusCode, 403); assert.equal(tooLoud.json().commandState, 'denied');
    assert.ok(tooLoud.json().decisionId); assert.ok(tooLoud.json().policyFailures.some((gate: string) => gate.endsWith('/participant-volume-ceiling')));
    assert.equal(simulator.calls.length, callsBeforeLimit);
    assert.equal((await request(media.credential, speaker.id, 'ha.media.volume', { volumePct: 39 })).statusCode, 200);
    await home.updateMember(media.id, [speaker.id], ['ha.media.volume'], 1, { maxVolumePct: 80 });
    assert.equal((await request(media.credential, speaker.id, 'ha.media.volume', { volumePct: 60 })).statusCode, 200);
    const mediaPrincipal = home.serviceRuntime()!.config.principals.find(p => p.id === media.id)!;
    mediaPrincipal.expiresAt = new Date(Date.now() - 1000).toISOString();
    assert.equal(home.status().members.find(m => m.id === media.id)!.connection.state, 'expired');
    assert.equal((await request(media.credential, speaker.id, 'ha.media.volume', { volumePct: 30 })).statusCode, 401);
    await home.updateMember(media.id, [speaker.id], ['ha.media.volume'], 1);
    assert.equal(home.status().members.find(m => m.id === media.id)!.limits.maxVolumePct, 80);
    assert.equal((await request(media.credential, speaker.id, 'ha.media.volume', { volumePct: 30 })).statusCode, 200);
    const internalAdmin = (home as unknown as { admin: GenesisMeshClient }).admin;
    const publish = internalAdmin.policy.publish;
    internalAdmin.policy.publish = async () => { throw new Error('Disposable policy publication outage'); };
    try { await assert.rejects(home.updateMember(media.id, [speaker.id], ['ha.media.volume'], 1, { maxVolumePct: 40 }), /publication outage/); }
    finally { internalAdmin.policy.publish = publish; }
    assert.equal(home.status().members.find(m => m.id === media.id)!.connection.state, 'needs_review');
    assert.equal((await request(media.credential, speaker.id, 'ha.media.volume', { volumePct: 30 })).statusCode, 401);
    await home.updateMember(media.id, [speaker.id], ['ha.media.volume'], 1, { maxVolumePct: 40 });
    assert.equal(home.status().members.find(m => m.id === media.id)!.connection.state, 'active');
    assert.equal((await request(media.credential, speaker.id, 'ha.media.volume', { volumePct: 30 })).statusCode, 200);
    const callsAfter = simulator.calls.length;
    await home.revoke(media.id);
    assert.equal(home.status().members.find(m => m.id === media.id)!.connection.state, 'revoked');
    await assert.rejects(home.updateMember(media.id, [speaker.id], ['ha.media.volume'], 1), /cannot be renewed/);
    assert.equal((await request(media.credential, speaker.id, 'ha.media.volume', { volumePct: 42 })).statusCode, 401);
    assert.equal(simulator.calls.length, callsAfter);
  } finally { await service?.close(); await home.close(); await simulator.close(); }
});
