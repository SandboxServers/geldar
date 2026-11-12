import type { OutputError, OutputErrorCode } from '../ports/index.ts';

/** The verbs a Phase 0 thought may use in `actions` (wave 5 Q9). `say` is the top-level field. */
export const PHASE0_VERBS: readonly string[] = [
  'goto',
  'mine',
  'craft',
  'place',
  'eat',
  'sleep',
  'open',
  'deposit',
  'withdraw',
  'attack',
  'wait',
  'unstick',
  'give',
  'note',
  'write_sign',
];

/** The programs an intent may name. Everything else (skills, `build`, `trade_wait`) is refused. */
export const PHASE0_PROGRAMS: readonly string[] = [
  'travel',
  'gather',
  'craft',
  'rest',
  'flee',
  'follow',
  'build',
];

/** The largest output the validators read: the Thinker's `text` cap (threat model section 4). */
export const MAX_OUTPUT_BYTES = 32 * 1024;

/** The largest `checkpoint` a thought may carry, serialized. The Body writes checkpoints; the Mind only echoes them. */
export const MAX_CHECKPOINT_BYTES = 4096;

/** The most errors one result lists. */
export const MAX_ERRORS = 20;

/** Limits that come from the shard, with the Phase 0 defaults. */
export interface Bounds {
  /** `world_border_radius` of the shard file. A coordinate may exceed it by 16 at most. */
  worldBorderRadius: number;
  /** `chat.max_chars`. */
  sayMaxChars: number;
  /** The largest `limits.max_world_ticks` an intent may ask for. */
  maxWorldTicks: number;
  /** The largest `limits.max_block_operations` an intent may ask for. */
  maxBlockOperations: number;
}

/** Phase 0 defaults: `shards/phase0.yaml` and the contract's own caps. */
export const DEFAULT_BOUNDS: Bounds = {
  worldBorderRadius: 1500,
  sayMaxChars: 256,
  maxWorldTicks: 240_000,
  maxBlockOperations: 10_000,
};

/** How far past the world border a coordinate may point. */
export const BORDER_MARGIN = 16;

/** Y limits of the world. */
export const Y_MIN = -64;
export const Y_MAX = 320;

/** Collects errors, capped at {@link MAX_ERRORS}. */
export class ErrorList {
  readonly errors: OutputError[] = [];

  add(code: OutputErrorCode, path: string, detail: string): void {
    if (this.errors.length < MAX_ERRORS) {
      this.errors.push({ code, path, detail: detail.slice(0, 256) });
    }
  }

  get empty(): boolean {
    return this.errors.length === 0;
  }
}

/** A plain JSON object (not an array, not null). */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A name safe to quote in an error detail; anything else is shown as a placeholder. */
export function safeName(value: unknown): string {
  return typeof value === 'string' && /^[A-Za-z0-9_]{1,32}$/.test(value) ? value : '(not a name)';
}

/** Checks `{x, y, z}`: integers, inside the world border plus the margin, y from -64 to 320. */
export function checkPosition(
  value: unknown,
  path: string,
  bounds: Bounds,
  errors: ErrorList,
): void {
  if (!isObject(value)) {
    errors.add('schema', path, 'must be a position {x, y, z}');
    return;
  }
  for (const key of Object.keys(value)) {
    if (key !== 'x' && key !== 'y' && key !== 'z') {
      errors.add('schema', `${path}/${safeName(key)}`, 'is not a known field');
    }
  }
  const reach = bounds.worldBorderRadius + BORDER_MARGIN;
  const ranges: [string, number, number][] = [
    ['x', -reach, reach],
    ['y', Y_MIN, Y_MAX],
    ['z', -reach, reach],
  ];
  for (const [key, lo, hi] of ranges) {
    const v = value[key];
    if (typeof v !== 'number' || !Number.isInteger(v)) {
      errors.add('schema', `${path}/${key}`, 'must be an integer');
    } else if (v < lo || v > hi) {
      errors.add('out_of_bounds', `${path}/${key}`, `must be from ${lo} to ${hi}`);
    }
  }
}

/** The shape of one program argument. */
type ArgSpec =
  | { kind: 'int'; min: number; max: number; required: boolean }
  | { kind: 'name'; required: boolean }
  | { kind: 'player'; required: boolean }
  | { kind: 'blueprint'; required: boolean }
  | { kind: 'target'; required: boolean };

/** Argument shapes of the Phase 0 programs, read from `golem/src/body/programs/*.ts`. */
const PROGRAM_ARGS: Record<string, Record<string, ArgSpec>> = {
  travel: { target: { kind: 'target', required: true } },
  gather: {
    block: { kind: 'name', required: true },
    count: { kind: 'int', min: 1, max: 2304, required: true },
    item: { kind: 'name', required: false },
    radius: { kind: 'int', min: 1, max: 64, required: false },
  },
  craft: {
    item: { kind: 'name', required: true },
    count: { kind: 'int', min: 1, max: 576, required: true },
  },
  rest: {
    until_health: { kind: 'int', min: 1, max: 20, required: false },
    wait_seconds: { kind: 'int', min: 1, max: 60, required: false },
    max_waits: { kind: 'int', min: 1, max: 120, required: false },
  },
  flee: {
    distance: { kind: 'int', min: 8, max: 64, required: false },
    max_legs: { kind: 'int', min: 1, max: 10, required: false },
  },
  follow: {
    target: { kind: 'player', required: true },
    max_unseen_seconds: { kind: 'int', min: 1, max: 120, required: false },
  },
  build: {
    blueprint: { kind: 'blueprint', required: true },
    block: { kind: 'name', required: true },
  },
};

/** The blueprint ids the Body's build program knows (golem/src/actions/build/blueprints.ts). */
const BLUEPRINTS: readonly string[] = ['shelter', 'wall', 'pillar'];

/** Checks an intent's `arguments` against its program's shape and caps. */
export function checkProgramArguments(
  program: string,
  args: Record<string, unknown>,
  path: string,
  bounds: Bounds,
  errors: ErrorList,
): void {
  const spec = PROGRAM_ARGS[program];
  if (spec === undefined) return;
  for (const key of Object.keys(args)) {
    if (!Object.hasOwn(spec, key)) {
      errors.add('schema', `${path}/${safeName(key)}`, `is not an argument of ${program}`);
    }
  }
  for (const [key, rule] of Object.entries(spec)) {
    const at = `${path}/${key}`;
    const v = args[key];
    if (v === undefined) {
      if (rule.required) errors.add('schema', at, 'is required');
      continue;
    }
    if (rule.kind === 'int') {
      if (typeof v !== 'number' || !Number.isInteger(v)) {
        errors.add('schema', at, 'must be an integer');
      } else if (v < rule.min || v > rule.max) {
        errors.add('out_of_bounds', at, `must be from ${rule.min} to ${rule.max}`);
      }
    } else if (rule.kind === 'name') {
      if (typeof v !== 'string' || !/^[a-z0-9_]{1,64}$/.test(v)) {
        errors.add('schema', at, 'must be a lower-case name');
      }
    } else if (rule.kind === 'blueprint') {
      if (typeof v !== 'string' || !BLUEPRINTS.includes(v)) {
        errors.add('schema', at, 'is not a known blueprint');
      }
    } else if (rule.kind === 'player') {
      if (typeof v !== 'string' || !/^[A-Za-z0-9_]{3,16}$/.test(v)) {
        errors.add('schema', at, 'is not a player name');
      }
    } else if (typeof v === 'string') {
      if (!/^[A-Za-z0-9_]{3,16}$/.test(v)) errors.add('schema', at, 'is not a player name');
    } else {
      checkPosition(v, at, bounds, errors);
    }
  }
}
