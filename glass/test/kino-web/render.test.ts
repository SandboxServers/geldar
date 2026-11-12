import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyTint, faceTextureIds, tileFallbackColour, tintFor } from '../../web/kino/blocktex.ts';
import { CullingWorld, cellsToCull, sectionsOfCells } from '../../web/kino/cull.ts';
import { meshSection } from '../../web/kino/mesher.ts';
import { statusLine } from '../../web/kino/status.ts';
import { buildAtlasLayout, makeUvLookup, parseTextures } from '../../web/kino/textures.ts';

const PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==';
// Mimics the REAL structure of BlueMap's textures.json: a top-level array of entries with resourcePath.
const REAL = [
  {
    resourcePath: 'bluemap:block/missing',
    color: [0.5, 0, 0.5, 1],
    halfTransparent: false,
    texture: PX,
  },
  {
    resourcePath: 'minecraft:block/oak_leaves',
    color: [0.56, 0.56, 0.56, 0.67],
    halfTransparent: false,
    texture: PX,
    animation: { interpolate: false, width: 1, height: 1, frametime: 1 },
  },
  {
    resourcePath: 'minecraft:block/grass_block_top',
    color: [0.57, 0.57, 0.57, 1],
    halfTransparent: false,
    texture: PX,
  },
  {
    resourcePath: 'minecraft:block/grass_block_side',
    color: [0.5, 0.42, 0.25, 1],
    halfTransparent: false,
    texture: PX,
  },
  {
    resourcePath: 'minecraft:block/dirt',
    color: [0.52, 0.37, 0.26, 1],
    halfTransparent: false,
    texture: PX,
  },
  {
    resourcePath: 'minecraft:block/oak_log',
    color: [0.42, 0.33, 0.19, 1],
    halfTransparent: false,
    texture: PX,
  },
  {
    resourcePath: 'minecraft:block/oak_log_top',
    color: [0.59, 0.47, 0.28, 1],
    halfTransparent: false,
    texture: PX,
  },
  {
    resourcePath: 'minecraft:block/stone',
    color: [0.49, 0.49, 0.49, 1],
    halfTransparent: false,
    texture: PX,
  },
  {
    resourcePath: 'minecraft:block/water_still',
    color: [0.69, 0.69, 0.69, 0.7],
    halfTransparent: true,
    texture: PX,
  },
];

describe('real textures.json structure', () => {
  const parsed = parseTextures(REAL);
  it('parses the top-level array keyed by resourcePath, with colour and halfTransparent', () => {
    expect(parsed.size).toBe(REAL.length);
    expect(parsed.get('minecraft:block/oak_leaves')?.color).toEqual([0.56, 0.56, 0.56, 0.67]);
    expect(parsed.get('minecraft:block/water_still')?.halfTransparent).toBe(true);
    expect(parsed.get('minecraft:block/stone')?.texture).toBe(PX);
  });

  it('maps block states to the real texture ids per face', () => {
    const layout = buildAtlasLayout(parsed.keys());
    const uv = makeUvLookup(layout);
    const slot = (id: string) => layout.uvOfSlot(layout.slotOf.get(id) as number);
    expect(uv('minecraft:oak_leaves[distance=7,persistent=false]', 'py')).toEqual(
      slot('minecraft:block/oak_leaves'),
    );
    expect(uv('minecraft:oak_leaves[distance=7]', 'px')).toEqual(
      slot('minecraft:block/oak_leaves'),
    );
    expect(uv('minecraft:grass_block[snowy=false]', 'py')).toEqual(
      slot('minecraft:block/grass_block_top'),
    );
    expect(uv('minecraft:grass_block[snowy=false]', 'nz')).toEqual(
      slot('minecraft:block/grass_block_side'),
    );
    expect(uv('minecraft:grass_block[snowy=false]', 'ny')).toEqual(slot('minecraft:block/dirt'));
    expect(uv('minecraft:oak_log[axis=y]', 'py')).toEqual(slot('minecraft:block/oak_log_top'));
    expect(uv('minecraft:oak_log[axis=y]', 'px')).toEqual(slot('minecraft:block/oak_log'));
    expect(uv('minecraft:water[level=0]', 'py')).toEqual(slot('minecraft:block/water_still'));
    expect(uv('minecraft:stone', 'ny')).toEqual(slot('minecraft:block/stone'));
  });

  it('uses missing (slot 0, magenta) only for a block with no texture at all', () => {
    const layout = buildAtlasLayout(parsed.keys());
    const uv = makeUvLookup(layout);
    expect(uv('minecraft:flux_capacitor', 'py')).toEqual(layout.uvOfSlot(0));
    expect(uv('minecraft:stone', 'py')).not.toEqual(layout.uvOfSlot(0));
  });

  it('derives stairs, slabs and wood from their base material', () => {
    expect(faceTextureIds('minecraft:oak_stairs[facing=north]', 'px')).toContain(
      'minecraft:block/oak_planks',
    );
    expect(faceTextureIds('minecraft:stone_brick_slab', 'py')).toContain(
      'minecraft:block/stone_bricks',
    );
    expect(faceTextureIds('minecraft:oak_wood', 'px')).toContain('minecraft:block/oak_log');
  });
});

describe('fallback colour and tint', () => {
  it('falls back to the entry colour, magenta only when there is no entry', () => {
    expect(tileFallbackColour([0.5, 0.25, 1, 1])).toBe('rgb(128, 64, 255)');
    expect(tileFallbackColour(undefined)).toBe('#ff00ff');
    expect(tileFallbackColour([2, -1, 0])).toBe('rgb(255, 0, 0)');
  });

  it('tints grass, leaves and water but not stone', () => {
    expect(tintFor('minecraft:block/grass_block_top')).not.toBeNull();
    expect(tintFor('minecraft:block/oak_leaves')).not.toBeNull();
    expect(tintFor('minecraft:block/water_still')).not.toBeNull();
    expect(tintFor('minecraft:block/stone')).toBeNull();
    expect(tintFor('minecraft:block/grass_block_side')).toBeNull();
    const px = new Uint8ClampedArray([200, 200, 200, 77]);
    applyTint(px, 0x00ff80);
    expect([...px]).toEqual([0, 200, 100, 77]);
  });
});

describe('camera inside foliage', () => {
  const leaves = 'minecraft:oak_leaves[persistent=true]';
  const world = {
    stateAt: (x: number, y: number, z: number) =>
      Math.abs(x) <= 4 && Math.abs(y) <= 4 && Math.abs(z) <= 4 ? leaves : 'minecraft:stone',
  };
  const stoneAt = { stateAt: () => 'minecraft:stone' };

  it('culls see-through blocks within 2 blocks and leaves solids and far leaves', () => {
    const cells = cellsToCull(world, { x: 0.5, y: 0.5, z: 0.5 });
    expect(cells.has('0,0,0')).toBe(true);
    expect(cells.has('2,0,0')).toBe(true);
    expect(cells.has('3,0,0')).toBe(false);
    expect(cellsToCull(stoneAt, { x: 0, y: 0, z: 0 }).size).toBe(0);
  });

  it('meshes no leaf faces around the camera, and does mesh them when not culled', () => {
    const uv = () => ({ u0: 0, v0: 0, u1: 1, v1: 1 });
    const solid = {
      stateAt: (x: number, y: number, z: number) =>
        x >= 0 && x < 16 && y >= 0 && y < 16 && z >= 0 && z < 16 ? leaves : undefined,
    };
    const full = meshSection(solid, 0, 0, 0, uv).indices.length;
    const culled = cellsToCull(solid, { x: 8, y: 8, z: 8 });
    const some = meshSection(new CullingWorld(solid, culled), 0, 0, 0, uv).indices.length;
    expect(culled.size).toBeGreaterThan(0);
    expect(some).toBeGreaterThan(0);
    expect(some).not.toBe(full);
    expect(sectionsOfCells(['17,3,-1'])).toEqual(new Set(['1,0,-1']));
  });
});

describe('status line and page layout', () => {
  it('reports connection, counts and atlas state', () => {
    const base = { connected: true, chunks: 260, entities: 3 };
    expect(statusLine({ ...base, atlas: { state: 'ready', count: 1971 } })).toBe(
      'connected | chunks 260 | entities 3 | atlas ready (1971)',
    );
    expect(
      statusLine({ ...base, connected: false, atlas: { state: 'failed', error: 'HTTP 500' } }),
    ).toContain('atlas FAILED (HTTP 500)');
  });

  it('page wraps the toolbar, sizes touch targets and has a status element', () => {
    const html = readFileSync(join(import.meta.dirname, '../../web/kino/index.html'), 'utf8');
    expect(html).toMatch(/#bar \{[^}]*flex-wrap: wrap/);
    expect(html).toMatch(/\.pane \.tools \{[^}]*flex-wrap: wrap/);
    expect(html).toContain('min-height: 44px');
    expect(html).toContain('id="status"');
    expect(html).not.toMatch(/#bar \{[^}]*position: fixed/);
  });
});

describe('shading, sky and fog', () => {
  it('shades top brightest, bottom darkest, sides between', async () => {
    const { faceShade, SKY_COLOUR, FOG_NEAR, FOG_FAR } = await import('../../web/kino/blocktex.ts');
    expect(faceShade(0, 1, 0)).toBe(1);
    expect(faceShade(0, -1, 0)).toBe(0.5);
    expect(faceShade(1, 0, 0)).toBe(0.6);
    expect(faceShade(-1, 0, 0)).toBe(0.6);
    expect(faceShade(0, 0, 1)).toBe(0.8);
    expect(faceShade(0, 0, -1)).toBe(0.8);
    expect(SKY_COLOUR).toBe(0x87ceeb);
    expect(FOG_NEAR).toBeLessThan(FOG_FAR);
  });

  it('scene has a sky background, fog and per-vertex shade colours', async () => {
    const { KinoScene, toGeometry } = await import('../../web/kino/scene.ts');
    const { FeedState } = await import('../../web/kino/feed.ts');
    const s = new KinoScene(new FeedState(), () => ({ u0: 0, v0: 0, u1: 1, v1: 1 }));
    expect((s.scene.background as { getHex(): number }).getHex()).toBe(0x87ceeb);
    expect(s.scene.fog).not.toBeNull();
    const g = toGeometry({
      positions: [0, 0, 0, 1, 0, 0, 1, 1, 0],
      normals: [0, 1, 0, 0, 1, 0, 0, 1, 0],
      uvs: [0, 0, 0, 0, 0, 0],
      indices: [0, 1, 2],
    });
    expect(g.getAttribute('color').getX(0)).toBe(1);
  });
});
