/**
 * The shared secret between lantern-local and the Mind's Thinker hub (threat model section 3).
 * `GELDAR_THINKER_TOKEN_FILE` names a git-ignored file holding the token; both sides read it and
 * the Thinker sends it in its `hello` frame. Unset means open, as before. The token is never
 * logged: errors name the variable and the path, never the token.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const THINKER_TOKEN_FILE_ENV = 'GELDAR_THINKER_TOKEN_FILE';

/** The token in the file named by `GELDAR_THINKER_TOKEN_FILE`, or `undefined` when unset. */
export function thinkerToken(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const file = env[THINKER_TOKEN_FILE_ENV];
  if (!file) return undefined;
  let token: string;
  try {
    token = readFileSync(file, 'utf8').trim();
  } catch {
    throw new Error(
      `cannot read the Thinker token file named by ${THINKER_TOKEN_FILE_ENV}: ${file}`,
    );
  }
  if (!token) throw new Error(`the Thinker token file named by ${THINKER_TOKEN_FILE_ENV} is empty`);
  return token;
}

/**
 * True when `offered` is `expected`. Both are hashed first, so the comparison takes the same time
 * whatever the lengths, and a missing or non-string offer is a mismatch.
 */
export function tokenMatches(expected: string, offered: unknown): boolean {
  if (typeof offered !== 'string') return false;
  const a = createHash('sha256').update(expected).digest();
  const b = createHash('sha256').update(offered).digest();
  return timingSafeEqual(a, b);
}
