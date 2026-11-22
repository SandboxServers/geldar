import { Vec3 } from 'vec3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { type DigSafetyInput, digSafetyRefusal } from './dig-safety.ts';
import { block, type FakeBlock, fakeBot, GRAVEL, mine, OAK_LOG, STONE } from './mine.fakes.ts';
import { moveNear } from './pathing.ts';

vi.mock('./pathing.ts', () => ({ moveNear: vi.fn(), ensurePathfinder: vi.fn() }));

/** The four horizontal sides of a cell, as [dx, dz]. */
const SIDES: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
/** The four diagonal neighbours of a cell, as [dx, dz]. */
const DIAGONALS: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
/** Body feet positions the geometry tests stand the Body at. */
const BODIES: readonly Vec3[] = [new Vec3(0, 64, 0), new Vec3(10, 70, -4), new Vec3(-7, 40, 12)];

/** A bot whose feet are at `feet`, with `blocks` in the world. */
function bodyAt(feet: Vec3, blocks: FakeBlock[]) {
  const bot = fakeBot(blocks);
  bot.entity.position = feet;
  return bot;
}

/** A stone at `at` with gravel directly above it. */
function stoneUnderGravel(at: Vec3): FakeBlock[] {
  return [
    block(STONE, at, [], { 270: true }, 'stone'),
    block(GRAVEL, at.offset(0, 1, 0), [], undefined, 'gravel'),
  ];
}

/**
 * Oak walls on the four sides of the feet cell (y 64) and of the head cell (y 65). A side named
 * in `openFeet` or `openHead` is air instead, which a drop falls through.
 */
function pit(
  openFeet: readonly [number, number] | null,
  openHead: readonly [number, number] | null,
): FakeBlock[] {
  const cells: FakeBlock[] = [];
  for (const [y, open] of [
    [64, openFeet],
    [65, openHead],
  ] as const) {
    for (const [dx, dz] of SIDES) {
      const at = new Vec3(dx, y, dz);
      if (open && open[0] === dx && open[1] === dz) {
        cells.push({ ...block(0, at, []), boundingBox: 'empty' as const });
      } else {
        cells.push(block(OAK_LOG, at, [OAK_LOG], undefined, 'oak_log'));
      }
    }
  }
  return cells;
}

describe('mine: the falling block above the stone is refused, by where the Body stands', () => {
  beforeEach(() => {
    vi.mocked(moveNear).mockReset();
    vi.mocked(moveNear).mockResolvedValue({ ok: true, distance: 0 });
  });

  const beside = BODIES.flatMap((feet) =>
    [...SIDES, ...DIAGONALS].map(([dx, dz]) => [feet, dx, dz] as const),
  );
  it.each(beside)(
    'digs a stone beside the Body under gravel, decision 0428 (feet %o, offset %i,%i)',
    async (feet, dx, dz) => {
      const bot = bodyAt(feet, stoneUnderGravel(feet.offset(dx, 0, dz)));
      expect(await mine(bot, 1, 'stone')).toMatchObject({ status: 'completed' });
      expect(bot.dig).toHaveBeenCalledTimes(1);
    },
  );

  // The Body is two cells away on one axis: outside the one-cell column reach, on each sign.
  const far = BODIES.flatMap((feet) => SIDES.map(([dx, dz]) => [feet, dx * 2, dz * 2] as const));
  it.each(far)(
    'digs a stone two cells from the Body (feet %o, offset %i,%i)',
    async (feet, dx, dz) => {
      const bot = bodyAt(feet, stoneUnderGravel(feet.offset(dx, 0, dz)));
      expect(await mine(bot, 1, 'stone')).toMatchObject({ status: 'completed' });
      expect(bot.dig).toHaveBeenCalledTimes(1);
    },
  );

  // Head at the stone's level + 3 is refused; + 4 is not. The Body below the column is refused too.
  it.each([[new Vec3(0, 62, 0)], [new Vec3(0, 63, 0)], [new Vec3(0, 50, 0)]] as const)(
    'digs the stone whatever the height of the Body (feet %o), decision 0428',
    async (feet) => {
      const bot = bodyAt(feet, stoneUnderGravel(new Vec3(1, 60, 0)));
      expect(await mine(bot, 1, 'stone')).toMatchObject({ status: 'completed' });
      expect(bot.dig).toHaveBeenCalledTimes(1);
    },
  );

  it('digs at the height bound from a Body in another place, and one cell above it', async () => {
    const feet = new Vec3(10, 70, -4);
    const at = new Vec3(11, 67, -4);
    const atBound = bodyAt(new Vec3(10, 69, -4), stoneUnderGravel(at));
    expect(await mine(atBound, 1, 'stone')).toMatchObject({ status: 'completed' });
    const aboveBound = bodyAt(feet.offset(0, 0, 0), stoneUnderGravel(at));
    expect(await mine(aboveBound, 1, 'stone')).toMatchObject({ status: 'completed' });
  });
});

describe('mine: a 2-high gravel bank beside the Body', () => {
  beforeEach(() => {
    vi.mocked(moveNear).mockReset();
    vi.mocked(moveNear).mockResolvedValue({ ok: true, distance: 0 });
  });

  it.each([
    ['bottom first', 0],
    ['top first', 1],
  ])(
    'digs the nearest of two stacked gravel blocks, whichever is listed first (%s)',
    async (_order, which) => {
      const bottom = block(GRAVEL, new Vec3(1, 64, 0), [], undefined, 'gravel');
      const top = block(GRAVEL, new Vec3(1, 65, 0), [], undefined, 'gravel');
      const bot = which === 0 ? fakeBot([bottom, top]) : fakeBot([top, bottom]);
      expect(await mine(bot, 1, 'gravel')).toMatchObject({
        status: 'completed',
        detail: { mined: 1 },
      });
      expect(bot.dig).toHaveBeenCalledTimes(1);
      // The fake lists the candidates in order: the first one listed is the nearest, and is dug.
      expect(bot.dig.mock.calls[0]?.[0]).toBe(which === 0 ? bottom : top);
    },
  );
});

describe('mine: walled-in check for a falling block being dug', () => {
  beforeEach(() => {
    vi.mocked(moveNear).mockReset();
    vi.mocked(moveNear).mockResolvedValue({ ok: true, distance: 0 });
  });

  it.each(SIDES)('digs gravel when the feet have one open side (%i,%i)', async (dx, dz) => {
    const gravel = block(GRAVEL, new Vec3(2, 64, 0), [], undefined, 'gravel');
    const bot = fakeBot([...pit([dx, dz], null), gravel]);
    expect(await mine(bot, 1, 'gravel')).toMatchObject({ status: 'completed' });
  });

  it.each(SIDES)('digs gravel when the head has one open side (%i,%i)', async (dx, dz) => {
    const gravel = block(GRAVEL, new Vec3(2, 64, 0), [], undefined, 'gravel');
    const bot = fakeBot([...pit(null, [dx, dz]), gravel]);
    expect(await mine(bot, 1, 'gravel')).toMatchObject({ status: 'completed' });
  });

  it('digs gravel when the feet are walled and the head is open on every side', async () => {
    const gravel = block(GRAVEL, new Vec3(2, 64, 0), [], undefined, 'gravel');
    const bot = fakeBot([...pit(null, null).slice(0, 4), gravel]);
    expect(await mine(bot, 1, 'gravel')).toMatchObject({ status: 'completed' });
  });

  it('digs gravel when feet and head are walled on all four sides, decision 0428', async () => {
    const gravel = block(GRAVEL, new Vec3(2, 64, 0), [], undefined, 'gravel');
    const bot = fakeBot([...pit(null, null), gravel]);
    expect(await mine(bot, 1, 'gravel')).toMatchObject({ status: 'completed' });
    expect(bot.dig).toHaveBeenCalledTimes(1);
  });
});

describe('mine: a pointed dripstone above the stone', () => {
  beforeEach(() => {
    vi.mocked(moveNear).mockReset();
    vi.mocked(moveNear).mockResolvedValue({ ok: true, distance: 0 });
  });

  function dripstone(at: Vec3, vertical: string): FakeBlock {
    return Object.assign(block(999, at, [], undefined, 'pointed_dripstone'), {
      getProperties: () => ({ vertical_direction: vertical }),
    });
  }

  it('digs a stone under a stalagmite (tip up) beside the Body', async () => {
    const stone = block(STONE, new Vec3(1, 64, 0), [], { 270: true }, 'stone');
    const bot = fakeBot([stone, dripstone(new Vec3(1, 65, 0), 'up')]);
    expect(await mine(bot, 1, 'stone')).toMatchObject({ status: 'completed' });
    expect(bot.dig).toHaveBeenCalledTimes(1);
  });

  it('digs a stone under a hanging stalactite (tip down) beside the Body, decision 0428', async () => {
    const stone = block(STONE, new Vec3(1, 64, 0), [], { 270: true }, 'stone');
    const bot = fakeBot([stone, dripstone(new Vec3(1, 65, 0), 'down')]);
    expect(await mine(bot, 1, 'stone')).toMatchObject({ status: 'completed' });
    expect(bot.dig).toHaveBeenCalledTimes(1);
  });

  it('does not count a stalagmite as a falling block in the shared hazard check', () => {
    const stone = block(STONE, new Vec3(1, 64, 0), [], { 270: true }, 'stone');
    const bot = fakeBot([stone, dripstone(new Vec3(1, 65, 0), 'up')]);
    const hazard = (cell: Vec3) =>
      digSafetyRefusal({
        bot: bot as unknown as DigSafetyInput['bot'],
        block: stone as unknown as DigSafetyInput['block'],
        at: cell,
        own: [new Vec3(0, 64, 0), new Vec3(0, 65, 0)],
      });
    expect(hazard(new Vec3(1, 64, 0))).toBeNull();
  });
});
