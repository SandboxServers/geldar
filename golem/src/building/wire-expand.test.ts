import { describe, expect, it } from 'vitest';
import { createPlanExpand, PlanNotRunnable } from './wire-expand.ts';

const FEET = { x: 10, y: 70, z: -4 };
const feet = () => FEET;

const palette = { s: { block: 'stone' }, p: { block: 'oak_planks' } };

describe('the plan expander the queue is built with (BLD-38b)', () => {
  it('turns each placed cell into an empty cell that the palette block goes into, in order', () => {
    const expand = createPlanExpand(feet);
    const cells = expand({
      palette,
      steps: [{ op: 'line', pal: 's', from: { x: 0, y: 64, z: 0 }, to: { x: 2, y: 64, z: 0 } }],
      order: 'given',
    });
    expect(cells).toEqual([
      { at: { x: 0, y: 64, z: 0 }, prior: 'air', target: 'stone' },
      { at: { x: 1, y: 64, z: 0 }, prior: 'air', target: 'stone' },
      { at: { x: 2, y: 64, z: 0 }, prior: 'air', target: 'stone' },
    ]);
  });

  it('shifts every cell by an explicit origin, and by the feet for origin here', () => {
    const expand = createPlanExpand(feet);
    const steps = [{ op: 'place', pal: 'p', at: { x: 1, y: 2, z: 3 } }];
    const absolute = expand({ palette, steps, origin: { x: 100, y: 0, z: 100 }, order: 'given' });
    expect(absolute[0]?.at).toEqual({ x: 101, y: 2, z: 103 });
    const here = expand({ palette, steps, origin: 'here', order: 'given' });
    expect(here[0]?.at).toEqual({ x: 11, y: 72, z: -1 });
  });

  it('orders bottom up by default and keeps the given order when asked', () => {
    const expand = createPlanExpand(feet);
    const steps = [
      { op: 'place', pal: 's', at: { x: 0, y: 65, z: 0 } },
      { op: 'place', pal: 's', at: { x: 0, y: 64, z: 0 } },
    ];
    const bottomUp = expand({ palette, steps });
    expect(bottomUp.map((c) => c.at.y)).toEqual([64, 65]);
    const given = expand({ palette, steps, order: 'given' });
    expect(given.map((c) => c.at.y)).toEqual([65, 64]);
  });

  it('refuses a break or a replace step, since the prior block is not known at submit time', () => {
    const expand = createPlanExpand(feet);
    expect(() => expand({ palette, steps: [{ op: 'break', at: { x: 0, y: 64, z: 0 } }] })).toThrow(
      PlanNotRunnable,
    );
    expect(() =>
      expand({ palette, steps: [{ op: 'replace', pal: 's', at: { x: 0, y: 64, z: 0 } }] }),
    ).toThrow(PlanNotRunnable);
  });

  it('refuses a palette key that names no block, and an origin that is not a cell', () => {
    const expand = createPlanExpand(feet);
    const steps = [{ op: 'place', pal: 'missing', at: { x: 0, y: 64, z: 0 } }];
    expect(() => expand({ palette, steps })).toThrow(/names no block/);
    const ok = [{ op: 'place', pal: 's', at: { x: 0, y: 64, z: 0 } }];
    expect(() => expand({ palette, steps: ok, origin: { x: 'a' } })).toThrow(PlanNotRunnable);
  });

  it('an empty plan has no cells', () => {
    expect(createPlanExpand(feet)({ palette, steps: [] })).toEqual([]);
  });
});
