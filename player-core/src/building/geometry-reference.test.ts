import { describe, expect, it } from 'vitest';
import { boxCells, type Cell, lineCells, sphereCells, wallCells } from './geometry.ts';

// The pre-fix (BLD-fix2a) generators, kept here as the reference: the new row-based and lazy versions must
// yield the same cells in the same order for every input the old ones could walk.

function oldSphere(center: Cell, radius: number, hollow: boolean): Cell[] {
  const out: Cell[] = [];
  const r2 = radius * radius;
  const inside = (dx: number, dy: number, dz: number): boolean => dx * dx + dy * dy + dz * dz <= r2;
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dz = -radius; dz <= radius; dz++) {
        if (!inside(dx, dy, dz)) continue;
        if (
          hollow &&
          inside(dx + 1, dy, dz) &&
          inside(dx - 1, dy, dz) &&
          inside(dx, dy + 1, dz) &&
          inside(dx, dy - 1, dz) &&
          inside(dx, dy, dz + 1) &&
          inside(dx, dy, dz - 1)
        ) {
          continue;
        }
        out.push({ x: center.x + dx, y: center.y + dy, z: center.z + dz });
      }
    }
  }
  return out;
}

function oldBox(from: Cell, to: Cell, hollow: boolean): Cell[] {
  const out: Cell[] = [];
  const [x0, x1] = [Math.min(from.x, to.x), Math.max(from.x, to.x)];
  const [y0, y1] = [Math.min(from.y, to.y), Math.max(from.y, to.y)];
  const [z0, z1] = [Math.min(from.z, to.z), Math.max(from.z, to.z)];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        if (hollow && !(x === x0 || x === x1 || y === y0 || y === y1 || z === z0 || z === z1)) {
          continue;
        }
        out.push({ x, y, z });
      }
    }
  }
  return out;
}

function oldWall(from: Cell, to: Cell, height: number): Cell[] {
  const base = Math.min(from.y, to.y);
  const floor = [...lineCells({ x: from.x, y: 0, z: from.z }, { x: to.x, y: 0, z: to.z })];
  const out: Cell[] = [];
  for (let h = 0; h < height; h++) {
    for (const p of floor) out.push({ x: p.x, y: base + h, z: p.z });
  }
  return out;
}

const CENTRE = { x: 3, y: -2, z: 5 };

describe('sphereCells matches the pre-fix generator', () => {
  for (const radius of [0, 1, 2, 3, 5, 7]) {
    it(`radius ${radius}, solid and hollow, same cells in the same order`, () => {
      expect([...sphereCells(CENTRE, radius)]).toEqual(oldSphere(CENTRE, radius, false));
      expect([...sphereCells(CENTRE, radius, true)]).toEqual(oldSphere(CENTRE, radius, true));
    });
  }
});

describe('boxCells matches the pre-fix generator', () => {
  const corners: [Cell, Cell][] = [
    [
      { x: 0, y: 0, z: 0 },
      { x: 4, y: 3, z: 2 },
    ],
    [
      { x: 2, y: 1, z: 0 },
      { x: -1, y: -2, z: 3 },
    ],
    [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
    ],
    [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ],
    [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 2, z: 0 },
    ],
    [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 2, z: 5 },
    ],
  ];
  for (const [from, to] of corners) {
    it(`corners ${JSON.stringify(from)} to ${JSON.stringify(to)}, solid and hollow`, () => {
      expect([...boxCells(from, to, false)]).toEqual(oldBox(from, to, false));
      expect([...boxCells(from, to, true)]).toEqual(oldBox(from, to, true));
    });
  }
});

describe('wallCells matches the pre-fix generator', () => {
  const walls: [Cell, Cell, number][] = [
    [{ x: 0, y: 64, z: 0 }, { x: 2, y: 64, z: 0 }, 2],
    [{ x: 0, y: 70, z: 0 }, { x: 0, y: 66, z: 3 }, 1],
    [{ x: -4, y: 60, z: 7 }, { x: 5, y: 61, z: -2 }, 4],
    [{ x: 1, y: 0, z: 1 }, { x: 1, y: 0, z: 1 }, 3],
  ];
  for (const [from, to, height] of walls) {
    it(`from ${JSON.stringify(from)} to ${JSON.stringify(to)} height ${height}`, () => {
      expect([...wallCells(from, to, height)]).toEqual(oldWall(from, to, height));
    });
  }
});

describe('wallCells is lazy', () => {
  it('a wall of length 6,000,000 yields its first cells at once, without collecting its line', () => {
    const started = performance.now();
    const first = [
      ...take(wallCells({ x: 0, y: 64, z: 0 }, { x: 6_000_000, y: 64, z: 0 }, 1), 100),
    ];
    expect(first).toHaveLength(100);
    expect(performance.now() - started).toBeLessThan(200);
  });
});

function take<T>(items: IterableIterator<T>, n: number): T[] {
  const out: T[] = [];
  for (const item of items) {
    if (out.length >= n) break;
    out.push(item);
  }
  return out;
}

describe('lineCells and its reverse', () => {
  it('a line and its reverse cover the same cells for every small offset', () => {
    const cellsOf = (a: Cell, b: Cell): string[] =>
      [...lineCells(a, b)].map((c) => `${c.x},${c.y},${c.z}`).sort();
    const origin = { x: 0, y: 0, z: 0 };
    for (let x = -4; x <= 4; x++) {
      for (let y = -4; y <= 4; y++) {
        for (let z = -4; z <= 4; z++) {
          const end = { x, y, z };
          expect(cellsOf(origin, end)).toEqual(cellsOf(end, origin));
        }
      }
    }
  });
});
