// Disposable real HA Core, not HA OS/Supervisor or physical-device acceptance.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { SupervisorRoles } from '../dist/src/ha-identity.js';
import { HomeAssistant } from '../dist/src/home-assistant.js';
const base = 'http://127.0.0.1:8123';
let ready = false;
for (let i = 0; i < 240; i++) {
  try { if ((await fetch(base + '/api/onboarding', { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {}
  await delay(500);
}
assert.ok(ready, 'Real HA Core did not become ready');
const clientId = base + '/';
const onboarding = await fetch(base + '/api/onboarding/users', { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Disposable owner', username: 'fixture-owner', password: randomBytes(32).toString('base64url'), client_id: clientId, language: 'en' }), signal: AbortSignal.timeout(30000) });
assert.equal(onboarding.status, 200);
const { auth_code: code } = await onboarding.json(); assert.equal(typeof code, 'string');
const login = await fetch(base + '/auth/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: clientId }), signal: AbortSignal.timeout(5000) });
assert.equal(login.status, 200);
const { access_token: token } = await login.json(); assert.equal(typeof token, 'string');
const socket = new WebSocket('ws://127.0.0.1:8123/api/websocket');
const pending = new Map(); let next = 0;
await new Promise((ok, no) => {
  const timer = setTimeout(() => no(new Error('HA WebSocket authentication timeout')), 10000);
  socket.addEventListener('error', () => { clearTimeout(timer); no(new Error('HA WebSocket failure')); });
  socket.addEventListener('message', event => {
    const value = JSON.parse(String(event.data));
    if (value.type === 'auth_required') socket.send(JSON.stringify({ type: 'auth', access_token: token }));
    else if (value.type === 'auth_ok') { clearTimeout(timer); ok(); }
    else if (value.type === 'result') { const entry = pending.get(value.id); pending.delete(value.id); value.success ? entry?.ok(value.result) : entry?.no(new Error('Native HA command refused')); }
  });
});
function command(type, input = {}) {
  return new Promise((ok, no) => {
    const id = ++next;
    const timer = setTimeout(() => { pending.delete(id); no(new Error('Native HA command timeout')); }, 5000);
    pending.set(id, { ok: value => { clearTimeout(timer); ok(value); }, no: error => { clearTimeout(timer); no(error); } });
    socket.send(JSON.stringify({ id, type, ...input }));
  });
}
try {
  const users = await command('config/auth/list');
  const owner = users.find(u => u.is_owner && u.name === 'Disposable owner'); assert.ok(owner);
  const roles = new SupervisorRoles(token, 'ws://127.0.0.1:8123/api/websocket');
  assert.equal((await roles.requireAdministrator(owner.id)).name, owner.name);
  const { user } = await command('config/auth/create', { name: 'Disposable participant', group_ids: ['system-users'] });
  await assert.rejects(roles.requireAdministrator(user.id), /administrators only/);
  await command('config/auth/update', { user_id: user.id, group_ids: ['system-admin'] });
  assert.equal((await roles.requireAdministrator(user.id)).id, user.id);
  await command('config/auth/update', { user_id: user.id, is_active: false });
  await assert.rejects(roles.requireAdministrator(user.id), /administrators only/);
  await assert.rejects(roles.requireAdministrator('not-a-native-user'), /administrators only/);
  const state = await fetch(base + '/api/states/light.fixture', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ state: 'off', attributes: { friendly_name: 'Native fixture light' } }) });
  assert.equal(state.status, 201);
  const adapter = new HomeAssistant(base + '/api', token);
  assert.ok((await adapter.catalog()).some(r => r.name === 'Native fixture light' && r.kind === 'light'));
  console.log('Real HA Core 2026.10.4: native auth protocol, owner/admin/regular/inactive roles, fresh role changes and REST catalog passed. No physical dispatch.');
} finally { socket.close(); }
