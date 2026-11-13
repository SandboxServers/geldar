import { classifyPathError, forbidCornerCutting } from './path-rules.ts';

export { classifyPathError, forbidCornerCutting };

import type { Bot } from 'mineflayer';
import pathfinderPkg from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { escapeLadder, inWater } from './escape-ladder.ts';
import { applyDigRules, DigTally } from './goto-dig.ts';
import { nearDoor, onPathUpdate } from './path-doors.ts';
import { installSoftDig, NO_PATH_TEXT, PARTIAL_TEXT, SEARCH_TIMEOUT_TEXT } from './soft-dig.ts';
import {
  DEFAULT_DIAG_SINK,
  type DiagSink,
  emitStallDiag,
  type RecoveryStep,
  type StallFacts,
  watchPathEvents,
} from './stall-diag.ts';
import {
  digGraceTicks,
  isDigging,
  JUMP_TICKS,
  pulseJump,
  recordRecovery,
  recoveryAllowed,
  setJump,
  stopDigIfDigging,
} from './stall-recovery.ts';

const { pathfinder, Movements, goals } = pathfinderPkg;

/** A path search may think this long per tick slice (ms, the library caps it at 50) ... */
const TICK_SLICE_MS = 40;
/** ... and this long in total before it gives up with a `Timeout`. */
const SEARCH_BUDGET_MS = 4000;
/** Tier 2's search budget (ms): an unreachable goal costs this much, not the whole 4 s (decision 0164). */
export const TIER_TWO_BUDGET_MS = 1500;
/** A stall's tier 2 ends once the bot is this far from the spot it stalled at (decision 0164). */
export const STALL_DIG_LEAVE_BLOCKS = 3;
/** Stall then replan: under this many blocks of movement for this many ticks drops the path. */
const REPLAN_MOVED = 0.03;
export const REPLAN_STALL_TICKS = 60;
/**
 * Still ticks before the one stall recovery of an episode (stop a dig, re-set the goal, jump at a
 * step). It shares the replan tick: the existing replan rule pins its first re-set to this tick.
 */
export const RECOVERY_STALL_TICKS = 60;
/** At most this many replans per goto; after that only the long stall rule below ends the move. */
export const MAX_REPLANS = 6;

/** Blocks the bot must move to count as moving again (the stall rule). */
const MOVED_BLOCKS = 0.75;
/** How often the stall watchdog looks, in wall milliseconds. */
const WATCH_INTERVAL_MS = 500;
/** Default stall limit: 600 world ticks, which is 30 s at 20 TPS. */
const DEFAULT_STALL_TICKS = 600;

/** How a move ended. A timeout is the caller's (through `runAction`), not this module's. */
export type MoveResult =
  | { ok: true; distance: number; partial?: true; message?: string }
  | {
      ok: false;
      reason: 'blocked' | 'timeout' | 'interrupted' | 'cancelled' | 'needs_rescue';
      message: string;
    };

/** Escape ladders one goto may run before the plain `blocked` result stands. */
export const MAX_LADDERS = 2;

/** The parts of a pathfinder `Movements` that the door rule reads and wraps. */
interface DoorMovements {
  canOpenDoors: boolean;
  openable: Set<number>;
  getBlock(pos: { x: number; y: number; z: number }, dx: number, dy: number, dz: number): DoorCell;
}

/** A cell as `getBlock` returns it; the door rule rewrites these flags. */
interface DoorCell {
  type?: number;
  openable?: boolean;
  safe?: boolean;
  physical?: boolean;
}

/** True for an open door's `open` property (a boolean, or its string form). */
const isOpen = (value: unknown): boolean => value === true || value === 'true';

/**
 * Lets a route walk through wooden doors. The server is Paper, where a right-click opens a village
 * door, so a closed door is a way through, not a wall. The library's openable set (2.4.5) holds
 * gates only, so wooden doors join it here. A door is two cells: the planner clicks the lower
 * half (`useOne`) and walks the upper half, which the library would otherwise refuse as unsafe.
 * An open door is walked through, never clicked shut. Iron doors need redstone, so they stay walls.
 * Only this instance's `getBlock` is wrapped; the library module is not touched.
 */
export function allowDoors(movements: unknown, bot: Bot): void {
  const m = movements as DoorMovements;
  const doorIds = new Set<number>();
  for (const block of bot.registry.blocksArray) {
    if (block.name.endsWith('_door') && !block.name.startsWith('iron_')) doorIds.add(block.id);
  }
  m.canOpenDoors = true;
  for (const id of doorIds) m.openable.add(id);
  const original = m.getBlock.bind(m);
  m.getBlock = (pos, dx, dy, dz) => {
    const cell = original(pos, dx, dy, dz);
    if (cell.type === undefined || !doorIds.has(cell.type)) return cell;
    const world = bot.blockAt(new Vec3(pos.x + dx, pos.y + dy, pos.z + dz), false) as {
      getProperties?: () => Record<string, unknown>;
    } | null;
    const props = world?.getProperties?.() ?? {};
    if (isOpen(props.open)) {
      cell.safe = true;
      cell.physical = false;
      cell.openable = false;
    } else if (props.half === 'upper') {
      cell.safe = true;
      cell.physical = false;
    }
    return cell;
  };
}

/** Tier 1 movements per bot: the plain walk (soft digs only, no towers) that `goto` starts with. */
const tierOne = new WeakMap<Bot, unknown>();

/**
 * Tier 2 movements (decision 0164): digging at cost 4, towers with scaffolding, and the safety
 * rules of `goto-dig.ts`. Built fresh per walk, with the same doors and corner rules as tier 1.
 */
function digMovements(bot: Bot): unknown {
  const digging = new Movements(bot);
  applyDigRules(digging, bot);
  forbidCornerCutting(digging);
  allowDoors(digging, bot);
  return digging;
}

/**
 * Loads the pathfinder once and sets the tier-1 movement rules: soft digs only, no towers, no
 * scaffolding. `goto` digs and builds only in tier 2, after the plain walk finds no path (0164).
 */
export function ensurePathfinder(bot: Bot): void {
  // Read through `unknown` so the check does not narrow `bot.pathfinder` to never below.
  const loaded: unknown = (bot as { pathfinder?: unknown }).pathfinder;
  if (loaded) return;
  bot.loadPlugin(pathfinder);
  const movements = new Movements(bot);
  // Soft-dig (decision 0141, amended by 0164): leaves, vines, snow and plant cover only in tier 1.
  installSoftDig(movements);
  movements.allow1by1towers = false;
  // The library spells this property `scafoldingBlocks` (2.4.5).
  movements.scafoldingBlocks = [];
  forbidCornerCutting(movements);
  allowDoors(movements, bot);
  tierOne.set(bot, movements);
  bot.pathfinder.setMovements(movements);
  // Fake bodies in tests have no emitter; the trail and the door snap need one (as watchPathEvents).
  if (typeof bot.on === 'function') bot.on('path_update', (update) => onPathUpdate(bot, update));
  bot.pathfinder.tickTimeout = TICK_SLICE_MS;
  bot.pathfinder.thinkTimeout = SEARCH_BUDGET_MS;
}

/** The distance (blocks) from a reach target at which a planned route counts as reaching it. */
export const REACH_RANGE = 2;

/**
 * A read-only route plan for `reach` (PX-8a): searches from where the Body stands to within
 * `REACH_RANGE` of `target` and reports the status and visited nodes. It never moves the bot.
 * `canDig` plans with full digging, otherwise with the same movements `goto` uses.
 */
export function planReach(
  bot: Bot,
  target: { x: number; y: number; z: number },
  canDig: boolean,
): { status: string; visited: number } {
  ensurePathfinder(bot);
  const goal = new goals.GoalNear(target.x, target.y, target.z, REACH_RANGE);
  const planner = bot.pathfinder as unknown as ReachPlanner;
  // The plain movements, not the last walk's tier 2 (a goto may have left digging movements set).
  let movements: unknown = tierOne.get(bot) ?? planner.movements;
  if (canDig) {
    const digging = new Movements(bot);
    digging.canDig = true;
    digging.allow1by1towers = false;
    digging.scafoldingBlocks = [];
    allowDoors(digging, bot);
    movements = digging;
  }
  const found = planner.getPathTo(movements, goal);
  return { status: found.status, visited: found.visitedNodes ?? 0 };
}

/** The parts of the pathfinder that a read-only plan uses. */
interface ReachPlanner {
  movements?: unknown;
  getPathTo(
    movements: unknown,
    goal: unknown,
  ): { status: string; path: PathNode[]; visitedNodes?: number };
}

/**
 * Stops the pathfinder now. `stop()` alone only sets a flag that the next path node or reset
 * consumes, so a `goto` started soon after would be rejected `PathStopped`. `setGoal(null)` runs
 * that reset at once, which consumes the flag here.
 */
function haltPathing(bot: Bot): void {
  bot.pathfinder.stop();
  bot.pathfinder.setGoal(null);
}

/**
 * Why the escape ladder must not run here, or null when it may. A door beside the bot or beside the
 * next path node is a doorway, which digging and pillaring only make worse. Nothing else skips: a
 * followPartial walk reports success even inside a pit, so the path status says nothing about a pit.
 */
function ladderSkip(bot: Bot): string | null {
  if (nearDoor(bot)) return 'door_adjacent';
  return null;
}

/** A pathfinder node as `getPathTo` returns it. */
interface PathNode {
  x: number;
  y: number;
  z: number;
}

/** The slice of `bot.pathfinder` that the partial-path fallback reads (absent on test fakes). */
interface PartialPlanner {
  movements?: unknown;
  getPathTo?: (movements: unknown, goal: unknown) => { status: string; path: PathNode[] };
}

/** The reason text for a path error: fixed words, never the library's. */
function fixedMessage(name: string | undefined): string {
  if (name === 'NoPath') return NO_PATH_TEXT;
  if (name === 'Timeout') return SEARCH_TIMEOUT_TEXT;
  return 'the walk failed';
}

/** The options `moveNear` takes; `diag` is where its stall_diag lines go (the Body's log by default). */
export interface MoveOptions {
  signal: AbortSignal;
  timeScale: number;
  stallTicks?: number;
  diag?: DiagSink;
  /** Tier 2 (digging and towers) may start after tier 1 fails. Default on; `false` for reflex walks. */
  digTier?: boolean;
}

/**
 * Walks the bot to within `range` of `target`. Stops early with `blocked` when the bot has not
 * moved 0.75 blocks for `stallTicks` world ticks (`bot.time.age`, not wall time), and with
 * `cancelled` when the signal aborts. A shorter stall (under 0.03 blocks for 60 ticks) drops the
 * path and replans from where the bot stands, up to 6 times. The first stall of an episode (no
 * movement for 60 ticks, when the stall limit is longer) is one recovery: it stops a dig, re-sets
 * the goal and pulses a jump at a one-block step, and is logged as a `stall_diag` line. When the
 * goal is unreachable the bot walks the partial path to the closest reachable spot and the result
 * says `partial`. `timeScale` is accepted for the caller's convenience but the wall timeout is the
 * caller's (through `runAction`), so it is not used here.
 */
export function moveNear(
  bot: Bot,
  target: { x: number; y: number; z: number },
  range: number,
  opts: MoveOptions,
): Promise<MoveResult> {
  ensurePathfinder(bot);
  watchPathEvents(bot);
  const stallTicks = opts.stallTicks ?? DEFAULT_STALL_TICKS;
  const sink = opts.diag ?? DEFAULT_DIAG_SINK;
  const goal = new Vec3(target.x, target.y, target.z);
  // Tier 1 is the plain walk; tier 2 (digging, towers) starts only when tier 1 finds no path or stalls.
  let tier = 1;
  const tally = new DigTally();
  /** Whether the tier 2 now running was started by a tier-1 search timeout (decision 0164). */
  let digFromTimeout = false;
  const enterDigTier = (fromTimeout = false): boolean => {
    if (opts.digTier === false || tier === 2) return false;
    if (typeof bot.pathfinder?.setMovements !== 'function') return false;
    tier = 2;
    digFromTimeout = fromTimeout;
    bot.pathfinder.setMovements(digMovements(bot) as never);
    bot.pathfinder.thinkTimeout = TIER_TWO_BUDGET_MS;
    tally.start(bot);
    return true;
  };
  /** Back to the plain walk: tier-1 movements, the normal search budget. The tally keeps its counts. */
  const leaveDigTier = (): void => {
    if (tier !== 2) return;
    tier = 1;
    tally.stop();
    const plain = tierOne.get(bot);
    if (plain !== undefined) bot.pathfinder.setMovements(plain as never);
    bot.pathfinder.thinkTimeout = SEARCH_BUDGET_MS;
  };

  return new Promise<MoveResult>((resolve, reject) => {
    if (opts.signal.aborted) {
      resolve({ ok: false, reason: 'cancelled', message: 'move cancelled before it started' });
      return;
    }
    let done = false;
    let watchdog: ReturnType<typeof setInterval> | undefined;
    let jumpAge: number | undefined;
    const releaseJump = (): void => {
      if (jumpAge === undefined) return;
      jumpAge = undefined;
      setJump(bot, false);
    };
    const onAbort = (): void => {
      haltPathing(bot);
      settle({ ok: false, reason: 'cancelled', message: 'move cancelled' });
    };
    const cleanup = (): void => {
      clearInterval(watchdog);
      // Every exit (success, cancel, failure, throw) leaves tier 2: its budget must not outlive the walk.
      leaveDigTier();
      tally.stop();
      opts.signal.removeEventListener('abort', onAbort);
      releaseJump();
    };
    const settle = (result: MoveResult, facts?: StallFacts): void => {
      if (done) return;
      done = true;
      cleanup();
      if (facts) emitStallDiag(bot, facts, sink);
      resolve(result);
    };

    let lastPos = bot.entity.position.clone();
    let lastMovedAge = bot.time.age;
    let lastMovedAt = sink.now();
    let replanPos = bot.entity.position.clone();
    let replanAge = bot.time.age;
    let replans = 0;
    let partial = false;
    let generation = 0;
    let escaping = false;
    let ladders = 0;
    let digSeenAge: number | undefined;
    let recoveredEpisode: number | undefined;
    let recoverySteps: readonly RecoveryStep[] = [];
    /** Where a stall put tier 2 on: tier 2 is left once the bot is this far from it (decision 0164). */
    let stallDigFrom: Vec3 | undefined;

    /** The facts of this move's stall or path failure, for its stall_diag line. */
    const factsAt = (reason: string, stalledTicks: number): StallFacts => ({
      reason,
      stalledTicks,
      msSinceMove: sink.now() - lastMovedAt,
      recovery: recoverySteps,
      toward: target,
    });

    /** Starts (or restarts) a walk to `aim`; answers from an older walk are ignored. */
    const start = (aim: unknown): void => {
      const mine = ++generation;
      bot.pathfinder.goto(aim as never).then(
        () => {
          if (mine !== generation) return;
          const distance = bot.entity.position.distanceTo(goal);
          // The library resolves an empty route (a sealed pit) as success without moving: no walk
          // happened, so the plain walk did not reach the goal and tier 2 starts (decision 0164).
          if (!partial && distance > range + 1 && enterDigTier()) {
            start(new goals.GoalNear(target.x, target.y, target.z, range));
            return;
          }
          const note = tally.note();
          settle(
            partial
              ? {
                  ok: true,
                  distance,
                  partial: true,
                  message: note ? `${PARTIAL_TEXT}; ${note}` : PARTIAL_TEXT,
                }
              : note
                ? { ok: true, distance, message: note }
                : { ok: true, distance },
          );
        },
        (error: unknown) => {
          if (mine !== generation) return;
          let reason = classifyPathError(error);
          if (reason === null) {
            // Not a pathing outcome: the run wrapper turns this throw into `internal`.
            if (!done) {
              done = true;
              cleanup();
              reject(error);
            }
            return;
          }
          const name = (error as { name?: string } | null)?.name;
          let message = fixedMessage(name);
          // Tier 1 found no path: the same goal again with digging and towers allowed. This
          // trigger is a walk with no route at all, so tier 2 stays for the rest of the walk.
          if (name === 'NoPath' && enterDigTier()) {
            stallDigFrom = undefined;
            start(new goals.GoalNear(target.x, target.y, target.z, range));
            return;
          }
          // Tier 1's search ran out of time with no partial walk behind it: a sealed area costs the
          // whole 4 s budget, so tier 2 gets the same chance as after NoPath (decision 0164).
          if (name === 'Timeout' && !partial && enterDigTier(true)) {
            stallDigFrom = undefined;
            start(new goals.GoalNear(target.x, target.y, target.z, range));
            return;
          }
          // Tier 2 found no way (or ran out of its short search): the plain walk's partial route
          // stands. A blocked tier 2 ends blocked (decision 0142), so the escape ladder runs below;
          // a tier 2 that a tier-1 timeout started ends with that timeout, as the plain walk did.
          if (tier === 2 && !partial && (name === 'NoPath' || name === 'Timeout')) {
            stallDigFrom = undefined;
            leaveDigTier();
            if (followPartial()) return;
            if (digFromTimeout) {
              reason = 'timeout';
              message = SEARCH_TIMEOUT_TEXT;
            } else {
              reason = 'blocked';
              message = NO_PATH_TEXT;
            }
          } else if (name === 'NoPath' && !partial && followPartial()) {
            return;
          }
          const facts =
            reason === 'blocked'
              ? factsAt(name ?? 'blocked', bot.time.age - lastMovedAge)
              : undefined;
          if (
            reason === 'blocked' &&
            (inWater(bot) || bot.time.age - lastMovedAge >= RECOVERY_STALL_TICKS) &&
            escalate(facts as StallFacts)
          ) {
            return;
          }
          settle({ ok: false, reason, message }, facts);
        },
      );
    };

    /**
     * Runs the hard-stuck ladder (at most `MAX_LADDERS` per move). A rung that frees the bot
     * restarts the walk; all rungs failing settles `needs_rescue`. False when no ladder was run.
     */
    const escalate = (facts: StallFacts): boolean => {
      // A body that cannot wait on ticks (a bare test fake) cannot run the timed rungs.
      if (done || escaping || ladders >= MAX_LADDERS) return false;
      if (typeof bot.waitForTicks !== 'function') return false;
      const skip = ladderSkip(bot);
      if (skip) {
        sink.log(JSON.stringify({ event: 'stall_diag', reason: 'ladder_skipped', why: skip }));
        return false;
      }
      ladders++;
      escaping = true;
      // The ladder ends this goto itself (escapeLadder's setGoal(null)): that GoalChanged is not a
      // new outcome, so the goto's answer is ignored from here on.
      generation++;
      void escapeLadder(bot, { signal: opts.signal, toward: target, sink }).then(
        (result) => {
          escaping = false;
          if (done) return;
          if (opts.signal.aborted) return;
          if (!result.ok) {
            settle({ ok: false, reason: 'needs_rescue', message: result.message }, facts);
            return;
          }
          lastPos = bot.entity.position.clone();
          lastMovedAge = bot.time.age;
          lastMovedAt = sink.now();
          replanPos = lastPos.clone();
          replanAge = bot.time.age;
          try {
            start(new goals.GoalNear(target.x, target.y, target.z, range));
          } catch (error) {
            done = true;
            cleanup();
            reject(error);
          }
        },
        (error: unknown) => {
          escaping = false;
          if (done) return;
          done = true;
          cleanup();
          reject(error);
        },
      );
      return true;
    };

    /** On `NoPath`, walks to the closest reachable node when that is a real step toward the goal. */
    const followPartial = (): boolean => {
      const planner = bot.pathfinder as unknown as PartialPlanner;
      if (typeof planner.getPathTo !== 'function') return false;
      const found = planner.getPathTo(
        planner.movements,
        new goals.GoalNear(target.x, target.y, target.z, range),
      );
      const last = found.path[found.path.length - 1];
      if (!last) return false;
      const here = bot.entity.position;
      if (here.distanceTo(new Vec3(last.x + 0.5, last.y, last.z + 0.5)) < 1.5) return false;
      partial = true;
      start(new goals.GoalBlock(last.x, last.y, last.z));
      return true;
    };

    /** The one recovery of a stall episode: stop a dig, re-set the goal, pulse a jump at a step. */
    const recover = (stalledTicks: number): void => {
      recoveredEpisode = lastMovedAge;
      recordRecovery(bot, sink.now());
      const steps: RecoveryStep[] = [];
      if (stopDigIfDigging(bot)) steps.push('stopDigging');
      haltPathing(bot);
      replans++;
      replanAge = bot.time.age;
      replanPos = bot.entity.position.clone();
      // A stalled tier-1 walk tries tier 2 (digging, towers) on this recovery, to get past this spot.
      if (enterDigTier()) stallDigFrom = bot.entity.position.clone();
      try {
        start(new goals.GoalNear(target.x, target.y, target.z, range));
      } catch (error) {
        done = true;
        cleanup();
        reject(error);
        return;
      }
      steps.push('replan');
      if (pulseJump(bot, target)) {
        jumpAge = bot.time.age;
        steps.push('jump');
      }
      recoverySteps = steps;
      emitStallDiag(bot, factsAt('stall', stalledTicks), sink);
    };

    watchdog = setInterval(() => {
      if (escaping) return;
      if (isDigging(bot)) digSeenAge ??= bot.time.age;
      else digSeenAge = undefined;
      /** A young dig is not a stall: recovery would end it with "Digging aborted". */
      const youngDig = digSeenAge !== undefined && bot.time.age - digSeenAge < digGraceTicks(bot);
      if (jumpAge !== undefined && bot.time.age - jumpAge >= JUMP_TICKS) releaseJump();
      // A stall's tier 2 only gets the bot past the stuck spot: once it has moved on, plan on tier 1.
      if (
        stallDigFrom !== undefined &&
        tier === 2 &&
        bot.entity.position.distanceTo(stallDigFrom) >= STALL_DIG_LEAVE_BLOCKS
      ) {
        stallDigFrom = undefined;
        leaveDigTier();
        haltPathing(bot);
        replanPos = bot.entity.position.clone();
        replanAge = bot.time.age;
        try {
          start(new goals.GoalNear(target.x, target.y, target.z, range));
        } catch (error) {
          done = true;
          cleanup();
          reject(error);
        }
        return;
      }
      if (bot.entity.position.distanceTo(lastPos) >= MOVED_BLOCKS) {
        lastPos = bot.entity.position.clone();
        lastMovedAge = bot.time.age;
        lastMovedAt = sink.now();
      } else {
        const stalledTicks = bot.time.age - lastMovedAge;
        if (stalledTicks >= stallTicks && !youngDig) {
          if (escalate(factsAt('stall', stalledTicks))) return;
          haltPathing(bot);
          settle(
            {
              ok: false,
              reason: 'blocked',
              message: `no movement for ${stallTicks} world ticks`,
            },
            factsAt('stall', stalledTicks),
          );
          return;
        }
        if (
          !youngDig &&
          stalledTicks >= RECOVERY_STALL_TICKS &&
          RECOVERY_STALL_TICKS < stallTicks &&
          recoveredEpisode !== lastMovedAge &&
          bot.entity.position.distanceTo(replanPos) < REPLAN_MOVED &&
          recoveryAllowed(bot, sink.now())
        ) {
          recover(stalledTicks);
          if (done) return;
        }
      }
      if (bot.entity.position.distanceTo(replanPos) >= REPLAN_MOVED) {
        replanPos = bot.entity.position.clone();
        replanAge = bot.time.age;
      } else if (
        !youngDig &&
        replans < MAX_REPLANS &&
        bot.time.age - replanAge >= REPLAN_STALL_TICKS
      ) {
        replans++;
        replanAge = bot.time.age;
        haltPathing(bot);
        try {
          start(new goals.GoalNear(target.x, target.y, target.z, range));
        } catch (error) {
          done = true;
          cleanup();
          reject(error);
        }
      }
    }, WATCH_INTERVAL_MS);
    opts.signal.addEventListener('abort', onAbort, { once: true });
    // Every walk starts on tier 1; a walk left on tier 2 by an earlier goto is put back.
    const plain = tierOne.get(bot);
    if (plain !== undefined && (bot.pathfinder as { movements?: unknown }).movements !== plain) {
      bot.pathfinder.setMovements(plain as never);
    }
    bot.pathfinder.thinkTimeout = SEARCH_BUDGET_MS;

    try {
      start(new goals.GoalNear(target.x, target.y, target.z, range));
    } catch (error) {
      // A synchronous throw skips the handlers above, so undo the watchdog and listener here.
      done = true;
      cleanup();
      throw error;
    }
  });
}
