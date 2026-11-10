/**
 * The ranger processes of `./geldar.ps1 players`: which sovereign players the shard config names, the command
 * line of each Body process, and the status report. Pure functions only; the process calls live in `rangers-cli.ts`.
 */
import { parse } from 'yaml';

/** One sovereign player as `shards/phase0.yaml` names it (`sovereign.players[]`). */
export interface Ranger {
  playerId: string;
  lifeId: string;
  name: string;
}

/** The Node heap cap of one ranger process (WM-12): six rangers and Adam fit a 4 GB host. */
export const RANGER_HEAP_MB = 320;

export class RangerError extends Error {}

/** The sovereign players of a shard config, in config order. A malformed entry is refused, not skipped. */
export function listRangers(shardYaml: string): Ranger[] {
  const doc = parse(shardYaml) as { sovereign?: { players?: unknown } } | null;
  const players = doc?.sovereign?.players;
  if (!Array.isArray(players))
    throw new RangerError('the shard config has no sovereign.players list');
  return players.map((entry) => {
    const row = entry as Record<string, unknown> | null;
    if (
      row === null ||
      typeof row.player_id !== 'string' ||
      typeof row.life_id !== 'string' ||
      typeof row.name !== 'string'
    ) {
      throw new RangerError('a sovereign.players entry lacks player_id, life_id or name');
    }
    return { playerId: row.player_id, lifeId: row.life_id, name: row.name };
  });
}

/** All rangers when `playerId` is undefined; otherwise the one named, or an error for an unknown id. */
export function selectRangers(all: readonly Ranger[], playerId: string | undefined): Ranger[] {
  if (playerId === undefined) return [...all];
  const found = all.find((ranger) => ranger.playerId === playerId);
  if (found === undefined)
    throw new RangerError(`no sovereign player '${playerId}' in the shard config`);
  return [found];
}

/** The command line of one ranger's Body: the player host entry point, capped at RANGER_HEAP_MB of heap. */
export function rangerCommand(repoRoot: string, playerId: string): { args: string[] } {
  const entry = `${repoRoot}/golem/src/players/main.ts`;
  return { args: [`--max-old-space-size=${RANGER_HEAP_MB}`, entry, '--player', playerId] };
}

/** The PID in a PID file, or null when the text is not a positive integer. */
export function parsePid(text: string): number | null {
  const trimmed = text.trim();
  if (!/^[0-9]{1,10}$/.test(trimmed)) return null;
  const pid = Number(trimmed);
  return pid > 0 ? pid : null;
}

/** online: the PID file names a live process; stale: it names a dead one; down: there is no PID file. */
export type RangerState = 'online' | 'stale' | 'down';

/** The state of one ranger from its PID file text (null when there is none) and a liveness check. */
export function rangerState(
  pidText: string | null,
  isAlive: (pid: number) => boolean,
): { state: RangerState; pid: number | null } {
  if (pidText === null) return { state: 'down', pid: null };
  const pid = parsePid(pidText);
  if (pid === null) return { state: 'stale', pid: null };
  return isAlive(pid) ? { state: 'online', pid } : { state: 'stale', pid };
}

/** One status line per ranger; an offline ranger prints `down` and nothing else. */
export function formatStatus(
  rows: readonly { ranger: Ranger; state: RangerState; pid: number | null; rssMb: number | null }[],
): string[] {
  if (rows.every((row) => row.state === 'down')) return ['down'];
  return rows.map(({ ranger, state, pid, rssMb }) => {
    if (state === 'down') return `${ranger.playerId} down`;
    const rss = rssMb === null ? 'rss unknown' : `rss ${rssMb} MB`;
    return `${ranger.playerId} ${state} pid ${pid ?? 'none'} ${rss} (life ${ranger.lifeId})`;
  });
}
