import { describe, expect, it } from 'vitest';
import * as building from './index.ts';

const c = { x: 0, y: 64, z: 0 };

describe('building library stubs (BLD-04 fills them)', () => {
  it('every shape helper throws not_implemented', () => {
    expect(() => building.boxCells(c, c, true)).toThrow('not_implemented');
    expect(() => building.lineCells(c, c)).toThrow('not_implemented');
    expect(() => building.wallCells(c, c)).toThrow('not_implemented');
    expect(() => building.circleCells(c, 2, 'y')).toThrow('not_implemented');
    expect(() => building.sphereCells(c, 2)).toThrow('not_implemented');
  });

  it('expansion, ordering and tally throw not_implemented', () => {
    expect(() => building.expandPlan({} as never)).toThrow('not_implemented');
    expect(() => building.orderCells([c], 'bottom_up')).toThrow('not_implemented');
    expect(() => building.tallyMaterials([])).toThrow('not_implemented');
  });
});
