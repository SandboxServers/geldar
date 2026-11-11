// Applies feed messages to the voxel store and tells the view what to remesh. The feed is read-only:
// this module never sends anything.

import type { EntityPosition, KinoFeed } from '../../../contract/src/generated/types.ts';
import { parseKey, VoxelWorld } from './world.ts';

export interface FeedChange {
  dirty: string[]; // section keys to (re)mesh
  entities?: EntityPosition[];
  bye?: string;
}

export class FeedState {
  readonly world = new VoxelWorld();
  entities: EntityPosition[] = [];
  focus: { x: number; y: number; z: number } | null = null;

  apply(msg: KinoFeed): FeedChange {
    switch (msg.type) {
      case 'chunk_section': {
        const key = this.world.applySection(msg);
        // Neighbours may have had a border face drawn against this section's absence.
        const [cx, sy, cz] = parseKey(key);
        return { dirty: [key, ...this.loadedNeighbours(cx, sy, cz)] };
      }
      case 'block_update': {
        const key = this.world.applyUpdate(msg);
        if (key === null) return { dirty: [] };
        const [cx, sy, cz] = parseKey(key);
        const { x, y, z } = msg.pos;
        const lx = ((x % 16) + 16) % 16;
        const ly = ((y % 16) + 16) % 16;
        const lz = ((z % 16) + 16) % 16;
        const dirty = [key];
        const edge = (v: number, axis: [number, number, number]) => {
          if (v === 0) dirty.push(`${cx - axis[0]},${sy - axis[1]},${cz - axis[2]}`);
          if (v === 15) dirty.push(`${cx + axis[0]},${sy + axis[1]},${cz + axis[2]}`);
        };
        edge(lx, [1, 0, 0]);
        edge(ly, [0, 1, 0]);
        edge(lz, [0, 0, 1]);
        return { dirty: dirty.filter((k) => this.world.has(k)) };
      }
      case 'entity_positions':
        this.entities = msg.entities;
        return { dirty: [], entities: msg.entities };
      case 'target_moved':
        this.focus = { x: msg.x, y: msg.y, z: msg.z };
        return { dirty: [] };
      case 'bye':
        return { dirty: [], bye: msg.reason };
      default:
        return { dirty: [] };
    }
  }

  private loadedNeighbours(cx: number, sy: number, cz: number): string[] {
    const out: string[] = [];
    const offsets: [number, number, number][] = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ];
    for (const [dx, dy, dz] of offsets) {
      const k = `${cx + dx},${sy + dy},${cz + dz}`;
      if (this.world.has(k)) out.push(k);
    }
    return out;
  }
}
