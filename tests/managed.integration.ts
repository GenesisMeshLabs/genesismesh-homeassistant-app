import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { LocalAuthorityInfo } from '../src/local-authority.js';
import { ManagedHome } from '../src/managed-home.js';
import { HomeAssistant } from '../src/home-assistant.js';
import { HaSimulator } from './ha-simulator.js';
import { intent } from './helpers.js';
import { createServer } from '../src/server.js';

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
    await home.close(); home = new ManagedHome(directory, local, ha); await home.initialize();
    assert.equal(home.ready, true); assert.equal(home.status().members.find(m => m.id === access.id)?.expiresAt, subject.expiresAt);
    service = createServer(() => home.serviceRuntime()?.config, { execute: (principal, body) => home.actParticipant(principal.id, body) }, home.journal, 'supervisor');
    assert.equal((await send(22)).statusCode, 200); assert.equal(simulator.calls.length, count + 1);
    await home.revoke(access.id); assert.equal((await send(21)).statusCode, 401);
    assert.equal(simulator.calls.length, count + 1);
    assert.ok(!JSON.stringify(home.status()).includes(access.credential));
  } finally { await service?.close(); await home.close(); await simulator.close(); }
});
