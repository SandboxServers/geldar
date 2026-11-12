import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import type { Block } from './bot-types.ts';
import { outcomeOfMove } from './move-outcome.ts';
import {
  type ActionOutcome,
  cancelled,
  completed,
  errorText,
  type FailReason,
  failed,
} from './outcome.ts';
import { moveNear } from './pathing.ts';
import type { ActionContext, ActionHandler } from './registry.ts';

/** The first world tick of the night window the Body checks (advisory: the server's window differs by one). */
const NIGHT_START = 12_542;
/** The last world tick of the night window the Body checks. */
const NIGHT_END = 23_459;
/** The horizontal neighbors searched for the other half of a bed. */
const HORIZONTAL = [new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1)];
/** How far from the bot the beds are searched for. */
const BED_RANGE = 32;
/** The most beds tried in one action, nearest first. */
const MAX_BEDS = 8;

/** Sleeps in the nearest free bed, trying up to MAX_BEDS. The action does not wait for morning and does not wake the bot. */
export const sleepAction: ActionHandler<'sleep'> = {
  kind: 'sleep',
  timeoutMs: 40_000,
  run: (ctx) => sleep(ctx),
};

/** True at night (the advisory window) or in a thunderstorm. */
export function isNightOrStorm(timeOfDay: number, thundering: boolean): boolean {
  return (timeOfDay >= NIGHT_START && timeOfDay <= NIGHT_END) || thundering;
}

/** Mineflayer's text when the bot is already in a bed. Treated as asleep, not as a failure. */
const ALREADY_SLEEPING = /already sleeping/i;

/** Maps a Mineflayer sleep error to a fail reason, by its text. Anything unknown is `internal`. */
export function classifySleepError(message: string): FailReason {
  if (ALREADY_SLEEPING.test(message)) return 'not_possible';
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
  if (bot.isSleeping) return completed();
  const beds = nearbyBeds(bot);
  if (beds.length === 0) return failed('not_found', 'no bed');
  if (!isNightOrStorm(bot.time.timeOfDay, bot.thunderState > 0)) {
    return failed('not_possible', 'you can only sleep at night or in a thunderstorm');
  }

  let last: ActionOutcome = failed('blocked', 'no bed was tried');
  for (const bed of beds) {
    const outcome = await sleepInBed(ctx, bed);
    if (outcome.status !== 'failed' || outcome.reason !== 'blocked' || ctx.signal.aborted) {
      return outcome;
    }
    last = outcome;
  }
  const lastText = last.status === 'failed' ? last.message : '';
  return failed(
    'blocked',
    `tried ${beds.length} nearby beds, all occupied or blocked; last: ${lastText}`,
  );
}

/** Walks to a bed and sleeps in it; completed when the bot is asleep, else the failure. */
async function sleepInBed(ctx: ActionContext, bed: Block): Promise<ActionOutcome> {
  const { bot } = ctx;
  const near = await walkNear(ctx, bed);
  if (near) return near;
  let used = bed;
  let attempt = await attemptSleep(bot, bed);
  if (attempt?.status === 'failed' && attempt.reason === 'out_of_reach') {
    // The bed check is measured from the head block, and `findBlocks` may return the foot: stand by the other half.
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

/**
 * The nearest beds within range, nearest first, at most MAX_BEDS. A bed is two blocks and `findBlocks`
 * returns both halves, so it asks for twice as many blocks and keeps one block per bed.
 */
function nearbyBeds(bot: Bot): Block[] {
  const from = bot.entity.position;
  const positions = bot.findBlocks({
    matching: (block: Block) => block.name.endsWith('_bed'),
    maxDistance: BED_RANGE,
    count: 2 * MAX_BEDS,
  });
  const sorted = [...positions].sort((a, b) => a.distanceTo(from) - b.distanceTo(from));
  const beds: Block[] = [];
  for (const position of sorted) {
    if (beds.length === MAX_BEDS) break;
    const block = bot.blockAt(position);
    if (block && !isHalfOfKeptBed(beds, block)) beds.push(block);
  }
  return beds;
}

/** True when a kept bed block of the same name is next to `block` on a horizontal side: the same bed. */
function isHalfOfKeptBed(beds: Block[], block: Block): boolean {
  return beds.some(
    (bed) =>
      bed.name === block.name &&
      HORIZONTAL.some((offset) => bed.position.plus(offset).equals(block.position)),
  );
}

/** Walks to within one block of `block`; null when the bot arrived, else the failure. */
async function walkNear(ctx: ActionContext, block: Block): Promise<ActionOutcome | null> {
  const move = await moveNear(ctx.bot, block.position, 1, {
    signal: ctx.signal,
    timeScale: ctx.timeScale,
  });
  if (move.ok) return ctx.signal.aborted ? cancelled() : null;
  return outcomeOfMove(move);
}

/** Calls `bot.sleep`; null when the call returned or the bot was already asleep, else the mapped failure. */
async function attemptSleep(bot: Bot, bed: Block): Promise<ActionOutcome | null> {
  try {
    await bot.sleep(bed);
    return null;
  } catch (error) {
    const message = errorText(error);
    if (ALREADY_SLEEPING.test(message)) return null;
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
