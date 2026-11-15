import { Vec3 } from 'vec3';
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type FakeBlock, fakeBot, sleep } from './sleep.fakes.ts';
import { takeCensus } from './sleep-census.ts';

vi.mock('./pathing.ts', () => ({
  moveNear: vi.fn(async () => ({ ok: true, distance: 0 })),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * A white bed of two blocks along x, its head at (x, 64, z). `states` gives each half's `occupied` state; an
 * absent state is a block whose state cannot be read.
 */
function pairAt(
  x: number,
  z = 0,
  states: [boolean | undefined, boolean | undefined] = [undefined, undefined],
): FakeBlock[] {
  const [head, foot] = states;
  return [
    { name: 'white_bed', position: new Vec3(x, 64, z), occupied: head },
    { name: 'white_bed', position: new Vec3(x + 1, 64, z), occupied: foot },
  ];
}

/** Twenty beds in a 5 by 4 grid, each with its head occupied: all in range of the origin. */
function twentyOccupiedBeds(): FakeBlock[] {
  return Array.from({ length: 20 }, (_, i) =>
    pairAt(2 + 4 * (i % 5), 4 * Math.floor(i / 5), [true, false]),
  ).flat();
}

describe('the bed census', () => {
  it('counts a two-block bed once', () => {
    const bot = fakeBot({ blocks: [...pairAt(3), ...pairAt(8)] });
    expect(takeCensus(bot, 32)).toEqual({ in_range: 2, occupied: 0, unknown: 2 });
  });

  it('a bed is occupied when either of its halves reports occupied', () => {
    const bot = fakeBot({
      blocks: [...pairAt(3, 0, [false, true]), ...pairAt(8, 0, [false, false])],
    });
    expect(takeCensus(bot, 32)).toEqual({ in_range: 2, occupied: 1, unknown: 0 });
  });

  it('a bed no half of which reports a state is unknown, and is not occupied', () => {
    const bot = fakeBot({
      blocks: [...pairAt(3), ...pairAt(8, 0, [true, undefined])],
    });
    expect(takeCensus(bot, 32)).toEqual({ in_range: 2, occupied: 1, unknown: 1 });
  });

  it('a failure that tried 8 of 20 beds in range states all 20 in its text', async () => {
    const bot = fakeBot({
      timeOfDay: 13_000,
      blocks: twentyOccupiedBeds(),
      sleepErrors: Array(8).fill('Bed is occupied'),
    });
    const outcome = await sleep(bot);
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'blocked',
      message:
        'tried 8 nearby beds, all occupied or blocked; last: the bed is occupied; 20 beds within 32 blocks, 20 occupied; ended at 0, 64, 0',
      detail: { beds_in_range: 20, beds_occupied: 20, beds_unknown: 0 },
    });
  });

  it('one bed reads in the singular', async () => {
    const bot = fakeBot({
      timeOfDay: 13_000,
      blocks: pairAt(3, 0, [true, false]),
      sleepErrors: ['Bed is occupied'],
    });
    const outcome = await sleep(bot);
    expect(outcome.status === 'failed' && outcome.message).toBe(
      'tried 1 nearby beds, all occupied or blocked; last: the bed is occupied; 1 bed within 32 blocks, 1 occupied; ended at 0, 64, 0',
    );
  });

  it('a bed whose state cannot be read is counted in beds_unknown, not as occupied', async () => {
    const bot = fakeBot({
      timeOfDay: 13_000,
      blocks: pairAt(3),
      sleepErrors: ['Bed is occupied'],
    });
    const outcome = await sleep(bot);
    expect(outcome).toMatchObject({
      status: 'failed',
      message:
        'tried 1 nearby beds, all occupied or blocked; last: the bed is occupied; 1 bed within 32 blocks, 0 occupied; ended at 0, 64, 0',
      detail: { beds_in_range: 1, beds_occupied: 0, beds_unknown: 1 },
    });
  });

  it('the failure reads the bed states again at its end', async () => {
    // Both halves start free; the bed becomes occupied while the Body is refused, so the end census says 1.
    const blocks = pairAt(3, 0, [false, false]);
    const head = blocks[0] as FakeBlock;
    const bot = fakeBot({ timeOfDay: 13_000, blocks });
    (bot.sleep as unknown as Mock).mockImplementationOnce(async () => {
      head.occupied = true;
      throw new Error('Bed is occupied');
    });
    const outcome = await sleep(bot);
    expect(outcome).toMatchObject({
      status: 'failed',
      message:
        'tried 1 nearby beds, all occupied or blocked; last: the bed is occupied; 1 bed within 32 blocks, 1 occupied; ended at 0, 64, 0',
      detail: { beds_in_range: 1, beds_occupied: 1, beds_unknown: 0 },
    });
  });

  it('the search-time failure carries the census too', async () => {
    // A time scale of 0 leaves no time for any bed: the loop stops before it tries one.
    const bot = fakeBot({
      timeOfDay: 13_000,
      blocks: [...pairAt(3, 0, [true, false]), ...pairAt(8)],
    });
    const outcome = await sleep(bot, 0);
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'blocked',
      message:
        'tried 0 of 2 nearby beds; the search time ran out; last: no bed was tried; 2 beds within 32 blocks, 1 occupied; ended at 0, 64, 0',
      detail: { beds_in_range: 2, beds_occupied: 1, beds_unknown: 1 },
    });
  });
});
