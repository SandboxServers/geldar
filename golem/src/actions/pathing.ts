import type { Bot } from 'mineflayer';
import pathfinderPkg from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import { escapeLadder, inWater } from './escape-ladder.ts';
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

/**
 * Loads the pathfinder once and sets the movement rules: no digging, no towers, no scaffolding.
 * Digging and placing belong to `mine` and `place`, so `goto` never tunnels or builds.
 */
export function ensurePathfinder(bot: Bot): void {
  // Read through `unknown` so the check does not narrow `bot.pathfinder` to never below.
  const loaded: unknown = (bot as { pathfinder?: unknown }).pathfinder;
  if (loaded) return;
  bot.loadPlugin(pathfinder);
  const movements = new Movements(bot);
  // Soft-dig (decision C5-01 soft-dig pathing, Proposed): leaves, vines, snow and plant cover only.
  installSoftDig(movements);
  movements.allow1by1towers = false;
  // The library spells this property `scafoldingBlocks` (2.4.5).
  movements.scafoldingBlocks = [];
  forbidCornerCutting(movements);
  bot.pathfinder.setMovements(movements);
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
  let movements: unknown = planner.movements;
  if (canDig) {
    const digging = new Movements(bot);
    digging.canDig = true;
    digging.allow1by1towers = false;
    digging.scafoldingBlocks = [];
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

/** A block as the pathfinder's `getBlock` returns it: prismarine fields plus its own flags. */
interface PathBlock {
  physical?: boolean;
  safe?: boolean;
  type?: number;
}

/** The parts of a pathfinder `Movements` that the corner rule reads and wraps. */
interface DiagonalMovements {
  carpets?: Set<number>;
  getBlock(node: unknown, dx: number, dy: number, dz: number): PathBlock;
  getMoveDiagonal(node: unknown, dir: { x: number; z: number }, neighbors: unknown[]): void;
}

/** True for a carpet: `physical` to the library, but flat, so it never presses the bot sideways. */
function isFlat(m: DiagonalMovements, block: PathBlock): boolean {
  return block.type !== undefined && Boolean(m.carpets?.has(block.type));
}

/**
 * Allows a diagonal step only when both orthogonal side cells are free. At foot level a side cell
 * blocks when it is solid, or unsafe (fences, walls, fire, lava, unloaded: `safe` is false and
 * `physical` may be too); flat blocks do not. At head level only a solid block blocks (an overhang).
 * The library accepts a diagonal when one side is free, so the bot cuts a corner, presses against
 * the block and Paper rejects its position every tick (live: the bed walk past the crafting table
 * rubber-banded until the 600-tick stall rule fired). With both sides free it never touches one.
 */
export function forbidCornerCutting(movements: unknown): void {
  const m = movements as DiagonalMovements;
  const original = m.getMoveDiagonal.bind(m);
  const sideBlocked = (node: unknown, dx: number, dz: number): boolean => {
    const foot = m.getBlock(node, dx, 0, dz);
    if (foot.safe === false || (foot.physical && !isFlat(m, foot))) return true;
    const head = m.getBlock(node, dx, 1, dz);
    return Boolean(head.physical) && !isFlat(m, head);
  };
  m.getMoveDiagonal = (node, dir, neighbors) => {
    if (sideBlocked(node, dir.x, 0) || sideBlocked(node, 0, dir.z)) return;
    original(node, dir, neighbors);
  };
}

/**
 * Maps a pathfinder error to a move reason. `NoPath` and `Timeout` (path search) mean the way is
 * blocked; `GoalChanged` means something else took over. Anything else is null: not a move result.
 */
export function classifyPathError(error: unknown): 'blocked' | 'interrupted' | null {
  const name = (error as { name?: unknown } | null)?.name;
  if (name === 'NoPath' || name === 'Timeout') return 'blocked';
  if (name === 'GoalChanged') return 'interrupted';
  return null;
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
function fixedMessage(name: string | undefined, error: unknown): string {
  if (name === 'NoPath') return NO_PATH_TEXT;
  if (name === 'Timeout') return SEARCH_TIMEOUT_TEXT;
  return error instanceof Error ? error.message : String(error);
}

/** The options `moveNear` takes; `diag` is where its stall_diag lines go (the Body's log by default). */
export interface MoveOptions {
  signal: AbortSignal;
  timeScale: number;
  stallTicks?: number;
  diag?: DiagSink;
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
          settle(
            partial
              ? { ok: true, distance, partial: true, message: PARTIAL_TEXT }
              : { ok: true, distance },
          );
        },
        (error: unknown) => {
          if (mine !== generation) return;
          const reason = classifyPathError(error);
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
          if (name === 'NoPath' && !partial && followPartial()) return;
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
          settle({ ok: false, reason, message: fixedMessage(name, error) }, facts);
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
      ladders++;
      escaping = true;
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
