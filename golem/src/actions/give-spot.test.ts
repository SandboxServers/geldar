import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import {
  STEP_BACK_TO,
  type StepBlock,
  stepBackCells,
  stepBackPoint,
  stepBackSpots,
} from './give-spot.ts';

const RECIPIENT = new Vec3(10, 64, 10);

describe('stepBackPoint', () => {
  it('steps away along the negative x axis when the body is on the west side', () => {
    const spot = stepBackPoint(new Vec3(9.9, 64, 10), RECIPIENT);
    expect(spot?.x).toBeCloseTo(8, 6);
    expect(spot?.z).toBeCloseTo(10, 6);
  });

  it('steps away along the positive x axis when the body is on the east side', () => {
    const spot = stepBackPoint(new Vec3(10.1, 64, 10), RECIPIENT);
    expect(spot?.x).toBeCloseTo(12, 6);
    expect(spot?.z).toBeCloseTo(10, 6);
  });

  it('steps away along the negative z axis when the body is to the north', () => {
    const spot = stepBackPoint(new Vec3(10, 64, 9.9), RECIPIENT);
    expect(spot?.x).toBeCloseTo(10, 6);
    expect(spot?.z).toBeCloseTo(8, 6);
  });

  it('steps away along the positive z axis when the body is to the south', () => {
    const spot = stepBackPoint(new Vec3(10, 64, 10.1), RECIPIENT);
    expect(spot?.x).toBeCloseTo(10, 6);
    expect(spot?.z).toBeCloseTo(12, 6);
  });

  it('steps along the diagonal and lands the distance away from the recipient', () => {
    const spot = stepBackPoint(new Vec3(9.1, 64, 9.1), RECIPIENT);
    expect(spot).not.toBeNull();
    const back = Math.hypot((spot?.x ?? 0) - 10, (spot?.z ?? 0) - 10);
    expect(back).toBeCloseTo(STEP_BACK_TO, 6);
    expect(spot?.x).toBeLessThan(10);
    expect(spot?.z).toBeLessThan(10);
  });

  it('keeps the body height and the default distance of 2 blocks', () => {
    const spot = stepBackPoint(new Vec3(10.5, 65.5, 10), RECIPIENT, undefined);
    expect(spot?.y).toBe(65.5);
    expect(spot?.distanceTo(new Vec3(RECIPIENT.x, 65.5, RECIPIENT.z))).toBeCloseTo(2, 6);
  });

  it('returns null when the body stands on the recipient', () => {
    expect(stepBackPoint(new Vec3(10, 64, 10), RECIPIENT)).toBeNull();
  });
});

const SOLID: StepBlock = { name: 'stone', boundingBox: 'block' };
const AIR: StepBlock = { name: 'air', boundingBox: 'empty' };
/** A world where the cells `solid` names are solid and every other cell is air. */
const worldWhere = (solid: (cell: Vec3) => boolean) => (cell: Vec3) => (solid(cell) ? SOLID : AIR);
/** The Body stands north-east of the recipient, so the straight-back side is north-east. */
const BODY = new Vec3(10.5, 64, 9.5);

describe('stepBackCells', () => {
  it('finds a standable cell behind the recipient when every cell on the Body side is a wall', () => {
    // Only cells on the far side of the recipient (its dot with the Body direction below zero) stand.
    const behind = (c: Vec3) =>
      (c.x + 0.5 - 10) * Math.SQRT1_2 - (c.z + 0.5 - 10) * Math.SQRT1_2 < -0.5;
    const cells = stepBackCells(
      BODY,
      RECIPIENT,
      worldWhere((c) => c.y === 63 || !behind(c)),
      3,
    );
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.every((c) => behind(c))).toBe(true);
  });

  it('tries one step up when the level spots are walls', () => {
    const cells = stepBackCells(
      BODY,
      RECIPIENT,
      worldWhere((c) => c.y === 64),
      3,
    );
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.every((c) => c.y === 65)).toBe(true);
  });

  it('tries one step down when the level spots have no floor', () => {
    const cells = stepBackCells(
      BODY,
      RECIPIENT,
      worldWhere((c) => c.y <= 62),
      3,
    );
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.every((c) => c.y === 63)).toBe(true);
  });

  it('returns no cell when nothing around the recipient is standable', () => {
    expect(
      stepBackCells(
        BODY,
        RECIPIENT,
        worldWhere(() => true),
        3,
      ),
    ).toEqual([]);
  });
});

/** The Body on a shore, 4.5 blocks from the recipient: its straight-back cell is (10, 64, 11). */
const SHORE = new Vec3(10.5, 64, 14.5);

/** A lookup that reads `name(cell)` at each cell, and air where it names none. */
function blocksWhere(name: (c: Vec3) => string | null): (c: Vec3) => StepBlock | null {
  return (c) => {
    const n = name(c) ?? 'air';
    const open = n === 'air' || n === 'lava' || n === 'water';
    return { name: n, boundingBox: open ? 'empty' : 'block' } as StepBlock;
  };
}

describe('stepBackCells hazards and order', () => {
  it('rejects a lava lake one block down, though its bed is solid (the review case)', () => {
    // Lake surface at y 63 (lava), stone bed at y 62, air above: no cell may stand in the lava.
    const lake = blocksWhere((c) => (c.y === 62 ? 'stone' : c.y === 63 ? 'lava' : null));
    expect(stepBackCells(SHORE, RECIPIENT, lake, 3)).toEqual([]);
  });

  it('rejects a magma block floor, which hurts a Body that stands on it', () => {
    const magma = blocksWhere((c) => (c.y === 63 ? 'magma_block' : null));
    expect(stepBackCells(SHORE, RECIPIENT, magma, 3)).toEqual([]);
  });

  it.each(['cactus', 'campfire', 'fire', 'powder_snow'])(
    'rejects a %s floor (a hurtful floor is no place to stand)',
    (floor) => {
      const world = blocksWhere((c) => (c.y === 63 ? floor : null));
      expect(stepBackCells(SHORE, RECIPIENT, world, 3)).toEqual([]);
    },
  );

  it('rejects a hazard in the feet cell even over a solid floor', () => {
    const world = blocksWhere((c) => (c.y === 63 ? 'stone' : c.y === 64 ? 'fire' : null));
    expect(stepBackCells(SHORE, RECIPIENT, world, 3)).toEqual([]);
  });

  it('lists every level cell before any step up, so a rise never comes first', () => {
    // Stone floor at y 63 everywhere; a stone at y 64 blocks the level cells on the Body side, so
    // the cells there are reached only by a step up (standing on that stone).
    const world = blocksWhere((c) => {
      if (c.y === 63) return 'stone';
      const blocked = c.y === 64 && c.z >= 11 && Math.abs(c.x - 10) <= 1;
      return blocked ? 'stone' : null;
    });
    const cells = stepBackCells(SHORE, RECIPIENT, world, 3);
    const firstRise = cells.findIndex((c) => c.y !== 64);
    expect(firstRise).toBeGreaterThan(0);
    expect(cells.some((c) => c.y === 65)).toBe(true);
    expect(cells.slice(0, firstRise).every((c) => c.y === 64)).toBe(true);
  });
});

describe('stepBackSpots', () => {
  it('lists the straight-back spot first, then 45, 90, 135 degrees either side and 180, all 2 blocks out', () => {
    const spots = stepBackSpots(new Vec3(9.9, 64, 10), RECIPIENT);
    expect(spots).toHaveLength(8);
    const [straight, plus45, minus45, plus90, minus90, plus135, minus135, far] = spots;
    expect(plus135?.x).toBeCloseTo(10 + 2 * Math.SQRT1_2, 6);
    expect(plus135?.z).toBeCloseTo(10 - 2 * Math.SQRT1_2, 6);
    expect(minus135?.x).toBeCloseTo(10 + 2 * Math.SQRT1_2, 6);
    expect(minus135?.z).toBeCloseTo(10 + 2 * Math.SQRT1_2, 6);
    expect(far?.x).toBeCloseTo(12, 6);
    expect(far?.z).toBeCloseTo(10, 6);
    expect(straight?.x).toBeCloseTo(8, 6);
    expect(straight?.z).toBeCloseTo(10, 6);
    expect(plus45?.x).toBeCloseTo(10 - 2 * Math.SQRT1_2, 6);
    expect(plus45?.z).toBeCloseTo(10 - 2 * Math.SQRT1_2, 6);
    expect(minus45?.x).toBeCloseTo(10 - 2 * Math.SQRT1_2, 6);
    expect(minus45?.z).toBeCloseTo(10 + 2 * Math.SQRT1_2, 6);
    expect(plus90?.x).toBeCloseTo(10, 6);
    expect(plus90?.z).toBeCloseTo(8, 6);
    expect(minus90?.x).toBeCloseTo(10, 6);
    expect(minus90?.z).toBeCloseTo(12, 6);
    for (const spot of spots) {
      expect(spot.y).toBe(64);
      expect(spot.distanceTo(new Vec3(10, 64, 10))).toBeCloseTo(STEP_BACK_TO, 6);
    }
  });

  it('turns the same way from the east side, where the straight-back spot is on the positive x axis', () => {
    const [straight, , , plus90, minus90] = stepBackSpots(new Vec3(10.1, 64, 10), RECIPIENT);
    expect(straight?.x).toBeCloseTo(12, 6);
    expect(plus90?.x).toBeCloseTo(10, 6);
    expect(plus90?.z).toBeCloseTo(12, 6);
    expect(minus90?.x).toBeCloseTo(10, 6);
    expect(minus90?.z).toBeCloseTo(8, 6);
  });

  it('is empty when the body stands on the recipient', () => {
    expect(stepBackSpots(new Vec3(10, 64, 10), RECIPIENT)).toEqual([]);
  });
});
