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

/** A PID file, format 2: the PID, the process start time, and the command-line marker that names the Body. */
export interface PidRecord {
  pid: number;
  started: string;
  marker: string;
}

export const PID_FORMAT = 2;

/** The start time a PID file holds when the platform could not report the process's start (never a real time). */
export const UNKNOWN_START = 'unknown';

/**
 * What the process check says of a PID file's process: `dead` (no such process); `owned` (the ranger's Body);
 * `mismatch` (readable, and another process); `unverifiable` (alive, and its identity cannot be read).
 */
export type Verdict = 'owned' | 'dead' | 'mismatch' | 'unverifiable';

/** The text a ranger's Body process must show on its command line for `down` to stop it. */
export const rangerMarker = (playerId: string): string => `players/main.ts --player ${playerId}`;

export function formatPidFile(record: PidRecord): string {
  return `${JSON.stringify({ format: PID_FORMAT, ...record })}\n`;
}

/** A current PID file, or an old one (a bare PID, or anything else): an old file is never trusted to kill. */
export type PidFile = { kind: 'current'; record: PidRecord } | { kind: 'old'; pid: number | null };

export function parsePidFile(text: string): PidFile {
  try {
    const row = JSON.parse(text) as Record<string, unknown>;
    if (
      row.format === PID_FORMAT &&
      typeof row.pid === 'number' &&
      Number.isInteger(row.pid) &&
      row.pid > 0 &&
      typeof row.started === 'string' &&
      row.started !== '' &&
      typeof row.marker === 'string'
    ) {
      return {
        kind: 'current',
        record: { pid: row.pid, started: row.started, marker: row.marker },
      };
    }
  } catch {
    // Not JSON: an old, bare PID file.
  }
  return { kind: 'old', pid: parsePid(text) };
}

/**
 * online: the PID file names the ranger's Body; stale: it names a dead process, another process, or is an old
 * file; unknown: it names a live process whose identity cannot be read, so neither `up` nor `down` may act;
 * down: no file.
 */
export type RangerState = 'online' | 'stale' | 'unknown' | 'down';

export interface RangerProcessState {
  state: RangerState;
  pid: number | null;
  /** Set for `unknown` only: why the process cannot be verified. */
  reason?: string;
}

/**
 * The state of one ranger from its PID file text (null when there is none) and the process verdict on the file's
 * record. An old file's PID is reported as stale with its PID, so `up` refuses to start over a live one.
 */
export function rangerState(
  pidText: string | null,
  verify: (record: PidRecord) => Verdict,
): RangerProcessState {
  if (pidText === null) return { state: 'down', pid: null };
  const file = parsePidFile(pidText);
  if (file.kind === 'old') return { state: 'stale', pid: file.pid };
  const { pid, started } = file.record;
  switch (verify(file.record)) {
    case 'owned':
      return { state: 'online', pid };
    case 'dead':
    case 'mismatch':
      return { state: 'stale', pid };
    case 'unverifiable':
      return {
        state: 'unknown',
        pid,
        reason: started === UNKNOWN_START ? 'start time unreadable' : `cannot verify pid ${pid}`,
      };
  }
}

/**
 * What the MCP's presence record of one life says (the `geldar-presence` bucket). `unknown` means NATS could
 * not be read; `none` means the bucket holds no valid record for the life.
 */
export type Presence =
  | { kind: 'record'; state: PresenceState; desiredBody: 'up' | 'down'; at: string }
  | { kind: 'none' }
  | { kind: 'unknown' };

const PRESENCE_STATES = ['awake', 'dim', 'hibernating'] as const;
export type PresenceState = (typeof PRESENCE_STATES)[number];

/** The presence of a life from its record text; `none` when the text is not a valid record of that life. */
export function parsePresenceRecord(text: string, lifeId: string): Presence {
  let row: Record<string, unknown> | null;
  try {
    row = JSON.parse(text) as Record<string, unknown> | null;
  } catch {
    return { kind: 'none' };
  }
  if (row === null || typeof row !== 'object') return { kind: 'none' };
  const state = row.state;
  const desired = row.desired_body;
  if (
    row.life_id !== lifeId ||
    !(PRESENCE_STATES as readonly unknown[]).includes(state) ||
    (desired !== 'up' && desired !== 'down') ||
    typeof row.at !== 'string'
  ) {
    return { kind: 'none' };
  }
  return { kind: 'record', state: state as PresenceState, desiredBody: desired, at: row.at };
}

/** The presence as one status fragment; `presence: unknown` is what an unreachable NATS prints. */
export function formatPresence(presence: Presence): string {
  if (presence.kind === 'unknown') return 'presence: unknown';
  if (presence.kind === 'none') return 'presence: no record';
  return `presence: ${presence.state}, desired body ${presence.desiredBody}, at ${presence.at}`;
}

/** One ranger's process state, RSS and presence, as `formatStatus` reads them. */
export interface RangerRow {
  ranger: Ranger;
  state: RangerState;
  pid: number | null;
  reason?: string;
  rssMb: number | null;
  presence: Presence;
}

/**
 * One status line per ranger: the process (online, stale, unknown or down), its PID and RSS, and the presence. A
 * Body stays online while hibernating, so presence is what says whether it is awake. Prints `down` only when no
 * process runs and the bucket is known to hold no record for any ranger; an unreachable NATS still prints
 * `presence: unknown` per ranger.
 */
export function formatStatus(rows: readonly RangerRow[]): string[] {
  if (rows.every((row) => row.state === 'down' && row.presence.kind === 'none')) return ['down'];
  return rows.map(({ ranger, state, pid, reason, rssMb, presence }) => {
    const rss = rssMb === null ? 'rss unknown' : `rss ${rssMb} MB`;
    const process =
      state === 'down'
        ? 'down'
        : state === 'unknown'
          ? `unknown pid ${pid ?? 'none'} (${reason ?? 'cannot verify'})`
          : `${state} pid ${pid ?? 'none'} ${rss}`;
    return `${ranger.playerId} ${process} (life ${ranger.lifeId}) ${formatPresence(presence)}`;
  });
}
