import { describe, expect, it } from 'vitest';
import { FeedState } from '../../web/kino/feed.ts';
import { meshSection, occludes, type UvLookup } from '../../web/kino/mesher.ts';
import { cellIndex, encodePaletteIndices } from '../../web/kino/palette.ts';

const uv: UvLookup = () => ({ u0: 0, v0: 0, u1: 1, v1: 1 });

function section(cx: number, sy: number, cz: number, cells: [number, number, number, string][]) {
  const palette: [string, ...string[]] = ['minecraft:air', ...new Set(cells.map((c) => c[3]))];
  const idx = new Uint16Array(4096);
  for (const [x, y, z, s] of cells) idx[cellIndex(x, y, z)] = palette.indexOf(s);
  const bits = Math.max(1, Math.ceil(Math.log2(palette.length)));
  return {
    type: 'chunk_section' as const,
    chunk_x: cx,
    chunk_z: cz,
    section_y: sy,
    palette,
    bits,
    data: encodePaletteIndices(idx, bits),
  };
}

const faces = (m: { indices: number[] }) => m.indices.length / 6;
const STONE = 'minecraft:stone';

describe('mesher', () => {
  it('draws six faces for a lone block', () => {
    const f = new FeedState();
    f.apply(section(0, 0, 0, [[5, 5, 5, STONE]]));
    const m = meshSection(f.world, 0, 0, 0, uv);
    expect(faces(m)).toBe(6);
    expect(m.positions.length / 3).toBe(24);
  });

  it('culls the shared face between neighbours', () => {
    const f = new FeedState();
    f.apply(
      section(0, 0, 0, [
        [5, 5, 5, STONE],
        [6, 5, 5, STONE],
      ]),
    );
    expect(faces(meshSection(f.world, 0, 0, 0, uv))).toBe(10);
  });

  it('draws nothing for an all-air section', () => {
    const f = new FeedState();
    f.apply(section(0, 0, 0, []));
    expect(faces(meshSection(f.world, 0, 0, 0, uv))).toBe(0);
  });

  it('culls across a section border when the neighbour is loaded', () => {
    const f = new FeedState();
    f.apply(section(0, 0, 0, [[15, 3, 3, STONE]]));
    expect(faces(meshSection(f.world, 0, 0, 0, uv))).toBe(6);
    f.apply(section(1, 0, 0, [[0, 3, 3, STONE]]));
    expect(faces(meshSection(f.world, 0, 0, 0, uv))).toBe(5);
    expect(faces(meshSection(f.world, 1, 0, 0, uv))).toBe(5);
  });

  it('culls across a vertical border and a negative-coordinate border', () => {
    const f = new FeedState();
    f.apply(section(0, 0, 0, [[2, 15, 2, STONE]]));
    f.apply(section(0, 1, 0, [[2, 0, 2, STONE]]));
    expect(faces(meshSection(f.world, 0, 0, 0, uv))).toBe(5);
    f.apply(section(-1, 0, 0, [[15, 2, 2, STONE]]));
    f.apply(section(0, 0, 0, [[0, 2, 2, STONE]]));
    expect(faces(meshSection(f.world, -1, 0, 0, uv))).toBe(5);
  });

  it('draws a face against air and against see-through blocks', () => {
    const f = new FeedState();
    f.apply(
      section(0, 0, 0, [
        [5, 5, 5, STONE],
        [6, 5, 5, 'minecraft:glass'],
      ]),
    );
    expect(faces(meshSection(f.world, 0, 0, 0, uv))).toBe(11); // stone 6 (glass hides nothing), glass 5 (stone hides one)
    expect(occludes('minecraft:air')).toBe(false);
    expect(occludes(undefined)).toBe(false);
    expect(occludes('minecraft:oak_leaves[persistent=true]')).toBe(false);
    expect(occludes('minecraft:stone')).toBe(true);
  });

  it('block_update changes the mesh and marks the bordering section dirty', () => {
    const f = new FeedState();
    f.apply(section(0, 0, 0, [[15, 3, 3, STONE]]));
    f.apply(section(1, 0, 0, []));
    const change = f.apply({ type: 'block_update', pos: { x: 16, y: 3, z: 3 }, state: STONE });
    expect(change.dirty.sort()).toEqual(['0,0,0', '1,0,0']);
    expect(faces(meshSection(f.world, 0, 0, 0, uv))).toBe(5);
    f.apply({ type: 'block_update', pos: { x: 16, y: 3, z: 3 }, state: 'minecraft:air' });
    expect(faces(meshSection(f.world, 0, 0, 0, uv))).toBe(6);
    expect(
      f.apply({ type: 'block_update', pos: { x: 500, y: 3, z: 3 }, state: STONE }).dirty,
    ).toEqual([]);
  });
});
