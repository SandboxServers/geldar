import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import type { Block } from '../actions/bot-types.ts';
import { noSafeExit } from './view.ts';

const stone = { name: 'stone', boundingBox: 'block' } as Block;
const air = { name: 'air', boundingBox: 'empty' } as Block;

/** Ground of stone at y <= 59, air above, `cells` overrides, `unknown` cells are not loaded. */
function world(cells: Record<string, Block>, unknown: string[] = []) {
  return (at: Vec3): Block | undefined => {
    const key = `${at.x},${at.y},${at.z}`;
    if (unknown.includes(key)) return undefined;
    if (key in cells) return cells[key];
    return at.y <= 59 ? stone : air;
  };
}

/** A one-block-wide pillar of stone from y 60 to y 69 at x 0, z 0: the Body stands on its top at y 70. */
function pillar(height = 10): Record<string, Block> {
  const cells: Record<string, Block> = {};
  for (let y = 60; y < 60 + height; y++) cells[`0,${y},0`] = stone;
  return cells;
}

const feet = new Vec3(0, 70, 0);

describe('noSafeExit (decision 0333)', () => {
  it('is true on a pillar top whose drop is 10 blocks on every side at full health', () => {
    expect(noSafeExit(world(pillar()), feet, 20)).toBe(true);
  });

  it('is false when one side has a 2-block step onto solid ground', () => {
    const cells = { ...pillar(), '1,68,0': stone };
    expect(noSafeExit(world(cells), feet, 20)).toBe(false);
  });

  it('is null when a cell the planner reads is not loaded (an unread cell is never a dead end)', () => {
    expect(noSafeExit(world(pillar(), ['-1,69,0']), feet, 20)).toBeNull();
  });

  it('is null when health is unknown', () => {
    expect(noSafeExit(world(pillar()), feet, undefined)).toBeNull();
  });

  it('is false on open ground with moves available', () => {
    expect(noSafeExit(world({}), new Vec3(0, 60, 0), 20)).toBe(false);
  });
});
