import { describe, expect, it } from 'vitest';
import { expandPlan, type PlanCell } from './expand.ts';
import { tallyMaterials } from './tally.ts';

const cell = (x: number, pal: string | null): PlanCell => ({ x, y: 0, z: 0, pal });

describe('tallyMaterials', () => {
  it('counts the cells of each palette key', () => {
    expect(tallyMaterials([cell(0, 's'), cell(1, 's'), cell(2, 'd')])).toEqual({ s: 2, d: 1 });
  });

  it('does not count breaks', () => {
    expect(tallyMaterials([cell(0, null), cell(1, 's'), cell(2, null)])).toEqual({ s: 1 });
  });

  it('an empty plan tallies to no keys', () => {
    expect(tallyMaterials([])).toEqual({});
  });

  it('a plan of only breaks tallies to no keys', () => {
    expect(tallyMaterials([cell(0, null)])).toEqual({});
  });

  it('counts a lazy expansion without collecting it first', () => {
    const counts = tallyMaterials(
      expandPlan({
        palette: { s: {}, d: {} },
        steps: [
          { op: 'box', pal: 's', from: { x: 0, y: 0, z: 0 }, to: { x: 2, y: 2, z: 2 } },
          { op: 'hollow_box', pal: 'd', from: { x: 0, y: 0, z: 0 }, to: { x: 2, y: 2, z: 2 } },
          { op: 'box', from: { x: 0, y: 0, z: 0 }, to: { x: 0, y: 0, z: 0 }, break: true },
        ],
      }),
    );
    expect(counts).toEqual({ s: 27, d: 26 });
  });
});
