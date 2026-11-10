import { isAbsolute, relative, resolve, sep } from 'node:path';
import { parse } from 'yaml';

/** One sovereign player as the shard config names it. */
export interface RosterPlayer {
  playerId: string;
  lifeId: string;
  name: string;
}

/** Raised for an unknown player or a skin file outside the gitignored skins directory. Messages are fixed. */
export class RosterError extends Error {}

const PLAYER_ID = /^[a-z0-9-]{1,32}$/;
const LIFE_ID = /^[a-z0-9_]{1,16}$/;

/**
 * Finds a player in `shards/phase0.yaml` (`sovereign.players[]`). The life id is the one the config names, and it
 * must be a canonical bucket key, because the identity plugin only matches those.
 */
export function findPlayer(shardYaml: string, playerId: string): RosterPlayer {
  if (!PLAYER_ID.test(playerId)) {
    throw new RosterError('the player id is not a valid sovereign player id');
  }
  const players = (parse(shardYaml) as { sovereign?: { players?: unknown } } | null)?.sovereign
    ?.players;
  if (!Array.isArray(players)) {
    throw new RosterError('the shard config has no sovereign.players list');
  }
  for (const entry of players as Array<Record<string, unknown>>) {
    if (entry?.player_id !== playerId) {
      continue;
    }
    if (typeof entry.life_id !== 'string' || !LIFE_ID.test(entry.life_id)) {
      throw new RosterError('the player has no valid life_id in the shard config');
    }
    return {
      playerId,
      lifeId: entry.life_id,
      name: typeof entry.name === 'string' ? entry.name : playerId,
    };
  }
  throw new RosterError(`no sovereign player ${playerId} in the shard config`);
}

/**
 * A skin file must sit under the repo's gitignored `skins/` directory, or outside the repo entirely (the player's
 * own private repo). Anywhere else in the repo it is refused, so a PNG cannot be committed by accident.
 */
export function checkSkinPath(file: string, repoRoot: string): string {
  const absolute = resolve(file);
  if (!isAbsolute(absolute)) {
    throw new RosterError('the skin path must resolve to an absolute file');
  }
  const rel = relative(repoRoot, absolute);
  const outsideRepo = rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel);
  const insideRepo = rel !== '' && !outsideRepo;
  if (insideRepo && rel.split(sep)[0] !== 'skins') {
    throw new RosterError('a skin inside the repo must be under skins/ (gitignored)');
  }
  return absolute;
}
