import { parse } from 'yaml';
import { checkOwnerId, type Row, type Sql } from './owners.ts';

/** The start is refused: the name is not on the roster for this owner. */
export const ROSTER_NOT_LISTED = 'ROSTER_NOT_LISTED';

/** The start is refused: the name's agents are already at its max_agents. */
export const ROSTER_LIMIT = 'ROSTER_LIMIT';

/** The add is refused: another owner (or this one) already holds the name. */
export const ROSTER_TAKEN = 'ROSTER_TAKEN';

/** The most agents one roster name may run at once (the table's CHECK agrees). */
export const MAX_AGENTS_LIMIT = 4;

/** Postgres error code for a unique violation. */
const UNIQUE_VIOLATION = '23505';

const MINECRAFT_NAME = /^[A-Za-z0-9_]{1,16}$/;

/** A refused roster call; `code` is the stable part, the message says what to fix. */
export class RosterError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = 'RosterError';
    this.code = code;
  }
}

/** A Minecraft name is 1 to 16 letters, digits or underscores. */
export function checkRosterName(name: string): void {
  if (!MINECRAFT_NAME.test(name)) throw new Error('a roster name is 1 to 16 letters, digits or _');
}

/** max_agents is a whole number from 1 to 4. */
export function checkMaxAgents(maxAgents: number): void {
  if (!Number.isInteger(maxAgents) || maxAgents < 1 || maxAgents > MAX_AGENTS_LIMIT) {
    throw new Error(`max_agents is a whole number from 1 to ${MAX_AGENTS_LIMIT}`);
  }
}

/** Parses a --max value; anything but a plain digit string is refused. */
export function parseMaxAgents(text: string): number {
  if (!/^[1-4]$/.test(text))
    throw new Error(`max_agents is a whole number from 1 to 4, not ${text}`);
  return Number(text);
}

/** Adds a Minecraft name to an owner's roster. A name another owner holds is refused. */
export async function addRosterName(
  sql: Sql,
  owner: string,
  name: string,
  maxAgents = 1,
): Promise<void> {
  checkOwnerId(owner);
  checkRosterName(name);
  checkMaxAgents(maxAgents);
  try {
    await sql.query(
      'INSERT INTO mcp_roster (player_name, owner_id, max_agents) VALUES ($1, $2, $3)',
      [name, owner, maxAgents],
    );
  } catch (error) {
    if ((error as { code?: unknown }).code === UNIQUE_VIOLATION) {
      throw new RosterError(ROSTER_TAKEN, `${name} is already on a roster`);
    }
    throw error;
  }
}

/** Removes a name from the owner's own roster; another owner's name is refused and kept. */
export async function removeRosterName(sql: Sql, owner: string, name: string): Promise<void> {
  checkOwnerId(owner);
  checkRosterName(name);
  const result = await sql.query(
    'DELETE FROM mcp_roster WHERE player_name = $1 AND owner_id = $2 RETURNING player_name',
    [name, owner],
  );
  if (result.rows.length === 0) {
    throw new RosterError(ROSTER_NOT_LISTED, `${name} is not on the roster of ${owner}`);
  }
}

/** Lists the roster, all owners or one. */
export async function listRoster(sql: Sql, owner?: string): Promise<Row[]> {
  if (owner === undefined) {
    const result = await sql.query(
      'SELECT player_name, owner_id, max_agents FROM mcp_roster ORDER BY player_name',
    );
    return result.rows;
  }
  checkOwnerId(owner);
  const result = await sql.query(
    'SELECT player_name, owner_id, max_agents FROM mcp_roster WHERE owner_id = $1 ORDER BY player_name',
    [owner],
  );
  return result.rows;
}

/**
 * Adds each name for the owner, all in one transaction, and returns how many were new. A name that
 * is already listed (for anyone) is skipped, so a second run adds nothing. A failure rolls the
 * whole run back.
 */
export async function seedRoster(sql: Sql, owner: string, names: string[]): Promise<number> {
  checkOwnerId(owner);
  for (const name of names) checkRosterName(name);
  let added = 0;
  await sql.query('BEGIN');
  try {
    for (const name of names) {
      const result = await sql.query(
        'INSERT INTO mcp_roster (player_name, owner_id, max_agents) VALUES ($1, $2, 1) ON CONFLICT (player_name) DO NOTHING RETURNING player_name',
        [name, owner],
      );
      added += result.rows.length;
    }
  } catch (error) {
    await sql.query('ROLLBACK');
    throw error;
  }
  await sql.query('COMMIT');
  return added;
}

/**
 * Refuses a sovereign start for a name that is not on this owner's roster, or whose agents are at
 * its max_agents. The roster row is locked, so two starts for one name cannot both pass. Call it
 * inside the start's transaction.
 */
export async function checkRosterStart(sql: Sql, owner: string, name: string): Promise<void> {
  const listed = await sql.query(
    'SELECT owner_id, max_agents FROM mcp_roster WHERE player_name = $1 FOR UPDATE',
    [name],
  );
  const row = listed.rows[0];
  if (row === undefined || row.owner_id !== owner) {
    throw new RosterError(ROSTER_NOT_LISTED, `${name} is not on the roster of ${owner}`);
  }
  const used = await sql.query(
    "SELECT count(*)::int AS n FROM mcp_players WHERE display_name = $1 AND status <> 'retired'",
    [name],
  );
  if (Number(used.rows[0]?.n) >= Number(row.max_agents)) {
    throw new RosterError(
      ROSTER_LIMIT,
      `${name} is at its limit of ${row.max_agents} agents; retire one or raise max_agents`,
    );
  }
}

/** Reads the Minecraft names from a shard config's sovereign.players list. */
export function readRosterNames(text: string): string[] {
  const doc = parse(text) as { sovereign?: { players?: unknown } } | null;
  const players = doc?.sovereign?.players;
  if (!Array.isArray(players)) throw new Error('the shard config has no sovereign.players list');
  return players.map((player, i) => {
    const name = (player as { name?: unknown } | null)?.name;
    if (typeof name !== 'string') throw new Error(`sovereign.players[${i}] has no name`);
    checkRosterName(name);
    return name;
  });
}
