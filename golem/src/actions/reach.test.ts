import { describe, expect, it, vi } from 'vitest';
import { RememberedBlocks } from '../perception/remembered.ts';
import {
  type Cell,
  REACH_NODE_CAP,
  type ReachInput,
  type ReachPlanner,
  reachTarget,
} from './reach.ts';

const FROM: Cell = { x: 0, y: 64, z: 0 };
const CHEST: Cell = { x: 0, y: 64, z: 3 };

/** A memory that has seen a chest at each given cell. */
function memoryWith(cells: Cell[]): RememberedBlocks {
  const memory = new RememberedBlocks();
  for (const cell of cells) memory.remember({ type: 'chest', ...cell });
  return memory;
}

function inputFor(plan: ReachPlanner, memory: RememberedBlocks, heldName?: string): ReachInput {
  return { from: FROM, heldName, memory, plan };
}

const ok = (visited = 10) => ({ status: 'success', visited });
const noPath = { status: 'noPath', visited: 10 };

describe('reachTarget', () => {
  it('answers in_hand for a held block of the target kind, without planning', () => {
    const plan = vi.fn(() => ok());
    const answer = reachTarget(inputFor(plan, memoryWith([CHEST]), 'chest'), CHEST);
    expect(answer).toEqual({ outcome: 'in_hand' });
    expect(plan).not.toHaveBeenCalled();
  });

  it('answers walk with the steps along x and z, on all four axis signs', () => {
    const cases: Array<[Cell, number]> = [
      [{ x: 5, y: 64, z: 0 }, 5],
      [{ x: -5, y: 64, z: 0 }, 5],
      [{ x: 0, y: 64, z: 5 }, 5],
      [{ x: 0, y: 64, z: -5 }, 5],
      [{ x: 3, y: 64, z: -4 }, 7],
    ];
    for (const [target, steps] of cases) {
      const plan = vi.fn(() => ok());
      const answer = reachTarget(inputFor(plan, memoryWith([target])), target);
      expect(answer).toEqual({ outcome: 'walk', steps });
    }
  });

  it('answers needs_digging when only the digging plan reaches the target', () => {
    const plan = (_t: Cell, canDig: boolean) => (canDig ? ok() : noPath);
    expect(reachTarget(inputFor(plan, memoryWith([CHEST])), CHEST)).toEqual({
      outcome: 'needs_digging',
    });
  });

  it('answers blocked when even the digging plan finds no route', () => {
    const plan = () => ({ status: 'partially', visited: 10 });
    expect(reachTarget(inputFor(plan, memoryWith([CHEST])), CHEST)).toEqual({
      outcome: 'blocked',
    });
  });

  it('answers unknown for a target never seen, without planning', () => {
    const plan = vi.fn(() => ok());
    const answer = reachTarget(inputFor(plan, memoryWith([])), CHEST);
    expect(answer).toEqual({ outcome: 'unknown' });
    expect(plan).not.toHaveBeenCalled();
  });

  it('gives a hidden but real target the same answer as an unseen one', () => {
    const hidden = reachTarget(
      inputFor(() => ok(), memoryWith([])),
      CHEST,
    );
    const unseen = reachTarget(
      inputFor(() => ok(), memoryWith([{ x: 9, y: 64, z: 9 }])),
      CHEST,
    );
    expect(hidden).toEqual(unseen);
  });

  it('keeps the last allowed walk at exactly the node cap', () => {
    const plan = () => ok(REACH_NODE_CAP);
    expect(reachTarget(inputFor(plan, memoryWith([CHEST])), CHEST)).toEqual({
      outcome: 'walk',
      steps: 3,
    });
  });

  it('answers unknown when the walk search goes over the node cap', () => {
    const plan = () => ok(REACH_NODE_CAP + 1);
    expect(reachTarget(inputFor(plan, memoryWith([CHEST])), CHEST)).toEqual({
      outcome: 'unknown',
    });
  });

  it('answers unknown when the digging search goes over the node cap', () => {
    const plan = (_t: Cell, canDig: boolean) =>
      canDig ? { status: 'success', visited: REACH_NODE_CAP + 1 } : noPath;
    expect(reachTarget(inputFor(plan, memoryWith([CHEST])), CHEST)).toEqual({
      outcome: 'unknown',
    });
  });

  it('answers unknown on a planner timeout, for either search', () => {
    const plan = () => ({ status: 'timeout', visited: 1 });
    expect(reachTarget(inputFor(plan, memoryWith([CHEST])), CHEST)).toEqual({
      outcome: 'unknown',
    });
  });

  it('answers unknown and does not throw when the planner throws', () => {
    const plan = (): never => {
      throw new Error('planner broke');
    };
    expect(() => reachTarget(inputFor(plan, memoryWith([CHEST])), CHEST)).not.toThrow();
    expect(reachTarget(inputFor(plan, memoryWith([CHEST])), CHEST)).toEqual({
      outcome: 'unknown',
    });
  });

  it('leaves no timer behind, since the search is synchronous', () => {
    vi.useFakeTimers();
    try {
      reachTarget(
        inputFor(() => ok(), memoryWith([CHEST])),
        CHEST,
      );
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
