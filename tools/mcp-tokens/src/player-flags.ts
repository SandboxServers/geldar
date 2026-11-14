import type { Sql } from './owners.ts';

/** The flags an operator may set on a player. An absent flag stays as it is. */
export interface PlayerFlags {
  publicCamera?: boolean | undefined;
  thoughtsDelayedPublic?: boolean | undefined;
}

export const PLAYER_FLAGS_USAGE =
  'usage: player flags <player-id> --public-camera on|off --thoughts-delayed-public on|off (at least one)';

/** One outcome code from operator_set_player_flags (migration 0034), with its exit code and message. */
interface Outcome {
  exit: number;
  line: (id: string, flags: PlayerFlags) => string;
}

function describe(flags: PlayerFlags): string {
  const camera = flags.publicCamera === undefined ? 'unchanged' : flags.publicCamera ? 'on' : 'off';
  const thoughts =
    flags.thoughtsDelayedPublic === undefined
      ? 'unchanged'
      : flags.thoughtsDelayedPublic
        ? 'on'
        : 'off';
  return `public camera ${camera}, delayed public thoughts ${thoughts}`;
}

const NOTHING_CHANGED = 'nothing changed';

/** Exit codes: 0 set, 1 unexpected, 2 no flag, 3 wait and retry (thoughts window), 4 unknown or retired player. */
export const OUTCOMES: Record<string, Outcome> = {
  ok: { exit: 0, line: (id, flags) => `player ${id}: ${describe(flags)}` },
  'too-soon': {
    exit: 3,
    line: (id) =>
      `player ${id}: the delayed public thoughts flag changed less than 10 seconds ago; ${NOTHING_CHANGED}. Wait 10 seconds and run the command again`,
  },
  'unknown-player': {
    exit: 4,
    line: (id) => `player ${id}: no such player; ${NOTHING_CHANGED}`,
  },
  'retired-player': {
    exit: 4,
    line: (id) => `player ${id}: the player is retired; ${NOTHING_CHANGED}`,
  },
  'no-flags': {
    exit: 2,
    line: (id) => `player ${id}: no flag given; ${NOTHING_CHANGED}`,
  },
};

function onOff(name: string, value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === 'on') return true;
  if (value === 'off') return false;
  throw new Error(`${name} takes on or off, not ${JSON.stringify(value)}\n${PLAYER_FLAGS_USAGE}`);
}

/** Checks the arguments after `player flags`: one player id and at least one flag set to on or off. */
export function parsePlayerFlags(
  args: readonly string[],
  camera: string | undefined,
  thoughts: string | undefined,
): { playerId: string; flags: PlayerFlags } {
  const [playerId, ...extra] = args;
  if (playerId === undefined || playerId === '' || extra.length > 0)
    throw new Error(PLAYER_FLAGS_USAGE);
  const flags: PlayerFlags = {
    publicCamera: onOff('--public-camera', camera),
    thoughtsDelayedPublic: onOff('--thoughts-delayed-public', thoughts),
  };
  if (flags.publicCamera === undefined && flags.thoughtsDelayedPublic === undefined)
    throw new Error(
      `give --public-camera, --thoughts-delayed-public or both\n${PLAYER_FLAGS_USAGE}`,
    );
  return { playerId, flags };
}

/**
 * Calls the operator function once. A refusal is still a call: the function writes the audit row
 * itself, so this never checks the window or the player in the application first.
 */
export async function setPlayerFlags(
  sql: Sql,
  playerId: string,
  flags: PlayerFlags,
): Promise<{ exit: number; line: string }> {
  const result = await sql.query('SELECT operator_set_player_flags($1, $2, $3) AS outcome', [
    playerId,
    flags.publicCamera ?? null,
    flags.thoughtsDelayedPublic ?? null,
  ]);
  const outcome = String(result.rows[0]?.outcome ?? '');
  const mapped = OUTCOMES[outcome];
  if (mapped === undefined)
    return { exit: 1, line: `player ${playerId}: unexpected outcome ${JSON.stringify(outcome)}` };
  return { exit: mapped.exit, line: mapped.line(playerId, flags) };
}
