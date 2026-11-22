/** A block cell position: the same shape as a plan coordinate. */
export interface Cell {
  x: number;
  y: number;
  z: number;
}

/**
 * Pure shape helpers (BLD-04). Each is a generator: it yields cells in a deterministic order,
 * never materialises the shape, and never imports mineflayer.
 */

/** Cells of an axis-aligned box between two corners, both corners included. */
export function* boxCells(from: Cell, to: Cell, hollow: boolean): IterableIterator<Cell> {
  const [x0, x1] = minMax(from.x, to.x);
  const [y0, y1] = minMax(from.y, to.y);
  const [z0, z1] = minMax(from.z, to.z);
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      // A hollow box's interior column (x and y both inside) keeps only its two ends in z: no scan of it.
      if (hollow && !(x === x0 || x === x1 || y === y0 || y === y1)) {
        yield { x, y, z: z0 };
        if (z1 > z0) yield { x, y, z: z1 };
        continue;
      }
      for (let z = z0; z <= z1; z++) {
        yield { x, y, z };
      }
    }
  }
}

/** The cells of a straight line from one corner to another, both ends included (3D DDA). */
export function* lineCells(from: Cell, to: Cell): IterableIterator<Cell> {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const steps = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
  if (steps === 0) {
    yield { x: from.x, y: from.y, z: from.z };
    return;
  }
  for (let i = 0; i <= steps; i++) {
    yield {
      x: from.x + Math.round((dx * i) / steps),
      y: from.y + Math.round((dy * i) / steps),
      z: from.z + Math.round((dz * i) / steps),
    };
  }
}

/**
 * The cells of a wall between two corners: the horizontal line from `from` to `to` (in x and z),
 * stacked `height` blocks up from the lower of the two corners' y. Layers run bottom-up.
 */
export function* wallCells(from: Cell, to: Cell, height: number): IterableIterator<Cell> {
  const base = Math.min(from.y, to.y);
  for (let h = 0; h < height; h++) {
    // Lazy: the floor line is walked per layer, never collected (the same cells in the same order).
    for (const p of lineCells({ x: from.x, y: 0, z: from.z }, { x: to.x, y: 0, z: to.z })) {
      yield { x: p.x, y: base + h, z: p.z };
    }
  }
}

/**
 * The outline of a circle of a radius on the plane that drops the named axis (midpoint
 * algorithm, eight-way symmetric, each cell once). A radius-2 circle on an axis has 12 cells.
 */
export function* circleCells(
  center: Cell,
  radius: number,
  axis: 'x' | 'y' | 'z',
): IterableIterator<Cell> {
  const seen = new Set<string>();
  const place = (a: number, b: number): Cell => {
    if (axis === 'y') return { x: center.x + a, y: center.y, z: center.z + b };
    if (axis === 'x') return { x: center.x, y: center.y + a, z: center.z + b };
    return { x: center.x + a, y: center.y + b, z: center.z };
  };
  let x = 0;
  let y = radius;
  let d = 3 - 2 * radius;
  while (x <= y) {
    for (const [a, b] of [
      [x, y],
      [y, x],
      [-x, y],
      [-y, x],
      [x, -y],
      [y, -x],
      [-x, -y],
      [-y, -x],
    ] as const) {
      const key = `${a},${b}`;
      if (!seen.has(key)) {
        seen.add(key);
        yield place(a, b);
      }
    }
    if (d < 0) {
      d += 4 * x + 6;
    } else {
      d += 4 * (x - y) + 10;
      y--;
    }
    x++;
  }
}

/**
 * The cells of a sphere of a radius about a centre: every cell within the radius, or with
 * `hollow`, only those with a neighbour outside it (the shell).
 */
export function* sphereCells(center: Cell, radius: number, hollow = false): IterableIterator<Cell> {
  const r2 = radius * radius;
  const inside = (dx: number, dy: number, dz: number): boolean => dx * dx + dy * dy + dz * dz <= r2;
  // Rows, not the cube: each (dx, dy) row's z-range is computed directly, so the work follows the cells.
  for (let dx = -radius; dx <= radius; dx++) {
    const halfY = isqrt(r2 - dx * dx);
    for (let dy = -halfY; dy <= halfY; dy++) {
      const halfZ = isqrt(r2 - dx * dx - dy * dy);
      for (let dz = -halfZ; dz <= halfZ; dz++) {
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
        yield { x: center.x + dx, y: center.y + dy, z: center.z + dz };
      }
    }
  }
}

/** The integer square root floor of n (n >= 0), exact. */
function isqrt(n: number): number {
  let s = Math.floor(Math.sqrt(n));
  while (s * s > n) s--;
  while ((s + 1) * (s + 1) <= n) s++;
  return s;
}

function minMax(a: number, b: number): [number, number] {
  return a <= b ? [a, b] : [b, a];
}
