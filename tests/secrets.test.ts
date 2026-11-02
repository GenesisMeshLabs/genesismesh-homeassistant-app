import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { readSigningSeed } from '../src/secrets.js';
import { testDirectory } from './helpers.js';

test('the key loader accepts core comment headers without logging or interpreting them as seed bytes', t => {
  const dir = testDirectory(t);
  const file = join(dir, 'test.key');
  const seed = randomBytes(32).toString('base64');
  writeFileSync(file, `# Ed25519 Private Key\n# Key ID: isolated-test\n${seed}\n`, { mode: 0o600 });
  assert.equal(readSigningSeed(file), seed);
  writeFileSync(file, 'not-a-key');
  assert.throws(() => readSigningSeed(file), /raw 32-byte/);
});
