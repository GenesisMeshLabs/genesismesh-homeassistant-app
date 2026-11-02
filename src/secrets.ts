import { readFileSync, statSync } from 'node:fs';

/** Core CLI key files contain comment headers; never forward those as seed bytes. */
export function readSigningSeed(file: string): string {
  if (statSync(file).size > 4096) throw new Error('Signing key file is too large.');
  const seed = readFileSync(file, 'utf8').split(/\r?\n/).filter(line => !line.trimStart().startsWith('#')).join('').trim();
  if (!/^[A-Za-z0-9+/]{43}=$/.test(seed) || Buffer.from(seed, 'base64').length !== 32) {
    throw new Error('Expected a raw 32-byte Ed25519 seed in a core-format key file.');
  }
  return seed;
}
