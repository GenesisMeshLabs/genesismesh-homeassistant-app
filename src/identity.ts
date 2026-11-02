import { createHash, timingSafeEqual } from 'node:crypto';
import type { Principal } from './contracts.js';
import { AppError } from './errors.js';

export function credentialDigest(credential: string): string {
  return createHash('sha256').update(credential).digest('hex');
}

/** P0 app-issued bearer possession, not native Mesh enrollment or hardware attestation. */
export function authenticate(header: string | undefined, principals: readonly Principal[]): Principal {
  const match = /^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(header ?? '');
  const candidate = Buffer.from(credentialDigest(match?.[1] ?? ''), 'hex');
  let found: Principal | undefined;
  for (const principal of principals) {
    if (timingSafeEqual(candidate, Buffer.from(principal.credentialSha256, 'hex'))) found = principal;
  }
  if (!match || !found || !found.enabled || Date.now() >= Date.parse(found.expiresAt)) {
    throw new AppError('unauthenticated', 'A current participant credential is required.', 401);
  }
  return found;
}
