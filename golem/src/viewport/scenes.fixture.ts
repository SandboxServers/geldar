// Fixture scenes for the viewport golden hashes and knowledge-boundary tests. Each scene is a small
// in-memory world with the same shape as the Body's view: cells in loaded 16-cubed sections, and null
// for everything else. Scenes are plain data, so they need no Kino or Body code.

import type { Vec, ViewportEntity, ViewportRequest, ViewportWorld } from './world.ts';

const AIR = 'air';
const S = (name: string): string => `minecraft:${name}`;

/** A sparse block grid: cells set here are loaded; a section with no cells set is loaded and air. */
export class Grid implements ViewportWorld {
  private readonly cells = new Map<string, string>();
  private readonly sections = new Set<string>();

  private static sectionKey(cx: number, sy: number, cz: number): string {
    return `${cx},${sy},${cz}`;
  }

  /** Declares the section loaded (all air until a cell is set). */
  load(cx: number, sy: number, cz: number): void {
    this.sections.add(Grid.sectionKey(cx, sy, cz));
  }

  set(x: number, y: number, z: number, state: string): void {
    this.cells.set(`${x},${y},${z}`, state);
    this.load(Math.floor(x / 16), Math.floor(y / 16), Math.floor(z / 16));
  }

  fill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, s: string): void {
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) this.set(x, y, z, s);
  }

  blockAt(x: number, y: number, z: number): string | null {
    const key = Grid.sectionKey(Math.floor(x / 16), Math.floor(y / 16), Math.floor(z / 16));
    if (!this.sections.has(key)) return null;
    return this.cells.get(`${x},${y},${z}`) ?? AIR;
  }
}

export interface Scene extends Omit<ViewportRequest, 'options'> {
  /** The view's name in the golden table. */
  name: string;
}

const EYE_HEIGHT = 1.62;
const EAST = (-90 * Math.PI) / 180;

/**
 * Enclosed sandstone pit: 5x5 room (x 2..6, z 2..6), floor y=63, ceiling y=68, walls sandstone, one 1x2
 * gap in the north wall at x=4, z=1. Outside: a grass plain. A zombie stands outside the gap, in line
 * of sight; a creeper stands behind the east wall (x=8..) and must never show.
 */
export function pitWorld(): Grid {
  const g = new Grid();
  g.fill(0, 60, 0, 15, 62, 15, S('stone'));
  g.fill(0, 63, 0, 15, 63, 15, S('grass_block'));
  g.fill(1, 63, 1, 7, 68, 7, S('sandstone'));
  g.fill(2, 64, 2, 6, 67, 6, AIR);
  g.fill(4, 64, 1, 4, 65, 1, AIR); // the gap
  g.fill(12, 64, 8, 12, 66, 8, S('oak_log'));
  g.fill(11, 66, 7, 13, 68, 9, S('oak_leaves'));
  return g;
}

const PIT_ENTITIES: ViewportEntity[] = [
  { type: 'zombie', x: 4.5, y: 64, z: -2.5, width: 0.6, height: 1.95 },
  { type: 'creeper', x: 10.5, y: 64, z: 4.5, width: 0.6, height: 1.7 },
];

/** Looking north through the gap: the zombie is in view. */
export function pitGapScene(): Scene {
  return {
    name: 'pit-gap',
    world: pitWorld(),
    eye: { x: 4.5, y: 63 + 1 + EYE_HEIGHT, z: 4.5 },
    yaw: 0,
    pitch: 0,
    entities: PIT_ENTITIES,
  };
}

/** Looking east at the wall with the creeper behind it: the creeper must not change a pixel. */
export function pitWallScene(entities: readonly ViewportEntity[] = PIT_ENTITIES): Scene {
  return {
    name: 'pit-wall',
    world: pitWorld(),
    eye: { x: 4.5, y: 63 + 1 + EYE_HEIGHT, z: 4.5 },
    yaw: EAST,
    pitch: 0,
    entities: [...entities],
  };
}

/** Open rolling terrain 64x64 with a pond and a few trees; no chunks beyond it are loaded. */
export function terrainWorld(): Grid {
  const g = new Grid();
  const height = terrainHeight;
  for (let cx = 0; cx < 4; cx++)
    for (let cz = 0; cz < 4; cz++) for (let sy = 3; sy <= 5; sy++) g.load(cx, sy, cz);
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
  return g;
}

function terrainHeight(x: number, z: number): number {
  return Math.round(66 + 4 * Math.sin(x / 9) + 3 * Math.cos(z / 7) + 2 * Math.sin((x + z) / 5));
}

/**
 * Rolling terrain from the west edge, looking east and slightly down, so the far ground is 48 to 60
 * blocks away and the distance fog is exercised. A zombie stands on the slope.
 */
export function terrainScene(): Scene {
  // 20 blocks up so the sight line clears the hills and the far ground is 48 to 59 blocks away.
  const eye: Vec = { x: 4.5, y: terrainHeight(4, 32) + 20, z: 32.5 };
  return {
    name: 'terrain',
    world: terrainWorld(),
    eye,
    yaw: EAST,
    pitch: -0.38,
    entities: [
      { type: 'zombie', x: 22.5, y: terrainHeight(22, 14), z: 14.5, width: 0.6, height: 1.95 },
    ],
  };
}
