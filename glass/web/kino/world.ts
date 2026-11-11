// The voxel store the mesher reads: decoded sections plus block_update edits.

import type {
  BlockUpdateMessage,
  ChunkSectionMessage,
} from '../../../contract/src/generated/types.ts';
import { cellIndex, decodePaletteIndices } from './palette.ts';

const AIR = new Set(['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air']);

export function isAir(state: string | undefined): boolean {
  return state === undefined || AIR.has(state);
}

interface Section {
  palette: string[];
  cells: Uint16Array;
}

export const sectionKey = (cx: number, sy: number, cz: number): string => `${cx},${sy},${cz}`;

export function parseKey(key: string): [number, number, number] {
  const [cx = 0, sy = 0, cz = 0] = key.split(',').map(Number);
  return [cx, sy, cz];
}

export class VoxelWorld {
  private readonly sections = new Map<string, Section>();

  /** Stores a chunk_section. Returns its key. */
  applySection(msg: ChunkSectionMessage): string {
    const cells = decodePaletteIndices(msg);
    const key = sectionKey(msg.chunk_x, msg.section_y, msg.chunk_z);
    this.sections.set(key, { palette: [...msg.palette], cells });
    return key;
  }

  /** Applies a block_update. Returns the key of the section it changed (null: section not loaded). */
  applyUpdate(msg: BlockUpdateMessage): string | null {
    const { x, y, z } = msg.pos;
    const key = sectionKey(Math.floor(x / 16), Math.floor(y / 16), Math.floor(z / 16));
    const section = this.sections.get(key);
    if (!section) return null;
    let idx = section.palette.indexOf(msg.state);
    if (idx < 0) {
      idx = section.palette.length;
      section.palette.push(msg.state);
    }
    section.cells[cellIndex(((x % 16) + 16) % 16, ((y % 16) + 16) % 16, ((z % 16) + 16) % 16)] =
      idx;
    return key;
  }

  has(key: string): boolean {
    return this.sections.has(key);
  }

  keys(): string[] {
    return [...this.sections.keys()];
  }

  /** The block state at world coordinates; undefined where no section is loaded. */
  stateAt(x: number, y: number, z: number): string | undefined {
    const section = this.sections.get(
      sectionKey(Math.floor(x / 16), Math.floor(y / 16), Math.floor(z / 16)),
    );
    if (!section) return undefined;
    const i =
      section.cells[cellIndex(((x % 16) + 16) % 16, ((y % 16) + 16) % 16, ((z % 16) + 16) % 16)] ??
      0;
    return section.palette[i];
  }
}
