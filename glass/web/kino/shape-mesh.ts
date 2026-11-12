// Quads for the non-cube shapes of blockshape.ts: boxes (slabs, posts, layers) and crossed plant quads.

import type { Box } from './blockshape.ts';
import { FACES, type FaceDef } from './faces.ts';
import type { MeshData, Uv } from './mesher.ts';

export type Point = readonly [number, number, number];

/** Appends one quad. `uvs` are per corner, in the same order as `pts`. */
export function pushQuad(
  mesh: MeshData,
  pts: readonly Point[],
  normal: Point,
  uvs: readonly (readonly [number, number])[],
  soft: number,
): void {
  const base = mesh.positions.length / 3;
  pts.forEach((p, i) => {
    mesh.positions.push(p[0], p[1], p[2]);
    mesh.normals.push(normal[0], normal[1], normal[2]);
    const [u, v] = uvs[i] ?? [0, 0];
    mesh.uvs.push(u, v);
    mesh.soft?.push(soft);
  });
  mesh.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

const axisOf = (a: readonly number[], b: readonly number[]): number =>
  [0, 1, 2].find((i) => a[i] !== b[i]) ?? 0;

/** True when the box face lies on the cell border, where a neighbouring cube can hide it. */
export function faceOnBorder(box: Box, f: FaceDef): boolean {
  const axis = f.d.findIndex((n) => n !== 0);
  return (f.d[axis] as number) > 0 ? (box[axis + 3] as number) >= 1 : (box[axis] as number) <= 0;
}

/**
 * One face of a box at the cell (wx, wy, wz). The tile is mapped as the game does: the face shows the
 * part of the texture that lies under it, so a 2 px post shows the 2 px column of the torch texture.
 */
export function pushBoxFace(
  mesh: MeshData,
  f: FaceDef,
  box: Box,
  at: Point,
  uv: Uv,
  soft: number,
): void {
  const c = f.corners;
  const ua = axisOf(c[0] as number[], c[1] as number[]);
  const va = axisOf(c[0] as number[], c[3] as number[]);
  const uInc = (c[1]?.[ua] ?? 0) > (c[0]?.[ua] ?? 0);
  const vInc = (c[3]?.[va] ?? 0) > (c[0]?.[va] ?? 0);
  const pts: Point[] = [];
  const uvs: [number, number][] = [];
  for (const corner of c) {
    const r = corner.map((k, i) => (k === 0 ? (box[i] as number) : (box[i + 3] as number)));
    pts.push([at[0] + (r[0] as number), at[1] + (r[1] as number), at[2] + (r[2] as number)]);
    const fu = uInc ? (r[ua] as number) : 1 - (r[ua] as number);
    const fv = vInc ? (r[va] as number) : 1 - (r[va] as number);
    uvs.push([uv.u0 + (uv.u1 - uv.u0) * fu, uv.v0 + (uv.v1 - uv.v0) * fv]);
  }
  pushQuad(mesh, pts, f.d, uvs, soft);
}

export function pushBox(
  mesh: MeshData,
  box: Box,
  at: Point,
  uvOf: (face: FaceDef['face']) => Uv,
  hidden: (f: FaceDef) => boolean,
  soft: number,
): void {
  for (const f of FACES) {
    if (faceOnBorder(box, f) && hidden(f)) continue;
    pushBoxFace(mesh, f, box, at, uvOf(f.face), soft);
  }
}

// Two diagonal planes; each is emitted facing both ways so the single-sided material shows both.
const PLANES: Point[][] = [
  [
    [0, 0, 0],
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 0],
  ],
  [
    [1, 0, 0],
    [0, 0, 1],
    [0, 1, 1],
    [1, 1, 0],
  ],
];

/** The crossed quads of a plant at the cell. Normal points up so the plant is lit like a top face. */
export function pushCross(mesh: MeshData, at: Point, uv: Uv, soft: number): void {
  const tile: [number, number][] = [
    [uv.u0, uv.v0],
    [uv.u1, uv.v0],
    [uv.u1, uv.v1],
    [uv.u0, uv.v1],
  ];
  for (const plane of PLANES) {
    const pts = plane.map((p): Point => [at[0] + p[0], at[1] + p[1], at[2] + p[2]]);
    pushQuad(mesh, pts, [0, 1, 0], tile, soft);
    pushQuad(
      mesh,
      [pts[1], pts[0], pts[3], pts[2]] as Point[],
      [0, 1, 0],
      [tile[1], tile[0], tile[3], tile[2]] as [number, number][],
      soft,
    );
  }
}
