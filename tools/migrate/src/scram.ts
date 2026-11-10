import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';

/** The iteration count Postgres uses for SCRAM-SHA-256 by default. */
export const SCRAM_ITERATIONS = 4096;

/**
 * The SCRAM-SHA-256 verifier Postgres stores for a password (RFC 5802, RFC 7677):
 * `SCRAM-SHA-256$<iterations>:<salt>$<StoredKey>:<ServerKey>`, all base64. It is computed here so
 * the password never travels to the server. Only printable ASCII is accepted: for that, SASLprep
 * is the identity, so the verifier is the one the server would derive.
 */
export function scramVerifier(
  password: string,
  salt: Buffer = randomBytes(16),
  iterations: number = SCRAM_ITERATIONS,
): string {
  if (!/^[\x20-\x7e]+$/.test(password)) throw new Error('the password must be printable ASCII');
  const saltedPassword = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const clientKey = hmac(saltedPassword, 'Client Key');
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = hmac(saltedPassword, 'Server Key');
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}

function hmac(key: Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}
