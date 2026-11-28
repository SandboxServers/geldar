import { randomUUID } from 'node:crypto';
import { rename, rm, writeFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { findPlayer, RosterError } from './roster.ts';

/** The largest roster file, in bytes. A bigger roster is refused and nothing is written. */
export const MAX_ROSTER_BYTES = 16384;

/**
 * Builds the flat `{ "<name>": "<life_id>" }` object from the sovereign players in the shard config. Every player is
 * read through `findPlayer`, so the same id and life-id rules apply. Names must be strings and must be unique, because
 * a duplicate name would silently drop a player from a flat object.
 */
export function buildRoster(shardYaml: string): Record<string, string> {
  const players = (parse(shardYaml) as { sovereign?: { players?: unknown } } | null)?.sovereign
    ?.players;
  if (!Array.isArray(players)) {
    throw new RosterError('the shard config has no sovereign.players list');
  }
  const roster: Record<string, string> = Object.create(null);
  for (const entry of players as Array<Record<string, unknown>>) {
    if (typeof entry?.player_id !== 'string') {
      throw new RosterError('a sovereign player has no valid player_id');
    }
    if (entry.name !== undefined && typeof entry.name !== 'string') {
      throw new RosterError('a sovereign player name must be a string');
    }
    const player = findPlayer(shardYaml, entry.player_id);
    if (player.name in roster) {
      throw new RosterError('two sovereign players share a name; the roster needs unique names');
    }
    roster[player.name] = player.lifeId;
  }
  return roster;
}

/**
 * The file body: the flat object, two-space indented, with a final newline. Every value must be a string, and the
 * body must fit in MAX_ROSTER_BYTES; a larger roster is refused before anything is written.
 */
export function encodeRoster(roster: Record<string, string>): string {
  for (const value of Object.values(roster)) {
    if (typeof value !== 'string') {
      throw new RosterError('the roster may hold strings only; nothing was written');
    }
  }
  const body = `${JSON.stringify(roster, null, 2)}\n`;
  if (Buffer.byteLength(body) > MAX_ROSTER_BYTES) {
    throw new RosterError('the roster is larger than 16 KiB; nothing was written');
  }
  return body;
}

/**
 * Writes the body to a temp file beside the target, then renames it into place, so a failed write never leaves a
 * partial roster. The temp file is removed on failure. The caller has already checked that the target is new.
 */
export async function writeRosterExport(
  target: string,
  body: string,
  moveFile: (from: string, to: string) => Promise<void> = rename,
): Promise<void> {
  const temp = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, body, { flag: 'wx', mode: 0o600 });
    await moveFile(temp, target);
  } catch {
    await rm(temp, { force: true });
    throw new RosterError('the roster file could not be written; nothing was left behind');
  }
}
