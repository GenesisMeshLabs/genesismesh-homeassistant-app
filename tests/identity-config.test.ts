import test from 'node:test';
import assert from 'node:assert/strict';
import { authenticate } from '../src/identity.js';
import { validateConfig, endpoint } from '../src/config.js';
import { configuration } from './helpers.js';

test('each baseline participant type has an independent app-scoped identity', () => {
  const { config, tokens } = configuration('unused');
  for (const kind of ['person', 'agent', 'machine', 'device', 'service']) {
    const principal = authenticate(`Bearer ${tokens[kind]}`, config.principals);
    assert.equal(principal.kind, kind);
    assert.equal(principal.id, kind);
  }
  assert.throws(() => authenticate(undefined, config.principals));
  assert.throws(() => authenticate('Bearer fabricated-participant-token-here', config.principals));
});

test('disabled and expired participants cannot authenticate', () => {
  const { config, tokens } = configuration('unused');
  const principal = config.principals[0]!;
  principal.enabled = false;
  assert.throws(() => authenticate(`Bearer ${tokens['person']}`, config.principals));
  principal.enabled = true;
  principal.expiresAt = new Date(Date.now() - 1000).toISOString();
  assert.throws(() => authenticate(`Bearer ${tokens['person']}`, config.principals));
});

test('configuration rejects unknown fields, ambiguous identities and scope mappings', () => {
  const { config } = configuration('unused');
  assert.deepEqual(validateConfig(config), config);
  assert.throws(() => validateConfig({ ...config, allowAll: true }));
  config.principals[1]!.credentialSha256 = config.principals[0]!.credentialSha256;
  assert.throws(() => validateConfig(config));
  const second = configuration('unused').config;
  second.principals[0]!.resources = ['another-home'];
  assert.throws(() => validateConfig(second));
  second.principals[0]!.resources = [];
  second.resources[0]!.entityId = 'light.wrong_domain';
  assert.throws(() => validateConfig(second));
});

test('only explicit loopback HTTP or credential-free HTTPS endpoints are accepted', () => {
  assert.equal(endpoint('http://127.0.0.1:8123/api/'), 'http://127.0.0.1:8123/api');
  assert.equal(endpoint('https://ha.example/api'), 'https://ha.example/api');
  for (const url of ['http://homeassistant.local/api', 'http://supervisor/core/api', 'https://user:secret@ha.example/api', 'https://ha.example/api?token=x', 'file:///tmp/ha']) {
    assert.throws(() => endpoint(url));
  }
});
