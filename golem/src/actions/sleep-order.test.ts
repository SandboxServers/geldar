import type { Bot } from 'mineflayer';
import type { Mock } from 'vitest';
import { describe, expect, it, vi } from 'vitest';
import { bed, type FakeBlock, fakeBot, sleep } from './sleep.fakes.ts';

vi.mock('./pathing.ts', () => ({
  moveNear: vi.fn(async () => ({ ok: true, distance: 0 })),
}));

/** A bed whose two halves report `occupied` as given, its head at x on row z 0 (decision 0338). */
function pair(x: number, occupied: boolean): FakeBlock[] {
  return bed('white_bed', x).map((block) => ({ ...block, occupied }));
}

/** The x of each bed `bot.sleep` was called with, in call order. */
function slept(bot: Bot): number[] {
  const calls = (bot.sleep as unknown as Mock).mock.calls as [FakeBlock][];
  return calls.map(([block]) => block.position.x);
}

describe('sleep bed order (decision 0338)', () => {
  it('tries the nearer free bed before a nearer occupied one', async () => {
    const bot = fakeBot({ timeOfDay: 13_000, blocks: [...pair(3, true), ...pair(6, false)] });
    const outcome = await sleep(bot);
    expect(outcome.status).toBe('completed');
    expect(slept(bot)).toEqual([6]);
  });

  it('tries an occupied bed after the free beds, and still tries it when they refuse', async () => {
    const bot = fakeBot({
      timeOfDay: 13_000,
      blocks: [...pair(3, true), ...pair(6, false)],
      sleepErrors: ['This bed is obstructed'],
    });
    const outcome = await sleep(bot);
    expect(outcome.status).toBe('completed');
    expect(slept(bot)).toEqual([6, 3]);
  });

  it('a search the time limit ends is a timeout that counts the beds tried and occupied', async () => {
    // A time scale of 0 leaves no time for any bed: the loop stops before it tries one.
    const bot = fakeBot({ timeOfDay: 13_000, blocks: [...pair(3, true), ...pair(8, false)] });
    const outcome = await sleep(bot, 0);
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'timeout',
      message:
        'tried 0 of 2 nearby beds, 1 occupied; the time limit ended the search; last: no bed was tried; 2 beds within 32 blocks, 1 occupied; ended at 0, 64, 0',
    });
    expect(slept(bot)).toEqual([]);
  });
});
