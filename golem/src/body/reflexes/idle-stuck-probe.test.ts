import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import type { Block } from '../../actions/bot-types.ts';
import { WATCH_REACH, watchProbe } from './idle-stuck-probe.ts';
import { GridWorld } from './reflexes.fakes.ts';

/** A stone floor at y 63 under open ground, wide enough that a 40-cell walk never meets its edge. */
function openGround(): GridWorld {
  const world = new GridWorld();
  world.fill(new Vec3(-60, 63, -60), new Vec3(60, 63, 60), 'stone');
  return world;
}

/** The open ground with a 3x3 air room at the origin, walled, roofed and floored in stone. */
function pocketWorld(): GridWorld {
  const world = openGround();
  world.fill(new Vec3(-2, 64, -2), new Vec3(2, 66, 2), 'stone');
  world.fill(new Vec3(-1, 64, -1), new Vec3(1, 65, 1), null);
  return world;
}

function reader(world: GridWorld): (at: Vec3) => Block {
  return (at) => world.blockAt(at) as unknown as Block;
}

const FEET = { x: 0, y: 64, z: 0 };

describe('idle_stuck watch probe (decision 0333 diagnostic fields)', () => {
  it('lists the first four moves the planner offers, nearest first', () => {
    expect(watchProbe(reader(pocketWorld()), FEET, 20).moves).toEqual([
      { dx: 1, dz: 0, dy: 0, kind: 'walk', drop: 0, landing: 'stone' },
      { dx: -1, dz: 0, dy: 0, kind: 'walk', drop: 0, landing: 'stone' },
      { dx: 0, dz: 1, dy: 0, kind: 'walk', drop: 0, landing: 'stone' },
      { dx: 0, dz: -1, dy: 0, kind: 'walk', drop: 0, landing: 'stone' },
    ]);
  });

  it('counts the cells a closed pocket reaches, and finds no exit', () => {
    const probe = watchProbe(reader(pocketWorld()), FEET, 20);
    expect(probe.reach).toBe(9);
    expect(probe.reach_exit).toBe(false);
  });

  it('caps the reach at 40 cells on open ground', () => {
    expect(WATCH_REACH).toBe(40);
    expect(watchProbe(reader(openGround()), FEET, 20).reach).toBe(40);
  });

  it('reports an exit on open ground, where a cell is 12 blocks away', () => {
    expect(watchProbe(reader(openGround()), FEET, 20).reach_exit).toBe(true);
  });

  it('reports null fields when no terrain is read', () => {
    expect(watchProbe(undefined, FEET, 20)).toEqual({ moves: null, reach: null, reach_exit: null });
  });
});
