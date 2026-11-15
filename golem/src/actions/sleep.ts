import type { Bot } from 'mineflayer';
import type { Block } from './bot-types.ts';
import { outcomeOfMove } from './move-outcome.ts';
import { type ActionOutcome, cancelled, completed, errorText, failed } from './outcome.ts';
import { moveNear } from './pathing.ts';
import type { ActionContext, ActionHandler } from './registry.ts';
import {
  isBeside,
  isObstructed,
  isRefusalToRemember,
  OBSTRUCTED_TEXT,
  rememberRefusal,
  wasRefused,
} from './sleep-beds.ts';
import {
  type BedCensus,
  bedKey,
  censusText,
  isBedOccupied,
  otherHalfPosition,
  takeCensus,
} from './sleep-census.ts';
import {
  type BedTry,
  sleepersDetail,
  sleepFailureDetail,
  withSleepDetail,
} from './sleep-detail.ts';
import { roundedPosition, triedMessage } from './sleep-message.ts';
import {
  ALREADY_SLEEPING,
  type BedResult,
  COULD_NOT_BE_USED,
  matchSleepError,
  refusalScene,
  sleepFailure,
} from './sleep-outcome.ts';
import { type BedRefusalWatch, watchBedRefusal } from './sleep-refusal.ts';
import { type SleepersWatch, watchSleepers } from './sleepers.ts';
import { DEFAULT_DIAG_SINK } from './stall-diag.ts';

export {
  classifySleepError,
  type SleepScene,
  sleepErrorText,
  sleepFailure,
} from './sleep-outcome.ts';

/** The first world tick of the night window the Body checks (advisory: the server's window differs by one). */
const NIGHT_START = 12_542;
/** The last world tick of the night window the Body checks. */
const NIGHT_END = 23_459;
/** How far from the bot the beds are searched for. */
const BED_RANGE = 32;
/** The most beds tried in one action, nearest first. */
const MAX_BEDS = 8;
/** The total time (wall ms at 1x, scaled by `timeScale`) after which the bed loop starts no new bed. */
const SLEEP_BUDGET_MS = 30_000;
/**
 * The time (wall ms at 1x, scaled by `timeScale`) after which a walk or a sleep still running is cut, so the
 * action reports its facts before the Body's 40 s action timeout.
 */
const SLEEP_HARD_STOP_MS = 35_000;
/** The world ticks a walk to a bed may stall for before it gives up (moveNear's default is 600). */
const BED_STALL_TICKS = 300;
/**
 * The time (wall ms at 1x, scaled by `timeScale`) a sleep waits for the server's sleepers line once the
 * Body lies down. The line comes with the bed, so the wait is short; without one the result carries none.
 */
const SLEEPERS_WAIT_MS = 300;
/**
 * The time (wall ms at 1x, scaled by `timeScale`) a generic refusal waits for its bed key (decision 0225). The
 * key comes with the refusal; without one the bed keeps "the bed could not be used".
 */
const BED_KEY_WAIT_MS = 300;
/** The reason a bed reports when the hard stop cut its walk or sleep short. */
const CUT_OFF = 'the bed was cut off by the time limit';
/**
 * The wall ms (at 1x, scaled by `timeScale`) one walk to a bed may run before the loop tries the next bed: at least
 * BED_WALK_CAP_MS, and BED_WALK_MS_PER_BLOCK for each block between the Body and the bed (decision 0341).
 */
const BED_WALK_CAP_MS = 7_000;
const BED_WALK_MS_PER_BLOCK = 450;
/** The reason a walk the per-bed cap cut short reports (decision 0341). Short, so it survives the 160-character cap. */
const CUT_OFF_WALK = 'the walk to the bed took too long';

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

async function sleep(ctx: ActionContext): Promise<ActionOutcome> {
  // An action that finds the bot already asleep has no sleep to report: it starts no watch.
  if (ctx.bot.isSleeping) return completed();
  // The watch runs for the whole action: it stops on success, failure, cancel and throw alike.
  const sleepers = watchSleepers(ctx.bot);
  const refusals = watchBedRefusal(ctx.bot);
  // Every bed the loop tried, in order: a failure reports them with the bot's final position.
  const tries: BedTry[] = [];
  // The census of the beds in range: the start, and the end the loop reads when it stops (decision 0226).
  const census: CensusRecord = {};
  try {
    const outcome = await sleepFromBeds(ctx, sleepers, refusals, tries, census);
    return withSleepDetail(outcome, sleepFailureDetail(ctx.bot, tries, census.end ?? census.start));
  } finally {
    sleepers.stop();
    refusals.stop();
  }
}

/** The bed census of one sleep: read when the attempt starts, and again when the bed loop stops. */
interface CensusRecord {
  start?: BedCensus;
  end?: BedCensus;
}

/** Reads the census now as the attempt's end census, and returns it. */
function endCensus(bot: Bot, census: CensusRecord): BedCensus {
  const end = takeCensus(bot, BED_RANGE);
  census.end = end;
  return end;
}

async function sleepFromBeds(
  ctx: ActionContext,
  sleepers: SleepersWatch,
  refusals: BedRefusalWatch,
  tries: BedTry[],
  census: CensusRecord,
): Promise<ActionOutcome> {
  const { bot } = ctx;
  const { beds, occupied } = nearbyBeds(bot);
  if (beds.length === 0) return failed('not_found', 'no bed');
  census.start = takeCensus(bot, BED_RANGE);
  if (!isNightOrStorm(bot.time.timeOfDay, bot.thunderState > 0)) {
    return failed('not_possible', 'it is not night');
  }

  let last: ActionOutcome = failed('blocked', 'no bed was tried');
  // The raw record of the last refused bed: it carries that bed's bed_key, which the loop's failure keeps (decision 0225).
  let lastRaw: string | undefined;
  // The whole loop has a budget: no new bed starts after it, so the action ends with its facts.
  const started = Date.now();
  const budget = SLEEP_BUDGET_MS * ctx.timeScale;
  // The hard stop cuts a walk or a sleep that is still running, so one slow bed cannot reach the action timeout.
  const stop = new AbortController();
  const stopTimer = setTimeout(() => stop.abort(), SLEEP_HARD_STOP_MS * ctx.timeScale);
  const bedCtx: ActionContext = { ...ctx, signal: AbortSignal.any([ctx.signal, stop.signal]) };
  let tried = 0;
  let outOfTime = false;
  // The beds whose walk the per-bed cap cut short: when every tried bed is one of them, the search is a timeout.
  let cut = 0;
  try {
    for (const bed of beds) {
      if (Date.now() - started >= budget) {
        outOfTime = true;
        break;
      }
      tried += 1;
      const { outcome, used } = await sleepInBed(bedCtx, bed, sleepers, refusals);
      if (outcome.status === 'cancelled' && stop.signal.aborted && !ctx.signal.aborted) {
        // Only the hard stop cut this bed: the search time ran out, which is not a cancel from the Mind.
        last = failed('blocked', CUT_OFF);
        tries.push(bedTry(used, CUT_OFF));
        outOfTime = true;
        break;
      }
      if (outcome.status === 'failed') {
        tries.push(bedTry(used, outcome.message));
        if (outcome.message === CUT_OFF_WALK) cut += 1;
        if (isRefusalToRemember(outcome.message)) rememberRefusal(bot, used);
      }
      // A success needs no end census: withSleepDetail keeps the detail of a failure only.
      if (outcome.status !== 'failed') return outcome;
      if ((outcome.reason !== 'blocked' && outcome.reason !== 'timeout') || ctx.signal.aborted) {
        endCensus(bot, census);
        return outcome;
      }
      if (outcome.status === 'failed') lastRaw = outcome.raw;
      last = outcome;
    }
  } finally {
    clearTimeout(stopTimer);
  }
  const end = endCensus(bot, census);
  const lastText = last.status === 'failed' ? last.message : '';
  const ended = `; ${censusText(end, BED_RANGE)}; ended at ${roundedPosition(bot)}`;
  if (outOfTime) {
    // The time limit ended the search: a factual timeout, not a blocked way (decision 0338).
    return failed(
      'timeout',
      triedMessage(
        `tried ${tried} of ${beds.length} nearby beds, ${occupied} occupied; the time limit ended the search`,
        lastText,
        ended,
      ),
      {},
      lastRaw,
    );
  }
  if (tried > 0 && cut === tried) {
    // Every bed's walk ran past its cap: the walks timed out, so the search is a timeout too (decision 0341).
    return failed(
      'timeout',
      triedMessage(`tried ${tried} nearby beds, every walk timed out`, lastText, ended),
      {},
      lastRaw,
    );
  }
  return failed(
    'blocked',
    triedMessage(`tried ${tried} nearby beds, all occupied or blocked`, lastText, ended),
    {},
    lastRaw,
  );
}

export { triedMessage };

/**
 * Walks to a bed and sleeps in it. The outcome is completed when the bot is asleep, else the failure; `used` is
 * the bed block the outcome came from (the other half after an out_of_reach).
 */
async function sleepInBed(
  ctx: ActionContext,
  bed: Block,
  sleepers: SleepersWatch,
  refusals: BedRefusalWatch,
): Promise<BedResult> {
  const { bot } = ctx;
  // A bed the Body's check finds obstructed is not walked to: the walk would end in the same refusal (decision 0341).
  if (isObstructed(bot, bed)) return { outcome: failed('blocked', OBSTRUCTED_TEXT), used: bed };
  const near = await walkNear(ctx, bed);
  if (near) return { outcome: near, used: bed };
  let used = bed;
  let attempt = await attemptSleep(ctx, bed, sleepers, refusals);
  if (attempt?.status === 'failed' && attempt.reason === 'out_of_reach') {
    // The bed check is measured from the head block, and `findBlocks` may return the foot: stand by the other half.
    const other = otherHalf(bot, bed);
    if (other) {
      used = other;
      const moved = await walkNear(ctx, other);
      if (moved) return { outcome: moved, used };
      attempt = await attemptSleep(ctx, other, sleepers, refusals);
    }
  }
  return { outcome: await bedOutcome(ctx, used, attempt, sleepers), used };
}

/** The outcome of a bed once its sleep call has run: cancelled, the refusal, or completed with the bed and sleepers facts. */
async function bedOutcome(
  ctx: ActionContext,
  used: Block,
  attempt: ActionOutcome | null,
  sleepers: SleepersWatch,
): Promise<ActionOutcome> {
  const { bot } = ctx;
  if (ctx.signal.aborted) return cancelled();
  if (attempt) return attempt;
  if (!bot.isSleeping) return failed('blocked', 'the bot is not asleep after sleep');
  // The sleepers line the server sends for this bed: a line already in hand is the answer; otherwise wait for
  // the next one, up to SLEEPERS_WAIT_MS.
  if (sleepers.latest() === undefined) await sleepers.nextLine(SLEEPERS_WAIT_MS * ctx.timeScale);
  if (ctx.signal.aborted) return cancelled();
  return completed({
    bed: { x: used.position.x, y: used.position.y, z: used.position.z },
    ...sleepersDetail(sleepers.latest()),
  });
}

/** The bed block as the detail records it, with the reason the attempt gave. */
function bedTry(bed: Block, reason: string): BedTry {
  return { block: { x: bed.position.x, y: bed.position.y, z: bed.position.z }, reason };
}

/** The beds the loop tries, in order, and how many of them the world holds occupied. */
interface BedList {
  beds: Block[];
  occupied: number;
}

/**
 * The nearest beds within range, at most MAX_BEDS. A bed is two blocks and `findBlocks` returns both halves, so
 * it asks for twice as many blocks and keeps one block per bed (bedKey pairs them, decision 0226). A bed is
 * occupied when either half says so. Free beds come first, nearest first, and occupied beds last, so the time
 * budget goes to the beds that can take a sleeper first (decision 0338).
 */
function nearbyBeds(bot: Bot): BedList {
  const from = bot.entity.position;
  const positions = bot.findBlocks({
    matching: (block: Block) => block.name.endsWith('_bed'),
    maxDistance: BED_RANGE,
    count: 2 * MAX_BEDS,
  });
  const sorted = [...positions].sort((a, b) => a.distanceTo(from) - b.distanceTo(from));
  const kept: { block: Block; occupied: boolean }[] = [];
  for (const position of sorted) {
    const block = bot.blockAt(position);
    if (!block) continue;
    const key = bedKey(block);
    const bed = kept.find((candidate) => bedKey(candidate.block) === key);
    if (bed) {
      if (isBedOccupied(block)) bed.occupied = true;
    } else if (kept.length < MAX_BEDS) {
      kept.push({ block, occupied: isBedOccupied(block) });
    }
  }
  // A bed refused in the last ten minutes (as obstructed or with no path) ranks last, after the occupied ones (decision 0341).
  const fresh = kept.filter((bed) => !wasRefused(bot, bed.block));
  const free = fresh.filter((bed) => !bed.occupied).map((bed) => bed.block);
  const taken = fresh.filter((bed) => bed.occupied).map((bed) => bed.block);
  const refused = kept.filter((bed) => wasRefused(bot, bed.block)).map((bed) => bed.block);
  // A free bed the Body already stands beside goes first: it needs no walk (decision 0341).
  const beside = free.filter((block) => isBeside(bot, block));
  const walk = free.filter((block) => !isBeside(bot, block));
  const occupied = kept.filter((bed) => bed.occupied).length;
  return { beds: [...beside, ...walk, ...taken, ...refused], occupied };
}

/**
 * Walks to within one block of `block`; null when the bot arrived, else the failure. A walk the per-bed cap cuts
 * short is a timeout for this bed only, so the loop tries the next one (decision 0341).
 */
async function walkNear(ctx: ActionContext, block: Block): Promise<ActionOutcome | null> {
  if (isBeside(ctx.bot, block)) return null;
  const cap = new AbortController();
  const reach = Math.max(
    BED_WALK_CAP_MS,
    ctx.bot.entity.position.distanceTo(block.position) * BED_WALK_MS_PER_BLOCK,
  );
  const capTimer = setTimeout(() => cap.abort(), reach * ctx.timeScale);
  try {
    const move = await moveNear(ctx.bot, block.position, 1, {
      signal: AbortSignal.any([ctx.signal, cap.signal]),
      timeScale: ctx.timeScale,
      stallTicks: BED_STALL_TICKS,
    });
    if (move.ok) return ctx.signal.aborted ? cancelled() : null;
    if (cap.signal.aborted && !ctx.signal.aborted) return failed('timeout', CUT_OFF_WALK);
    return outcomeOfMove(move);
  } finally {
    clearTimeout(capTimer);
  }
}

/**
 * Calls `bot.sleep` unless `signal` aborts first; null when the call returned or the bot was already asleep,
 * `cancelled` when the signal aborted, else the mapped failure. The sleepers watch is armed right before the
 * call, so only the lines from this call count. Mineflayer's sleep has no cancel: an abandoned
 * call settles on its own, and the race has already handled its outcome.
 */
async function attemptSleep(
  ctx: ActionContext,
  bed: Block,
  sleepers: SleepersWatch,
  refusals: BedRefusalWatch,
): Promise<ActionOutcome | null> {
  const { bot, signal } = ctx;
  if (signal.aborted) return cancelled();
  try {
    sleepers.arm();
    refusals.arm();
    await untilAborted(bot.sleep(bed), signal);
    return null;
  } catch (error) {
    if (signal.aborted) return cancelled();
    const message = errorText(error);
    if (ALREADY_SLEEPING.test(message)) return null;
    // The generic refusal's bed key may arrive a moment after it: wait for one, as the sleepers line is awaited.
    if (matchSleepError(message)?.fact === COULD_NOT_BE_USED && refusals.latest() === undefined) {
      await refusals.nextKey(BED_KEY_WAIT_MS * ctx.timeScale);
    }
    if (signal.aborted) return cancelled();
    const bedKey = refusals.latest();
    return sleepFailure(
      message,
      DEFAULT_DIAG_SINK,
      refusalScene(bot, bed, message, bedKey),
      bedKey,
    );
  }
}

/** Resolves with `work`, or rejects as soon as `signal` aborts. The abort listener is removed either way. */
async function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  let cleanup = (): void => undefined;
  const aborted = new Promise<never>((_, reject) => {
    const onAbort = (): void => reject(new Error('aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    cleanup = () => signal.removeEventListener('abort', onAbort);
  });
  try {
    return await Promise.race([work, aborted]);
  } finally {
    cleanup();
  }
}

/** The other half of a bed: the block at the position its part and facing name, when it is the same bed. */
function otherHalf(bot: Bot, bed: Block): Block | null {
  const position = otherHalfPosition(bed);
  if (position === undefined) return null;
  const cell = bot.blockAt(position);
  return cell && cell.name === bed.name && bedKey(cell) === bedKey(bed) ? cell : null;
}
