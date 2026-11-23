import { describe, expect, it, vi } from 'vitest';
import type { PlanCell } from './cell-do.ts';
import type { CellSource } from './cell-source.ts';
import {
  countPlanCells,
  createPlanExpand,
  createPlanSource,
  PlanNotRunnable,
} from './wire-expand.ts';

const FEET = { x: 10, y: 70, z: -4 };
const feet = () => FEET;
const palette = { s: { block: 'stone' }, p: { block: 'oak_planks' } };

/** Every cell a source holds, read to its end. */
function readAll(source: CellSource): PlanCell[] {
  const out: PlanCell[] = [];
  for (let i = 0; ; i++) {
    const cell = source.at(i);
    if (cell === undefined) return out;
    out.push(cell);
  }
}

const multiStep = [
  { op: 'box', pal: 's', from: { x: 0, y: 60, z: 0 }, to: { x: 4, y: 63, z: 4 } },
  { op: 'sphere', pal: 'p', center: { x: 2, y: 62, z: 2 }, radius: 3 },
  { op: 'box', break: true, from: { x: 0, y: 63, z: 0 }, to: { x: 1, y: 65, z: 1 } },
  { op: 'replace', pal: 's', at: { x: 2, y: 61, z: 2 } },
];

describe('the lazy plan source (B8-lazy) against the eager expander', () => {
  it('yields the same cells in the same order for box, sphere and overlapping multi-step plans', () => {
    const eager = createPlanExpand(feet);
    const source = createPlanSource(feet);
    const cases = [
      { palette, steps: [multiStep[0]] },
      { palette, steps: [multiStep[1]] },
      { palette, steps: multiStep },
      { palette, steps: multiStep, origin: 'here' as const },
      { palette, steps: multiStep, order: 'given' as const },
    ];
    for (const body of cases) {
      expect(readAll(source(body))).toEqual(eager(body));
    }
  });

  it('counts a plan to the same total the eager expander gives, and reads it again from a new source', async () => {
    const body = { palette, steps: multiStep };
    const total = await countPlanCells(createPlanSource(feet)(body));
    expect(total).toBe(createPlanExpand(feet)(body).length);
    expect(readAll(createPlanSource(feet)(body))).toHaveLength(total);
  });

  it('yields to the event loop during a count pass, every slice', async () => {
    const spy = vi.spyOn(globalThis, 'setImmediate');
    try {
      const body = {
        palette,
        steps: [{ op: 'box', pal: 's', from: { x: 0, y: 0, z: 0 }, to: { x: 19, y: 9, z: 19 } }],
      };
      const total = await countPlanCells(createPlanSource(feet)(body), 100);
      expect(total).toBe(4000);
      expect(spy.mock.calls.length).toBe(40);
    } finally {
      spy.mockRestore();
    }
  });

  it('refuses a plan with a palette key that names no block when counted (the add-time refusal)', async () => {
    const body = { palette, steps: [{ op: 'place', pal: 'missing', at: { x: 0, y: 0, z: 0 } }] };
    await expect(countPlanCells(createPlanSource(feet)(body))).rejects.toBeInstanceOf(
      PlanNotRunnable,
    );
  });

  it('an empty plan is an empty source', async () => {
    expect(await countPlanCells(createPlanSource(feet)({ palette, steps: [] }))).toBe(0);
  });
});
