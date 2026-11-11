// Culled voxel meshing of one section. A face is drawn only when the neighbouring cell does not
// hide it. The neighbour is read from the world, so faces on a section border are culled against
// the next section; where no section is loaded, the neighbour counts as air and the face is drawn.

import { isAir, type VoxelWorld } from './world.ts';

export type Face = 'px' | 'nx' | 'py' | 'ny' | 'pz' | 'nz';

export interface Uv {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

/** Maps a block state and face to its atlas rectangle. */
export type UvLookup = (state: string, face: Face) => Uv;

export interface MeshData {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
}

const SEE_THROUGH =
  /^minecraft:(?:.*glass.*|.*leaves|water|lava|ice|barrier|light|.*_pane|iron_bars)(?:\[|$)/;

/** True when a block hides the faces of its neighbours. */
export function occludes(state: string | undefined): boolean {
  return !isAir(state) && !SEE_THROUGH.test(state as string);
}

interface FaceDef {
  face: Face;
  d: [number, number, number];
  corners: [number, number, number][];
}

// Corner order is counter-clockwise seen from outside, so the winding faces outward.
const FACES: FaceDef[] = [
  {
    face: 'px',
    d: [1, 0, 0],
    corners: [
      [1, 0, 1],
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
    ],
  },
  {
    face: 'nx',
    d: [-1, 0, 0],
    corners: [
      [0, 0, 0],
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
    ],
  },
  {
    face: 'py',
    d: [0, 1, 0],
    corners: [
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
      [0, 1, 0],
    ],
  },
  {
    face: 'ny',
    d: [0, -1, 0],
    corners: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ],
  },
  {
    face: 'pz',
    d: [0, 0, 1],
    corners: [
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ],
  },
  {
    face: 'nz',
    d: [0, 0, -1],
    corners: [
      [1, 0, 0],
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
    ],
  },
];

export function meshSection(
  world: VoxelWorld,
  cx: number,
  sy: number,
  cz: number,
  uvFor: UvLookup,
): MeshData {
  const mesh: MeshData = { positions: [], normals: [], uvs: [], indices: [] };
  const ox = cx * 16;
  const oy = sy * 16;
  const oz = cz * 16;
  for (let y = 0; y < 16; y++) {
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const wx = ox + x;
        const wy = oy + y;
        const wz = oz + z;
        const state = world.stateAt(wx, wy, wz) as string;
        if (isAir(state)) continue;
        for (const f of FACES) {
          const neighbour = world.stateAt(wx + f.d[0], wy + f.d[1], wz + f.d[2]);
          if (occludes(neighbour)) continue;
          // A see-through block does not draw faces against an identical neighbour.
          if (!occludes(state) && neighbour === state) continue;
          const uv = uvFor(state, f.face);
          const base = mesh.positions.length / 3;
          const quadUv: [number, number][] = [
            [uv.u0, uv.v0],
            [uv.u1, uv.v0],
            [uv.u1, uv.v1],
            [uv.u0, uv.v1],
          ];
          f.corners.forEach((c, i) => {
            mesh.positions.push(wx + c[0], wy + c[1], wz + c[2]);
            mesh.normals.push(f.d[0], f.d[1], f.d[2]);
            const [u, v] = quadUv[i] ?? [0, 0];
            mesh.uvs.push(u, v);
          });
          mesh.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
      }
    }
  }
  return mesh;
}
