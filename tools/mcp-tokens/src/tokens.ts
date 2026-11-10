import { randomBytes } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import {
  hashToken,
  mintToken as newTokenValue,
} from '../../../threshold/mcp/src/store/token-hash.ts';
import type { Sql } from './owners.ts';
import { transaction } from './players.ts';
import { isInsideRepo, REPO_ROOT, readPepper, writeOwnerOnly } from './secret-files.ts';

/** At most this many active tokens per player: the one in use and, while rotating, its successor. */
export const MAX_ACTIVE_TOKENS = 2;

/** A new token lives this many days (spec 5.15.3: a default expiry of 30 days). */
export const TOKEN_EXPIRY_DAYS = 30;

/** How long a rotated-out token keeps working when `--grace-minutes` is not given. */
export const DEFAULT_GRACE_MINUTES = 10;

/** The longest grace a rotation may give the old token: one day. */
export const MAX_GRACE_MINUTES = 1440;

/** The name of the variable in the file that `token mint` and `token rotate` write. */
export const TOKEN_VARIABLE = 'GELDAR_MCP_TOKEN';

/**
 * The absolute path with symlinks resolved: realpath of the nearest existing ancestor (or of the
 * path itself), with the missing rest appended as written.
 */
export function resolveThroughSymlinks(path: string): string {
  let existing = resolve(path);
  const missing: string[] = [];
  for (;;) {
    try {
      return join(realpathSync(existing), ...missing);
    } catch {
      const parent = dirname(existing);
      if (parent === existing) return join(existing, ...missing);
      missing.unshift(basename(existing));
      existing = parent;
    }
  }
}

/**
 * A `--out` path must lie outside the repo, so a token file can never be committed. The check runs
 * on the path as given and on its symlink-resolved form, so a link outside the repo that points in
 * is refused too. The file is never overwritten: the write fails if it exists.
 */
export function checkOutPath(out: string, repoRoot: string = REPO_ROOT): string {
  const path = resolve(out);
  const inside =
    isInsideRepo(path, repoRoot) ||
    isInsideRepo(resolveThroughSymlinks(path), resolveThroughSymlinks(repoRoot));
  if (inside) {
    throw new Error('--out must be outside the repo; a token file must never be committed');
  }
  return path;
}

/** Parses --grace-minutes: a whole number from 0 to MAX_GRACE_MINUTES. */
export function parseGrace(text: string): number {
  if (!/^[0-9]{1,4}$/.test(text) || Number(text) > MAX_GRACE_MINUTES) {
    throw new Error(`--grace-minutes is a whole number from 0 to ${MAX_GRACE_MINUTES}`);
  }
  return Number(text);
}

interface Issued {
  tokenId: string;
  value: string;
}

/**
 * Locks the player row, refuses a retired player and a player at the active-token limit, then
 * inserts the new token's hash. The value itself is only returned, never stored.
 */
async function issue(sql: Sql, pepper: string, playerId: string): Promise<Issued> {
  const players = await sql.query(
    'SELECT status FROM mcp_players WHERE player_id = $1 FOR UPDATE',
    [playerId],
  );
  const player = players.rows[0];
  if (player === undefined) throw new Error(`no player ${playerId}`);
  if (player.status === 'retired')
    throw new Error(`player ${playerId} is retired; it cannot hold tokens`);
  const active = await sql.query(
    'SELECT count(*)::int AS n FROM mcp_tokens WHERE player_id = $1 AND revoked_at IS NULL AND expires_at > now()',
    [playerId],
  );
  if (Number(active.rows[0]?.n) >= MAX_ACTIVE_TOKENS) {
    throw new Error(
      `player ${playerId} already has ${MAX_ACTIVE_TOKENS} active tokens; revoke one first`,
    );
  }
  const value = newTokenValue();
  const tokenId = `tk_${randomBytes(8).toString('hex')}`;
  await sql.query(
    `INSERT INTO mcp_tokens (token_id, player_id, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(days => $4))`,
    [tokenId, playerId, hashToken(pepper, value), TOKEN_EXPIRY_DAYS],
  );
  return { tokenId, value };
}

/** The file a token goes to: one line, the variable and the value, readable by the current user only. */
async function writeTokenFile(path: string, value: string): Promise<void> {
  await writeOwnerOnly(path, `${TOKEN_VARIABLE}=${value}\n`, 'wx');
}

/** Mints a token for a player, writes it to `out`, and returns the token's id (never the value). */
export async function mintTokenFile(
  sql: Sql,
  secretDir: string,
  playerId: string,
  out: string,
): Promise<string> {
  const path = checkOutPath(out);
  const pepper = await readPepper(secretDir);
  let tokenId = '';
  await transaction(sql, async () => {
    const issued = await issue(sql, pepper, playerId);
    await writeTokenFile(path, issued.value);
    tokenId = issued.tokenId;
  });
  return tokenId;
}

/**
 * Mints a new token for a player and gives every older active token a grace period: each one
 * expires `graceMinutes` from now, or sooner if it already would. Returns the new token's id.
 */
export async function rotateTokenFile(
  sql: Sql,
  secretDir: string,
  playerId: string,
  out: string,
  graceMinutes: number = DEFAULT_GRACE_MINUTES,
): Promise<string> {
  const path = checkOutPath(out);
  const pepper = await readPepper(secretDir);
  let tokenId = '';
  await transaction(sql, async () => {
    const issued = await issue(sql, pepper, playerId);
    await sql.query(
      `UPDATE mcp_tokens SET expires_at = LEAST(expires_at, now() + make_interval(mins => $2))
       WHERE player_id = $1 AND token_id <> $3 AND revoked_at IS NULL`,
      [playerId, graceMinutes, issued.tokenId],
    );
    await writeTokenFile(path, issued.value);
    tokenId = issued.tokenId;
  });
  return tokenId;
}

/** One line per token: its id, its player, its status and its expiry. The hashes are never selected. */
export async function listTokens(sql: Sql, playerId?: string): Promise<string[]> {
  const where = playerId === undefined ? '' : 'WHERE player_id = $1';
  const result = await sql.query(
    `SELECT token_id, player_id, expires_at,
       CASE WHEN revoked_at IS NOT NULL THEN 'revoked' WHEN expires_at <= now() THEN 'expired' ELSE 'active' END AS status
     FROM mcp_tokens ${where} ORDER BY player_id, created_at`,
    playerId === undefined ? [] : [playerId],
  );
  return result.rows.map(
    (row) => `${row.token_id} ${row.player_id} ${row.status} expires ${String(row.expires_at)}`,
  );
}

/** Revokes one token by its id; returns how many were revoked (1). */
export async function revokeToken(sql: Sql, tokenId: string): Promise<number> {
  const result = await sql.query(
    'UPDATE mcp_tokens SET revoked_at = now() WHERE token_id = $1 AND revoked_at IS NULL RETURNING token_id',
    [tokenId],
  );
  if (result.rows.length === 0) throw new Error(`no active token ${tokenId}`);
  return result.rows.length;
}

/** Revokes every active token a player holds; returns how many were revoked. */
export async function revokePlayerTokens(sql: Sql, playerId: string): Promise<number> {
  const result = await sql.query(
    'UPDATE mcp_tokens SET revoked_at = now() WHERE player_id = $1 AND revoked_at IS NULL RETURNING token_id',
    [playerId],
  );
  return result.rows.length;
}
