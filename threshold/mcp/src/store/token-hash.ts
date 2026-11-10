import { createHmac, randomBytes } from 'node:crypto';

/** The fixed prefix that lets the repo secret scan catch a leaked token. */
export const TOKEN_PREFIX = 'gmcp-';

/** A token: `gmcp-` and 64 lower-case hex characters (256 random bits). */
export const TOKEN_PATTERN = /^gmcp-[0-9a-f]{64}$/;

/**
 * A new token. Only `mcp-tokens token mint` calls this; the value is written to a file and
 * never printed. `random` is injectable for tests.
 */
export function mintToken(random: (size: number) => Buffer = randomBytes): string {
  return `${TOKEN_PREFIX}${random(32).toString('hex')}`;
}

/** What Postgres stores in `mcp_tokens.token_hash`: HMAC-SHA256 of the token, keyed by the pepper. */
export function hashToken(pepper: Uint8Array | string, token: Uint8Array | string): Buffer {
  return createHmac('sha256', pepper).update(token).digest();
}
