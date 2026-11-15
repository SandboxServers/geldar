import { Vec3 } from 'vec3';
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type FakeBlock, fakeBot, sleep } from './sleep.fakes.ts';
import { triedMessage } from './sleep.ts';
import { takeCensus } from './sleep-census.ts';

vi.mock('./pathing.ts', () => ({
  moveNear: vi.fn(async () => ({ ok: true, distance: 0 })),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

/** The vector from a bed's foot to its head for each facing: the head is the foot plus it. */
const FOOT_TO_HEAD: Record<string, [number, number]> = {
  north: [0, -1],
  south: [0, 1],
  west: [-1, 0],
  east: [1, 0],
};

/**
 * A bed of two blocks at y 64: its head at (x, 64, z) facing `facing` (west by default, so the foot is at x + 1),
 * and its foot one block the other way. `states` gives each half's `occupied` state; an absent state is a block
 * whose state cannot be read.
 */
function pairAt(
  x: number,
  z = 0,
  states: [boolean | undefined, boolean | undefined] = [undefined, undefined],
  facing = 'west',
): FakeBlock[] {
  const [head, foot] = states;
  const [dx, dz] = FOOT_TO_HEAD[facing] ?? [0, 0];
  return [
    { name: 'white_bed', position: new Vec3(x, 64, z), occupied: head, part: 'head', facing },
    {
      name: 'white_bed',
      position: new Vec3(x - dx, 64, z - dz),
      occupied: foot,
      part: 'foot',
      facing,
    },
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

  it('three beds side by side with only the last occupied count one occupied', () => {
    const bot = fakeBot({
      blocks: [
        ...pairAt(2, 0, [false, false]),
        ...pairAt(4, 0, [false, false]),
        ...pairAt(6, 0, [true, false]),
      ],
    });
    expect(takeCensus(bot, 32)).toEqual({ in_range: 3, occupied: 1, unknown: 0 });
  });

  it.each(['north', 'south', 'east', 'west'])(
    'a bed facing %s is one bed of two blocks',
    (facing) => {
      const bot = fakeBot({ blocks: pairAt(0, 0, [true, false], facing) });
      expect(takeCensus(bot, 32)).toEqual({ in_range: 1, occupied: 1, unknown: 0 });
    },
  );

  it('beds facing each way, along x and along z, count one bed each', () => {
    const bot = fakeBot({
      blocks: [
        ...pairAt(4, 0, [true, false], 'west'),
        ...pairAt(-4, 0, [false, false], 'east'),
        ...pairAt(0, 4, [false, false], 'north'),
        ...pairAt(0, -4, [false, false], 'south'),
      ],
    });
    expect(takeCensus(bot, 32)).toEqual({ in_range: 4, occupied: 1, unknown: 0 });
  });

  it('a block whose part cannot be read counts once, by its own state', () => {
    const bot = fakeBot({
      blocks: [{ name: 'white_bed', position: new Vec3(3, 64, 0), occupied: true }],
    });
    expect(takeCensus(bot, 32)).toEqual({ in_range: 1, occupied: 1, unknown: 0 });
  });

  it('a bed 40 blocks away is not in range', () => {
    const bot = fakeBot({ blocks: [...pairAt(3), ...pairAt(40, 0, [true, false])] });
    expect(takeCensus(bot, 32)).toEqual({ in_range: 1, occupied: 0, unknown: 1 });
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

  it('a refusal that stops the loop reads the census at its end', async () => {
    // Both halves start free; the bed becomes occupied during the refused sleep, so only the end census says 1.
    const blocks = pairAt(3, 0, [false, false]);
    const head = blocks[0] as FakeBlock;
    const bot = fakeBot({ timeOfDay: 13_000, blocks });
    (bot.sleep as unknown as Mock).mockImplementationOnce(async () => {
      head.occupied = true;
      throw new Error('Not night');
    });
    const outcome = await sleep(bot);
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'not_possible',
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

  it('three beds side by side read the same through the loop', async () => {
    const bot = fakeBot({
      timeOfDay: 13_000,
      blocks: [
        ...pairAt(2, 0, [false, false]),
        ...pairAt(4, 0, [false, false]),
        ...pairAt(6, 0, [true, false]),
      ],
      sleepErrors: Array(3).fill('Bed is occupied'),
    });
    const outcome = await sleep(bot);
    expect(outcome).toMatchObject({
      status: 'failed',
      message:
        'tried 3 nearby beds, all occupied or blocked; last: the bed is occupied; 3 beds within 32 blocks, 1 occupied; ended at 0, 64, 0',
      detail: { beds_in_range: 3, beds_occupied: 1, beds_unknown: 0 },
    });
  });

  it('a neighbouring bed does not swallow a bed: the loop tries both', async () => {
    // Bed A is the head at x 0 with its foot at x -1; bed B is the head at x 1 with its foot at x 2. The nearest
    // block of B is its head, next to A's head, and must still be tried.
    const bot = fakeBot({
      timeOfDay: 13_000,
      blocks: [...pairAt(0, 0, [false, false], 'east'), ...pairAt(1, 0, [false, false], 'west')],
      sleepErrors: ['Bed is occupied', 'Bed is occupied'],
    });
    const outcome = await sleep(bot);
    expect(outcome).toMatchObject({
      status: 'failed',
      detail: { beds_tried: [{ x: 0 }, { x: 1 }] },
    });
  });

  it('a bed 40 blocks away is not tried', async () => {
    const bot = fakeBot({
      timeOfDay: 13_000,
      blocks: [...pairAt(3), ...pairAt(40, 0, [true, false])],
      sleepErrors: ['Bed is occupied'],
    });
    const outcome = await sleep(bot);
    expect(outcome).toMatchObject({
      status: 'failed',
      message:
        'tried 1 nearby beds, all occupied or blocked; last: the bed is occupied; 1 bed within 32 blocks, 0 occupied; ended at 0, 64, 0',
      detail: { beds_tried: [{ x: 3 }] },
    });
  });
});

describe('the tried-beds message', () => {
  const base = 'tried 8 nearby beds, all occupied or blocked';
  const tail = '; 20 beds within 32 blocks, 20 occupied; ended at 0, 64, 0';

  it('keeps a last text that fits whole', () => {
    expect(triedMessage(base, 'the bed is occupied', tail)).toBe(
      `${base}; last: the bed is occupied${tail}`,
    );
  });

  it('cuts a long last text to 160 characters, and keeps the census and the position', () => {
    const message = triedMessage(base, 'x'.repeat(300), tail);
    expect(message).toHaveLength(160);
    expect(message.startsWith(`${base}; last: xx`)).toBe(true);
    expect(message.endsWith(`...${tail}`)).toBe(true);
  });

  it('keeps a very long tail whole, and leaves the last text to its dots', () => {
    const longTail = `; ${'9 beds within 32 blocks, 9 occupied; '.repeat(6)}ended at 0, 64, 0`;
    expect(triedMessage(base, 'the bed is occupied', longTail)).toBe(
      `${base}; last: ...${longTail}`,
    );
  });
});
