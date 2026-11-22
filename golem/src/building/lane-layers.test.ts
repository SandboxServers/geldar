import { describe, expect, it } from 'vitest';
import type { PlanCell } from './cell-do.ts';
import { arrayCellSource, type CellSource } from './cell-source.ts';
import { type LaneDeps, type LanePlan, PlanLane } from './lane.ts';

const CTX = { signal: new AbortController().signal } as never;

function cells(n: number, y = 64, x = 0): PlanCell[] {
  return Array.from({ length: n }, (_, z) => ({
    at: { x, y, z },
    prior: 'air',
    target: 'stone',
  }));
}

function planOf(id: string, source: CellSource, total: number, cursor?: number): LanePlan {
  return {
    lifeId: 'life-1',
    planId: id,
    chunks: 1,
    source,
    fresh: () => source,
    total,
    ...(cursor === undefined ? {} : { cursor }),
  };
}

/** Deps whose throttle holds the cell: a step reads the cursor's cell, then stops before any cell runs. */
const HOLD: LaneDeps = {
  env: {} as never,
  handlers: {} as never,
  now: () => 0,
  beforeCell: () => 'gap',
};

describe('plan lane: scaffold layers and resume walks (review 6)', () => {
  it('a plan started after another with the same id reads its own layer (F1)', async () => {
    const lane = new PlanLane();
    // A plan that ends by running out of cells (cursor at its total) clears no cache by itself.
    const first = planOf('p1', arrayCellSource(cells(1)), 1, 1);
    lane.start(first);
    const x0 = { x: 0, y: 64, z: 0 };
    expect(await lane.removalsFor(first, [x0])).toEqual([x0]);
    await lane.step(CTX, HOLD);
    expect(lane.snapshot()?.phase).toBe('completed');
    // Same id, other cells on y 64: the cell at x 0 is not on this plan.
    const second = planOf('p1', arrayCellSource(cells(1, 64, 5)), 1);
    lane.start(second);
    expect(await lane.removalsFor(second, [x0])).toEqual([]);
  });

  it('the layer of a plan is read in slices that yield (F3): 2001 cells yield 3 times', async () => {
    let yields = 0;
    const lane = new PlanLane(async () => {
      yields++;
    });
    const plan = planOf('p1', arrayCellSource(cells(2000)), 2000);
    lane.start(plan);
    const x0 = { x: 0, y: 64, z: 0 };
    expect(await lane.removalsFor(plan, [x0])).toEqual([x0]);
    expect(yields).toBe(3);
  });

  it('a resume from a late cursor walks the source in slices that yield (F4)', async () => {
    let yields = 0;
    const lane = new PlanLane(async () => {
      yields++;
    });
    lane.start(planOf('p1', arrayCellSource(cells(2000)), 2000, 1500));
    await lane.step(CTX, HOLD);
    // Cells 0 to 1499 are walked in slices of 512 (3 slices, 2 yields); the held cell runs nothing.
    expect(yields).toBe(2);
    expect(lane.checkpointState()?.cursor).toBe(1500);
  });

  it('a cursor past the end of the source stops the resume walk instead of spinning', async () => {
    let yields = 0;
    const lane = new PlanLane(async () => {
      // A spin would yield forever: the guard turns it into a failure.
      if (++yields > 1000) throw new Error('resume walk spins');
    });
    lane.start(planOf('p1', arrayCellSource(cells(10)), 10, 5000));
    await lane.step(CTX, HOLD);
    expect(yields).toBeLessThan(1000);
    // The source has no cell at the cursor, so the plan ends as completed.
    expect(lane.snapshot()?.phase).toBe('completed');
  });

  it('a death during the resume walk stops reading the source (abort path, F4)', async () => {
    const plain = cells(3000);
    let reads = 0;
    const counting: CellSource = {
      at: (i) => {
        reads++;
        return plain[i];
      },
    };
    let lane: PlanLane | null = null;
    lane = new PlanLane(async () => {
      // The first slice is done: the Body dies before the next one.
      void lane?.endForDeath(0);
    });
    lane.start(planOf('p1', counting, 3000, 2500));
    await lane.step(CTX, HOLD);
    expect(reads).toBeLessThanOrEqual(512);
    expect(lane.state).toBe('idle');
  });
});
