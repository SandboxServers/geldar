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
  type JsonValue,
} from './outcome.ts';
import { moveNear } from './pathing.ts';
import type { ActionContext, ActionHandler } from './registry.ts';
import {
  type BedTry,
  observeMonsters,
  sleepFailureDetail,
  withSleepDetail,
} from './sleep-detail.ts';
import {
  type Hostile,
  hostilesAroundBed,
  MAX_NAMED_HOSTILES,
  monstersFact,
} from './sleep-hostiles.ts';
import { type SleepersLine, type SleepersWatch, watchSleepers } from './sleepers.ts';
import { DEFAULT_DIAG_SINK, type DiagSink } from './stall-diag.ts';

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

/** The reason a bed reports when the hard stop cut its walk or sleep short. */
const CUT_OFF = 'the bed was cut off by the time limit';

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

/** A sleep error the Body knows: the text it matches, its fail reason, and the fact it reports. */
interface SleepError {
  match: RegExp;
  reason: FailReason;
  /** The facts-only text the agent reads; absent when the message is kept as it came. */
  fact?: string;
  /** True for the monsters refusal: its text names the hostiles around the bed (sleep-hostiles.ts). */
  monsters?: true;
}

/** What a refusal knows about the bed it was tried in: the hostiles the bed check counts and the block light. */
export interface SleepScene {
  hostiles: readonly Hostile[];
  light: number | null;
  /** The dwell in ticks of the nearest hostile, on a monsters refusal whose nearest hostile has an id. */
  dwellTicks?: number | undefined;
}

/** What one bed of the loop gave: the outcome, and the bed block it ended on. */
interface BedResult {
  outcome: ActionOutcome;
  used: Block;
}

/** The sleep errors, from Mineflayer's texts and the server's, in the order they are matched. */
const SLEEP_ERRORS: readonly SleepError[] = [
  { match: ALREADY_SLEEPING, reason: 'not_possible' },
  { match: /monsters nearby/i, reason: 'not_possible', monsters: true },
  { match: /not night|only sleep at night/i, reason: 'not_possible', fact: 'it is not night' },
  { match: /too far/i, reason: 'out_of_reach', fact: 'the bed is too far away' },
  { match: /occupied/i, reason: 'blocked', fact: 'the bed is occupied' },
  { match: /obstructed/i, reason: 'blocked', fact: 'the bed is obstructed' },
  { match: /not a bed|only half bed/i, reason: 'not_found' },
  { match: /not sleeping|cant click/i, reason: 'blocked', fact: 'the bed could not be used' },
];

/** The first sleep error whose text the message matches, or undefined. */
function matchSleepError(message: string): SleepError | undefined {
  return SLEEP_ERRORS.find((known) => known.match.test(message));
}

/** Maps a Mineflayer sleep error to a fail reason, by its text. Anything unknown is `not_possible`. */
export function classifySleepError(message: string): FailReason {
  return matchSleepError(message)?.reason ?? 'not_possible';
}

/**
 * The failed outcome for a sleep error. A text that no known error matches keeps its server text and
 * logs one `sleep_reason_unknown` line to the diag sink, so a new text shows up in the log. Every refusal
 * carries its record (the hostiles, the light, the message) in `raw`: the action log keeps it, the agent does not read it.
 */
export function sleepFailure(
  message: string,
  diag: DiagSink = DEFAULT_DIAG_SINK,
  scene: SleepScene = { hostiles: [], light: null },
): ActionOutcome {
  if (matchSleepError(message) === undefined) {
    diag.log(JSON.stringify({ event: 'sleep_reason_unknown', message }));
  }
  // The light comes before the hostiles: the action log clips the record to 200 characters.
  const record = {
    event: 'sleep_refusal',
    message,
    light: scene.light,
    hostiles: scene.hostiles
      .slice(0, MAX_NAMED_HOSTILES)
      .map(({ kind, blocks }) => ({ kind, blocks })),
    count: scene.hostiles.length,
    ...(scene.dwellTicks === undefined ? {} : { dwell_ticks: scene.dwellTicks }),
  };
  return failed(
    classifySleepError(message),
    sleepErrorText(message, scene.hostiles, scene.dwellTicks),
    {},
    JSON.stringify(record),
  );
}

/**
 * The text the agent reads for a sleep error: the fact it states, or the message when no fact is known.
 * The monsters refusal names the hostiles in `hostiles` (none in view when the list is empty).
 */
export function sleepErrorText(
  message: string,
  hostiles: readonly Hostile[] = [],
  dwellTicks?: number,
): string {
  const known = matchSleepError(message);
  if (known?.monsters) return monstersFact(hostiles, dwellTicks);
  return known?.fact ?? message;
}

/**
 * What the bed the Body tried holds for a refusal: the counted hostiles around its position and its block light.
 * A monsters refusal also records the hostiles' dwell (sleep-detail.ts).
 */
function refusalScene(bot: Bot, bed: Block, message: string): SleepScene {
  const hostiles = hostilesAroundBed(Object.values(bot.entities), bed.position, bot.registry);
  const monsters = matchSleepError(message)?.monsters === true;
  return {
    hostiles,
    light: bot.blockAt(bed.position)?.light ?? null,
    dwellTicks: monsters ? observeMonsters(bot, hostiles) : undefined,
  };
}

async function sleep(ctx: ActionContext): Promise<ActionOutcome> {
  // An action that finds the bot already asleep has no sleep to report: it starts no watch.
  if (ctx.bot.isSleeping) return completed();
  // The watch runs for the whole action: it stops on success, failure, cancel and throw alike.
  const sleepers = watchSleepers(ctx.bot);
  // Every bed the loop tried, in order: a failure reports them with the bot's final position.
  const tries: BedTry[] = [];
  try {
    const outcome = await sleepFromBeds(ctx, sleepers, tries);
    return withSleepDetail(outcome, sleepFailureDetail(ctx.bot, tries));
  } finally {
    sleepers.stop();
  }
}

async function sleepFromBeds(
  ctx: ActionContext,
  sleepers: SleepersWatch,
  tries: BedTry[],
): Promise<ActionOutcome> {
  const { bot } = ctx;
  const beds = nearbyBeds(bot);
  if (beds.length === 0) return failed('not_found', 'no bed');
  if (!isNightOrStorm(bot.time.timeOfDay, bot.thunderState > 0)) {
    return failed('not_possible', 'it is not night');
  }

  let last: ActionOutcome = failed('blocked', 'no bed was tried');
  // The whole loop has a budget: no new bed starts after it, so the action ends with its facts.
  const started = Date.now();
  const budget = SLEEP_BUDGET_MS * ctx.timeScale;
  // The hard stop cuts a walk or a sleep that is still running, so one slow bed cannot reach the action timeout.
  const stop = new AbortController();
  const stopTimer = setTimeout(() => stop.abort(), SLEEP_HARD_STOP_MS * ctx.timeScale);
  const bedCtx: ActionContext = { ...ctx, signal: AbortSignal.any([ctx.signal, stop.signal]) };
  let tried = 0;
  let outOfTime = false;
  try {
    for (const bed of beds) {
      if (Date.now() - started >= budget) {
        outOfTime = true;
        break;
      }
      tried += 1;
      const { outcome, used } = await sleepInBed(bedCtx, bed, sleepers);
      if (outcome.status === 'cancelled' && stop.signal.aborted && !ctx.signal.aborted) {
        // Only the hard stop cut this bed: the search time ran out, which is not a cancel from the Mind.
        last = failed('blocked', CUT_OFF);
        tries.push(bedTry(used, CUT_OFF));
        outOfTime = true;
        break;
      }
      if (outcome.status === 'failed') tries.push(bedTry(used, outcome.message));
      if (
        outcome.status !== 'failed' ||
        (outcome.reason !== 'blocked' && outcome.reason !== 'timeout') ||
        ctx.signal.aborted
      ) {
        return outcome;
      }
      last = outcome;
    }
  } finally {
    clearTimeout(stopTimer);
  }
  const lastText = last.status === 'failed' ? last.message : '';
  if (outOfTime) {
    return failed(
      'blocked',
      `tried ${tried} of ${beds.length} nearby beds; the search time ran out; last: ${lastText}`,
    );
  }
  return failed(
    'blocked',
    `tried ${tried} nearby beds, all occupied or blocked; last: ${lastText}`,
  );
}

/** Walks to a bed and sleeps in it; completed when the bot is asleep, else the failure. */
/**
 * Walks to a bed and sleeps in it. The outcome is completed when the bot is asleep, else the failure; `used` is
 * the bed block the outcome came from (the other half after an out_of_reach).
 */
async function sleepInBed(
  ctx: ActionContext,
  bed: Block,
  sleepers: SleepersWatch,
): Promise<BedResult> {
  const { bot } = ctx;
  const near = await walkNear(ctx, bed);
  if (near) return { outcome: near, used: bed };
  let used = bed;
  let attempt = await attemptSleep(bot, bed, ctx.signal, sleepers);
  if (attempt?.status === 'failed' && attempt.reason === 'out_of_reach') {
    // The bed check is measured from the head block, and `findBlocks` may return the foot: stand by the other half.
    const other = otherHalf(bot, bed);
    if (other) {
      used = other;
      const moved = await walkNear(ctx, other);
      if (moved) return { outcome: moved, used };
      attempt = await attemptSleep(bot, other, ctx.signal, sleepers);
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

/** The sleepers fact the result carries: `sleepers` as `{asleep, needed}` or `skipped`; no key when no line was seen. */
function sleepersDetail(line: SleepersLine | undefined): Record<string, JsonValue> {
  if (line === undefined) return {};
  return {
    sleepers: line === 'skipped' ? 'skipped' : { asleep: line.asleep, needed: line.needed },
  };
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
    stallTicks: BED_STALL_TICKS,
  });
  if (move.ok) return ctx.signal.aborted ? cancelled() : null;
  return outcomeOfMove(move);
}

/**
 * Calls `bot.sleep` unless `signal` aborts first; null when the call returned or the bot was already asleep,
 * `cancelled` when the signal aborted, else the mapped failure. The sleepers watch is armed right before the
 * call, so only the lines from this call count. Mineflayer's sleep has no cancel: an abandoned
 * call settles on its own, and the race has already handled its outcome.
 */
async function attemptSleep(
  bot: Bot,
  bed: Block,
  signal: AbortSignal,
  sleepers: SleepersWatch,
): Promise<ActionOutcome | null> {
  if (signal.aborted) return cancelled();
  try {
    sleepers.arm();
    await untilAborted(bot.sleep(bed), signal);
    return null;
  } catch (error) {
    if (signal.aborted) return cancelled();
    const message = errorText(error);
    if (ALREADY_SLEEPING.test(message)) return null;
    return sleepFailure(message, DEFAULT_DIAG_SINK, refusalScene(bot, bed, message));
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

/** The other half of a bed: the same bed block next to it on a horizontal side. */
function otherHalf(bot: Bot, bed: Block): Block | null {
  for (const offset of HORIZONTAL) {
    const cell = bot.blockAt(bed.position.plus(offset));
    if (cell?.name === bed.name) return cell;
  }
  return null;
}
