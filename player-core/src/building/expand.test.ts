import { describe, expect, it } from 'vitest';
import { type ExpandCursor, expandPlan, type PlanCell, type PlanSpec } from './expand.ts';

const palette = { s: { block: 'stone' }, d: { block: 'dirt' } };

function plan(steps: PlanSpec['steps']): PlanSpec {
  return { palette, steps };
}

function all(spec: PlanSpec, from?: ExpandCursor): PlanCell[] {
  return [...expandPlan(spec, from)];
}

describe('expandPlan', () => {
  const mixed = plan([
    { op: 'place', pal: 's', at: { x: 0, y: 0, z: 0 } },
    {
      op: 'list',
      pal: 'd',
      cells: [
        { x: 1, y: 0, z: 0 },
        { x: 2, y: 0, z: 0 },
      ],
    },
    { op: 'box', from: { x: 0, y: 1, z: 0 }, to: { x: 1, y: 1, z: 0 }, break: true },
    { op: 'break', at: { x: 5, y: 5, z: 5 } },
  ]);

  it('expands the steps in order, with their palette keys', () => {
    expect(all(mixed)).toEqual([
      { x: 0, y: 0, z: 0, pal: 's' },
      { x: 1, y: 0, z: 0, pal: 'd' },
      { x: 2, y: 0, z: 0, pal: 'd' },
      { x: 0, y: 1, z: 0, pal: null },
      { x: 1, y: 1, z: 0, pal: null },
      { x: 5, y: 5, z: 5, pal: null },
    ]);
  });

  it('a break step and a break op both yield null keys', () => {
    expect(all(plan([{ op: 'break', at: { x: 0, y: 0, z: 0 } }]))).toEqual([
      { x: 0, y: 0, z: 0, pal: null },
    ]);
  });

  it('expands a wall with its height and a sphere with its hollow flag', () => {
    const cells = all(
      plan([
        { op: 'wall', pal: 's', from: { x: 0, y: 0, z: 0 }, to: { x: 1, y: 0, z: 0 }, height: 2 },
        { op: 'sphere', pal: 'd', center: { x: 0, y: 10, z: 0 }, radius: 1, hollow: true },
      ]),
    );
    expect(cells).toHaveLength(4 + 6);
    expect(
      cells.filter((c) => c.pal === 'd').some((c) => c.x === 0 && c.y === 10 && c.z === 0),
    ).toBe(false);
  });

  it('expands a circle on the named axis', () => {
    const cells = all(
      plan([{ op: 'circle', pal: 's', center: { x: 0, y: 0, z: 0 }, radius: 2, axis: 'x' }]),
    );
    expect(cells).toHaveLength(12);
    expect(cells.every((c) => c.x === 0)).toBe(true);
  });

  it('resumes at a cursor inside a step and yields the same tail', () => {
    const full = all(mixed);
    expect(all(mixed, { step: 0, offset: 1 })).toEqual(full.slice(1));
    expect(all(mixed, { step: 1, offset: 1 })).toEqual(full.slice(2));
    expect(all(mixed, { step: 3, offset: 0 })).toEqual(full.slice(5));
  });

  it('a cursor at the end yields nothing', () => {
    expect(all(mixed, { step: 4, offset: 0 })).toEqual([]);
    expect(all(mixed, { step: 3, offset: 1 })).toEqual([]);
  });

  it('is lazy: a million-cell box gives its first ten cells from an iterator', () => {
    const big = plan([
      { op: 'box', pal: 's', from: { x: 0, y: 0, z: 0 }, to: { x: 99, y: 99, z: 99 } },
    ]);
    const it = expandPlan(big);
    expect(Array.isArray(it)).toBe(false);
    const first: PlanCell[] = [];
    for (let i = 0; i < 10; i++) {
      const next = it.next();
      if (next.done) break;
      first.push(next.value);
    }
    expect(first).toHaveLength(10);
    expect(first[0]).toEqual({ x: 0, y: 0, z: 0, pal: 's' });
  });

  it('throws invalid_step for an unknown op', () => {
    expect(() => all(plan([{ op: 'teleport', pal: 's' }]))).toThrow('invalid_step');
  });

  it('throws invalid_step for a placing step with no palette key', () => {
    expect(() =>
      all(plan([{ op: 'box', from: { x: 0, y: 0, z: 0 }, to: { x: 1, y: 0, z: 0 } }])),
    ).toThrow('invalid_step');
  });

  it('throws invalid_step for a step missing a required field', () => {
    expect(() => all(plan([{ op: 'line', pal: 's', from: { x: 0, y: 0, z: 0 } }]))).toThrow(
      'invalid_step',
    );
  });
});
