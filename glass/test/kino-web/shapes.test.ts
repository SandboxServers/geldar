import { describe, expect, it } from 'vitest';
import { shapeOf } from '../../web/kino/blockshape.ts';
import { faceTextureIds, tintFor } from '../../web/kino/blocktex.ts';
import { FeedState } from '../../web/kino/feed.ts';
import { meshSection, occludes, type UvLookup } from '../../web/kino/mesher.ts';
import { cellIndex, encodePaletteIndices } from '../../web/kino/palette.ts';

// Synthetic fixtures only: block names and numbers, no Mojang art.

const mc = (s: string): string => `minecraft:${s}`;
const kindOf = (s: string, coverage?: number) => shapeOf(mc(s), coverage).kind;

describe('shape classification', () => {
  it.each([
    'short_grass',
    'tall_grass[half=upper]',
    'fern',
    'large_fern[half=lower]',
    'dandelion',
    'poppy',
    'azure_bluet',
    'oak_sapling',
    'dead_bush',
    'brown_mushroom',
    'sugar_cane[age=3]',
    'sweet_berry_bush[age=2]',
    'seagrass',
    'wheat[age=7]',
  ])('%s is a cross-plant, not a cube', (s) => {
    expect(kindOf(s)).toBe('cross');
  });

  it.each([
    'stone',
    'grass_block[snowy=false]',
    'oak_log[axis=y]',
    'sand',
    'birch_log[axis=y]',
    'sponge',
  ])('%s is a cube', (s) => expect(kindOf(s)).toBe('cube'));

  it('keeps see-through cubes whatever their texture coverage', () => {
    expect(kindOf('oak_leaves[distance=1]', 0.67)).toBe('cube');
    expect(kindOf('glass', 0.25)).toBe('cube');
    expect(kindOf('water[level=0]', 0.3)).toBe('cube');
  });

  it('draws a rule-less block with a mostly transparent texture as a plant, never a cube', () => {
    expect(kindOf('some_new_flower', 0.14)).toBe('cross');
    expect(kindOf('some_new_flower', 0.69)).toBe('cross');
    expect(kindOf('some_new_block', 0.7)).toBe('cube');
    expect(kindOf('some_new_block', 1)).toBe('cube');
    expect(kindOf('some_new_block')).toBe('cube'); // coverage unknown
  });

  it('slabs are half height by type; a double slab is a cube', () => {
    expect(shapeOf(mc('oak_slab[type=bottom]'))).toEqual({
      kind: 'boxes',
      boxes: [[0, 0, 0, 1, 0.5, 1]],
    });
    expect(shapeOf(mc('oak_slab[type=top]'))).toEqual({
      kind: 'boxes',
      boxes: [[0, 0.5, 0, 1, 1, 1]],
    });
    expect(kindOf('oak_slab[type=double]')).toBe('cube');
  });

  it('snow layers rise by layers; eight layers is a cube; a carpet is one sixteenth', () => {
    expect(shapeOf(mc('snow[layers=3]'))).toEqual({
      kind: 'boxes',
      boxes: [[0, 0, 0, 1, 0.375, 1]],
    });
    expect(kindOf('snow[layers=8]')).toBe('cube');
    expect(shapeOf(mc('white_carpet'))).toEqual({
      kind: 'boxes',
      boxes: [[0, 0, 0, 1, 1 / 16, 1]],
    });
  });

  it('stairs are a slab plus a step towards the facing, on every side', () => {
    const step = (facing: string, half = 'bottom') =>
      (shapeOf(mc(`oak_stairs[facing=${facing},half=${half}]`)) as unknown as { boxes: number[][] })
        .boxes[1];
    expect(step('north')).toEqual([0, 0.5, 0, 1, 1, 0.5]);
    expect(step('south')).toEqual([0, 0.5, 0.5, 1, 1, 1]);
    expect(step('west')).toEqual([0, 0.5, 0, 0.5, 1, 1]);
    expect(step('east')).toEqual([0.5, 0.5, 0, 1, 1, 1]);
    expect(step('east', 'top')).toEqual([0.5, 0, 0, 1, 0.5, 1]);
  });

  it('fences and torches are thin posts; vines are a decal on the supported side', () => {
    expect(shapeOf(mc('oak_fence'))).toEqual({
      kind: 'boxes',
      boxes: [[0.375, 0, 0.375, 0.625, 1, 0.625]],
    });
    expect(kindOf('torch')).toBe('boxes');
    const vine = shapeOf(mc('vine[north=true,east=false,south=false,west=false,up=false]'));
    expect(vine).toEqual({ kind: 'boxes', boxes: [[0, 0, 0, 1, 1, 1 / 16]] });
    expect(kindOf('vine[north=false,up=false]')).toBe('skip');
    expect(kindOf('potted_oak_sapling')).toBe('skip');
  });

  it('only a cube hides its neighbours', () => {
    expect(occludes(mc('stone'))).toBe(true);
    for (const s of ['short_grass', 'oak_slab[type=bottom]', 'oak_fence', 'snow[layers=2]'])
      expect(occludes(mc(s))).toBe(false);
  });
});

describe('texture and tint rules', () => {
  it('picks the half texture of tall plants and the stage texture of crops', () => {
    expect(faceTextureIds(mc('tall_grass[half=upper]'), 'pz')[0]).toBe(
      'minecraft:block/tall_grass_top',
    );
    expect(faceTextureIds(mc('tall_grass[half=lower]'), 'pz')[0]).toBe(
      'minecraft:block/tall_grass_bottom',
    );
    expect(faceTextureIds(mc('large_fern[half=upper]'), 'pz')[0]).toBe(
      'minecraft:block/large_fern_top',
    );
    expect(faceTextureIds(mc('sweet_berry_bush[age=2]'), 'pz')[0]).toBe(
      'minecraft:block/sweet_berry_bush_stage2',
    );
    expect(faceTextureIds(mc('carrots[age=7]'), 'pz')[0]).toBe('minecraft:block/carrots_stage3');
    expect(faceTextureIds(mc('white_carpet'), 'py')).toContain('minecraft:block/white_wool');
  });

  it.each([
    'grass_block_top',
    'short_grass',
    'tall_grass_top',
    'tall_grass_bottom',
    'fern',
    'large_fern_top',
    'large_fern_bottom',
    'oak_leaves',
    'vine',
    'sugar_cane',
    'lily_pad',
    'water_still',
  ])('tints the grey texture %s', (name) => {
    expect(tintFor(`minecraft:block/${name}`)).not.toBeNull();
  });

  it.each([
    'dandelion',
    'poppy',
    'azure_bluet',
    'cornflower',
    'brown_mushroom',
    'red_mushroom',
    'oak_sapling',
    'dead_bush',
    'sand',
    'stone',
    'grass_block_side',
  ])('does not tint %s', (name) => {
    expect(tintFor(`minecraft:block/${name}`)).toBeNull();
  });
});

function world(cells: [number, number, number, string][]): FeedState {
  const f = new FeedState();
  const palette: [string, ...string[]] = ['minecraft:air', ...new Set(cells.map((c) => c[3]))];
  const idx = new Uint16Array(4096);
  for (const [x, y, z, s] of cells) idx[cellIndex(x, y, z)] = palette.indexOf(s);
  const bits = Math.max(1, Math.ceil(Math.log2(palette.length)));
  f.apply({
    type: 'chunk_section',
    chunk_x: 0,
    chunk_z: 0,
    section_y: 0,
    palette,
    bits,
    data: encodePaletteIndices(idx, bits),
  });
  return f;
}

const unit: UvLookup = () => ({ u0: 0, v0: 0, u1: 1, v1: 1 });
const quads = (m: { indices: number[] }) => m.indices.length / 6;

describe('shape meshing', () => {
  it('a fern is two crossed planes, both sides: four quads, diagonal, facing up for light', () => {
    const m = meshSection(world([[3, 3, 3, mc('fern')]]).world, 0, 0, 0, unit);
    expect(quads(m)).toBe(4);
    const xs = new Set<string>();
    for (let i = 0; i < m.positions.length; i += 3)
      xs.add(`${m.positions[i]},${m.positions[i + 1]},${m.positions[i + 2]}`);
    expect(xs).toEqual(
      new Set(['3,3,3', '4,3,4', '4,4,4', '3,4,3', '4,3,3', '3,3,4', '3,4,4', '4,4,3']),
    );
    expect(m.normals.every((n, i) => (i % 3 === 1 ? n === 1 : n === 0))).toBe(true);
  });

  it('a plant on grass does not hide the grass top, and a slab does not hide its neighbour', () => {
    const grass = mc('grass_block[snowy=false]');
    const m = meshSection(
      world([
        [3, 3, 3, grass],
        [3, 4, 3, mc('short_grass')],
      ]).world,
      0,
      0,
      0,
      unit,
    );
    expect(quads(m)).toBe(6 + 4); // all six cube faces (the top shows) + the plant
    const s = meshSection(
      world([
        [3, 3, 3, mc('stone')],
        [4, 3, 3, mc('oak_slab[type=bottom]')],
      ]).world,
      0,
      0,
      0,
      unit,
    );
    expect(quads(s)).toBe(6 + 5); // stone 6 (a slab hides nothing), slab 5 (its west face is hidden by the stone)
  });

  it('an unknown block with a mostly transparent texture is meshed as a plant', () => {
    const lookup: UvLookup = Object.assign(() => ({ u0: 0, v0: 0, u1: 1, v1: 1 }), {
      coverage: (s: string) => (s.includes('weedy') ? 0.2 : 1),
    });
    const w = world([
      [1, 1, 1, mc('weedy_thing')],
      [5, 1, 1, mc('solid_thing')],
    ]).world;
    expect(quads(meshSection(w, 0, 0, 0, lookup))).toBe(4 + 6);
  });

  it('maps a post to the texture part under it (a torch is the middle two columns)', () => {
    const m = meshSection(world([[2, 2, 2, mc('torch')]]).world, 0, 0, 0, unit);
    const us = m.uvs.filter((_, i) => i % 2 === 0);
    expect(Math.min(...us)).toBeCloseTo(7 / 16);
    expect(Math.max(...us)).toBeCloseTo(9 / 16);
  });

  it('skips a vine with no supported face and meshes one with a face', () => {
    expect(
      quads(meshSection(world([[2, 2, 2, mc('vine[north=false,up=false]')]]).world, 0, 0, 0, unit)),
    ).toBe(0);
    expect(
      quads(meshSection(world([[2, 2, 2, mc('vine[north=true,up=false]')]]).world, 0, 0, 0, unit)),
    ).toBe(6);
  });
});
