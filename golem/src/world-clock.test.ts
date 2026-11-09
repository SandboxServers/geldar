import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import { describe, expect, it, vi } from 'vitest';
import { sleep, watchWorldTicks, worldAge } from './world-clock.ts';

const botAt = (age: unknown) => ({ time: { age } }) as unknown as Bot;

describe('worldAge', () => {
  it('reads a finite age', () => {
    expect(worldAge(botAt(240))).toBe(240);
  });

  it.each([undefined, Number.NaN, Number.POSITIVE_INFINITY, '20'])('is null for %j', (age) => {
    expect(worldAge(botAt(age))).toBeNull();
  });

  it('is null before the first time packet', () => {
    expect(worldAge({} as unknown as Bot)).toBeNull();
  });
});

describe('sleep', () => {
  it('resolves after the delay', async () => {
    vi.useFakeTimers();
    try {
      let done = false;
      const pending = sleep(100).then(() => {
        done = true;
      });
      await vi.advanceTimersByTimeAsync(99);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await pending;
      expect(done).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('watchWorldTicks', () => {
  function emitterBot(age: number | undefined) {
    const bot = new EventEmitter() as unknown as Bot;
    bot.time = { age } as never;
    return bot;
  }

  it('emits nothing before the first time packet', () => {
    const bot = emitterBot(undefined);
    const seen: number[] = [];
    watchWorldTicks(bot, (t) => seen.push(t));
    bot.emit('physicsTick' as never);
    expect(seen).toEqual([]);
  });

  it('advances one per physics tick and re-bases on a later time packet', () => {
    const bot = emitterBot(40);
    const seen: number[] = [];
    watchWorldTicks(bot, (t) => seen.push(t));
    bot.emit('physicsTick' as never);
    bot.emit('physicsTick' as never);
    (bot.time as { age?: number }).age = 60;
    bot.emit('time' as never);
    bot.emit('physicsTick' as never);
    expect(seen).toEqual([41, 42, 61]);
  });

  it('never goes backwards when a time packet is behind the estimate', () => {
    const bot = emitterBot(40);
    const seen: number[] = [];
    watchWorldTicks(bot, (t) => seen.push(t));
    for (let i = 0; i < 22; i++) bot.emit('physicsTick' as never);
    (bot.time as { age?: number }).age = 60;
    bot.emit('time' as never);
    bot.emit('physicsTick' as never);
    expect(seen.at(-2)).toBe(62);
    expect(seen.at(-1)).toBe(63);
  });

  it('unsubscribes both listeners', () => {
    const bot = emitterBot(40);
    const off = watchWorldTicks(bot, () => undefined);
    off();
    expect(bot.listenerCount('physicsTick' as never)).toBe(0);
    expect(bot.listenerCount('time' as never)).toBe(0);
  });
});
