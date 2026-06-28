import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

export function generateId(): string {
  return randomUUID();
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${derived.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, keyHex] = stored.split(':');
  if (!saltHex || !keyHex) {
    return false;
  }
  const salt = Buffer.from(saltHex, 'hex');
  const key = Buffer.from(keyHex, 'hex');
  const derived = scryptSync(password, salt, key.length);
  return key.length === derived.length && timingSafeEqual(key, derived);
}

export function pkceChallengeS256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function verifyPkce(verifier: string, challenge: string): boolean {
  // OAuth 2.1 mandates S256; the `plain` method is intentionally unsupported.
  const computed = pkceChallengeS256(verifier);
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * HMAC that authorizes a single direct file download (the reference server's
 * stand-in for an object-store presigned URL): it binds the project, path, and
 * expiry so the unauthenticated download route can serve the bytes without a
 * bearer token while still scoping access to exactly one file for a short time.
 */
export function signDownloadToken(
  secret: string,
  projectId: string,
  filePath: string,
  expiresAt: number,
): string {
  return createHmac('sha256', secret)
    .update(`${projectId}\n${filePath}\n${expiresAt}`)
    .digest('base64url');
}

export function verifyDownloadToken(
  secret: string,
  projectId: string,
  filePath: string,
  expiresAt: number,
  signature: string,
): boolean {
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) {
    return false;
  }
  const expected = Buffer.from(
    signDownloadToken(secret, projectId, filePath, expiresAt),
  );
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
