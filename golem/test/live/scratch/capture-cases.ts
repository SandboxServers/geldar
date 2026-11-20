// CAP-2: the pure parts of the scratch-shard provenance capture: the case table, argument parsing, the life-id
// and shard guards, and the list and dry-run renderers. No bot, no NATS, no RCON. The runner is provenance-capture.ts.
// Scratch-shard test tooling only: never run it against a live or Colo shard (principle 1; runbook
// docs/runbooks/capture-real-payloads.md, "OPS RUN SHEET").
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
  'RCON (127.0.0.1:25575, --rcon-host): whitelist add/remove, tp, give, clear, summon, setblock, fill, kill';

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
    ops: `${RCON}; compose/opt-in/coreprotect.yml`,
  },
  {
    id: 'kill',
    summary: 'bot A kills a summoned zombie (combat_fact hostile_kill, AN-47a)',
    expect: 'combat_fact=1',
    bots: 1,
    ops: RCON,
  },
  {
    id: 'survived',
    summary: 'bot A hits a zombie, waits out the encounter (fight_survived, AN-47a)',
    expect: 'combat_fact=1',
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

/** The scratch shard is `phase0`. Any other name needs the explicit flag, and live or Colo names are always refused. */
export function refuseShard(shard: string, knowingScratch: boolean): string | null {
  if (/colo|live|prod/i.test(shard)) return `refused: shard "${shard}" is not a scratch shard`;
  if (shard === 'phase0') return null;
  if (knowingScratch) return null;
  return `refused: shard "${shard}" is not phase0; pass --i-know-this-is-a-scratch-shard to run it`;
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
}

/** Parses the CLI. Throws with a usage message for a bad argument; a refused shard is reported by `refuseShard`. */
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
    },
  });
  const mode = values.list ? 'list' : values['dry-run'] ? 'dry-run' : 'run';
  if (mode !== 'list' && values.case === undefined) {
    throw new Error(
      'usage: provenance-capture --case <name|all> [--shard phase0] [--nats-url URL] [--out DIR] [--dry-run] | --list',
    );
  }
  return {
    mode,
    cases: mode === 'list' || values.case === undefined ? [] : resolveCases(values.case),
    shard: values.shard ?? 'phase0',
    natsUrl: values['nats-url'] ?? 'nats://127.0.0.1:4222',
    out: values.out ?? '.capture',
    knowingScratch: values['i-know-this-is-a-scratch-shard'] ?? false,
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
  ];
  for (const c of cases) {
    const cp = c.coreprotect === undefined ? '' : `; needs CoreProtect ${c.coreprotect}`;
    lines.push(`- ${c.id}: ${c.bots} bot(s), validate --expect ${c.expect}${cp}`);
    lines.push(`    ops/RCON: ${c.ops}`);
  }
  lines.push(
    'ops privileges: RCON on 127.0.0.1 only; the bots are whitelisted and removed in finally; world areas are restored.',
  );
  return lines.join('\n');
}
