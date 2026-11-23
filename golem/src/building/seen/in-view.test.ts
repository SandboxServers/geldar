import { describe, expect, it } from 'vitest';
import type { ViewPose, ViewWorld } from '../../perception/view/viewport.ts';
import { cellInView, recordIfInView } from './recorder.ts';
import { SeenMap } from './section.ts';

/** A view world with `solid` cells opaque, `unknown` cells not loaded, the rest air. */
function world(solid: string[] = [], unknown: string[] = [], dark = false): ViewWorld {
  return {
    dark,
    block: (x, y, z) => {
      const key = `${x},${y},${z}`;
      const kind = unknown.includes(key) ? 'unknown' : solid.includes(key) ? 'solid' : 'air';
      return { kind } as ReturnType<ViewWorld['block']>;
    },
  } as ViewWorld;
}

// The eyes at (0.5, 64.5, 0.5) facing yaw 0, pitch 0: the view runs toward -z.
const pose: ViewPose = { x: 0.5, y: 64.5, z: 0.5, yaw: 0, pitch: 0 } as ViewPose;

describe('cellInView (review fix 3: no wall-hack for a changed cell)', () => {
  it('a cell in front with clear line of sight is in view', () => {
    expect(cellInView(world(), pose, 0, 64, -5)).toBe(true);
  });

  it('a cell behind an opaque block is not in view, so a change there is not recorded', () => {
    expect(cellInView(world(['0,64,-3']), pose, 0, 64, -5)).toBe(false);
  });

  it('a solid target with clear sight to it is in view (the first opaque block is seen)', () => {
    expect(cellInView(world(['0,64,-5']), pose, 0, 64, -5)).toBe(true);
  });

  it('a cell behind the eyes or far to the side of the cone is not in view', () => {
    expect(cellInView(world(), pose, 0, 64, 3)).toBe(false);
    expect(cellInView(world(), pose, -10, 64, -1)).toBe(false);
  });

  it('a cell beyond the view range is not in view; in the dark the range is shorter', () => {
    expect(cellInView(world(), pose, 0, 64, -30)).toBe(false);
    expect(cellInView(world([], [], true), pose, 0, 64, -10)).toBe(false);
    expect(cellInView(world([], [], true), pose, 0, 64, -5)).toBe(true);
  });

  it('an unloaded cell on the line of sight ends the sight: the target is not in view', () => {
    expect(cellInView(world([], ['0,64,-3']), pose, 0, 64, -5)).toBe(false);
  });
});

describe('recordIfInView (decision 0424, 2026-11-22 addendum: an out-of-view read never enters the map)', () => {
  it('an out-of-view verified read of an unseen cell does not enter the map', () => {
    const map = new SeenMap();
    const recorded = recordIfInView(
      map,
      world(['0,64,-3']),
      pose,
      0,
      64,
      -5,
      'minecraft:diamond_ore',
      7,
    );
    expect(recorded).toBe(false);
    expect(map.read(0, 64, -5)).toBeUndefined();
  });

  it('an out-of-view read leaves a seen cell as the Body last saw it', () => {
    const map = new SeenMap();
    map.record(0, 64, -5, 'minecraft:stone', 1);
    recordIfInView(map, world(['0,64,-3']), pose, 0, 64, -5, 'minecraft:air', 9);
    expect(map.read(0, 64, -5)).toEqual({ name: 'minecraft:stone', lastSeen: 1, inherited: false });
  });

  it('an in-view read is recorded with its tick', () => {
    const map = new SeenMap();
    expect(recordIfInView(map, world(), pose, 0, 64, -5, 'minecraft:stone', 7)).toBe(true);
    expect(map.read(0, 64, -5)).toEqual({ name: 'minecraft:stone', lastSeen: 7, inherited: false });
  });
});
