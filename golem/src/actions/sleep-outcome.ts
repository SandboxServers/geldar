import type { Bot } from 'mineflayer';
import type { Block } from './bot-types.ts';
import { type ActionOutcome, type FailReason, failed } from './outcome.ts';
import { observeMonsters } from './sleep-detail.ts';
import {
  type Hostile,
  hostilesAroundBed,
  MAX_NAMED_HOSTILES,
  monstersFact,
} from './sleep-hostiles.ts';
import { bedRefusalFact, NOT_SAFE_KEY } from './sleep-refusal.ts';
import { DEFAULT_DIAG_SINK, type DiagSink } from './stall-diag.ts';

/** The text of the generic refusal when no bed key says more (decision 0224; facts in decision 0225). */
export const COULD_NOT_BE_USED = 'the bed could not be used';

/** Mineflayer's text when the bot is already in a bed. Treated as asleep, not as a failure. */
export const ALREADY_SLEEPING = /already sleeping/i;

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
export interface BedResult {
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
  { match: /not sleeping|cant click/i, reason: 'blocked', fact: COULD_NOT_BE_USED },
];

/** The first sleep error whose text the message matches, or undefined. */
export function matchSleepError(message: string): SleepError | undefined {
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
  bedKey?: string,
): ActionOutcome {
  if (matchSleepError(message) === undefined) {
    diag.log(JSON.stringify({ event: 'sleep_reason_unknown', message }));
  }
  // The light comes before the hostiles: the action log clips the record to 200 characters.
  const record = {
    event: 'sleep_refusal',
    message,
    light: scene.light,
    ...(bedKey === undefined ? {} : { bed_key: bedKey }),
    hostiles: scene.hostiles
      .slice(0, MAX_NAMED_HOSTILES)
      .map(({ kind, blocks }) => ({ kind, blocks })),
    count: scene.hostiles.length,
    ...(scene.dwellTicks === undefined ? {} : { dwell_ticks: scene.dwellTicks }),
  };
  const fact = bedFact(message, bedKey, scene);
  if (fact) return failed(fact.reason, fact.text, {}, JSON.stringify(record));
  return failed(
    classifySleepError(message),
    sleepErrorText(message, scene.hostiles, scene.dwellTicks),
    {},
    JSON.stringify(record),
  );
}

/**
 * The fact a bed key gives a generic refusal (the text that says only "could not be used"). The key `not_safe`
 * with a counted hostile keeps the named-hostile text; any other key reads its own fact (sleep-refusal.ts).
 */
function bedFact(
  message: string,
  bedKey: string | undefined,
  scene: SleepScene,
): { text: string; reason: FailReason } | undefined {
  if (bedKey === undefined || matchSleepError(message)?.fact !== COULD_NOT_BE_USED)
    return undefined;
  if (bedKey === NOT_SAFE_KEY && scene.hostiles.length > 0) {
    return { text: monstersFact(scene.hostiles, scene.dwellTicks), reason: 'not_possible' };
  }
  return bedRefusalFact(bedKey, scene.hostiles.length > 0);
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
export function refusalScene(bot: Bot, bed: Block, message: string, bedKey?: string): SleepScene {
  const hostiles = hostilesAroundBed(Object.values(bot.entities), bed.position, bot.registry);
  const monsters =
    matchSleepError(message)?.monsters === true || (bedKey === NOT_SAFE_KEY && hostiles.length > 0);
  return {
    hostiles,
    light: bot.blockAt(bed.position)?.light ?? null,
    dwellTicks: monsters ? observeMonsters(bot, hostiles) : undefined,
  };
}
