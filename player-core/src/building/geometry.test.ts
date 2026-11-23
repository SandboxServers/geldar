import { describe, expect, it } from 'vitest';
import {
  CIRCLE_R2_OFFSETS,
  SPHERE_R2_HOLLOW_COUNT,
  SPHERE_R2_SOLID_COUNT,
} from './fixtures/bld-04/goldens.ts';
import { boxCells, type Cell, circleCells, lineCells, sphereCells, wallCells } from './geometry.ts';

const origin: Cell = { x: 0, y: 64, z: 0 };

function keys(cells: Iterable<Cell>): string[] {
  return [...cells].map((c) => `${c.x},${c.y},${c.z}`).sort();
}

describe('boxCells', () => {
  it('a solid 3x3x3 box has 27 cells', () => {
    expect([...boxCells({ x: 0, y: 0, z: 0 }, { x: 2, y: 2, z: 2 }, false)]).toHaveLength(27);
  });

  it('a hollow 3x3x3 box has 26 cells and leaves the centre out', () => {
    const cells = keys(boxCells({ x: 0, y: 0, z: 0 }, { x: 2, y: 2, z: 2 }, true));
    expect(cells).toHaveLength(26);
    expect(cells).not.toContain('1,1,1');
    expect(cells).toContain('0,0,0');
  });

  it('corner order does not matter', () => {
    expect(keys(boxCells({ x: 2, y: 2, z: 2 }, { x: 0, y: 0, z: 0 }, true))).toEqual(
      keys(boxCells({ x: 0, y: 0, z: 0 }, { x: 2, y: 2, z: 2 }, true)),
    );
  });

  it('a single-cell box is one cell', () => {
    expect([...boxCells(origin, origin, true)]).toEqual([origin]);
  });

  it('a hollow box with one thick axis is all surface', () => {
    expect(keys(boxCells({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 2 }, true))).toHaveLength(3);
  });
});

describe('lineCells', () => {
  it('runs along x in both signs, both ends included', () => {
    expect(keys(lineCells({ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }))).toEqual([
      '0,0,0',
      '1,0,0',
      '2,0,0',
      '3,0,0',
    ]);
    expect(keys(lineCells({ x: 0, y: 0, z: 0 }, { x: -2, y: 0, z: 0 }))).toEqual([
      '-1,0,0',
      '-2,0,0',
      '0,0,0',
    ]);
  });

  it('runs along y and z, both signs', () => {
    expect([...lineCells({ x: 0, y: 5, z: 0 }, { x: 0, y: 3, z: 0 })]).toEqual([
      { x: 0, y: 5, z: 0 },
      { x: 0, y: 4, z: 0 },
      { x: 0, y: 3, z: 0 },
    ]);
    expect(keys(lineCells({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: -2 }))).toEqual([
      '0,0,-1',
      '0,0,-2',
      '0,0,0',
    ]);
  });

  it('a diagonal takes one cell per dominant step', () => {
    expect([...lineCells({ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 2 })]).toEqual([
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 1 },
      { x: 2, y: 0, z: 2 },
    ]);
  });

  it('a point is one cell', () => {
    expect([...lineCells(origin, origin)]).toEqual([origin]);
  });
});

describe('wallCells', () => {
  it('stacks the line height blocks up from the lower corner', () => {
    const cells = keys(wallCells({ x: 0, y: 64, z: 0 }, { x: 2, y: 64, z: 0 }, 2));
    expect(cells).toEqual(['0,64,0', '0,65,0', '1,64,0', '1,65,0', '2,64,0', '2,65,0']);
  });

  it('uses the lower of the two y values as the base', () => {
    const cells = keys(wallCells({ x: 0, y: 70, z: 0 }, { x: 0, y: 66, z: 3 }, 1));
    expect(cells.every((k) => k.split(',')[1] === '66')).toBe(true);
    expect(cells).toHaveLength(4);
  });
});

describe('circleCells', () => {
  it('a radius-2 circle on y is the 12-cell golden outline in x and z', () => {
    const expected = CIRCLE_R2_OFFSETS.map(
      ([a, b]) => `${origin.x + a},${origin.y},${origin.z + b}`,
    ).sort();
    expect(keys(circleCells(origin, 2, 'y'))).toEqual(expected);
  });

  it('a circle on x keeps x and draws in y and z', () => {
    const expected = CIRCLE_R2_OFFSETS.map(
      ([a, b]) => `${origin.x},${origin.y + a},${origin.z + b}`,
    ).sort();
    expect(keys(circleCells(origin, 2, 'x'))).toEqual(expected);
  });

  it('a circle on z keeps z and draws in x and y', () => {
    const expected = CIRCLE_R2_OFFSETS.map(
      ([a, b]) => `${origin.x + a},${origin.y + b},${origin.z}`,
    ).sort();
    expect(keys(circleCells(origin, 2, 'z'))).toEqual(expected);
  });

  it('every cell sits at the radius on the plane it draws, in every sign', () => {
    for (const axis of ['x', 'y', 'z'] as const) {
      for (const c of circleCells(origin, 5, axis)) {
        const a = axis === 'x' ? c.y - origin.y : c.x - origin.x;
        const b = axis === 'z' ? c.y - origin.y : c.z - origin.z;
        const d2 = a * a + b * b;
        expect(d2).toBeGreaterThanOrEqual(20);
        expect(d2).toBeLessThanOrEqual(30);
      }
    }
  });
});

describe('sphereCells', () => {
  it('a radius-1 solid sphere is seven cells', () => {
    expect([...sphereCells(origin, 1)]).toHaveLength(7);
  });

  it('a radius-2 solid sphere has the golden 33 lattice points', () => {
    expect([...sphereCells(origin, 2)]).toHaveLength(SPHERE_R2_SOLID_COUNT);
  });

  it('a radius-2 hollow sphere drops its seven interior points', () => {
    const cells = keys(sphereCells(origin, 2, true));
    expect(cells).toHaveLength(SPHERE_R2_HOLLOW_COUNT);
    expect(cells).not.toContain('0,64,0');
    expect(cells).toContain('2,64,0');
  });

  it('a radius-1 hollow sphere is the six neighbours of the centre', () => {
    expect(keys(sphereCells(origin, 1, true))).toEqual([
      '-1,64,0',
      '0,63,0',
      '0,64,-1',
      '0,64,1',
      '0,65,0',
      '1,64,0',
    ]);
  });

  it('reaches every octant', () => {
    const cells = [...sphereCells(origin, 2)];
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          expect(
            cells.some(
              (c) =>
                Math.sign(c.x - origin.x) === sx &&
                Math.sign(c.y - origin.y) === sy &&
                Math.sign(c.z - origin.z) === sz,
            ),
          ).toBe(true);
        }
      }
    }
  });
});

describe('laziness', () => {
  it('a million-cell box yields its first cells without materialising', () => {
    const before = process.memoryUsage().heapUsed;
    const it = boxCells({ x: 0, y: 0, z: 0 }, { x: 99, y: 99, z: 99 }, false);
    const first: Cell[] = [];
    for (let i = 0; i < 10; i++) {
      const next = it.next();
      if (next.done) break;
      first.push(next.value);
    }
    const grown = process.memoryUsage().heapUsed - before;
    expect(first).toHaveLength(10);
    expect(first[0]).toEqual({ x: 0, y: 0, z: 0 });
    expect(first[9]).toEqual({ x: 0, y: 0, z: 9 });
    expect(grown).toBeLessThan(16 * 1024 * 1024);
  });
});
