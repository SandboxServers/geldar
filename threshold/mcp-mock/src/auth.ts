import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** player_id -> sha256 digest of that player's bearer token. */
export type TokenTable = ReadonlyMap<string, Buffer>;

/**
 * Outcome of a bearer check: `ok` (token matches the URL's player), `unauthorized`
 * (missing, malformed or unknown token, or unknown player) or `forbidden` (a valid token for another player).
 */
export type AuthResult = 'ok' | 'unauthorized' | 'forbidden';

const PLAYER_ID = /^[a-z][a-z0-9-]{1,38}$/;
const TOKEN = /^[A-Za-z0-9._~+/=-]{16,200}$/;

function digest(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

/**
 * Loads the tokens file: one JSON object, `{ "<player_id>": "<token>" }`.
 * Throws an Error naming the offending player id or the problem; a message never holds a token.
 */
export function loadTokens(path: string): TokenTable {
  let parsed: unknown;
  try {
    // Windows editors often write a BOM, which JSON.parse rejects.
    parsed = JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''));
  } catch (error) {
    // Parser messages can quote file content, so report only the error class.
    const kind = error instanceof SyntaxError ? 'invalid JSON' : 'cannot read the file';
    throw new Error(`tokens file: ${kind}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('tokens file: must be a JSON object of player_id to token');
  }
  const entries = Object.entries(parsed);
  if (entries.length === 0) throw new Error('tokens file: no players listed');

  const table = new Map<string, Buffer>();
  const owners = new Map<string, number>();
  for (const [index, [playerId, token]] of entries.entries()) {
    if (!PLAYER_ID.test(playerId)) {
      // The key may be a token written the wrong way round, so never echo it.
      throw new Error(
        `tokens file: invalid player id in entry ${index + 1} (length ${playerId.length})`,
      );
    }
    if (typeof token !== 'string' || !TOKEN.test(token)) {
      throw new Error(`tokens file: invalid token in entry ${index + 1} (player id length ${playerId.length})`);
    }
    const hex = digest(token).toString('hex');
    const other = owners.get(hex);
    if (other !== undefined) {
      throw new Error(`tokens file: entries ${other} and ${index + 1} share a token`);
    }
    owners.set(hex, index + 1);
    table.set(playerId, digest(token));
  }
  return table;
}

/**
 * Checks an `Authorization` header for the player named in the URL.
 * An unknown player is `unauthorized`, so a probe cannot learn which players exist.
 */
export function checkBearer(
  table: TokenTable,
  playerId: string,
  header: string | undefined,
): AuthResult {
  if (header === undefined || !header.startsWith('Bearer ')) return 'unauthorized';
  const presented = digest(header.slice('Bearer '.length));
  let matched: string | undefined;
  for (const [id, stored] of table) {
    if (timingSafeEqual(presented, stored)) matched = id;
  }
  const own = table.get(playerId);
  if (own === undefined || matched === undefined) return 'unauthorized';
  return matched === playerId ? 'ok' : 'forbidden';
}
