import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import {
  allowedKeys,
  cardinalOfYaw,
  clickedProperties,
  pitchFor,
  planPlaceState,
  stateMatches,
  yawForFacing,
} from './place-state.ts';

const UP = new Vec3(0, 1, 0);
const DOWN = new Vec3(0, -1, 0);
const EAST = new Vec3(1, 0, 0);
const WEST = new Vec3(-1, 0, 0);
const SOUTH = new Vec3(0, 0, 1);

describe('place state: tiers', () => {
  it('gives logs an axis, stairs a facing and half, slabs a half only', () => {
    expect(allowedKeys('oak_log')).toEqual(['axis']);
    expect(allowedKeys('stone')).toEqual([]);
    expect(allowedKeys('oak_stairs')).toEqual(['facing', 'half']);
    expect(allowedKeys('oak_slab')).toEqual(['half']);
    expect(allowedKeys('furnace')).toEqual(['facing']);
  });

  it('refuses a state the block does not take', () => {
    expect(planPlaceState('stone', { axis: 'x' }, [EAST])).toBeNull();
    expect(planPlaceState('oak_log', { facing: 'north' }, [EAST])).toBeNull();
  });
});

describe('place state: log axis', () => {
  it('places a log along x by clicking an x face', () => {
    const plan = planPlaceState('oak_log', { axis: 'x' }, [UP, EAST, SOUTH]);
    expect(plan?.reference).toEqual(EAST);
  });

  it('places a log along y by clicking a top face', () => {
    expect(planPlaceState('oak_log', { axis: 'y' }, [EAST, UP])?.reference).toEqual(UP);
  });

  it('is unachievable with only y references and an x axis', () => {
    expect(planPlaceState('oak_log', { axis: 'x' }, [UP, DOWN])).toBeNull();
  });
});

describe('place state: stair facing and half', () => {
  it('faces a stair back toward the bot, which looks the other way', () => {
    const plan = planPlaceState('oak_stairs', { facing: 'south', half: 'top' }, [UP]);
    expect(plan).not.toBeNull();
    // The stair faces south, so the bot looks north: yaw pi looks at -z.
    expect(cardinalOfYaw(plan?.yaw ?? 0)).toBe('north');
    expect(Math.cos(plan?.yaw ?? 0)).toBeCloseTo(-1);
    expect(
      stateMatches(
        'oak_stairs',
        { facing: 'south', half: 'top' },
        clickedProperties('oak_stairs', UP, plan?.yaw ?? 0, plan?.cursorY ?? 0),
      ),
    ).toBe(true);
  });

  it('takes the top half from a block above it, and the bottom half from one below', () => {
    expect(planPlaceState('oak_stairs', { half: 'top' }, [DOWN, UP])?.reference).toEqual(UP);
    expect(planPlaceState('oak_stairs', { half: 'bottom' }, [UP, DOWN])?.reference).toEqual(DOWN);
  });

  it('is unachievable for a bottom stair with only a block above', () => {
    expect(planPlaceState('oak_stairs', { half: 'bottom' }, [UP])).toBeNull();
  });
});

describe('place state: slab half', () => {
  it('places a top slab from a side reference with the cursor in the top half', () => {
    const plan = planPlaceState('oak_slab', { half: 'top' }, [EAST]);
    expect(plan?.reference).toEqual(EAST);
    expect(plan?.cursorY).toBeGreaterThan(0.5);
    expect(clickedProperties('oak_slab', EAST, 0, plan?.cursorY ?? 0)).toEqual({ type: 'top' });
  });

  it('places a bottom slab from a side reference with the cursor in the bottom half', () => {
    const plan = planPlaceState('oak_slab', { half: 'bottom' }, [WEST]);
    expect(plan?.cursorY).toBeLessThan(0.5);
    expect(clickedProperties('oak_slab', WEST, 0, plan?.cursorY ?? 1)).toEqual({ type: 'bottom' });
  });

  it('is unachievable for a top slab with only a block below it', () => {
    expect(planPlaceState('oak_slab', { half: 'top' }, [DOWN])).toBeNull();
  });
});

describe('place state: yaw and pitch', () => {
  it('turns the bot to face each cardinal, one at a time', () => {
    for (const facing of ['north', 'south', 'east', 'west'] as const) {
      const yaw = yawForFacing(facing);
      const lookedAt = cardinalOfYaw(yaw);
      // The bot looks the opposite way to the facing it places.
      const opposite = { north: 'south', south: 'north', east: 'west', west: 'east' }[facing];
      expect(lookedAt).toBe(opposite);
    }
  });

  it('looks up at a cell above, down at one below, and level beside', () => {
    expect(pitchFor(UP)).toBeCloseTo(-Math.PI / 2);
    expect(pitchFor(DOWN)).toBeCloseTo(Math.PI / 2);
    expect(pitchFor(EAST)).toBe(0);
  });
});
