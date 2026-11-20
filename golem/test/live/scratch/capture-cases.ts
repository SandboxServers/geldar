// CAP-2: the pure parts of the scratch-shard provenance capture: the case table, argument parsing, the life-id,
// block-id, loopback and shard guards, the positive-control and stale-folder rules, and the list and dry-run
// renderers. No bot, no NATS, no RCON. The runner is provenance-capture.ts; its windows are capture-windows.ts and its
// subscriber is capture-subscriber.ts. Scratch-shard test tooling only: never run it against a live or Colo shard
// (principle 1; runbook docs/runbooks/capture-real-payloads.md, "OPS RUN SHEET").
import { parseArgs } from 'node:util';

/** One case of the capture. `expect` is the validator's `--expect` spec for the case's own folder. */
export interface CaptureCase {
  id: string;
  /** One line: what the case does on the shard. */
  summary: string;
  /** The validator spec: `kind=N` (at least N) or `kind=0` (exactly none). */
  expect: string;
  /** Bots the case starts: `bot A` always, `bot B` for the two-life cases. */
  bots: 1 | 2;
  /** The CoreProtect state the case needs (only the break cases depend on it). */
  coreprotect?: 'absent' | 'present';
  /** What the case needs from ops or RCON, printed in the dry-run plan. */
  ops: string;
}

const RCON =
  'RCON (127.0.0.1:25575, --rcon-host): whitelist add/remove, tp, give, clear, summon, setblock, fill, kill, experience add (anvil, enchanting table)';

/** The case that proves the send-nothing cases can see a take: a take=0 counts only when it ran in the same session. */
export const POSITIVE_CONTROL = 'chest-single';

/** The fifteen cases. The runbook's run sheet names each one (a test checks both lists match). */
export const CAPTURE_CASES: readonly CaptureCase[] = [
  {
    id: 'toss',
    summary: 'bot A tosses cobblestone, bot B picks it up (AN-26a pickup)',
    expect: 'pickup=1',
    bots: 2,
    ops: RCON,
  },
  {
    id: 'break-coreprotect-absent',
    summary: 'bot A places a block, bot B breaks it; no CoreProtect (AN-27a)',
    expect: 'break=1',
    bots: 2,
    coreprotect: 'absent',
    ops: RCON,
  },
  {
    id: 'break-coreprotect-present',
    summary: 'as above with the CoreProtect overlay; owner query inside 30 s (AN-27a)',
    expect: 'break=1',
    bots: 2,
    coreprotect: 'present',
    ops: `${RCON}; NATS request blockowner.query before the break (the Body's route); CoreProtect checked by ops`,
  },
  {
    id: 'kill',
    summary: 'bot A kills a summoned zombie (combat_fact hostile_kill, AN-47a)',
    expect: 'combat_fact=1,combat=1',
    bots: 1,
    ops: RCON,
  },
  {
    id: 'survived',
    summary:
      'bot A hits a zombie that cannot attack, waits out the encounter (fight_survived, AN-47a)',
    expect: 'combat_fact=1,combat=1',
    bots: 1,
    ops: RCON,
  },
  {
    id: 'chest-single',
    summary: 'withdraw from a single chest (AN-51a take)',
    expect: 'take=1',
    bots: 1,
    ops: RCON,
  },
  {
    id: 'chest-double',
    summary: 'withdraw from a double chest (AN-51a take)',
    expect: 'take=1',
    bots: 1,
    ops: RCON,
  },
  {
    id: 'chest-shift-click',
    summary: 'shift-click (mode 1) out of a chest (AN-51a take)',
    expect: 'take=1',
    bots: 1,
    ops: RCON,
  },
  {
    id: 'chest-number-key',
    summary: 'number-key swap (mode 2) out of a chest (AN-51a take)',
    expect: 'take=1',
    bots: 1,
    ops: RCON,
  },
  {
    id: 'furnace',
    summary: 'take smelted output from a furnace: SENDS a take (furnace ruling)',
    expect: 'take=1',
    bots: 1,
    ops: RCON,
  },
  {
    id: 'brewing-stand',
    summary: 'take a brewed potion: SENDS a take (furnace ruling)',
    expect: 'take=1',
    bots: 1,
    ops: RCON,
  },
  {
    id: 'crafting-table',
    summary: 'take crafting output: sends NOTHING (furnace ruling)',
    expect: 'take=0',
    bots: 1,
    ops: RCON,
  },
  {
    id: 'anvil',
    summary: 'take from an anvil: sends NOTHING (furnace ruling)',
    expect: 'take=0',
    bots: 1,
    ops: RCON,
  },
  {
    id: 'enchanting-table',
    summary: 'take from an enchanting table: sends NOTHING (furnace ruling)',
    expect: 'take=0',
    bots: 1,
    ops: RCON,
  },
  {
    id: 'player-2x2',
    summary: 'take from the own 2x2 inventory craft: sends NOTHING (furnace ruling)',
    expect: 'take=0',
    bots: 1,
    ops: RCON,
  },
];

/**
 * The block ids the cases place with `TestControl.setblock`. That method accepts only bare ids
 * (`^[a-z0-9_]{1,64}$`, golem/src/test-control.ts): no `minecraft:` namespace and no block state.
 */
export const CASE_BLOCKS = {
  chest: 'chest',
  furnace: 'furnace',
  brewingStand: 'brewing_stand',
  craftingTable: 'crafting_table',
  anvil: 'anvil',
  enchantingTable: 'enchanting_table',
} as const;

/**
 * CAP-4: each case that places a container block sits at its own (x, z) offset from the arena centre, so the coordinates
 * of a take payload name its case (before, every take sat at the same block: the holder type was not separable). The
 * double chest also fills x + 1. Bot A stands at x - 2 beside its block (windows.ts), so the offsets stay within reach.
 */
export const CASE_BLOCK_OFFSET = {
  'chest-single': [2, 0],
  'chest-double': [4, 0],
  'chest-shift-click': [7, 0],
  'chest-number-key': [9, 0],
  furnace: [11, 0],
  'brewing-stand': [13, 0],
  'crafting-table': [2, 2],
  anvil: [4, 2],
  'enchanting-table': [7, 2],
} as const satisfies Record<string, readonly [number, number]>;

/**
 * CAP-4 (review 1): the two break cases place their block on cells of their own, off the container rows. Bot A stands
 * at x - 1 and bot B at x + 1, both on the block's z (provenance-capture.ts breakPair), so the cell is in reach of both.
 */
export const BREAK_BLOCK_OFFSET = {
  'break-coreprotect-absent': [1, 4],
  'break-coreprotect-present': [1, 6],
} as const satisfies Record<string, readonly [number, number]>;

export type BlockCaseId = keyof typeof CASE_BLOCK_OFFSET | keyof typeof BREAK_BLOCK_OFFSET;

/** Every case that places a block at its own cell: the containers and the two breaks. */
export const BLOCK_CASE_OFFSET: Record<BlockCaseId, readonly [number, number]> = {
  ...CASE_BLOCK_OFFSET,
  ...BREAK_BLOCK_OFFSET,
};

/** The block position of a case: the arena centre plus the case's own offset. */
export function caseBlockPosition(
  id: BlockCaseId,
  centre: { x: number; z: number },
): { x: number; z: number } {
  const [dx, dz] = BLOCK_CASE_OFFSET[id];
  return { x: centre.x + dx, z: centre.z + dz };
}

const BARE_BLOCK_ID = /^[a-z0-9_]{1,64}$/;

/** Null for a bare block id; otherwise the reason `TestControl.setblock` would throw on it. */
export function blockIdProblem(id: string): string | null {
  if (BARE_BLOCK_ID.test(id)) return null;
  return `"${id}" is not a bare block id (no namespace, no block state, lower case only)`;
}

/**
 * The double chest: two `chest` blocks with block states, placed by a raw command (TestControl.setblock cannot take
 * a state). The left half faces north with its partner to the east, so the partner is `right`.
 */
export function doubleChestCommands(x: number, y: number, z: number): [string, string] {
  return [
    `setblock ${x} ${y} ${z} chest[facing=north,type=left]`,
    `setblock ${x + 1} ${y} ${z} chest[facing=north,type=right]`,
  ];
}

/** The life-id pattern the plugin and the contract use (EventEnvelope.java:27, contract evidence.ts). */
const LIFE_ID = /^ag_[a-z][a-z0-9]{0,15}_[0-9]{2,}$/;

/** The two capture bots. Their names must be life ids, or the combat and take listeners ignore them. */
export const BOT_A = 'ag_capa_01';
export const BOT_B = 'ag_capb_02';
/** Arena slots 8 and 9 (arena.ts: slot 10 is the last that fits; the other live cases use lower slots). */
export const SLOT_A = 8;
export const SLOT_B = 9;

export function isLifeId(name: string): boolean {
  return LIFE_ID.test(name);
}

/** The shard name the subjects are built from: lower case, digits and dashes (no spaces, no dots, no wildcards). */
const SHARD_NAME = /^[a-z][a-z0-9-]{1,31}$/;

export function shardNameProblem(shard: string): string | null {
  return SHARD_NAME.test(shard)
    ? null
    : `shard "${shard}" is not a shard name (lower case, letters, digits, dashes)`;
}

/**
 * True only for a loopback URL. The script's `--nats-url` is separate from the registry's GELDAR_NATS_URL, so this
 * check is what keeps the owner query and the subscriber on the machine (config.ts uses the same host rule).
 */
export function isLoopbackUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === '127.0.0.1' || host === 'localhost';
  } catch {
    return false;
  }
}

/**
 * The scratch shard is `phase0`. Any other name needs the explicit flag, and live or Colo names are always refused.
 * This is a name check only; the loopback host rule (`isLoopbackUrl`) is the guard that keeps a non-scratch server
 * unreachable from this script.
 */
export function refuseShard(shard: string, knowingScratch: boolean): string | null {
  if (/colo|live|prod/i.test(shard)) return `refused: shard "${shard}" is not a scratch shard`;
  if (shard === 'phase0') return null;
  if (knowingScratch) return null;
  return `refused: shard "${shard}" is not phase0; pass --i-know-this-is-a-scratch-shard to run it`;
}

/**
 * A take=0 case is evidence only when `chest-single` ran and passed in the same session (a zero from a dead or
 * unflagged listener is an empty folder too). Returns the refusal text, or null when the zero may count.
 */
export function zeroIsEvidence(c: CaptureCase, controlPassed: boolean): string | null {
  if (c.expect !== 'take=0' || controlPassed) return null;
  return `refused: ${c.id} expects take=0 and counts only after ${POSITIVE_CONTROL} passed (take=1) in the same session`;
}

/**
 * The session marker: `<out>/positive-control.json`, written by the runner when chest-single passes its validator.
 * A later run with the same `--out` (the run sheet runs the send-nothing cases one per command) reads it, so a zero
 * counts only after the control passed in this capture session.
 */
export const CONTROL_MARKER = 'positive-control.json';

/** True only for a marker that says chest-single passed its take=1 validation in some run (the session id is set). */
export function controlFromMarker(marker: unknown): boolean {
  if (typeof marker !== 'object' || marker === null) return false;
  const m = marker as Record<string, unknown>;
  return (
    m.case === POSITIVE_CONTROL &&
    m.expect === 'take=1' &&
    typeof m.session === 'string' &&
    m.session.length > 0
  );
}

/** The control state after one case: only chest-single changes it, and only by its validator's exit (0 = passed). */
export function nextControlState(c: CaptureCase, code: number, passed: boolean): boolean {
  if (c.id !== POSITIVE_CONTROL) return passed;
  return code === 0;
}

/** The extra validator flags of a case. The present case must show a prior owner (null fails). */
export function validatorArgs(c: CaptureCase): string[] {
  return c.coreprotect === 'present' ? ['--expect-prior-owner'] : [];
}

/**
 * Refuses up front a take=0 case with no positive control before it: chest-single earlier in the selected cases, or
 * a passed control already on disk (`controlOnDisk`, read from the session marker in `--out`). The runner also
 * checks at run time that the control passed (its validator exit was 0).
 */
export function sessionRefusal(
  cases: readonly CaptureCase[],
  controlOnDisk = false,
): string | null {
  let control = controlOnDisk;
  for (const c of cases) {
    const refusal = zeroIsEvidence(c, control);
    if (refusal !== null) return refusal;
    if (c.id === POSITIVE_CONTROL) control = true;
  }
  return null;
}

/** The dry-run's warning: what a real run would refuse. Null when the selected cases are a valid session. */
export function controlWarning(
  cases: readonly CaptureCase[],
  controlOnDisk: boolean,
): string | null {
  const refusal = sessionRefusal(cases, controlOnDisk);
  return refusal === null ? null : `warning (a real run refuses this): ${refusal}`;
}

/**
 * What to do with `<out>/<case>/` at case start: use an empty folder, refuse a folder with files unless `--clean`
 * is given, or clear it. A stale file would otherwise pass `take=1` or fail `take=0` for a reason that is not the run.
 */
export function staleFolderAction(entries: number, clean: boolean): 'use' | 'clean' | 'refuse' {
  if (entries === 0) return 'use';
  return clean ? 'clean' : 'refuse';
}

export function findCase(id: string): CaptureCase | undefined {
  return CAPTURE_CASES.find((c) => c.id === id);
}

/** Resolves `all` or a comma list of case ids. Throws on an unknown id, so a typo never runs a partial set. */
export function resolveCases(spec: string): CaptureCase[] {
  if (spec === 'all') return [...CAPTURE_CASES];
  const out: CaptureCase[] = [];
  for (const raw of spec.split(',')) {
    const id = raw.trim();
    if (id.length === 0) continue;
    const found = findCase(id);
    if (found === undefined) throw new Error(`unknown case "${id}"; run with --list`);
    out.push(found);
  }
  if (out.length === 0) throw new Error('--case names no case');
  return out;
}

export interface RunArgs {
  mode: 'list' | 'dry-run' | 'run';
  cases: CaptureCase[];
  shard: string;
  natsUrl: string;
  out: string;
  knowingScratch: boolean;
  clean: boolean;
}

/**
 * Parses the CLI. Throws with a usage message for a bad argument, a bad shard name, or a non-loopback NATS URL.
 * A refused shard (name) is reported by `refuseShard`.
 */
export function parseRunArgs(argv: string[]): RunArgs {
  const { values } = parseArgs({
    args: argv,
    strict: true,
    options: {
      case: { type: 'string' },
      shard: { type: 'string', default: 'phase0' },
      'nats-url': { type: 'string', default: 'nats://127.0.0.1:4222' },
      out: { type: 'string', default: '.capture' },
      list: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      'i-know-this-is-a-scratch-shard': { type: 'boolean', default: false },
      clean: { type: 'boolean', default: false },
    },
  });
  const mode = values.list ? 'list' : values['dry-run'] ? 'dry-run' : 'run';
  if (mode !== 'list' && values.case === undefined) {
    throw new Error(
      'usage: provenance-capture --case <name|all> [--shard phase0] [--nats-url URL] [--out DIR] [--clean] [--dry-run] | --list',
    );
  }
  const shard = values.shard ?? 'phase0';
  const shardProblem = shardNameProblem(shard);
  if (shardProblem !== null) throw new Error(shardProblem);
  const natsUrl = values['nats-url'] ?? 'nats://127.0.0.1:4222';
  if (!isLoopbackUrl(natsUrl)) {
    throw new Error(`--nats-url must be a loopback URL (127.0.0.1 or localhost), not ${natsUrl}`);
  }
  return {
    mode,
    cases: mode === 'list' || values.case === undefined ? [] : resolveCases(values.case),
    shard,
    natsUrl,
    out: values.out ?? '.capture',
    knowingScratch: values['i-know-this-is-a-scratch-shard'] ?? false,
    clean: values.clean ?? false,
  };
}

/** The `--list` table: one row per case. */
export function renderList(cases: readonly CaptureCase[] = CAPTURE_CASES): string {
  const lines = ['case | bots | expect | coreprotect | what'];
  for (const c of cases) {
    lines.push(`${c.id} | ${c.bots} | ${c.expect} | ${c.coreprotect ?? '-'} | ${c.summary}`);
  }
  return lines.join('\n');
}

/** The `--dry-run` plan: what runs, the subjects, the bots, the ops privileges. Connects to nothing. */
export function renderPlan(
  cases: readonly CaptureCase[],
  args: Pick<RunArgs, 'shard' | 'natsUrl' | 'out'>,
): string {
  const subjects = `geldar.${args.shard}.provenance.>, geldar.${args.shard}.combat_fact`;
  const lines = [
    `PLAN (dry run, nothing is connected): shard ${args.shard}, nats ${args.natsUrl}, out ${args.out}`,
    `bots: ${BOT_A} (slot ${SLOT_A}), ${BOT_B} (slot ${SLOT_B}); both must be life ids: ${isLifeId(BOT_A) && isLifeId(BOT_B)}`,
    `subscriber subjects: ${subjects}`,
    'per case: start nats-capture, WAIT for READY, do the case, settle 20 s, stop the subscriber, validate <out>/<case>/',
    `stale folder: a non-empty <out>/<case>/ is refused unless --clean is given; a take=0 case needs ${POSITIVE_CONTROL} to pass first in the same session`,
  ];
  for (const c of cases) {
    const cp = c.coreprotect === undefined ? '' : `; needs CoreProtect ${c.coreprotect}`;
    lines.push(`- ${c.id}: ${c.bots} bot(s), validate --expect ${c.expect}${cp}`);
    lines.push(`    ops/RCON: ${c.ops}`);
    if (c.coreprotect === 'present') {
      lines.push(
        '    precondition (ops, NOT checked by the script): CoreProtect is loaded (`plugins` lists it) and the overlay is mounted',
      );
      lines.push(
        '    owner query: NATS request blockowner.query right before the break; the case FAILS if the break is 30 s or more after it, or the reply has no owner for the block',
      );
    }
  }
  lines.push(
    'ops privileges: RCON on 127.0.0.1 only; the bots are whitelisted and removed in finally; world areas are restored.',
  );
  return lines.join('\n');
}
