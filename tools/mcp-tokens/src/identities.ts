import type { Sql } from './owners.ts';
import { transaction } from './players.ts';

/** An identity is named by its HMAC id: 64 lower-case hex digits (mcp_identities.identity_hash). */
const IDENTITY_HASH = /^[0-9a-f]{64}$/;

function checkHash(hash: string): void {
  if (!IDENTITY_HASH.test(hash)) throw new Error('an identity id is 64 lower-case hex digits');
}

/**
 * Bans a registration identity (decision 0135, ruling R35) and revokes every live token of its
 * owner in the same transaction. The MCP also refuses tokens of a banned identity, so a token
 * minted before this call cannot outlive it. Players stay as they are; nothing is retired.
 */
export async function banIdentity(sql: Sql, hash: string): Promise<number> {
  checkHash(hash);
  let revoked = 0;
  await transaction(sql, async () => {
    const found = await sql.query(
      `UPDATE mcp_identities SET banned_at = COALESCE(banned_at, now())
       WHERE identity_hash = decode($1, 'hex') RETURNING owner_id`,
      [hash],
    );
    const owner = found.rows[0]?.owner_id;
    if (owner === undefined) throw new Error('no identity with that id');
    const result = await sql.query(
      `UPDATE mcp_tokens SET revoked_at = now()
       WHERE revoked_at IS NULL
         AND player_id IN (SELECT player_id FROM mcp_players WHERE owner_id = $1)
       RETURNING token_id`,
      [owner],
    );
    revoked = result.rows.length;
  });
  return revoked;
}

/** Lifts a ban. Tokens revoked by the ban stay revoked: the owner mints new ones. */
export async function unbanIdentity(sql: Sql, hash: string): Promise<void> {
  checkHash(hash);
  const result = await sql.query(
    "UPDATE mcp_identities SET banned_at = NULL WHERE identity_hash = decode($1, 'hex') RETURNING owner_id",
    [hash],
  );
  if (result.rows.length === 0) throw new Error('no identity with that id');
}
