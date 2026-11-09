import type { Bot } from 'mineflayer';
import { describe, expect, it } from 'vitest';
import { pollUntil } from './poll.ts';

/** A bot stub whose only use here is `waitForTicks`, which counts the waits it was asked for. */
function fakeBot(): { bot: Bot; waits: () => number } {
  let waits = 0;
  const bot = {
    waitForTicks: async (ticks: number) => {
      waits += ticks;
    },
  } as unknown as Bot;
  return { bot, waits: () => waits };
}

describe('pollUntil', () => {
  it('returns true without waiting when the condition already holds', async () => {
    const { bot, waits } = fakeBot();
    const ok = await pollUntil(bot, new AbortController().signal, () => true, { polls: 3 });
    expect(ok).toBe(true);
    expect(waits()).toBe(0);
  });

  it('waits one tick per poll until the condition holds', async () => {
    const { bot, waits } = fakeBot();
    let checks = 0;
    const ok = await pollUntil(bot, new AbortController().signal, () => ++checks > 2, {});
    expect(ok).toBe(true);
    expect(waits()).toBe(2);
  });

  it('gives up after the poll limit with false', async () => {
    const { bot, waits } = fakeBot();
    const ok = await pollUntil(bot, new AbortController().signal, () => false, { polls: 2 });
    expect(ok).toBe(false);
    expect(waits()).toBe(2);
  });

  it('returns false at once when the signal is already aborted', async () => {
    const { bot, waits } = fakeBot();
    const controller = new AbortController();
    controller.abort();
    const ok = await pollUntil(bot, controller.signal, () => false, { polls: 5 });
    expect(ok).toBe(false);
    expect(waits()).toBe(0);
  });

  it('returns false once the wall-clock limit has passed', async () => {
    const { bot } = fakeBot();
    const ok = await pollUntil(bot, new AbortController().signal, () => false, { wallMs: -1 });
    expect(ok).toBe(false);
  });
});
