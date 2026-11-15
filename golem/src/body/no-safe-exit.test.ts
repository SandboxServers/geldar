import { Vec3 } from 'vec3';
import { describe, expect, it } from 'vitest';
import { planMoves } from '../actions/unstick-plan.ts';
import { FEET, ledge } from './ledge.fakes.ts';
import { FALL_STOP_DROP } from './reflexes/fall-stop.ts';
import { noSafeExit } from './view.ts';

describe('noSafeExit uses the fall_stop drop cap (decision 0333)', () => {
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
