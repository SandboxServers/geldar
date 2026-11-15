import { Vec3 } from 'vec3';
import { DEFAULT_DIAG_SINK } from '../../actions/stall-diag.ts';
import type { BodyView } from '../view.ts';
import { WATCH_REACH, type WatchProbe, watchProbe } from './idle-stuck-probe.ts';
import { ownHoleWithin } from './panic-burrow.ts';
import { failedWalksAt } from './unstick.ts';

/**
 * Still ticks (20 per second) a Body boxed in by reachability waits before idle_stuck may act: 120 s
 * (decision 0336). The owner's conditions also hold it for the whole still spell, with the idle guards.
 */
export const BOXED_TICKS = 2400;
/** Still ticks for a Body on an owned roofed shelter (its own placed blocks, a roof above): 300 s (decision 0336). */
export const BOXED_OWNED_TICKS = 6000;
/**
 * Still ticks for a Body boxed in at night: 600 s, on its own shelter or not (owner default, 2026-11-15,
 * until geldar-93 says otherwise). A view that cannot say whether it is night counts as night.
 */
export const BOXED_NIGHT_TICKS = 12000;
/** At night a hostile this close (blocks) holds the boxed trigger off. */
export const BOXED_NIGHT_HOSTILE_RADIUS = 16;
/** A Body's own hole (a panic burrow or dark shelter it dug) holds the boxed trigger off for this long: 15 min. */
export const BOXED_HOLE_TICKS = 18000;
/** Attempts (runs, and refused runs) a Body may make per hour of world time, per life: 6 (decision 0336). */
export const BOXED_RUNS_PER_HOUR = 6;
/**
 * Ticks between two boxed attempts: 5 min (decision 0336). At 10 min the sixth attempt lands at 50 min and
 * the hourly cap could never bind; at 5 min the sixth lands at 25 min and the seventh is held by the cap.
 */
export const BOXED_COOLDOWN_TICKS = 6000;
/** One hour of world time in ticks (as idle_stuck counts it). */
const HOUR_TICKS = 72000;
/** How far above the feet the liquid check looks (the head and the cell above it). */
const LIQUID_ABOVE = 2;

/** Per-Body boxed attempts: the hour's attempt ticks, the cooldown end, and whether the cap line was written. */
interface BoxedState {
  attempts: number[];
  cooldownUntil: number;
  capLogged: boolean;
}

const boxedStates = new WeakMap<BodyView, BoxedState>();

function boxedStateOf(view: BodyView): BoxedState {
  let state = boxedStates.get(view);
  if (!state) {
    state = { attempts: [], cooldownUntil: 0, capLogged: false };
    boxedStates.set(view, state);
  }
  return state;
}

/** Forgets the boxed attempts and cooldown of a view (the Body died and respawned, decision 0336 "per life"). */
export function resetBoxedIn(view: BodyView): void {
  boxedStates.delete(view);
}

/**
 * True when the probe reads a closed region: fewer than `WATCH_REACH` cells reachable by the planner's
 * moves, and no reached cell is a way out (`reach_exit` false). An unread probe is never boxed in.
 */
export function boxedFromProbe(probe: WatchProbe): boolean {
  return probe.reach !== null && probe.reach_exit === false && probe.reach < WATCH_REACH;
}

/**
 * Boxed in by reachability (decision 0336): the planner's region is closed (`boxedFromProbe`) AND the Body
 * has been trying to move and failing from this spot (its last two goto outcomes ended `blocked` here,
 * `failedWalksAt`, decision 0332). A Body that is only waiting has no failed walk and is not boxed in.
 */
export function isBoxedIn(view: BodyView, here: { x: number; y: number; z: number }): boolean {
  if (!failedWalksAt(view, here)) return false;
  return boxedFromProbe(watchProbe(view.terrainAt, view.position, view.health));
}

/**
 * True for a Body standing on its own placement under a roof: an owned shelter, which waits the 300 s
 * clock (decision 0336). `roofWithin` is optional; a missing read is not a roof.
 */
export function isOwnedShelter(view: BodyView): boolean {
  return view.onOwnPlacement === true && view.roofWithin?.(3) === true;
}

/** True at night, or when the view cannot say (an unknown read counts as night for the boxed rules). */
export function isNightForBoxed(view: BodyView): boolean {
  return view.isNight !== false;
}

/** The still ticks a boxed Body waits: 600 s at night, 300 s on an owned shelter by day, 120 s otherwise. */
export function boxedWaitTicks(view: BodyView): number {
  if (isNightForBoxed(view)) return BOXED_NIGHT_TICKS;
  return isOwnedShelter(view) ? BOXED_OWNED_TICKS : BOXED_TICKS;
}

/**
 * True while the boxed trigger is held off (decision 0336, owner default 2026-11-15): the Body dug its own
 * hole less than `BOXED_HOLE_TICKS` ago (panic burrow or dark shelter, at any hour), or it is night and a
 * hostile stands within `BOXED_NIGHT_HOSTILE_RADIUS` blocks.
 */
export function boxedHeld(view: BodyView, now: number): boolean {
  return boxedHoldReason(view, now) !== null;
}

/** Why the boxed trigger is held off: the Body's own hole, or a hostile at night; null when it is not held. */
export type BoxedHold = 'own_hole' | 'hostile' | null;

/** The hold reason of the boxed trigger at `now` (see `boxedHeld`). */
export function boxedHoldReason(view: BodyView, now: number): BoxedHold {
  if (ownHoleWithin(view, now, BOXED_HOLE_TICKS)) return 'own_hole';
  // A view with no hostile read (a test fake, or a watch line on one) holds nothing for hostiles.
  if (
    isNightForBoxed(view) &&
    (view.nearbyHostiles?.(BOXED_NIGHT_HOSTILE_RADIUS).length ?? 0) > 0
  ) {
    return 'hostile';
  }
  return null;
}

/** What the attempt gate says now: `ok`, the cooldown still holds, or the hour's cap is reached. */
export type BoxedGate = 'ok' | 'cooldown' | 'cap';

/** The gate's answer at `now`, read without changing any state. */
function gateNow(view: BodyView, now: number): BoxedGate {
  const state = boxedStateOf(view);
  if (now < state.cooldownUntil) return 'cooldown';
  const live = state.attempts.filter((started) => now - started < HOUR_TICKS);
  return live.length >= BOXED_RUNS_PER_HOUR ? 'cap' : 'ok';
}

/** The attempt gate (decision 0336): the cooldown first, then the hour's cap. A gate that is open clears the cap line. */
export function boxedGate(view: BodyView, now: number): BoxedGate {
  const state = boxedStateOf(view);
  state.attempts = state.attempts.filter((started) => now - started < HOUR_TICKS);
  const gate = gateNow(view, now);
  if (gate === 'ok') state.capLogged = false;
  return gate;
}

/**
 * The first gate the boxed trigger fails, checked in the trigger's own order (the watch line's `gate`):
 * `wait` while the still spell is shorter than the boxed clock, `not_boxed` for a region that is not closed
 * or no failed walks, `held` for a hold, `cooldown` or `cap` for the attempt gate, and `none` when all open.
 * `idle` is the still spell in ticks at `now`.
 */
export type BoxedBlock = 'wait' | 'not_boxed' | 'held' | 'cooldown' | 'cap' | 'none';

export function boxedFirstGate(
  view: BodyView,
  here: { x: number; y: number; z: number },
  idle: number,
  now: number,
): BoxedBlock {
  if (idle < boxedWaitTicks(view)) return 'wait';
  if (!isBoxedIn(view, here)) return 'not_boxed';
  if (boxedHoldReason(view, now) !== null) return 'held';
  const gate = gateNow(view, now);
  return gate === 'ok' ? 'none' : gate;
}

/** Notes one boxed attempt at `now` (a run or a refused run) and starts the cooldown. Returns the attempts this hour. */
export function noteBoxedAttempt(view: BodyView, now: number): number {
  const state = boxedStateOf(view);
  state.attempts.push(now);
  state.cooldownUntil = now + BOXED_COOLDOWN_TICKS;
  return state.attempts.length;
}

/** True the first time the cap is seen in one capped window, so the cap line is written once. */
export function noteCapLogged(view: BodyView): boolean {
  const state = boxedStateOf(view);
  if (state.capLogged) return false;
  state.capLogged = true;
  return true;
}

type Read = NonNullable<BodyView['terrainAt']>;

/** Lava, else water, in the 3x3 columns around `centre` from `dyMin` to `dyMax`; null when neither. */
function liquidIn(read: Read, centre: Vec3, dyMin: number, dyMax: number): 'lava' | 'water' | null {
  let water = false;
  for (let dy = dyMin; dy <= dyMax; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const name = read(centre.offset(dx, dy, dz))?.name;
        if (name === 'lava') return 'lava';
        if (name === 'water') water = true;
      }
    }
  }
  return water ? 'water' : null;
}

/**
 * The liquid a dig step would expose (decision 0336): lava or water in the Body's column (one block below
 * its feet up to two above the head), or in the 3x3x3 around the block about to be dug when `block` is
 * given. 'unread' when no terrain is read (a read the view cannot make is not a yes to digging). Null when
 * none is near.
 */
export function digStepLiquid(
  view: BodyView,
  block: Vec3 | null,
): 'lava' | 'water' | 'unread' | null {
  const read = view.terrainAt;
  if (!read) return 'unread';
  const feet = view.position;
  const base = new Vec3(Math.floor(feet.x), Math.floor(feet.y), Math.floor(feet.z));
  const body = liquidIn(read, base, -1, LIQUID_ABOVE);
  if (body === 'lava') return 'lava';
  const cell = block === null ? null : liquidIn(read, block, -1, 1);
  if (cell === 'lava') return 'lava';
  return body ?? cell;
}

/** The pre-run check (decision 0336): no run starts with liquid in the Body's own column. */
export function liquidNear(view: BodyView): 'lava' | 'water' | 'unread' | null {
  return digStepLiquid(view, null);
}

/**
 * The dig guard of one boxed run, checked before EACH dig step (decision 0336): a step is refused, and
 * logged with the block it would dig, when lava or water is beside, under or above the Body or the block,
 * or when no terrain is read. The terrain is read again at each step, so liquid revealed by an earlier dig
 * refuses the next one.
 */
export function boxedDigGuard(view: BodyView): (block: { position: Vec3 }) => boolean {
  return (block) => {
    const liquid = digStepLiquid(view, block.position);
    const cave = liquid === null && caveMouth(view, block.position);
    if (liquid === null && !cave) return false;
    DEFAULT_DIAG_SINK.log(
      JSON.stringify({
        event: 'idle_stuck_boxed',
        result: 'dig refused',
        reason: cave ? 'cave_mouth' : 'liquid',
        liquid,
        block: { x: block.position.x, y: block.position.y, z: block.position.z },
      }),
    );
    return true;
  };
}

/** The axis of a dig step: the one the block lies furthest along from the feet cell (x or z before y on a tie). */
function digDirection(base: Vec3, block: Vec3): Vec3 | null {
  const d = block.minus(base);
  const ax = Math.abs(d.x);
  const ay = Math.abs(d.y);
  const az = Math.abs(d.z);
  if (ax === 0 && ay === 0 && az === 0) return null;
  if (ay > ax && ay > az) return new Vec3(0, Math.sign(d.y), 0);
  if (ax >= az) return new Vec3(Math.sign(d.x), 0, 0);
  return new Vec3(0, 0, Math.sign(d.z));
}

/** The two unit axes that span the plane across a dig direction. */
function planeAxes(dir: Vec3): [Vec3, Vec3] {
  if (dir.x !== 0) return [new Vec3(0, 1, 0), new Vec3(0, 0, 1)];
  if (dir.y !== 0) return [new Vec3(1, 0, 0), new Vec3(0, 0, 1)];
  return [new Vec3(1, 0, 0), new Vec3(0, 1, 0)];
}

/**
 * The cave mouth test of one dig step (decision 0336, narrowed by the orchestrator). A cave mouth is an
 * UNDERGROUND opening, and digging `block` is refused when the cell beyond it in the dig direction, `beyond`:
 * - is air with no sky access (sky light 0, or no sky light read: unknown counts as underground), or has an air
 *   cell in the 3x3 plane across the dig with no sky access, so the opening is a roofed void or a cave; or
 * - is air with air in the three cells straight below it (a drop of 3 blocks or more), at the surface too.
 * Open ground at the surface (sky light above 0 on the cell beyond and its air neighbours) is not a cave mouth:
 * breaking out onto it is the purpose of the dig. A solid cell beyond opens nothing and is allowed.
 */
export function caveMouth(view: BodyView, block: Vec3): boolean {
  const read = view.terrainAt;
  if (!read) return false;
  const feet = view.position;
  const base = new Vec3(Math.floor(feet.x), Math.floor(feet.y), Math.floor(feet.z));
  const dir = digDirection(base, block);
  if (dir === null) return false;
  const beyond = block.plus(dir);
  const air = (at: Vec3): boolean => read(at)?.boundingBox === 'empty';
  const noSky = (at: Vec3): boolean => air(at) && !((read(at)?.skyLight ?? 0) > 0);
  // A cell the view has not loaded is unknown, and unknown refuses (owner rule, decision 0336).
  const unknown = (at: Vec3): boolean => {
    const cell = read(at);
    return cell === null || cell === undefined;
  };
  if (unknown(beyond)) return true;
  if (!air(beyond)) return false;
  const below = [1, 2, 3].map((n) => beyond.offset(0, -n, 0));
  if (below.some(unknown)) return true;
  if (below.every(air)) return true;
  const [a, b] = planeAxes(dir);
  for (let u = -1; u <= 1; u++) {
    for (let v = -1; v <= 1; v++) {
      const at = beyond.offset(a.x * u + b.x * v, a.y * u + b.y * v, a.z * u + b.z * v);
      if (unknown(at) || noSky(at)) return true;
    }
  }
  return false;
}
