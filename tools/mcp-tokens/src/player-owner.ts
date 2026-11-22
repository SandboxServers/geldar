import { checkOwnerId, type Sql } from './owners.ts';
import { transaction } from './players.ts';

/** The player ids an operator may name: ag- then 1 to 40 lower-case letters, digits or dashes (colo-admin.sh). */
const PLAYER_ID_PATTERN = /^ag-[a-z0-9-]{1,40}$/;

export const PLAYER_SET_OWNER_USAGE = 'usage: player set-owner <player_id> <owner_id>';

/** Reads the words after `player set-owner`; anything else is refused with the usage line. */
export function parseSetOwner(args: readonly string[]): { playerId: string; owner: string } {
  const [playerId, owner, ...extra] = args;
  if (playerId === undefined || owner === undefined || extra.length > 0) {
    throw new Error(PLAYER_SET_OWNER_USAGE);
  }
  if (!PLAYER_ID_PATTERN.test(playerId)) {
    throw new Error('player id must match ^ag-[a-z0-9-]{1,40}$');
  }
  checkOwnerId(owner);
  return { playerId, owner };
}

/**
 * Moves one player to another owner in one transaction (C7 assign-cmd). The three owner links move
 * together: mcp_players.owner_id, the mcp_roster row of the player's name (the supervisor refuses a
 * Body start when that row is not on the owner, sql 0033) and agents.owner of the player's life (Kino and
 * Glass scope, account deletion). Each step must change exactly one row, or the whole move rolls back.
 *
 * Refused, with nothing written: an unknown player, a retired player, an unknown owner, and a move
 * that would take the target owner past its player_cap (active and paused players count, retired do
 * not). A player already on the target owner is a no-op: nothing is written and no audit row is added.
 * A successful move writes one register_audit row (actor hashed as the other admin verbs do, detail
 * with the owner ids only, no names or tokens). Returns the lines to print; prints no name.
 */
export async function setPlayerOwner(
  sql: Sql,
  playerId: string,
  owner: string,
  actor = 'operator',
): Promise<string[]> {
  const lines: string[] = [];
  await transaction(sql, async () => {
    const found = await sql.query(
      'SELECT owner_id, life_id, display_name, status FROM mcp_players WHERE player_id = $1 FOR UPDATE',
      [playerId],
    );
    const player = found.rows[0];
    if (player === undefined) throw new Error(`no player ${playerId}`);
    if (player.status === 'retired') {
      throw new Error(`player ${playerId} is retired; a retired player is not moved`);
    }
    const from = String(player.owner_id);
    if (from === owner) {
      lines.push(`player ${playerId} is already on owner ${owner}; nothing changed`);
      return;
    }
    const target = await sql.query(
      'SELECT player_cap FROM mcp_owners WHERE owner_id = $1 FOR UPDATE',
      [owner],
    );
    const cap = target.rows[0];
    if (cap === undefined) throw new Error(`no owner ${owner}`);
    const used = await sql.query(
      "SELECT count(*)::int AS n FROM mcp_players WHERE owner_id = $1 AND status <> 'retired'",
      [owner],
    );
    if (Number(used.rows[0]?.n) + 1 > Number(cap.player_cap)) {
      throw new Error(`owner ${owner} is at the cap of ${cap.player_cap} players; nothing changed`);
    }
    const roster = await sql.query(
      'UPDATE mcp_roster SET owner_id = $2 WHERE player_name = lower($1) AND owner_id = $3 RETURNING player_name',
      [String(player.display_name), owner, from],
    );
    if (roster.rows.length !== 1) {
      throw new Error(`the roster of ${from} does not list this player's name; nothing changed`);
    }
    const moved = await sql.query(
      'UPDATE mcp_players SET owner_id = $2 WHERE player_id = $1 RETURNING player_id',
      [playerId, owner],
    );
    if (moved.rows.length !== 1)
      throw new Error(`player ${playerId} did not move; nothing changed`);
    const agent = await sql.query(
      'UPDATE agents SET owner = $2 WHERE agent_id = $1 AND owner = $3 RETURNING agent_id',
      [String(player.life_id), owner, from],
    );
    if (agent.rows.length !== 1) {
      throw new Error(`the life of ${playerId} is not on owner ${from}; nothing changed`);
    }
    await sql.query(
      `INSERT INTO register_audit (actor, action, target, outcome, admin, detail)
       VALUES (left(encode(sha256(convert_to($1, 'UTF8')), 'hex'), 16), $2, $3, $4, $5, $6)`,
      [actor, 'player.set_owner', playerId, 'ok', false, `owner ${from} to ${owner}`],
    );
    lines.push(`moved ${playerId} from owner ${from} to owner ${owner}`);
  });
  return lines;
}
