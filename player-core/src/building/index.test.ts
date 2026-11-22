import { describe, expect, it } from 'vitest';
import * as building from './index.ts';

const c = { x: 0, y: 64, z: 0 };

describe('building library barrel (BLD-04)', () => {
  it('exports working shape helpers', () => {
    expect([...building.boxCells(c, c, true)]).toEqual([c]);
    expect([...building.lineCells(c, c)]).toEqual([c]);
    expect([...building.wallCells(c, c, 1)]).toEqual([c]);
    expect([...building.circleCells(c, 2, 'y')]).toHaveLength(12);
    expect([...building.sphereCells(c, 1)]).toHaveLength(7);
  });

  it('exports expansion, ordering and tally', () => {
    const cells = [
      ...building.expandPlan({
        palette: { s: {} },
        steps: [{ op: 'place', pal: 's', at: c }],
      }),
    ];
    expect(cells).toEqual([{ ...c, pal: 's' }]);
    expect(building.orderCells([c], 'bottom_up')).toEqual([c]);
    expect(building.orderPlanCells([{ ...c, pal: 's' }], 'bottom_up')).toEqual([
      { ...c, pal: 's' },
    ]);
    expect(building.tallyMaterials(cells)).toEqual({ s: 1 });
  });
});
