import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Block } from './bot-types.ts';
import { moveNear } from './pathing.ts';
import { bed, fakeBot, sleep, walkUntilAborted } from './sleep.fakes.ts';
import { isBeside, isObstructed, REFUSAL_MEMORY_MS } from './sleep-beds.ts';
import { NO_PATH_TEXT } from './soft-dig.ts';

/** A walk that arrives after `ms`, or reports a failed move when its signal is aborted first. */
const arrivesAfter =
  (ms: number) =>
  (_bot: unknown, _target: unknown, _range: unknown, opts: { signal: AbortSignal }) =>
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ ok: true, distance: 0 }), ms);
      opts.signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          resolve({ ok: false, reason: 'blocked', message: 'walk stopped' });
        },
        { once: true },
      );
    });

type Cell = Record<string, unknown> | null;
const AIR: Cell = { name: 'air', boundingBox: 'empty', shapes: [], transparent: true };
const STONE: Cell = {
  name: 'stone',
  boundingBox: 'block',
  shapes: [[0, 0, 0, 1, 1, 1]],
  transparent: false,
};
const FACINGS: [string, Vec3][] = [
  ['north', new Vec3(0, 0, -1)],
  ['south', new Vec3(0, 0, 1)],
  ['east', new Vec3(1, 0, 0)],
  ['west', new Vec3(-1, 0, 0)],
];
/** Cells that do not suffocate: a shape that is not a full cube, a transparent cube, an unreadable shape. */
const NON_SUFFOCATING: Record<string, Cell> = {
  glass: { name: 'glass', boundingBox: 'block', shapes: [[0, 0, 0, 1, 1, 1]], transparent: true },
  leaves: {
    name: 'oak_leaves',
    boundingBox: 'block',
    shapes: [[0, 0, 0, 1, 1, 1]],
    transparent: true,
  },
  slab: {
    name: 'oak_slab',
    boundingBox: 'block',
    shapes: [[0, 0, 0, 1, 0.5, 1]],
    transparent: false,
  },
  stairs: {
    name: 'oak_stairs',
    boundingBox: 'block',
    shapes: [
      [0, 0, 0, 1, 0.5, 1],
      [0, 0.5, 0.5, 1, 1, 1],
    ],
    transparent: false,
  },
  lantern: {
    name: 'lantern',
    boundingBox: 'block',
    shapes: [[0.3125, 0, 0.3125, 0.6875, 0.5625, 0.6875]],
    transparent: false,
  },
  trapdoor: {
    name: 'oak_trapdoor',
    boundingBox: 'block',
    shapes: [[0, 0, 0, 1, 0.1875, 1]],
    transparent: true,
  },
  carpet: {
    name: 'white_carpet',
    boundingBox: 'empty',
    shapes: [[0, 0, 0, 1, 0.0625, 1]],
    transparent: true,
  },
  unreadable: { name: 'mystery', boundingBox: 'block', transparent: false },
};

/** A Body at (0, 64, 0) in a world whose listed cells are given; any other cell is air, and `null` is unloaded. */
function bodyIn(cells: Map<string, Cell>): Bot {
  return {
    entity: { position: new Vec3(0, 64, 0) },
    blockAt: (position: Vec3) => {
      const cell = cells.has(position.toString()) ? cells.get(position.toString()) : AIR;
      return cell === null ? null : ({ ...AIR, ...cell, position } as unknown as Block);
    },
  } as unknown as Bot;
}

/** The cells above a foot and a head, both set to `cell`. */
const aboveBoth = (foot: Vec3, head: Vec3, cell: Cell) =>
  new Map<string, Cell>([
    [foot.offset(0, 1, 0).toString(), cell],
    [head.offset(0, 1, 0).toString(), cell],
  ]);

/** A bed half as the census reads it: its part and facing. */
const half = (position: Vec3, part: 'head' | 'foot', facing: string) =>
  ({ name: 'white_bed', position, getProperties: () => ({ part, facing }) }) as unknown as Block;

describe('isObstructed: both cells above the bed (decision 0341)', () => {
  const foot = new Vec3(10, 64, 10);
  it.each(FACINGS)(
    '%s: solid cubes above both halves obstruct, whichever half is passed',
    (name, v) => {
      const head = foot.plus(v);
      const both = bodyIn(aboveBoth(foot, head, STONE));
      expect(isObstructed(both, half(foot, 'foot', name))).toBe(true);
      expect(isObstructed(both, half(head, 'head', name))).toBe(true);
    },
  );
  it.each(FACINGS)(
    '%s: a solid cube above one half only does not obstruct (head or foot side)',
    (name, v) => {
      const head = foot.plus(v);
      const headOnly = bodyIn(new Map([[head.offset(0, 1, 0).toString(), STONE]]));
      const footOnly = bodyIn(new Map([[foot.offset(0, 1, 0).toString(), STONE]]));
      expect(isObstructed(headOnly, half(foot, 'foot', name))).toBe(false);
      expect(isObstructed(headOnly, half(head, 'head', name))).toBe(false);
      expect(isObstructed(footOnly, half(foot, 'foot', name))).toBe(false);
      expect(isObstructed(footOnly, half(head, 'head', name))).toBe(false);
    },
  );
  it.each(Object.keys(NON_SUFFOCATING))(
    'a %s above both halves does not obstruct the bed',
    (kind) => {
      const head = foot.plus(new Vec3(1, 0, 0));
      const world = bodyIn(aboveBoth(foot, head, NON_SUFFOCATING[kind] ?? null));
      expect(isObstructed(world, half(foot, 'foot', 'east'))).toBe(false);
    },
  );
  it('an unloaded cell above a half does not obstruct the bed', () => {
    const head = foot.plus(new Vec3(1, 0, 0));
    expect(isObstructed(bodyIn(aboveBoth(foot, head, null)), half(foot, 'foot', 'east'))).toBe(
      false,
    );
  });
});

describe('isBeside: one block on each axis, and no further (decision 0341)', () => {
  it.each([
    [1, 64, 0, true],
    [-1, 64, 0, true],
    [0, 64, 1, true],
    [0, 64, -1, true],
    [0, 65, 0, true],
    [0, 63, 0, true],
    [2, 64, 0, false],
    [0, 64, 2, false],
    [0, 66, 0, false],
    [0, 62, 0, false],
  ])('a bed at (%i, %i, %i) is beside the Body: %s', (x, y, z, expected) => {
    expect(isBeside(bodyIn(new Map()), { position: new Vec3(x, y, z) } as unknown as Block)).toBe(
      expected,
    );
  });
});

vi.mock('./pathing.ts', () => ({
  moveNear: vi.fn(async () => ({ ok: true, distance: 0 })),
}));

beforeEach(() => {
  vi.mocked(moveNear).mockClear();
  vi.useRealTimers();
});

/** A solid block in the cell above a bed's head: the cell the Body's obstruction check reads (decision 0341). */
const solidAbove = (x: number) => ({
  name: 'stone',
  position: new Vec3(x, 65, 0),
  boundingBox: 'block' as const,
  shapes: [[0, 0, 0, 1, 1, 1]],
  transparent: false,
});

/** The position of the bed the sleep call `call` (0-based, across the bot's calls) was made on. */
const triedAt = (bot: ReturnType<typeof fakeBot>, call: number) =>
  vi.mocked(bot.sleep).mock.calls[call]?.[0]?.position;

/** A fake bot whose bed at x=5 is refused as obstructed and bed at x=9 as occupied: one sleep, which fails. */
async function refuseFirstBed(): Promise<ReturnType<typeof fakeBot>> {
  const bot = fakeBot({
    timeOfDay: 13_000,
    blocks: [...bed('white_bed', 5), ...bed('white_bed', 9).map((b) => ({ ...b, occupied: true }))],
    sleepErrors: ['the bed is obstructed', 'the bed is occupied'],
  });
  expect(await sleep(bot)).toMatchObject({ status: 'failed' });
  return bot;
}

describe('sleep: a bed the Body finds obstructed is not walked to (decision 0341)', () => {
  it('skips a bed with solid blocks above both halves and walks to the next free bed', async () => {
    const bot = fakeBot({
      timeOfDay: 13_000,
      blocks: [...bed('white_bed', 5), solidAbove(5), solidAbove(6), ...bed('white_bed', 9)],
    });
    expect(await sleep(bot)).toMatchObject({ status: 'completed' });
    expect(vi.mocked(moveNear).mock.calls.map((call) => call[1])).toEqual([new Vec3(9, 64, 0)]);
    expect(triedAt(bot, 0)).toEqual(new Vec3(9, 64, 0));
  });

  it('a bed the Body is already beside is tried first, with no walk', async () => {
    const bot = fakeBot({
      timeOfDay: 13_000,
      blocks: [...bed('white_bed', 9), ...bed('white_bed', 1)],
    });
    expect(await sleep(bot)).toMatchObject({ status: 'completed' });
    expect(moveNear).not.toHaveBeenCalled();
    expect(triedAt(bot, 0)).toEqual(new Vec3(1, 64, 0));
  });

  it('a bed refused as obstructed is remembered: the same Body ranks it last next time', async () => {
    const bot = await refuseFirstBed();
    expect(await sleep(bot)).toMatchObject({ status: 'completed' });
    // Call 0 tried bed 5 (obstructed) and bed 9 (occupied); the next sleep tries bed 9 first, bed 5 last.
    expect(triedAt(bot, 2)).toEqual(new Vec3(9, 64, 0));
  });

  it('keeps a refused bed last just inside ten minutes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-15T20:00:00Z'));
    const bot = await refuseFirstBed();
    vi.setSystemTime(Date.now() + REFUSAL_MEMORY_MS - 1);
    const outcome = sleep(bot);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await outcome).toMatchObject({ status: 'completed' });
    expect(triedAt(bot, 2)).toEqual(new Vec3(9, 64, 0));
  });

  it('tries a refused bed again once ten minutes have passed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-15T20:00:00Z'));
    const bot = await refuseFirstBed();
    vi.setSystemTime(Date.now() + REFUSAL_MEMORY_MS);
    const outcome = sleep(bot);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await outcome).toMatchObject({ status: 'completed' });
    expect(triedAt(bot, 2)).toEqual(new Vec3(5, 64, 0));
  });

  it('a refusal is kept for its own Body only: another Body still tries the bed first', async () => {
    await refuseFirstBed();
    const other = fakeBot({
      timeOfDay: 13_000,
      blocks: [
        ...bed('white_bed', 5),
        ...bed('white_bed', 9).map((b) => ({ ...b, occupied: true })),
      ],
    });
    expect(await sleep(other)).toMatchObject({ status: 'completed' });
    expect(triedAt(other, 0)).toEqual(new Vec3(5, 64, 0));
  });

  it('a walk past the per-bed cap is cut at 7 s and the next bed is tried', async () => {
    vi.useFakeTimers();
    const bot = fakeBot({
      timeOfDay: 13_000,
      blocks: [...bed('white_bed', 5), ...bed('white_bed', 9)],
    });
    vi.mocked(moveNear).mockImplementationOnce(walkUntilAborted as never);
    const outcome = sleep(bot, 1);
    await vi.advanceTimersByTimeAsync(6_999);
    expect(vi.mocked(moveNear).mock.calls[0]?.[3].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1_001);
    expect(vi.mocked(moveNear).mock.calls[0]?.[3].signal.aborted).toBe(true);
    expect(await outcome).toMatchObject({ status: 'completed' });
    expect(triedAt(bot, 0)).toEqual(new Vec3(9, 64, 0));
  });

  it('a cancel from the Mind during a capped walk still reports cancelled, not a time limit', async () => {
    vi.useFakeTimers();
    const bot = fakeBot({
      timeOfDay: 13_000,
      blocks: [...bed('white_bed', 5), ...bed('white_bed', 9)],
    });
    vi.mocked(moveNear).mockImplementationOnce(walkUntilAborted as never);
    const controller = new AbortController();
    const outcome = sleep(bot, 1, controller.signal);
    await vi.advanceTimersByTimeAsync(1_000);
    controller.abort();
    expect(await outcome).toMatchObject({ status: 'cancelled' });
    expect(bot.sleep).not.toHaveBeenCalled();
  });
});

describe('sleep: the walk cap scales with the distance, and a no-path bed is remembered (decision 0341)', () => {
  it('a lone free bed 28 blocks away is reached: a walk that arrives at 10 s is not cut at 7 s', async () => {
    vi.useFakeTimers();
    const bot = fakeBot({ timeOfDay: 13_000, blocks: bed('white_bed', 28) });
    vi.mocked(moveNear).mockImplementationOnce(arrivesAfter(10_000) as never);
    const outcome = sleep(bot, 1);
    await vi.advanceTimersByTimeAsync(11_000);
    expect(await outcome).toMatchObject({ status: 'completed' });
    expect(triedAt(bot, 0)).toEqual(new Vec3(28, 64, 0));
  });

  it('when every bed walk is cut, the search is a timeout and its text keeps the cut reason', async () => {
    vi.useFakeTimers();
    const bot = fakeBot({
      timeOfDay: 13_000,
      blocks: [...bed('white_bed', 5), ...bed('white_bed', 9)],
    });
    vi.mocked(moveNear)
      .mockImplementationOnce(walkUntilAborted as never)
      .mockImplementationOnce(walkUntilAborted as never);
    const outcome = sleep(bot, 1);
    await vi.advanceTimersByTimeAsync(14_500);
    expect(await outcome).toMatchObject({
      status: 'failed',
      reason: 'timeout',
      message: expect.stringContaining(
        'tried 2 nearby beds, every walk timed out; last: the walk to the bed took too long',
      ),
    });
    expect(bot.sleep).not.toHaveBeenCalled();
  });

  it('a bed refused with no path ranks last for the same Body on the next sleep', async () => {
    const bot = fakeBot({
      timeOfDay: 13_000,
      blocks: [...bed('white_bed', 5), ...bed('white_bed', 9)],
      sleepErrors: ['the bed is occupied'],
    });
    vi.mocked(moveNear).mockResolvedValueOnce({
      ok: false,
      reason: 'blocked',
      message: NO_PATH_TEXT,
    } as never);
    expect(await sleep(bot)).toMatchObject({ status: 'failed' });
    expect(triedAt(bot, 0)).toEqual(new Vec3(9, 64, 0));
    expect(await sleep(bot)).toMatchObject({ status: 'completed' });
    expect(triedAt(bot, 1)).toEqual(new Vec3(9, 64, 0));
  });

  it('one bed cut by its walk cap, the other occupied: the search ends blocked, not timeout (decision 0341)', async () => {
    vi.useFakeTimers();
    const bot = fakeBot({
      timeOfDay: 13_000,
      blocks: [
        ...bed('white_bed', 5),
        ...bed('white_bed', 9).map((b) => ({ ...b, occupied: true })),
      ],
      sleepErrors: ['the bed is occupied'],
    });
    vi.mocked(moveNear).mockImplementationOnce(walkUntilAborted as never);
    const outcome = sleep(bot, 1);
    await vi.advanceTimersByTimeAsync(7_001);
    expect(await outcome).toMatchObject({
      status: 'failed',
      reason: 'blocked',
      message: expect.stringContaining('tried 2 nearby beds, all occupied or blocked'),
    });
    // Only the bed past its cap was cut; the occupied bed was reached and refused, so the bot slept in neither.
    expect(bot.sleep).toHaveBeenCalledTimes(1);
  });

  it('a refusal through the other half is remembered for the whole bed: the next sleep ranks it last', async () => {
    const bot = fakeBot({
      timeOfDay: 13_000,
      blocks: [
        ...bed('white_bed', 5),
        ...bed('white_bed', 9).map((b) => ({ ...b, occupied: true })),
      ],
      sleepErrors: ['You are too far away', 'the bed is obstructed', 'the bed is occupied'],
    });
    expect(await sleep(bot)).toMatchObject({ status: 'failed', reason: 'blocked' });
    // Out of reach from the first half, so the other half (x=6) was tried and refused as obstructed.
    expect(triedAt(bot, 1)).toEqual(new Vec3(6, 64, 0));
    // Both halves are one bed: the next sleep tries bed 9 first and the refused bed last, not the half at x=5 first.
    expect(await sleep(bot)).toMatchObject({ status: 'completed' });
    expect(triedAt(bot, 3)).toEqual(new Vec3(9, 64, 0));
  });
});
