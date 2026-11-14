import { describe, expect, it } from 'vitest';
import { dryGoal } from './path-rules.ts';

const node = (x: number, y = 64, z = 0) => ({ x, y, z });

/** A stand-in near goal: any node within one block of x 0 on the z 0 line ends the walk. */
function nearGoal() {
  return {
    isEnd: (n: { x: number; y: number; z: number }) => Math.abs(n.x) <= 1 && n.z === 0,
    heuristic: () => 7,
  };
}

describe('dryGoal', () => {
  it('does not end the walk on a water node, and still ends on the dry node beside it', () => {
    const wet = (x: number) => x === 1;
    const goal = dryGoal(nearGoal(), (x, y, z) => wet(x) && y === 64 && z === 0);
    expect(goal.isEnd(node(1))).toBe(false);
    expect(goal.isEnd(node(0))).toBe(true);
    expect(goal.isEnd(node(-1))).toBe(true);
  });

  it('keeps the goal methods of the wrapped goal', () => {
    const goal = dryGoal(nearGoal(), () => false);
    expect(goal.heuristic()).toBe(7);
  });
});
