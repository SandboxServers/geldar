import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { type ActionOutcome, cancelled, completed, type FailReason, failed } from './outcome.ts';
import { type MoveResult, moveNear } from './pathing.ts';
import type { ActionContext, ActionHandler } from './registry.ts';

/** The first world tick of the night window the Body checks (advisory: the server's window differs by one). */
const NIGHT_START = 12_542;
/** The last world tick of the night window the Body checks. */
const NIGHT_END = 23_459;
/** The horizontal neighbors searched for the other half of a bed. */
const HORIZONTAL = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];

type Block = NonNullable<ReturnType<Bot['findBlock']>>;

/** Sleeps in the nearest bed. The action does not wait for morning and does not wake the bot. */
export const sleepHandler: ActionHandler<'sleep'> = {
  kind: 'sleep',
  timeoutMs: 40_000,
  run: (ctx) => sleep(ctx),
};

/** True at night (the advisory window) or in a thunderstorm. */
export function isNightOrStorm(timeOfDay: number, thundering: boolean): boolean {
  return (timeOfDay >= NIGHT_START && timeOfDay <= NIGHT_END) || thundering;
}

/** Maps a Mineflayer sleep error to a fail reason, by its text. Anything unknown is `internal`. */
export function classifySleepError(message: string): FailReason {
  if (/monsters nearby/i.test(message)) return 'not_possible';
  if (/too far/i.test(message)) return 'out_of_reach';
  if (/occupied/i.test(message)) return 'blocked';
  if (/not a bed|only half bed/i.test(message)) return 'not_found';
  if (/not sleeping|cant click/i.test(message)) return 'blocked';
  if (/not night/i.test(message)) return 'not_possible';
  return 'internal';
}

async function sleep(ctx: ActionContext): Promise<ActionOutcome> {
  const { bot } = ctx;
  const bed = bot.findBlock({ matching: (block) => block.name.endsWith('_bed'), maxDistance: 32 });
  if (!bed) return failed('not_found', 'no bed');
  if (!isNightOrStorm(bot.time.timeOfDay, bot.thunderState > 0)) {
    return failed('not_possible', 'you can only sleep at night or in a thunderstorm');
  }

  const near = await walkNear(ctx, bed);
  if (near) return near;
  let used = bed;
  let attempt = await attemptSleep(bot, bed);
  if (attempt?.status === 'failed' && attempt.reason === 'out_of_reach') {
    // The bed check is measured from the head block, and `findBlock` may return the foot: stand by the other half.
    const other = otherHalf(bot, bed);
    if (other) {
      const moved = await walkNear(ctx, other);
      if (moved) return moved;
      used = other;
      attempt = await attemptSleep(bot, other);
    }
  }
  if (ctx.signal.aborted) return cancelled();
  if (attempt) return attempt;
  if (!bot.isSleeping) return failed('blocked', 'the bot is not asleep after sleep');
  return completed({ bed: { x: used.position.x, y: used.position.y, z: used.position.z } });
}

/** Walks to within one block of `block`; null when the bot arrived, else the failure. */
async function walkNear(ctx: ActionContext, block: Block): Promise<ActionOutcome | null> {
  const move = await moveNear(ctx.bot, block.position, 1, {
    signal: ctx.signal,
    timeScale: ctx.timeScale,
  });
  if (move.ok) return ctx.signal.aborted ? cancelled() : null;
  return moveOutcome(move);
}

/** Calls `bot.sleep`; null when the call returned, else the mapped failure. */
async function attemptSleep(bot: Bot, bed: Block): Promise<ActionOutcome | null> {
  try {
    await bot.sleep(bed);
    return null;
  } catch (error) {
    const message = errorText(error);
    return failed(classifySleepError(message), message);
  }
}

/** The other half of a bed: the same bed block next to it on a horizontal side. */
function otherHalf(bot: Bot, bed: Block): Block | null {
  for (const offset of HORIZONTAL) {
    const cell = bot.blockAt(bed.position.plus(offset));
    if (cell?.name === bed.name) return cell;
  }
  return null;
}

/** Maps a walk that did not arrive to an outcome. */
function moveOutcome(move: Extract<MoveResult, { ok: false }>): ActionOutcome {
  return move.reason === 'cancelled' ? cancelled() : failed(move.reason, move.message);
}

/** The error text, cut to the message limit. */
function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 200);
}
