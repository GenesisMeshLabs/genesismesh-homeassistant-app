import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createIngress } from '../src/ingress.js';
import { AppError } from '../src/errors.js';

test('ingress rejects forwarded-header spoofing, unknown users and missing CSRF before changing anything', async () => {
  let changes = 0;
  const app = createIngress({ status: () => ({ ready: false }) as never, catalog: async () => [],
    configure: async () => { changes++; }, addMember: async () => { changes++; return {} as never; },
    revoke: async () => { changes++; }, act: async () => { changes++; return {} as never; } },
  { requireAdministrator: async id => { if (id !== 'owner') throw new AppError('administrator_required', 'Admin required', 403); return { id, name: 'Owner' }; } }, resolve('web-dist'));
  try {
    assert.equal((await app.inject({ url: '/api/status', remoteAddress: '127.0.0.1', headers: { 'x-remote-user-id': 'owner', 'x-forwarded-for': '172.30.32.2' } })).statusCode, 403);
    assert.equal((await app.inject({ url: '/api/status', remoteAddress: '172.30.32.2', headers: { 'x-remote-user-id': 'guest' } })).statusCode, 403);
    assert.equal((await app.inject({ url: '/api/status', remoteAddress: '172.30.32.2' })).statusCode, 401);
    const request = { remoteAddress: '172.30.32.2', headers: { 'x-remote-user-id': 'owner' } };
    const session = (await app.inject({ url: '/api/session', ...request })).json();
    assert.ok(session.csrf);
    assert.equal((await app.inject({ method: 'POST', url: '/api/setup', ...request, payload: { resources: ['r-' + 'a'.repeat(24)], minimum: 19, maximum: 23 } })).statusCode, 403);
    const valid = await app.inject({ method: 'POST', url: '/api/setup', remoteAddress: request.remoteAddress,
      headers: { ...request.headers, 'x-gm-csrf': session.csrf }, payload: { resources: ['r-' + 'a'.repeat(24)], minimum: 19, maximum: 23 } });
    assert.equal(valid.statusCode, 200); assert.equal(changes, 1);
    assert.equal((await app.inject({ url: '/', ...request })).statusCode, 200);
    assert.match(String(valid.headers['content-security-policy']), /frame-ancestors 'self'/);
  } finally { await app.close(); }
});
