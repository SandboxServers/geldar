import type { Bot } from 'mineflayer';
import { DEFAULT_DIAG_SINK, type DiagSink } from '../actions/stall-diag.ts';

/*
 * The time since rest (decision 0225). Operator log only: the snapshot, the view and the Mind never read it.
 * The statistic ids below are the 26.1.x registry order; the reader is enabled only on 26.1 servers.
 */

/** The statistics category `custom` in the 26.1.x registry order (decision 0225). */
export const CUSTOM_CATEGORY_ID = 8;
/** The custom statistic `time_since_rest` in the 26.1.x registry order: ticks since the bot last rested. */
export const TIME_SINCE_REST_ID = 4;
/** The version prefix the ids are pinned to: the reader does nothing on any other version. */
const PINNED_VERSION = '26.1';
/** The ClientCommand action that asks the server for its statistics. */
const REQUEST_STATISTICS = 1;
/** How often the statistic is requested, in wall ms at 1x (scaled by `timeScale`). */
export const REST_STAT_INTERVAL_MS = 5 * 60_000;
/** How long after a successful sleep the statistic is requested, in wall ms at 1x (scaled by `timeScale`). */
export const AFTER_SLEEP_MS = 2_000;
/** Ticks per minute, as the minutes field of the log line counts them. */
const TICKS_PER_MINUTE = 1_200;

/** One entry of the clientbound `statistics` packet. */
interface StatisticEntry {
  categoryId: number;
  statisticId: number;
  value: number;
}

/** The part of the protocol client the reader uses: its writes and its packet events. */
interface RestClient {
  write(name: string, data: unknown): void;
  on(event: string, listener: (packet: unknown) => void): unknown;
  removeListener(event: string, listener: (packet: unknown) => void): unknown;
}

export interface RestStatOptions {
  sink?: DiagSink;
  /** The Body's time scale (wall ms at 1x, multiplied by it). */
  timeScale?: number;
}

/**
 * Logs the time since rest once the bot has spawned, every five minutes and 2 s after a successful sleep.
 * Does nothing on a version other than 26.1.x, and nothing when the bot has no protocol client (the fakes).
 * The timers are unref'd and cleared when the bot ends.
 */
export function watchRestStat(bot: Bot, options: RestStatOptions = {}): void {
  if (typeof bot.version !== 'string' || !bot.version.startsWith(PINNED_VERSION)) return;
  const client = (bot as unknown as { _client?: RestClient })._client;
  if (client === undefined || typeof client.write !== 'function') return;
  const sink = options.sink ?? DEFAULT_DIAG_SINK;
  const scale = options.timeScale ?? 1;
  let interval: ReturnType<typeof setInterval> | undefined;
  let afterSleep: ReturnType<typeof setTimeout> | undefined;

  const request = (): void => {
    client.write('client_command', { actionId: REQUEST_STATISTICS });
  };
  const onStatistics = (packet: unknown): void => {
    const entries = (packet as { entries?: unknown } | undefined)?.entries;
    if (!Array.isArray(entries)) return;
    const entry = entries.find(
      (item: StatisticEntry) =>
        item?.categoryId === CUSTOM_CATEGORY_ID && item?.statisticId === TIME_SINCE_REST_ID,
    ) as StatisticEntry | undefined;
    if (entry === undefined || typeof entry.value !== 'number') return;
    const ticks = entry.value;
    sink.log(
      JSON.stringify({
        event: 'rest_stat',
        ticks_since_rest: ticks,
        minutes: Math.floor(ticks / TICKS_PER_MINUTE),
      }),
    );
  };
  const onSpawn = (): void => {
    if (interval !== undefined) return;
    request();
    interval = setInterval(request, REST_STAT_INTERVAL_MS * scale);
    interval.unref?.();
  };
  const onSleep = (): void => {
    if (afterSleep !== undefined) clearTimeout(afterSleep);
    afterSleep = setTimeout(request, AFTER_SLEEP_MS * scale);
    afterSleep.unref?.();
  };
  const stop = (): void => {
    if (interval !== undefined) clearInterval(interval);
    if (afterSleep !== undefined) clearTimeout(afterSleep);
    interval = undefined;
    afterSleep = undefined;
    client.removeListener('statistics', onStatistics);
    bot.removeListener('spawn', onSpawn);
    bot.removeListener('sleep', onSleep);
    bot.removeListener('end', stop);
  };

  client.on('statistics', onStatistics);
  bot.on('spawn', onSpawn);
  bot.on('sleep', onSleep);
  bot.on('end', stop);
}
