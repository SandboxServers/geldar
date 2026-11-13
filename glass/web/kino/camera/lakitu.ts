// The Lakitu chase camera (decision 0161): behind the agent's heading, swinging round lazily while the
// agent moves, rotated in 45-degree steps, three zoom distances, rising over or pushed in at walls, a swoop-in
// when it tunes to an agent. Pure: it reads the voxel world and the target, and sends nothing.
//
// Angles: the camera yaw follows orbitGoal (yaw 0 puts the camera on +z of the agent). Minecraft yaw
// is degrees, 0 facing +z (south), 90 facing -x (west), so "behind" is camera yaw = PI - mcYaw.

import type { VoxelWorld } from '../world.ts';
import { CAMERA_HALF, collides, type Vec3 } from './collision.ts';
import { lookPoint } from './modes.ts';

/** Close, medium and far: horizontal distance behind the eyes, and height above them. */
export const ZOOM_LEVELS: readonly { distance: number; height: number }[] = [
  { distance: 4.5, height: 1.5 },
  { distance: 7, height: 3.5 },
  { distance: 14, height: 6 },
];
export const DEFAULT_ZOOM = 1;
export const ROTATE_STEP = Math.PI / 4;
/** How fast the camera swings behind a moving agent (per second, exponential). */
export const SWING_RATE = 1.6;
/** Below this horizontal speed (blocks per second) the agent counts as standing still. */
export const MOVING_SPEED = 0.6;
/** After this long without a camera input, a moving agent pulls a rotated camera back behind it. */
export const RECENTRE_IDLE_SECONDS = 3.5;
export const SWOOP_SECONDS = 1.6;
/** Easing rates (per second, exponential) for a stepped rotation and for easing back out from a wall. */
const OFFSET_RATE = 8;
const ZOOM_RATE = 5;
const WALL_OUT_RATE = 2;
const RAY_STEP = 0.2;
/** When the way behind is blocked, the camera tries these extra heights and rises over the wall. */
export const LIFTS: readonly number[] = [0, 2.5, 5, 8];
/** A lift is good enough when its ray is clear for this share of its length. */
const LIFT_CLEAR = 0.8;
const LIFT_UP_RATE = 4;
const LIFT_DOWN_RATE = 1;

export interface ChaseState {
  /** The yaw that "behind the agent" has swung to so far; null until the first update. */
  baseYaw: number | null;
  /** True once baseYaw came from a heading; until then the first heading that arrives replaces it. */
  headed: boolean;
  /** The viewer's rotation away from behind, shown and wanted. */
  offset: number;
  offsetGoal: number;
  zoom: number;
  /** The zoom level's distance and height, eased between levels. */
  levelDistance: number;
  levelHeight: number;
  /** The distance actually shown along the camera ray, after walls. */
  shown: number | null;
  /** Extra height over a wall behind the agent, eased (Super Mario 64's camera rises over walls). */
  lift: number;
  /** Swoop progress: 1 at the start, 0 when done. */
  swoop: number;
  idle: number;
  speed: number;
  last: Vec3 | null;
}

export function newChase(): ChaseState {
  const level = ZOOM_LEVELS[DEFAULT_ZOOM] as { distance: number; height: number };
  return {
    baseYaw: null,
    headed: false,
    offset: 0,
    offsetGoal: 0,
    zoom: DEFAULT_ZOOM,
    levelDistance: level.distance,
    levelHeight: level.height,
    shown: null,
    lift: 0,
    swoop: 0,
    idle: 0,
    speed: 0,
    last: null,
  };
}

/** Wraps an angle to (-PI, PI]. */
export function wrapAngle(a: number): number {
  const t = (a + Math.PI) % (2 * Math.PI);
  return (t < 0 ? t + 2 * Math.PI : t) - Math.PI;
}

/** Moves angle `cur` a fraction `k` of the short way round to `goal`. */
export function approachAngle(cur: number, goal: number, k: number): number {
  return cur + wrapAngle(goal - cur) * k;
}

/** The camera yaw that puts the camera behind an agent facing Minecraft yaw `degrees`. */
export function yawBehind(degrees: number): number {
  return wrapAngle(Math.PI - (degrees * Math.PI) / 180);
}

/** The camera yaw behind a movement of (dx, dz): the camera sits on the side the agent came from. */
export function yawBehindMotion(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

/** Smoothstep easing, 0..1 in and out. */
export const ease = (t: number): number => t * t * (3 - 2 * t);

/**
 * How far (blocks) the camera box can travel from `from` towards `to` before it meets a block. Blocks
 * the box overlaps before it first gets clear (the agent's own eyes in a wall or a trunk) are ignored;
 * the first block after that stops it. With no clear point on the way, the answer is 0.
 */
export function clearDistance(world: VoxelWorld, from: Vec3, to: Vec3, half = CAMERA_HALF): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const len = Math.hypot(dx, dy, dz);
  if (len === 0) return 0;
  const n = Math.ceil(len / RAY_STEP);
  let clear = 0;
  let free = !collides(world, from, half);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const hit = collides(
      world,
      { x: from.x + dx * t, y: from.y + dy * t, z: from.z + dz * t },
      half,
    );
    if (hit && free) break;
    if (!hit) {
      free = true;
      clear = len * t;
    }
  }
  return clear;
}

/** Viewer inputs on the chase camera. Each is view-only: nothing here is sent anywhere. */
export function rotateChase(s: ChaseState, steps: number): void {
  s.offsetGoal += steps * ROTATE_STEP;
  s.idle = 0;
}

export function dragChase(s: ChaseState, dYaw: number): void {
  s.offset += dYaw;
  s.offsetGoal = s.offset;
  s.idle = 0;
}

/** Steps the zoom level; returns false at either end (the page can say so). */
export function zoomChase(s: ChaseState, steps: number): boolean {
  const next = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, s.zoom + steps));
  const moved = next !== s.zoom;
  s.zoom = next;
  s.idle = 0;
  return moved;
}

/** Swings the camera back behind the agent. */
export function recentreChase(s: ChaseState): void {
  s.offsetGoal = Math.round(s.offset / (2 * Math.PI)) * 2 * Math.PI;
  s.idle = 0;
}

/** Starts the swoop-in (a new target). Under reduced motion the camera simply appears in place. */
export function swoopChase(s: ChaseState, reducedMotion: boolean): void {
  s.swoop = reducedMotion ? 0 : 1;
  s.shown = null;
  s.baseYaw = null;
  s.headed = false;
  s.last = null;
}

export interface ChaseInput {
  /** The agent's feet. */
  target: Vec3;
  /** The agent's Minecraft yaw in degrees, when the feed has its entity. */
  heading: number | null;
  dt: number;
}

/** Advances the chase camera by one frame and returns the camera position. */
export function stepChase(s: ChaseState, world: VoxelWorld, input: ChaseInput): Vec3 {
  const { target, heading, dt } = input;
  let motionYaw: number | null = null;
  if (s.last && dt > 0) {
    const dx = target.x - s.last.x;
    const dz = target.z - s.last.z;
    const v = Math.hypot(dx, dz) / dt;
    // A teleport is not walking: drop it from the speed estimate.
    if (v < 40) s.speed += (v - s.speed) * (1 - Math.exp(-dt * 6));
    if (Math.hypot(dx, dz) > 1e-4) motionYaw = yawBehindMotion(dx, dz);
  }
  s.last = { ...target };
  const moving = s.speed > MOVING_SPEED;
  const behind = heading !== null ? yawBehind(heading) : moving ? motionYaw : null;
  if (s.baseYaw === null || (!s.headed && heading !== null)) {
    // The first frames often have a position but no entity yet: a guess until the heading arrives.
    s.baseYaw = behind ?? s.baseYaw ?? 0;
    s.headed = heading !== null;
  } else if (moving && behind !== null)
    s.baseYaw = approachAngle(s.baseYaw, behind, 1 - Math.exp(-dt * SWING_RATE));

  s.idle += dt;
  if (moving && s.idle > RECENTRE_IDLE_SECONDS) {
    const home = Math.round(s.offsetGoal / (2 * Math.PI)) * 2 * Math.PI;
    s.offsetGoal += (home - s.offsetGoal) * (1 - Math.exp(-dt * 0.8));
  }
  s.offset += (s.offsetGoal - s.offset) * (1 - Math.exp(-dt * OFFSET_RATE));

  const level = ZOOM_LEVELS[s.zoom] as { distance: number; height: number };
  const kz = 1 - Math.exp(-dt * ZOOM_RATE);
  s.levelDistance += (level.distance - s.levelDistance) * kz;
  s.levelHeight += (level.height - s.levelHeight) * kz;

  const sw = ease(s.swoop);
  s.swoop = Math.max(0, s.swoop - dt / SWOOP_SECONDS);
  const horizontal = s.levelDistance * (1 + 2.5 * sw);
  const height = s.levelHeight + 14 * sw;

  const yaw = s.baseYaw + s.offset;
  const eye = lookPoint(target);
  const goalAt = (extra: number): Vec3 => ({
    x: eye.x + Math.sin(yaw) * horizontal,
    y: eye.y + height + extra,
    z: eye.z + Math.cos(yaw) * horizontal,
  });
  // A lifted camera first rises straight up from the eyes (as far as that is clear), then goes out:
  // an agent pressed against a wall is filmed from over the wall's top, not through it.
  const originAt = (extra: number): Vec3 =>
    extra === 0
      ? eye
      : {
          x: eye.x,
          y: eye.y + clearDistance(world, eye, { x: eye.x, y: eye.y + extra, z: eye.z }),
          z: eye.z,
        };
  const rayAt = (extra: number): { from: Vec3; to: Vec3; length: number } => {
    const from = originAt(extra);
    const to = goalAt(extra);
    return { from, to, length: Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z) };
  };
  if (sw > 0.05) {
    // During the swoop the camera is above the world's walls: it flies in, it does not collide yet.
    s.lift = 0;
  } else {
    // The lowest lift whose ray is mostly clear; the clearest one when none is.
    let want = 0;
    let best = -1;
    for (const extra of LIFTS) {
      const r = rayAt(extra);
      const share = r.length === 0 ? 0 : clearDistance(world, r.from, r.to) / r.length;
      if (share > best + 1e-6) {
        best = share;
        want = extra;
      }
      if (share >= LIFT_CLEAR) {
        want = extra;
        break;
      }
    }
    const rate = want > s.lift ? LIFT_UP_RATE : LIFT_DOWN_RATE;
    s.lift += (want - s.lift) * (1 - Math.exp(-dt * rate));
  }
  const {
    from,
    to: goal,
    length: full,
  } = sw > 0.05
    ? { from: eye, to: goalAt(0), length: Math.hypot(horizontal, height) }
    : rayAt(s.lift);
  const clear = sw > 0.05 ? full : clearDistance(world, from, goal);
  // In fast against a wall, back out slowly, so the view does not pump.
  if (s.shown === null || clear < s.shown) s.shown = clear;
  else s.shown += (clear - s.shown) * (1 - Math.exp(-dt * WALL_OUT_RATE));
  const f = full === 0 ? 0 : s.shown / full;
  return {
    x: from.x + (goal.x - from.x) * f,
    y: from.y + (goal.y - from.y) * f,
    z: from.z + (goal.z - from.z) * f,
  };
}
