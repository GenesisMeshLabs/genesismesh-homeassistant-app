// Disposable Supervisor/Core proxy simulator. Never a physical HA acceptance claim.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { WebSocketServer } from 'ws';

const token = 'container-fixture-only';
const entities = [
  { entity_id: 'light.desk', state: 'off', attributes: { friendly_name: 'Desk lamp' } },
  { entity_id: 'climate.living_room', state: 'heat', attributes: { friendly_name: 'Heating', min_temp: 7, max_temp: 35 } },
];
if (process.argv[2] === 'serve') {
  let calls = 0, administrator = true;
  const server = createServer(async (req, res) => {
    const send = (value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(value)); };
    if (req.url === '/fixture/calls') return send({ calls });
    if (req.url === '/fixture/demote') { administrator = false; return send({}); }
    if (req.url === '/fixture/promote') { administrator = true; return send({}); }
    if (req.headers.authorization !== `Bearer ${token}`) return send({}, 401);
    if (req.url === '/core/api/states') return send(entities);
    if (req.url === '/core/api/config') return send({ unit_system: { temperature: '°C' } });
    const entity = entities.find(e => req.url === `/core/api/states/${e.entity_id}`);
    if (entity) return send(entity);
    if (req.method === 'POST' && /^\/core\/api\/services\/(light\/turn_(on|off)|climate\/set_temperature)$/.test(req.url)) { calls++; return send([]); }
    send({}, 404);
  });
  const ws = new WebSocketServer({ server, path: '/core/websocket' });
  ws.on('connection', socket => {
    socket.send(JSON.stringify({ type: 'auth_required', ha_version: 'fixture' }));
    let authenticated = false;
    socket.on('message', raw => {
      const message = JSON.parse(raw);
      if (message.type === 'auth' && message.access_token === token) { authenticated = true; socket.send(JSON.stringify({ type: 'auth_ok', ha_version: 'fixture' })); }
      else if (authenticated && message.type === 'config/auth/list') socket.send(JSON.stringify({ id: message.id, type: 'result', success: true,
        result: [{ id: 'ha-owner', name: 'Home owner', is_owner: false, is_active: true, system_generated: false, group_ids: administrator ? ['system-admin'] : ['system-users'] }] }));
      else socket.close();
    });
  });
  server.listen(80, '0.0.0.0');
} else {
  const base = 'http://172.30.32.4:8099';
  let healthy = false;
  for (let i = 0; i < 180; i++) {
    try { if ((await fetch(base + '/health', { signal: AbortSignal.timeout(1000) })).ok) { healthy = true; break; } } catch {}
    await delay(500);
  }
  assert.ok(healthy, 'Managed app did not become healthy');
  const headers = { 'X-Remote-User-Id': 'ha-owner' };
  const session = await (await fetch(base + '/api/session', { headers })).json();
  assert.ok(session.csrf);
  async function ui(path, input) {
    const response = await fetch(base + '/api/' + path, { headers: { ...headers, 'Content-Type': 'application/json', 'X-GM-CSRF': session.csrf },
      ...(input ? { method: 'POST', body: JSON.stringify(input) } : {}) });
    return { status: response.status, body: await response.json() };
  }
  const calls = async () => (await (await fetch('http://127.0.0.1/fixture/calls')).json()).calls;
  async function action(credential, resourceId, temperatureC = 21) {
    return fetch('http://172.30.32.4:8098/v1/actions', { method: 'POST', headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: randomUUID(), resourceId, capability: 'ha.climate.set_temperature', parameters: { temperatureC }, expiresAt: new Date(Date.now() + 60000).toISOString() }) });
  }
  if (process.argv[2] === 'first') {
    assert.equal((await fetch(base + '/api/status')).status, 401);
    assert.equal((await ui('status')).body.ready, false);
    const catalog = (await ui('catalog')).body.resources;
    assert.equal(catalog.length, 2);
    assert.equal((await ui('setup', { resources: catalog.map(r => r.id), minimum: 19, maximum: 23 })).status, 200);
    const resourceId = catalog.find(r => r.kind === 'climate').id;
    const member = (await ui('access', { name: 'Container machine', kind: 'machine', resources: [resourceId], hours: 1 })).body;
    assert.ok(member.credential);
    assert.equal((await action(member.credential, resourceId)).status, 200);
    const count = await calls();
    assert.equal((await action(member.credential, resourceId, 24)).status, 403);
    assert.equal(await calls(), count);
    await fetch('http://127.0.0.1/fixture/demote');
    assert.equal((await ui('status')).status, 403);
    await fetch('http://127.0.0.1/fixture/promote');
    writeFileSync('/tmp/smoke-state.json', JSON.stringify({ ...member, resourceId, count }), { mode: 0o600 });
    console.log('Fresh container: automatic authority, scoped access, policy denial, native-role refresh passed.');
  } else if (process.argv[2] === 'restart') {
    const saved = JSON.parse(readFileSync('/tmp/smoke-state.json'));
    const status = (await ui('status')).body;
    assert.equal(status.ready, true); assert.ok(status.members.some(m => m.id === saved.id));
    assert.ok(!JSON.stringify(status).includes(saved.credential));
    assert.equal((await action(saved.credential, saved.resourceId, 22)).status, 200);
    assert.equal((await ui('revoke', { id: saved.id })).status, 200);
    const count = await calls();
    assert.equal((await action(saved.credential, saved.resourceId)).status, 401);
    assert.equal(await calls(), count);
    console.log('Restart: same identity/access, durable activity, revocation without dispatch passed.');
  } else throw new Error('Unknown smoke phase');
}
