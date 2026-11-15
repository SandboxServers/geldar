import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import type { Block } from '../actions/bot-types.ts';
import { planMoves } from '../actions/unstick-plan.ts';
import { cellKey, FEET, ledge } from './ledge.fakes.ts';
import { FALL_STOP_DROP } from './reflexes/fall-stop.ts';
import { noSafeExit } from './view.ts';

/**
 * The ledge of ledge.fakes.ts with a pool at the bottom of its east column: water at the landing cell
 * (x = 1, `drop` blocks down) on a solid floor one block lower. fall_stop does not stop a fall into water.
 */
function waterLedge(drop: number): (at: Vec3) => Block | null {
  const base = ledge(drop);
  const pool = cellKey(1, 63 - drop, 0);
  const floor = cellKey(1, 62 - drop, 0);
  return (at) => {
    const key = cellKey(at.x, at.y, at.z);
    if (key === pool) return { name: 'water', boundingBox: 'empty' } as Block;
    if (key === floor) return { name: 'stone', boundingBox: 'block' } as Block;
    return base(at);
  };
}

describe('noSafeExit uses the fall_stop drop cap (decision 0333)', () => {
  it.each([5, 6])(
    'a %i block drop into water at health 18.5 is an exit: noSafeExit false',
    (drop) => {
      expect(noSafeExit(waterLedge(drop), FEET, 18.5)).toBe(false);
    },
  );

  it.each([5, 6])('the capped planner keeps the %i block water landing as a walk-off', (drop) => {
    expect(planMoves(waterLedge(drop), FEET, 18.5, FALL_STOP_DROP)).toEqual([
      { dir: new Vec3(1, 0, 0), jump: false, drop },
    ]);
  });

  it('a 7 block drop into water is past MAX_DROP and stays no exit', () => {
    expect(noSafeExit(waterLedge(7), FEET, 18.5)).toBe(true);
  });

  it('a 6 block drop at health 18.5 is not an exit fall_stop allows: noSafeExit true', () => {
    expect(noSafeExit(ledge(6), FEET, 18.5)).toBe(true);
  });

  it('a 5 block drop at health 18.5 is not an exit either', () => {
    expect(noSafeExit(ledge(5), FEET, 18.5)).toBe(true);
  });

  it.each([3, 4])('a %i block drop at health 18.5 remains an exit: noSafeExit false', (drop) => {
    expect(noSafeExit(ledge(drop), FEET, 18.5)).toBe(false);
  });

  it('a 4 block drop is not an exit at health 9 (no health for the fall)', () => {
    expect(noSafeExit(ledge(4), FEET, 9)).toBe(true);
  });

  it('the capped planner refuses the 6 block drop and keeps the 4 block one', () => {
    expect(planMoves(ledge(6), FEET, 18.5, FALL_STOP_DROP)).toEqual([]);
    expect(planMoves(ledge(4), FEET, 18.5, FALL_STOP_DROP)).toEqual([
      { dir: new Vec3(1, 0, 0), jump: false, drop: 4 },
    ]);
  });

  it('without a cap the planner still offers the 6 block drop (the default is the planner limit)', () => {
    expect(planMoves(ledge(6), FEET, 18.5)).toEqual([
      { dir: new Vec3(1, 0, 0), jump: false, drop: 6 },
    ]);
  });
});
