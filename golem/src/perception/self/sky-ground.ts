import type { Snapshot } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';

type Self = Snapshot['self'];
type Trapped = NonNullable<Self['trapped']>;
type Sun = NonNullable<Self['sun']>;

/** Ground is searched this many cells down; no ground within the cap reads as the cap. */
const GROUND_CAP = 32;
/** The highest cell searched for sky. A solid cell above the bot means no sky above it. */
const SKY_TOP = 319;

const OPEN = new Set(['air', 'cave_air', 'void_air', 'water', 'lava']);

/** Air, liquid and leaves do not stop a fall or block the sky. Everything else is ground or a wall. */
function isOpen(name: string): boolean {
  return OPEN.has(name) || name.endsWith('leaves');
}

/** The name of the block at a cell, or null when the cell is not loaded or has no name. */
function nameAt(bot: Bot, x: number, y: number, z: number): string | null {
  const name = bot.blockAt(new Vec3(x, y, z))?.name;
  return typeof name === 'string' ? name : null;
}

/**
 * The air cells between the feet and the first solid cell below them, leaves excepted. The cell
 * under the feet is 0 air cells. Null when a cell on the way is not loaded.
 */
function groundBelow(bot: Bot, x: number, feet: number, z: number): number | null {
  for (let n = 0; n < GROUND_CAP; n++) {
    const name = nameAt(bot, x, feet - 1 - n, z);
    if (name === null) return null;
    if (!isOpen(name)) return n;
  }
  return GROUND_CAP;
}

/** True when a solid block stands on all four sides at the feet and at the head. Null when unloaded. */
function wallsAround(bot: Bot, x: number, feet: number, z: number): boolean | null {
  for (const [dx, dz] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    for (const y of [feet, feet + 1]) {
      const name = nameAt(bot, x + dx, y, z + dz);
      if (name === null) return null;
      if (isOpen(name)) return false;
    }
  }
  return true;
}

/** Pit when walls stand around the bot and ground was found; perched when the ground is below it. */
function trappedState(ground: number, walls: boolean): Trapped {
  if (walls && ground < GROUND_CAP) return 'pit';
  if (ground > 0) return 'perched';
  return 'none';
}

/** True when nothing solid is above the feet up to the sky height. Null when a cell is not loaded. */
function skyAbove(bot: Bot, x: number, feet: number, z: number): boolean | null {
  for (let y = feet + 1; y <= SKY_TOP; y++) {
    const name = nameAt(bot, x, y, z);
    if (name === null) return null;
    if (!isOpen(name)) return false;
  }
  return true;
}

/** The sun phase for a world time of day. Edges: 3000, 9000, 11000 and 12000 start a new phase. */
export function sunPhase(timeOfDay: number): Sun {
  const t = ((timeOfDay % 24000) + 24000) % 24000;
  if (t < 3000) return 'morning';
  if (t < 9000) return 'midday';
  if (t < 11000) return 'afternoon';
  if (t < 12000) return 'low';
  return 'set';
}

/**
 * Sky and ground for `self`: the air below the feet (`ground_below`, capped at 32), the trapped
 * state (`trapped`) and the coarse sun phase (`sun`, only when there is sky above). A field is left
 * out when a cell it needs is not loaded; nothing is thrown.
 */
export function skyGround(bot: Bot): Partial<Self> {
  const x = Math.floor(bot.entity.position.x);
  const feet = Math.floor(bot.entity.position.y);
  const z = Math.floor(bot.entity.position.z);
  const out: Partial<Self> = {};
  const ground = groundBelow(bot, x, feet, z);
  if (ground !== null) {
    out.ground_below = ground;
    const walls = wallsAround(bot, x, feet, z);
    if (walls !== null) out.trapped = trappedState(ground, walls);
  }
  const sky = skyAbove(bot, x, feet, z);
  const time = bot.time?.timeOfDay;
  if (sky === true && typeof time === 'number') out.sun = sunPhase(time);
  return out;
}
