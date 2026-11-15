import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
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

/** A bed whose head at x reports `head` and whose foot at x + 1 reports `foot`; the head is the nearer half. */
function halves(x: number, head: boolean, foot: boolean): FakeBlock[] {
  const [headBlock, footBlock] = bed('white_bed', x);
  return [
    { ...headBlock, occupied: head } as FakeBlock,
    { ...footBlock, occupied: foot } as FakeBlock,
  ];
}

/** A bed whose foot at x reports `foot` and whose head at x + 1 reports `head`; the foot is the nearer half. */
function footNearer(x: number, head: boolean, foot: boolean): FakeBlock[] {
  return [
    {
      name: 'white_bed',
      position: new Vec3(x, 64, 0),
      part: 'foot',
      facing: 'east',
      occupied: foot,
    },
    {
      name: 'white_bed',
      position: new Vec3(x + 1, 64, 0),
      part: 'head',
      facing: 'east',
      occupied: head,
    },
  ];
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

  it('a bed with only its foot occupied, the nearer half seen first, is ordered as occupied', async () => {
    const bot = fakeBot({
      timeOfDay: 13_000,
      blocks: [...halves(3, false, true), ...pair(6, false)],
    });
    const outcome = await sleep(bot);
    expect(outcome.status).toBe('completed');
    expect(slept(bot)).toEqual([6]);
  });

  it('a bed with only its head occupied, the foot seen first, is ordered as occupied', async () => {
    const bot = fakeBot({
      timeOfDay: 13_000,
      blocks: [...footNearer(3, true, false), ...pair(6, false)],
    });
    const outcome = await sleep(bot);
    expect(outcome.status).toBe('completed');
    expect(slept(bot)).toEqual([6]);
  });

  it('the free beds are tried nearest first, whatever order they are listed in', async () => {
    const bot = fakeBot({
      timeOfDay: 13_000,
      blocks: [...pair(9, false), ...pair(3, false), ...pair(6, false)],
      sleepErrors: ['This bed is obstructed', 'This bed is obstructed'],
    });
    const outcome = await sleep(bot);
    expect(outcome.status).toBe('completed');
    expect(slept(bot)).toEqual([3, 6, 9]);
  });

  it('the occupied beds are tried nearest first, after a free bed that refuses', async () => {
    const bot = fakeBot({
      timeOfDay: 13_000,
      blocks: [...pair(9, true), ...pair(3, true), ...pair(6, false)],
      sleepErrors: ['This bed is obstructed', 'This bed is obstructed', 'This bed is obstructed'],
    });
    const outcome = await sleep(bot);
    expect(outcome).toMatchObject({ status: 'failed', reason: 'blocked' });
    expect(slept(bot)).toEqual([6, 3, 9]);
  });

  it('with no free bed, every occupied bed is tried nearest first and the loop reports all occupied', async () => {
    const bot = fakeBot({
      timeOfDay: 13_000,
      blocks: [...pair(9, true), ...pair(3, true)],
      sleepErrors: ['This bed is obstructed', 'This bed is obstructed'],
    });
    const outcome = await sleep(bot);
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'blocked',
      message: expect.stringContaining('tried 2 nearby beds, all occupied or blocked'),
    });
    expect(slept(bot)).toEqual([3, 9]);
  });

  it('with every bed free, the nearest one is tried first', async () => {
    const bot = fakeBot({
      timeOfDay: 13_000,
      blocks: [...pair(9, false), ...pair(3, false), ...pair(6, false)],
    });
    const outcome = await sleep(bot);
    expect(outcome.status).toBe('completed');
    expect(slept(bot)).toEqual([3]);
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
