import type { Bot } from 'mineflayer';

/** How many players are asleep, and how many the server needs (decision 0215, "The sleepers line"). */
export interface SleepersCount {
  asleep: number;
  needed: number;
}

/** The newest sleep line the server sent: a count, or `skipped` when the night was skipped. */
export type SleepersLine = SleepersCount | 'skipped';

/** The largest number a sleepers line may carry: a bigger one is not a player count. */
const MAX_COUNT = 999;
const PLAYERS_SLEEPING = 'sleep.players_sleeping';
const SKIPPING_NIGHT = 'sleep.skipping_night';

type Node = Record<string, unknown>;

function asNode(value: unknown): Node | undefined {
  return typeof value === 'object' && value !== null ? (value as Node) : undefined;
}

/** The count one `with` argument holds: a bare int, or a chat component whose `text` (or `json.text`) is the int. */
function intArg(arg: unknown): number | undefined {
  const node = asNode(arg);
  const value = node === undefined ? arg : (node.text ?? asNode(node.json)?.text);
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_COUNT
    ? value
    : undefined;
}

/** The sleep line one message node carries, or undefined when its translation is not a sleep line. */
function lineOf(node: Node): SleepersLine | undefined {
  if (node.translate === SKIPPING_NIGHT) return 'skipped';
  const args = node.with;
  if (node.translate !== PLAYERS_SLEEPING || !Array.isArray(args)) return undefined;
  const asleep = intArg(args[0]);
  const needed = intArg(args[1]);
  return asleep === undefined || needed === undefined ? undefined : { asleep, needed };
}

/**
 * Reads the sleep line of one chat message. Only `game_info` lines count: chat and system lines are
 * not the server's sleep count. Mineflayer hands the message over as a ChatMessage (the top level) and
 * as its raw json, so both shapes are read; the first one that is a sleep line wins.
 */
export function parseSleepersLine(position: unknown, message: unknown): SleepersLine | undefined {
  if (position !== 'game_info') return undefined;
  const top = asNode(message);
  if (top === undefined) return undefined;
  return lineOf(top) ?? lineOf(asNode(top.json) ?? {});
}

/** The sleep-line tracker of one sleep action. */
export interface SleepersWatch {
  /** The newest sleep line since the watch started, or undefined when none has arrived. */
  latest(): SleepersLine | undefined;
  /** Resolves when the next sleep line arrives, or after `ms` when none does. */
  nextLine(ms: number): Promise<void>;
  /** Unsubscribes from the bot's messages. Safe to call twice. */
  stop(): void;
}

/** Listens to the bot's messages for sleep lines until `stop()`. Only the newest line is kept. */
export function watchSleepers(bot: Bot): SleepersWatch {
  let latest: SleepersLine | undefined;
  let wake: (() => void) | undefined;
  const onMessage = (message: unknown, position: unknown): void => {
    const line = parseSleepersLine(position, message);
    if (line === undefined) return;
    latest = line;
    wake?.();
  };
  bot.on('message', onMessage);
  return {
    latest: () => latest,
    nextLine: (ms) =>
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
