import type { Bot } from 'mineflayer';
import type { FailReason } from './outcome.ts';

/** The prefix of the bed refusal keys the server sends as action-bar lines (decision 0225). */
const BED_PREFIX = 'block.minecraft.bed.';
/** The bed key the server sends when monsters are near the bed. */
export const NOT_SAFE_KEY = `${BED_PREFIX}not_safe`;

/** The fact a bed key gives: the text the agent reads and the fail reason it carries. */
export interface BedRefusalFact {
  text: string;
  reason: FailReason;
}

type Node = Record<string, unknown>;

function asNode(value: unknown): Node | undefined {
  return typeof value === 'object' && value !== null ? (value as Node) : undefined;
}

/**
 * The bed key one message carries: the message's `translate`, else its `json.translate` (mineflayer 4.39 passes a
 * prismarine-chat ChatMessage as the first argument, with `game_info` and a null sender). Only `game_info` lines
 * count; a line without a `block.minecraft.bed.*` translate is ignored.
 */
function bedKeyOf(position: unknown, message: unknown): string | undefined {
  if (position !== 'game_info') return undefined;
  const candidates = [asNode(message)?.translate, asNode(asNode(message)?.json)?.translate];
  const key = candidates.find((value) => typeof value === 'string');
  return typeof key === 'string' && key.startsWith(BED_PREFIX) ? key : undefined;
}

/** The bed-key tracker of one sleep action. */
export interface BedRefusalWatch {
  /** The newest bed key since the watch was last armed, or undefined when none has arrived. */
  latest(): string | undefined;
  /** Starts counting: keys count from now on, and the newest key so far is cleared. Called right before each `bot.sleep`. */
  arm(): void;
  /** Resolves when the next bed key arrives, or after `ms` when none does. */
  nextKey(ms: number): Promise<void>;
  /** Unsubscribes from the bot's messages. Safe to call twice. */
  stop(): void;
}

/**
 * Listens to the bot's messages for bed refusal keys until `stop()`. Keys are ignored until `arm()` is
 * called; after that only the newest key is kept.
 */
export function watchBedRefusal(bot: Bot): BedRefusalWatch {
  let armed = false;
  let latest: string | undefined;
  let wake: (() => void) | undefined;
  const onMessage = (message: unknown, position: unknown): void => {
    if (!armed) return;
    const key = bedKeyOf(position, message);
    if (key === undefined) return;
    latest = key;
    wake?.();
  };
  bot.on('message', onMessage);
  return {
    latest: () => latest,
    arm: () => {
      armed = true;
      latest = undefined;
    },
    nextKey: (ms) =>
      new Promise<void>((resolve) => {
        const finish = (): void => {
          clearTimeout(timer);
          wake = undefined;
          resolve();
        };
        const timer = setTimeout(finish, ms);
        wake = finish;
      }),
    stop: () => {
      bot.removeListener('message', onMessage);
    },
  };
}

/**
 * The fact a bed key states, or undefined when the key has none. `hostilesCounted` is true when the bed box
 * holds a hostile the Body counts: then `not_safe` has no fact of its own (the named-hostile text is used).
 */
export function bedRefusalFact(key: string, hostilesCounted: boolean): BedRefusalFact | undefined {
  switch (key) {
    case `${BED_PREFIX}no_sleep`:
      return { text: 'it is not night', reason: 'not_possible' };
    case NOT_SAFE_KEY:
      return hostilesCounted
        ? undefined
        : {
            text: 'the server says there are monsters nearby; none in view',
            reason: 'not_possible',
          };
    case `${BED_PREFIX}too_far_away`:
      return { text: 'the bed is too far away', reason: 'out_of_reach' };
    case `${BED_PREFIX}occupied`:
      return { text: 'the bed is occupied', reason: 'blocked' };
    case `${BED_PREFIX}obstructed`:
      return { text: 'the bed is obstructed', reason: 'blocked' };
    default:
      return undefined;
  }
}
