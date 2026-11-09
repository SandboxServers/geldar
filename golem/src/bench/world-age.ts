import type { Bot } from 'mineflayer';
import type { BenchEnv } from './types.ts';

const POLL_MS = 50;
/** `bot.time.age` changes only when the server sends a time update, every 20 ticks (decision 0038). */
export const WORLD_AGE_RESOLUTION_TICKS = 20;
/**
 * The smallest age delta (5 steps) from which a ticks-per-second figure is worth reporting: below
 * it the 20-tick quantisation is a quarter or more of the measurement (decision 0038).
 */
export const MIN_TPS_SPAN_TICKS = 5 * WORLD_AGE_RESOLUTION_TICKS;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** World age of the bot, or null before the first time packet. */
export function worldAge(bot: Bot): number | null {
  const age: unknown = bot.time?.age;
  return typeof age === 'number' && Number.isFinite(age) ? age : null;
}

/**
 * The polling helper for scenarios: true as soon as `predicate` holds; false when `maxWorldTicks`
 * of world age pass first or `env.signal` aborts. Polls every 50 ms of wall time.
 */
export async function waitUntil(
  env: Pick<BenchEnv, 'bot' | 'signal' | 'timeScale'>,
  predicate: () => boolean,
  maxWorldTicks: number,
): Promise<boolean> {
  const start = worldAge(env.bot);
  const wallStart = Date.now();
  // Without a world clock, fall back to the wall time the ticks would take at this rate.
  const wallLimit = maxWorldTicks * 50 * env.timeScale;
  for (;;) {
    if (env.signal.aborted) return false;
    if (predicate()) return true;
    const age = worldAge(env.bot);
    if (start !== null && age !== null) {
      // The age only changes every 20 ticks, so `start` can be up to 19 ticks stale: allow for it.
      if (age - start >= maxWorldTicks + (WORLD_AGE_RESOLUTION_TICKS - 1)) return false;
    } else if (Date.now() - wallStart >= wallLimit) {
      return false;
    }
    await sleep(POLL_MS);
  }
}
