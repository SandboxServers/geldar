// Culled voxel meshing of one section. A face is drawn only when the neighbouring cell does not
// hide it. The neighbour is read from the world, so faces on a section border are culled against
// the next section; where no section is loaded, the neighbour counts as air and the face is drawn.

import { type Shape, shapeOf } from './blockshape.ts';
import type { StateReader } from './cull.ts';
import { FACES, type Face } from './faces.ts';
import { pushBox, pushCross, pushQuad } from './shape-mesh.ts';
import { isAir } from './world.ts';

export type { Face };

export interface Uv {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

/**
 * Maps a block state and face to its atlas rectangle. coverage (optional) is the average alpha of the
 * state's side texture, 0..1; the mesher draws a rule-less block with mostly transparent art as a plant.
 */
export type UvLookup = ((state: string, face: Face) => Uv) & {
  coverage?: (state: string) => number | undefined;
};

export interface MeshData {
  positions: number[];
  normals: number[];
  uvs: number[];
  indices: number[];
  /** Per vertex: 1 leaves, 0.5 other see-through blocks, 0 opaque (drives the shader fade). */
  soft?: number[];
}

/** The `soft` attribute value of a block state. */
export function softOf(state: string): number {
  if (!SEE_THROUGH.test(state)) return 0;
  return /leaves(?:\[|$)/.test(state) ? 1 : 0.5;
}

const SEE_THROUGH =
  /^minecraft:(?:.*glass.*|.*leaves|water|lava|ice|barrier|light|.*_pane|iron_bars)(?:\[|$)/;

/** True when a block hides the faces of its neighbours. */
export function occludes(state: string | undefined): boolean {
  return (
    !isAir(state) && !SEE_THROUGH.test(state as string) && shapeOf(state as string).kind === 'cube'
  );
}

export function meshSection(
  world: StateReader,
  cx: number,
  sy: number,
  cz: number,
  uvFor: UvLookup,
): MeshData {
  const soft: number[] = [];
  const mesh: MeshData = { positions: [], normals: [], uvs: [], indices: [], soft };
  const shapes = new Map<string, Shape>();
  const shapeFor = (s: string): Shape => {
    let sh = shapes.get(s);
    if (!sh) {
      sh = shapeOf(s, uvFor.coverage?.(s));
      shapes.set(s, sh);
    }
    return sh;
  };
  // Only a full cube hides what lies behind it; a slab, a fern or a fence does not.
  const hides = (s: string | undefined): boolean =>
    occludes(s) && shapeFor(s as string).kind === 'cube';
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
        const shape = shapeFor(state);
        if (shape.kind === 'skip') continue;
        const s = shape.kind === 'cross' ? 0.5 : softOf(state);
        if (shape.kind === 'cross') {
          pushCross(mesh, [wx, wy, wz], uvFor(state, 'pz'), s);
          continue;
        }
        const neighbour = (f: { d: [number, number, number] }): string | undefined =>
          world.stateAt(wx + f.d[0], wy + f.d[1], wz + f.d[2]);
        if (shape.kind === 'boxes') {
          for (const b of shape.boxes)
            pushBox(
              mesh,
              b,
              [wx, wy, wz],
              (face) => uvFor(state, face),
              (f) => hides(neighbour(f)),
              s,
            );
          continue;
        }
        for (const f of FACES) {
          const n = neighbour(f);
          if (hides(n)) continue;
          // A see-through block does not draw faces against an identical neighbour.
          if (!occludes(state) && n === state) continue;
          const uv = uvFor(state, f.face);
          const quadUv: [number, number][] = [
            [uv.u0, uv.v0],
            [uv.u1, uv.v0],
            [uv.u1, uv.v1],
            [uv.u0, uv.v1],
          ];
          pushQuad(
            mesh,
            f.corners.map((c) => [wx + c[0], wy + c[1], wz + c[2]] as const),
            f.d,
            quadUv,
            s,
          );
        }
      }
    }
  }
  return mesh;
}
