import type { Bot } from 'mineflayer';
import pathfinderPkg from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';

const { pathfinder, Movements, goals } = pathfinderPkg;

/** Blocks the bot must move to count as moving again (the stall rule). */
const MOVED_BLOCKS = 0.75;
/** How often the stall watchdog looks, in wall milliseconds. */
const WATCH_INTERVAL_MS = 500;
/** Default stall limit: 600 world ticks, which is 30 s at 20 TPS. */
const DEFAULT_STALL_TICKS = 600;

/** How a move ended. A timeout is the caller's (through `runAction`), not this module's. */
export type MoveResult =
  | { ok: true; distance: number }
  | { ok: false; reason: 'blocked' | 'timeout' | 'interrupted' | 'cancelled'; message: string };

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
  movements.canDig = false;
  movements.allow1by1towers = false;
  // The library spells this property `scafoldingBlocks` (2.4.5).
  movements.scafoldingBlocks = [];
  bot.pathfinder.setMovements(movements);
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
 * Walks the bot to within `range` of `target`. Stops early with `blocked` when the bot has not
 * moved 0.75 blocks for `stallTicks` world ticks (`bot.time.age`, not wall time), and with
 * `cancelled` when the signal aborts. `timeScale` is accepted for the caller's convenience but the
 * wall timeout is the caller's (through `runAction`), so it is not used here.
 */
export function moveNear(
  bot: Bot,
  target: { x: number; y: number; z: number },
  range: number,
  opts: { signal: AbortSignal; timeScale: number; stallTicks?: number },
): Promise<MoveResult> {
  ensurePathfinder(bot);
  const stallTicks = opts.stallTicks ?? DEFAULT_STALL_TICKS;
  const goal = new Vec3(target.x, target.y, target.z);

  return new Promise<MoveResult>((resolve, reject) => {
    if (opts.signal.aborted) {
      resolve({ ok: false, reason: 'cancelled', message: 'move cancelled before it started' });
      return;
    }
    let done = false;
    let watchdog: ReturnType<typeof setInterval> | undefined;
    const onAbort = (): void => {
      bot.pathfinder.stop();
      settle({ ok: false, reason: 'cancelled', message: 'move cancelled' });
    };
    const cleanup = (): void => {
      clearInterval(watchdog);
      opts.signal.removeEventListener('abort', onAbort);
    };
    const settle = (result: MoveResult): void => {
      if (done) return;
      done = true;
      cleanup();
      resolve(result);
    };

    let lastPos = bot.entity.position.clone();
    let lastMovedAge = bot.time.age;
    watchdog = setInterval(() => {
      if (bot.entity.position.distanceTo(lastPos) >= MOVED_BLOCKS) {
        lastPos = bot.entity.position.clone();
        lastMovedAge = bot.time.age;
      } else if (bot.time.age - lastMovedAge >= stallTicks) {
        bot.pathfinder.stop();
        settle({
          ok: false,
          reason: 'blocked',
          message: `no movement for ${stallTicks} world ticks`,
        });
      }
    }, WATCH_INTERVAL_MS);
    opts.signal.addEventListener('abort', onAbort, { once: true });

    bot.pathfinder.goto(new goals.GoalNear(target.x, target.y, target.z, range)).then(
      () => settle({ ok: true, distance: bot.entity.position.distanceTo(goal) }),
      (error: unknown) => {
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
        const message = error instanceof Error ? error.message : String(error);
        settle({ ok: false, reason, message });
      },
    );
  });
}
