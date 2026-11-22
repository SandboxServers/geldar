// Seen-map recorder (BLD-17). The Body records only what the character's own sight reveals (decision 0424):
// the rays of the viewport (golem/src/perception/view/viewport.ts), from the eyes, line of sight only,
// stopping at unloaded chunks and at DARK_RANGE in the dark. No wall-hack: a cell is never recorded unseen.

import {
  DARK_RANGE,
  DEFAULT_COLS,
  DEFAULT_ROWS,
  lookVector,
  MAX_RANGE,
  rayAngles,
  type ViewPose,
  type ViewWorld,
} from '../../perception/view/viewport.ts';
import type { SeenMap } from './section.ts';

/** The seen map is refreshed every this many game ticks. */
export const RECORD_EVERY_TICKS = 10;
/** At most this many rays are cast in one sampled tick; the cone is covered over several ticks. */
export const RAY_BUDGET = 64;
/** The march step along a ray, in blocks (the viewport's step). */
const STEP = 0.25;
const CONE_RAYS = DEFAULT_COLS * DEFAULT_ROWS;

export interface RecorderOptions {
  everyTicks?: number;
  rayBudget?: number;
}

/** The recorder's state: the map it writes and the cursor over the cone's rays. */
export interface SeenRecorder {
  readonly map: SeenMap;
  readonly everyTicks: number;
  readonly rayBudget: number;
  cursor: number;
}

function positiveInt(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1)
    throw new RangeError(`${name} must be a positive integer`);
  return value;
}

export function newRecorder(map: SeenMap, opts: RecorderOptions = {}): SeenRecorder {
  return {
    map,
    everyTicks: positiveInt(opts.everyTicks ?? RECORD_EVERY_TICKS, 'everyTicks'),
    rayBudget: Math.min(positiveInt(opts.rayBudget ?? RAY_BUDGET, 'rayBudget'), CONE_RAYS),
    cursor: 0,
  };
}

/**
 * Walks one ray from the eyes. Each block it reaches is recorded (air and transparent blocks as they are,
 * the first opaque block last). An unloaded chunk ends the ray without recording anything there.
 */
function walkRay(
  map: SeenMap,
  world: ViewWorld,
  pose: ViewPose,
  yaw: number,
  pitch: number,
  tick: number,
): void {
  const [dx, dy, dz] = lookVector(yaw, pitch);
  const limit = world.dark ? DARK_RANGE : MAX_RANGE;
  let lastKey = '';
  for (let t = STEP; t <= limit; t += STEP) {
    const bx = Math.floor(pose.x + dx * t);
    const by = Math.floor(pose.y + dy * t);
    const bz = Math.floor(pose.z + dz * t);
    const key = `${bx},${by},${bz}`;
    if (key === lastKey) continue;
    lastKey = key;
    const sample = world.block(bx, by, bz);
    if (sample.kind === 'unknown') return;
    map.record(bx, by, bz, sample.name ?? sample.kind, tick);
    if (sample.kind === 'solid') return;
  }
}

/**
 * Casts up to `rayBudget` rays of the facing cone from the eyes on a sampled tick (a multiple of
 * `everyTicks`). Returns the number of rays cast this call (0 on an unsampled tick).
 */
export function recordSeen(
  rec: SeenRecorder,
  world: ViewWorld,
  pose: ViewPose,
  tick: number,
): number {
  if (tick % rec.everyTicks !== 0) return 0;
  const count = rec.rayBudget;
  for (let i = 0; i < count; i++) {
    const index = (rec.cursor + i) % CONE_RAYS;
    const col = index % DEFAULT_COLS;
    const row = Math.floor(index / DEFAULT_COLS);
    const [yaw, pitch] = rayAngles(pose, DEFAULT_COLS, DEFAULT_ROWS, col, row);
    walkRay(rec.map, world, pose, yaw, pitch, tick);
  }
  rec.cursor = (rec.cursor + count) % CONE_RAYS;
  return count;
}

/** Records a block the Body itself placed or broke (a break is recorded as `air`). */
export function recordChange(
  map: SeenMap,
  x: number,
  y: number,
  z: number,
  name: string,
  tick: number,
): void {
  map.record(x, y, z, name, tick);
}

/**
 * True when the cell is in view now (review fix 3, decision 0424): inside the outermost rays of the
 * facing cone, within the view range, and reached with no opaque or unloaded block before it. A changed
 * cell that is not in view is not recorded; it stays as the Body last saw it.
 */
export function cellInView(
  world: ViewWorld,
  pose: ViewPose,
  x: number,
  y: number,
  z: number,
): boolean {
  // The same rays the recorder casts, so a cell is in view exactly when a sampled ray records it.
  for (let index = 0; index < CONE_RAYS; index++) {
    const col = index % DEFAULT_COLS;
    const row = Math.floor(index / DEFAULT_COLS);
    const [yaw, pitch] = rayAngles(pose, DEFAULT_COLS, DEFAULT_ROWS, col, row);
    if (rayReaches(world, pose, yaw, pitch, x, y, z)) return true;
  }
  return false;
}

/** Walks one cone ray as walkRay does; true when it reaches the cell before any opaque or unloaded block. */
function rayReaches(
  world: ViewWorld,
  pose: ViewPose,
  yaw: number,
  pitch: number,
  x: number,
  y: number,
  z: number,
): boolean {
  const [dx, dy, dz] = lookVector(yaw, pitch);
  const limit = world.dark ? DARK_RANGE : MAX_RANGE;
  let lastKey = '';
  for (let t = STEP; t <= limit; t += STEP) {
    const bx = Math.floor(pose.x + dx * t);
    const by = Math.floor(pose.y + dy * t);
    const bz = Math.floor(pose.z + dz * t);
    const key = `${bx},${by},${bz}`;
    if (key === lastKey) continue;
    lastKey = key;
    const sample = world.block(bx, by, bz);
    if (sample.kind === 'unknown') return false;
    if (bx === x && by === y && bz === z) return true;
    if (sample.kind === 'solid') return false;
  }
  return false;
}
