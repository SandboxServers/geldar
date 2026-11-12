import type { Bot } from 'mineflayer';

/** Health samples kept: the trend compares the oldest kept sample with the newest. */
export const TREND_WINDOW = 3;

/** Milliseconds between health samples. */
export const TREND_INTERVAL_MS = 5_000;

export type HealthTrend = 'rising' | 'steady' | 'falling';

interface Sampler {
  samples: number[];
  timer: ReturnType<typeof setInterval> | null;
  closed: boolean;
}

const samplers = new WeakMap<Bot, Sampler>();

/** Records the Body's health (capped at 20, as the snapshot shows it) if the bot reports a number. */
function record(bot: Bot, state: Sampler): void {
  if (typeof bot.health !== 'number' || Number.isNaN(bot.health)) return;
  state.samples.push(Math.min(20, bot.health));
  if (state.samples.length > TREND_WINDOW) state.samples.shift();
}

/** Starts sampling for a bot once; the timer stops, and the state closes, when the bot ends. */
function start(bot: Bot): Sampler {
  const state: Sampler = { samples: [], timer: null, closed: false };
  samplers.set(bot, state);
  record(bot, state);
  state.timer = setInterval(() => record(bot, state), TREND_INTERVAL_MS);
  const onDeath = (): void => {
    state.samples = [];
  };
  const onEnd = (): void => {
    if (state.timer !== null) clearInterval(state.timer);
    state.timer = null;
    state.closed = true;
    bot.off('death', onDeath);
    bot.off('end', onEnd);
  };
  bot.on('death', onDeath);
  bot.on('end', onEnd);
  return state;
}

/**
 * The Body's health trend over the sample window: rising, falling, or steady. Fewer than two
 * samples (or a closed bot) gives steady. A death clears the window, so a respawn starts steady.
 */
export function healthTrend(bot: Bot): HealthTrend {
  // A bot that is not an event emitter cannot report its death or end, so it is not sampled.
  if (typeof bot.on !== 'function') return 'steady';
  const state = samplers.get(bot) ?? start(bot);
  if (state.closed || state.samples.length < 2) return 'steady';
  const oldest = state.samples[0] as number;
  const newest = state.samples[state.samples.length - 1] as number;
  if (newest > oldest) return 'rising';
  if (newest < oldest) return 'falling';
  return 'steady';
}
