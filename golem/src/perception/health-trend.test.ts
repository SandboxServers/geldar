import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { healthTrend, TREND_INTERVAL_MS, TREND_WINDOW } from './health-trend.ts';

/** A bot whose health the test sets; `health` is read on each sample. */
function trendBot(health: number | undefined = 20) {
  const bot = new EventEmitter() as unknown as Record<string, unknown>;
  bot.health = health;
  return { bot: bot as unknown as Bot, raw: bot };
}

/** Lets one sample interval pass. */
function tick(): void {
  vi.advanceTimersByTime(TREND_INTERVAL_MS);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('healthTrend', () => {
  it('uses a window of 3 samples, sampled every 5 seconds', () => {
    expect(TREND_WINDOW).toBe(3);
    expect(TREND_INTERVAL_MS).toBe(5_000);
  });

  it('is rising when the newest sample is higher (18 then 19)', () => {
    const { bot, raw } = trendBot(18);
    expect(healthTrend(bot)).toBe('steady');
    raw.health = 19;
    tick();
    expect(healthTrend(bot)).toBe('rising');
  });

  it('is steady when the samples are equal', () => {
    const { bot } = trendBot(18);
    healthTrend(bot);
    tick();
    expect(healthTrend(bot)).toBe('steady');
  });

  it('is falling when the newest sample is lower', () => {
    const { bot, raw } = trendBot(18);
    healthTrend(bot);
    raw.health = 15;
    tick();
    expect(healthTrend(bot)).toBe('falling');
  });

  it('counts the oldest sample at the window edge (the third sample still sees the first)', () => {
    const { bot, raw } = trendBot(19);
    healthTrend(bot);
    raw.health = 18;
    tick();
    tick();
    expect(healthTrend(bot)).toBe('falling');
  });

  it('drops the sample that falls out of the window (no window would still say falling)', () => {
    const { bot, raw } = trendBot(19);
    healthTrend(bot);
    raw.health = 18;
    tick();
    tick();
    tick();
    expect(healthTrend(bot)).toBe('steady');
  });

  it('caps health at 20 as the snapshot shows it', () => {
    const { bot, raw } = trendBot(20);
    healthTrend(bot);
    raw.health = 24;
    tick();
    expect(healthTrend(bot)).toBe('steady');
  });

  it('a death clears the window, so a respawn at full health reads steady, not rising', () => {
    const { bot, raw } = trendBot(12);
    healthTrend(bot);
    (bot as unknown as EventEmitter).emit('death');
    raw.health = 20;
    tick();
    expect(healthTrend(bot)).toBe('steady');
    tick();
    expect(healthTrend(bot)).toBe('steady');
  });

  it('with no samples (health not a number) gives steady and does not throw', () => {
    const { bot } = trendBot(undefined);
    expect(() => healthTrend(bot)).not.toThrow();
    tick();
    expect(healthTrend(bot)).toBe('steady');
  });

  it('a bot with no event methods reads steady, starts no timer, and does not throw', () => {
    const plain = { health: 18, entity: {} } as unknown as Bot;
    expect(() => healthTrend(plain)).not.toThrow();
    expect(healthTrend(plain)).toBe('steady');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the timer on bot end, and a closed bot reads steady without a new timer', () => {
    const { bot, raw } = trendBot(18);
    healthTrend(bot);
    expect(vi.getTimerCount()).toBe(1);
    (bot as unknown as EventEmitter).emit('end');
    expect(vi.getTimerCount()).toBe(0);
    raw.health = 10;
    expect(healthTrend(bot)).toBe('steady');
    expect(vi.getTimerCount()).toBe(0);
  });
});
