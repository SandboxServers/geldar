// Fixture scenes, built as Kino chunk_section messages and loaded into Kino's own VoxelWorld, so the
// renderer is shown to read the same voxel store the Glass client meshes from.

import type { ChunkSectionMessage } from '../../../contract/src/generated/types.ts';
import { VoxelWorld } from '../../../glass/web/kino/world.ts';
import type { SeenEntity } from './render.ts';

const AIR = 'minecraft:air';

export class Grid {
  private readonly cells = new Map<string, string>();
  private readonly sections = new Set<string>();
  /** Declares a section loaded (all air until set). */
  load(cx: number, sy: number, cz: number): void {
    this.sections.add(`${cx},${sy},${cz}`);
  }
  set(x: number, y: number, z: number, state: string): void {
    this.cells.set(`${x},${y},${z}`, state);
    this.load(Math.floor(x / 16), Math.floor(y / 16), Math.floor(z / 16));
  }
  fill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, s: string): void {
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.set(x, y, z, s);
  }
  toWorld(): VoxelWorld {
    const world = new VoxelWorld();
    for (const key of this.sections) {
      const [cx, sy, cz] = key.split(',').map(Number) as [number, number, number];
      const palette = [AIR];
      const idx = new Uint16Array(4096);
      for (let y = 0; y < 16; y++)
        for (let z = 0; z < 16; z++)
          for (let x = 0; x < 16; x++) {
            const s = this.cells.get(`${cx * 16 + x},${sy * 16 + y},${cz * 16 + z}`);
            if (!s) continue;
            let i = palette.indexOf(s);
            if (i < 0) i = palette.push(s) - 1;
            idx[(y * 16 + z) * 16 + x] = i;
          }
      world.applySection(encode(cx, sy, cz, palette, idx));
    }
    return world;
  }
}

function encode(
  cx: number,
  sy: number,
  cz: number,
  palette: string[],
  idx: Uint16Array,
): ChunkSectionMessage {
  const bits = palette.length <= 1 ? 0 : Math.max(1, Math.ceil(Math.log2(palette.length)));
  const bytes = new Uint8Array(Math.ceil((4096 * bits) / 8));
  if (bits > 0)
    for (let i = 0; i < 4096; i++)
      for (let b = 0; b < bits; b++)
        if (((idx[i] as number) >> b) & 1) {
          const bit = i * bits + b;
          bytes[bit >> 3] = (bytes[bit >> 3] as number) | (1 << (bit & 7));
        }
  return {
    type: 'chunk_section',
    chunk_x: cx,
    chunk_z: cz,
    section_y: sy,
    palette,
    bits,
    data: Buffer.from(bytes).toString('base64'),
  } as ChunkSectionMessage;
}

export interface Scene {
  world: VoxelWorld;
  entities: SeenEntity[];
}

const S = (n: string): string => `minecraft:${n}`;

/**
 * Enclosed sandstone pit: 5x5 room (x 2..6, z 2..6), floor y=63, ceiling y=68, walls sandstone,
 * one 1x2 gap in the north wall at x=4. Outside: grass plain. A zombie stands outside the gap in the
 * line of sight, and another stands behind the east wall (must stay hidden).
 */
export function pitScene(): Scene {
  const g = new Grid();
  g.fill(0, 60, 0, 15, 62, 15, S('stone'));
  g.fill(0, 63, 0, 15, 63, 15, S('grass_block'));
  g.fill(1, 63, 1, 7, 68, 7, S('sandstone'));
  g.fill(2, 64, 2, 6, 67, 6, AIR);
  g.fill(4, 64, 1, 4, 65, 1, AIR); // the gap
  g.fill(12, 64, 8, 12, 66, 8, S('oak_log'));
  g.fill(11, 66, 7, 13, 68, 9, S('oak_leaves'));
  return {
    world: g.toWorld(),
    entities: [
      { type: 'zombie', x: 4.5, y: 64, z: -2.5, width: 0.6, height: 1.95 },
      { type: 'creeper', x: 10.5, y: 64, z: 4.5, width: 0.6, height: 1.7 },
    ],
  };
}

/** Open rolling terrain 64x64 with a pond and a few trees; edge chunks beyond are not loaded. */
export function terrainScene(): Scene {
  const g = new Grid();
  const height = (x: number, z: number): number =>
    Math.round(66 + 4 * Math.sin(x / 9) + 3 * Math.cos(z / 7) + 2 * Math.sin((x + z) / 5));
  for (let x = 0; x < 64; x++)
    for (let z = 0; z < 64; z++) {
      const h = height(x, z);
      g.fill(x, 56, z, x, h - 3, z, S('stone'));
      g.fill(x, h - 2, z, x, h - 1, z, S('dirt'));
      const pond = (x - 40) ** 2 + (z - 20) ** 2 < 36;
      g.set(x, h, z, pond ? S('sand') : S('grass_block'));
      if (pond) g.fill(x, h + 1, z, x, 68, z, S('water'));
      if (!pond && (x * 7 + z * 13) % 41 === 0) {
        g.fill(x, h + 1, z, x, h + 4, z, S('oak_log'));
        g.fill(x - 1, h + 3, z - 1, x + 1, h + 5, z + 1, S('oak_leaves'));
      }
    }
  return {
    world: g.toWorld(),
    entities: [{ type: 'zombie', x: 22.5, y: height(22, 14), z: 14.5, width: 0.6, height: 1.95 }],
  };
}
export const spawnY = (scene: Scene, x: number, z: number): number => {
  for (let y = 120; y > 0; y--) {
    const s = scene.world.stateAt(x, y, z);
    if (s && s !== AIR) return y + 1;
  }
  return 64;
};
