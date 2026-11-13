// An invented world for the Kino preview: rolling grass, a pond, trees, a stone wall and a hut, and
// three agents walking their own routes. Test-only. Textures and skins are drawn here from noise, so no
// game asset is used or committed.

import type { EntityPosition, KinoFeed } from '../../../contract/src/generated/types.ts';
import { cellIndex, encodePaletteIndices } from '../../web/kino/palette.ts';
import { encodePng, pngDataUri } from './png.ts';

export interface PreviewAgent {
  id: string;
  label: string;
  /** Feet position and Minecraft yaw (degrees) at time `t` seconds. */
  at(t: number): { x: number; z: number; yaw: number };
  skin: { shirt: number; pants: number; hair: number; skin: number };
}

/** The ground height (the top solid block's y) at a column. */
export function groundAt(x: number, z: number): number {
  if (inPond(x, z)) return 62;
  return 64 + Math.round(1.6 * Math.sin(x / 9) + 1.4 * Math.cos(z / 11));
}

/** A stable 0..1 value per column, for scattering plants. */
const hash = (x: number, z: number): number => {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const inPond = (x: number, z: number): boolean => (x - 12) ** 2 + (z + 9) ** 2 < 34;
const TREES: [number, number][] = [
  [-6, -14],
  [15, 6],
  [-17, 3],
  [4, 15],
  [-3, 20],
  [22, -4],
];
const WALL = { x: 6, z0: -5, z1: 3, h: 3 };
const HUT = { x0: -16, x1: -10, z0: -14, z1: -9 };

/** The block state at a position, or air. */
export function blockAt(x: number, y: number, z: number): string {
  const g = groundAt(x, z);
  if (inPond(x, z)) {
    if (y <= 61) return 'minecraft:sand';
    if (y <= 64) return 'minecraft:water[level=0]';
    return 'minecraft:air';
  }
  if (y < g - 3) return 'minecraft:stone';
  if (y < g) return 'minecraft:dirt';
  if (y === g) return 'minecraft:grass_block[snowy=false]';
  // Wall: three high along x = 6.
  if (x === WALL.x && z >= WALL.z0 && z <= WALL.z1 && y <= g + WALL.h)
    return 'minecraft:cobblestone';
  // Hut: cobblestone walls with a door gap, a plank roof.
  if (x >= HUT.x0 && x <= HUT.x1 && z >= HUT.z0 && z <= HUT.z1) {
    const base = groundAt(HUT.x0, HUT.z0);
    const edge = x === HUT.x0 || x === HUT.x1 || z === HUT.z0 || z === HUT.z1;
    if (y === base + 5) return 'minecraft:oak_planks';
    const door = z === HUT.z1 && x === HUT.x0 + 3 && y <= base + 2;
    if (edge && y > g && y <= base + 4 && !door) return 'minecraft:cobblestone';
  }
  for (const [tx, tz] of TREES) {
    const tg = groundAt(tx, tz);
    if (x === tx && z === tz && y > tg && y <= tg + 5) return 'minecraft:oak_log[axis=y]';
    const dy = y - (tg + 5);
    const r = dy <= 0 ? 2 : 1;
    if (dy >= -1 && dy <= 1 && Math.abs(x - tx) <= r && Math.abs(z - tz) <= r) {
      if (!(Math.abs(x - tx) === r && Math.abs(z - tz) === r))
        return 'minecraft:oak_leaves[persistent=false]';
    }
  }
  if (y === g + 1) {
    const h = hash(x, z);
    if (h < 0.08) return 'minecraft:short_grass';
    if (h > 0.993) return 'minecraft:poppy';
  }
  return 'minecraft:air';
}

/** Chunks -RADIUS..RADIUS-1 on each axis; sections 3 and 4 (y 48 to 79). */
export const RADIUS = 3;

export function sectionMessages(): KinoFeed[] {
  const out: KinoFeed[] = [];
  for (let cx = -RADIUS; cx < RADIUS; cx++)
    for (let cz = -RADIUS; cz < RADIUS; cz++)
      for (const sy of [3, 4]) {
        const palette: [string, ...string[]] = ['minecraft:air'];
        const idx = new Uint16Array(4096);
        for (let y = 0; y < 16; y++)
          for (let z = 0; z < 16; z++)
            for (let x = 0; x < 16; x++) {
              const s = blockAt(cx * 16 + x, sy * 16 + y, cz * 16 + z);
              let i = palette.indexOf(s);
              if (i < 0) i = palette.push(s) - 1;
              idx[cellIndex(x, y, z)] = i;
            }
        const bits = palette.length <= 1 ? 0 : Math.ceil(Math.log2(palette.length));
        out.push({
          type: 'chunk_section',
          chunk_x: cx,
          chunk_z: cz,
          section_y: sy,
          palette,
          bits,
          data: encodePaletteIndices(idx, bits),
        });
      }
  return out;
}

const yawOf = (dx: number, dz: number): number => (Math.atan2(-dx, dz) * 180) / Math.PI;

export const AGENTS: PreviewAgent[] = [
  {
    id: 'ag_ember_01',
    label: 'Ember',
    // A wide loop round the wall.
    at: (t) => {
      const a = t * 0.3;
      const x = 2 + Math.cos(a) * 11;
      const z = Math.sin(a) * 11;
      return { x, z, yaw: yawOf(-Math.sin(a), Math.cos(a)) };
    },
    skin: { shirt: 0xc8452c, pants: 0x2d3550, hair: 0x5a2c14, skin: 0xe0ac86 },
  },
  {
    id: 'ag_moss_02',
    label: 'Moss',
    // A figure of eight in the trees.
    at: (t) => {
      const a = t * 0.22;
      const x = -9 + Math.sin(a) * 8;
      const z = 6 + Math.sin(2 * a) * 5;
      return { x, z, yaw: yawOf(Math.cos(a) * 8, 2 * Math.cos(2 * a) * 5) };
    },
    skin: { shirt: 0x4f7a3a, pants: 0x4a3a28, hair: 0x1e1a14, skin: 0x8d5a3c },
  },
  {
    id: 'ag_tide_03',
    label: 'Tide',
    // Walks to the pond, stands looking about, walks back.
    at: (t) => {
      const p = (t % 24) / 24;
      const walk = p < 0.4 ? p / 0.4 : p < 0.6 ? 1 : 1 - (p - 0.6) / 0.4;
      const x = -2 + walk * 9;
      const z = -9;
      const yaw = p < 0.4 ? -90 : p < 0.6 ? -90 + Math.sin((p - 0.4) * 40) * 70 : 90;
      return { x, z, yaw };
    },
    skin: { shirt: 0x2f7fa8, pants: 0x30302e, hair: 0xd8c27a, skin: 0xf0c8a8 },
  },
];

export function entityPositions(t: number): EntityPosition[] {
  return AGENTS.map((a, i) => {
    const p = a.at(t);
    return {
      id: `e${i + 1}`,
      type: 'minecraft:player',
      agent_id: a.id,
      x: p.x,
      y: groundAt(Math.floor(p.x), Math.floor(p.z)) + 1,
      z: p.z,
      yaw: p.yaw,
      pitch: 0,
    };
  });
}

/** A seeded noise value in 0..1 for a pixel. */
const noise = (x: number, y: number, seed: number): number => {
  const s = Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453;
  return s - Math.floor(s);
};

function tile(
  base: number,
  seed: number,
  spread: number,
  alpha?: (x: number, y: number) => number,
) {
  const px = new Uint8Array(16 * 16 * 4);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const k = 1 - spread / 2 + noise(x, y, seed) * spread;
      const o = (y * 16 + x) * 4;
      px[o] = Math.min(255, ((base >> 16) & 255) * k);
      px[o + 1] = Math.min(255, ((base >> 8) & 255) * k);
      px[o + 2] = Math.min(255, (base & 255) * k);
      px[o + 3] = alpha ? alpha(x, y) : 255;
    }
  return px;
}

/** BlueMap's textures.json shape: [{ resourcePath, color, halfTransparent, texture }]. */
export function texturesJson(): unknown[] {
  const grassSide = tile(0x866043, 5, 0.35);
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 16; x++) {
      if (y === 3 && noise(x, 9, 1) > 0.5) continue;
      const o = (y * 16 + x) * 4;
      grassSide.set([95, 159, 53, 255], o);
    }
  const plant = (x: number, y: number): number =>
    Math.abs(x - 8) < 1 + (16 - y) / 5 && noise(x, y, 4) > 0.35 && y > 3 ? 255 : 0;
  const poppy = tile(0xc0281e, 8, 0.2, (x, y) =>
    (y > 8 && Math.abs(x - 8) < 1) || (y <= 8 && y > 3 && Math.abs(x - 8) < 3) ? 255 : 0,
  );
  const entries: [string, Uint8Array, boolean][] = [
    ['grass_block_top', tile(0x9c9c9c, 1, 0.3), false],
    ['grass_block_side', grassSide, false],
    ['dirt', tile(0x866043, 2, 0.35), false],
    ['stone', tile(0x7d7d7d, 3, 0.3), false],
    ['cobblestone', tile(0x6f6f6f, 6, 0.6), false],
    ['sand', tile(0xdbcfa3, 7, 0.15), false],
    ['oak_planks', tile(0xa2824e, 9, 0.25), false],
    ['oak_log', tile(0x6b5130, 10, 0.4), false],
    ['oak_log_top', tile(0xb08d57, 11, 0.3), false],
    ['oak_leaves', tile(0xa0a0a0, 12, 0.5, (x, y) => (noise(x, y, 13) > 0.25 ? 255 : 0)), true],
    ['water_still', tile(0xb0b0b0, 14, 0.15, () => 190), true],
    ['short_grass', tile(0x9c9c9c, 15, 0.3, plant), true],
    ['poppy', poppy, true],
  ];
  return entries.map(([name, px, half]) => ({
    resourcePath: `minecraft:block/${name}`,
    color: [0.5, 0.5, 0.5, 1],
    halfTransparent: half,
    texture: pngDataUri(16, 16, px),
  }));
}

/** A 64x64 classic skin: hair, face, shirt, trousers. */
export function skinPng(a: PreviewAgent): Buffer {
  const px = new Uint8Array(64 * 64 * 4);
  const fill = (x0: number, y0: number, w: number, h: number, rgb: number): void => {
    for (let y = y0; y < y0 + h; y++)
      for (let x = x0; x < x0 + w; x++) {
        const k = 0.9 + noise(x, y, 2) * 0.2;
        px.set(
          [((rgb >> 16) & 255) * k, ((rgb >> 8) & 255) * k, (rgb & 255) * k, 255].map((v) =>
            Math.min(255, v),
          ),
          (y * 64 + x) * 4,
        );
      }
  };
  const { shirt, pants, hair, skin } = a.skin;
  fill(0, 0, 32, 16, skin); // head
  fill(8, 0, 8, 8, hair); // top
  fill(0, 8, 32, 2, hair); // hair band round the head
  fill(24, 8, 8, 8, hair); // back of the head
  fill(9, 12, 2, 1, 0xffffff); // eyes
  fill(13, 12, 2, 1, 0xffffff);
  fill(10, 12, 1, 1, 0x26324a);
  fill(13, 12, 1, 1, 0x26324a);
  fill(11, 14, 2, 1, 0x9a5a4a); // mouth
  fill(0, 16, 16, 16, pants); // right leg
  fill(16, 16, 24, 16, shirt); // body
  fill(40, 16, 16, 16, shirt); // right arm
  fill(44, 26, 8, 6, skin); // hand
  fill(16, 48, 16, 16, pants); // left leg
  fill(32, 48, 16, 16, shirt); // left arm
  fill(36, 58, 8, 6, skin);
  fill(0, 28, 16, 4, 0x2a2420); // shoes
  fill(16, 60, 16, 4, 0x2a2420);
  return encodePng(64, 64, px);
}
