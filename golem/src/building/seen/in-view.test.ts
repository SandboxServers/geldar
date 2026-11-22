import { describe, expect, it } from 'vitest';
import type { ViewPose, ViewWorld } from '../../perception/view/viewport.ts';
import { cellInView } from './recorder.ts';

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
