import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { CsrfSessions, ingressUser, SupervisorRoles } from '../src/ha-identity.js';

test('ingress identity requires the actual Supervisor peer and its user header', () => {
  assert.equal(ingressUser('::ffff:172.30.32.2', 'owner'), 'owner');
  for (const address of ['127.0.0.1', '172.30.32.3', '172.30.32.20', '::1']) assert.throws(() => ingressUser(address, 'owner'));
  assert.throws(() => ingressUser('172.30.32.2', undefined));
  assert.throws(() => ingressUser('172.30.32.2', ['owner', 'other']));
});

test('CSRF intents are bound to a verified user and cannot be supplied as arbitrary booleans', () => {
  const sessions = new CsrfSessions(); const token = sessions.issue('owner');
  sessions.check('owner', token);
  assert.throws(() => sessions.check('guest', token));
  assert.throws(() => sessions.check('owner', 'true'));
  assert.throws(() => sessions.check('owner', undefined));
});

test('HA roles are freshly read through authenticated WebSocket commands', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address === 'object');
  let active = true; let queries = 0;
  server.on('connection', socket => {
    socket.send(JSON.stringify({ type: 'auth_required' }));
    socket.on('message', data => {
      const message = JSON.parse(String(data));
      if (message.type === 'auth') { assert.equal(message.access_token, 'supervisor-test'); socket.send(JSON.stringify({ type: 'auth_ok' })); }
      else { assert.equal(message.type, 'config/auth/list'); queries++;
        socket.send(JSON.stringify({ id: message.id, type: 'result', success: true, result: [
          { id: 'owner', name: 'Home owner', is_owner: true, is_active: active, system_generated: false, group_ids: ['system-admin'] },
          { id: 'guest', name: 'Guest', is_owner: false, is_active: true, system_generated: false, group_ids: ['system-users'] },
        ] })); }
    });
  });
  try {
    const roles = new SupervisorRoles('supervisor-test', `ws://127.0.0.1:${address.port}`);
    assert.equal((await roles.requireAdministrator('owner')).name, 'Home owner');
    await assert.rejects(() => roles.requireAdministrator('guest'), /administrators/);
    active = false;
    await assert.rejects(() => roles.requireAdministrator('owner'), /administrators/);
    await assert.rejects(() => roles.requireAdministrator('unknown'), /administrators/);
    assert.equal(queries, 4);
  } finally { for (const socket of server.clients) socket.terminate(); await new Promise<void>(ok => server.close(() => ok())); }
});
