import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';

/** A cell as the door rules read it: its registry name and, for doors, its state properties. */
export interface CellProbe {
  name?: string;
  getProperties?: () => Record<string, unknown> | undefined;
}

/** A path node as the pathfinder hands it over in `path_update`. */
export interface PathNodeLike {
  x: number;
  y: number;
  z: number;
}

/** The last `path_update` of one body: its status and the node array the library stores next. */
interface PathRecord {
  status?: string | undefined;
  path: PathNodeLike[];
}

const records = new WeakMap<object, PathRecord>();

/** A door or a fence gate: a block the body walks through or opens, not a wall for an escape. */
export function isDoorLike(cell: CellProbe | null | undefined): boolean {
  const name = cell?.name ?? '';
  return name.endsWith('_door') || name.endsWith('_fence_gate');
}

/** The lower half of a wooden door. Iron doors need redstone, so they are never walked through. */
export function isWoodenDoorLower(cell: CellProbe | null | undefined): boolean {
  const name = cell?.name ?? '';
  if (!name.endsWith('_door') || name.startsWith('iron_')) return false;
  return cell?.getProperties?.()?.half === 'lower';
}

/**
 * Puts a node back in the doorway when the library lifted it onto a door. `postProcessPath` (mineflayer-
 * pathfinder 2.4.5) moves each node onto the top of the real collision shape of its block. A door's
 * lower half is a block tall, so the node of a doorway lands one block up, at the door's edge, and the
 * bot never reaches it. The node is set to the centre of the door's cell at the door's floor.
 */
export function snapDoorNodes(path: PathNodeLike[], bot: Bot): void {
  for (const node of path) {
    const cell = new Vec3(Math.floor(node.x), Math.floor(node.y) - 1, Math.floor(node.z));
    if (!isWoodenDoorLower(bot.blockAt(cell) as CellProbe | null)) continue;
    node.x = cell.x + 0.5;
    node.y = cell.y;
    node.z = cell.z + 0.5;
  }
}

/**
 * The `path_update` listener. It snaps door nodes in place, before the library assigns the path: the
 * array it stores next is this same array, so the snapped nodes are the ones it follows.
 */
export function onPathUpdate(bot: Bot, update: unknown): void {
  const result = update as { status?: string; path?: PathNodeLike[] } | null | undefined;
  if (!Array.isArray(result?.path)) return;
  snapDoorNodes(result.path, bot);
  records.set(bot, { status: result.status, path: result.path });
}

/** The status the library last reported for this body's path, or undefined before any path. */
export function lastPathStatus(bot: Bot): string | undefined {
  return records.get(bot)?.status;
}

/** True when `cell` or a side of it at feet or head height holds a door or a fence gate. */
function touchesDoor(bot: Bot, cell: Vec3): boolean {
  for (const [dx, dz] of [
    [0, 0],
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    for (const dy of [0, 1]) {
      const at = cell.offset(dx, dy, dz);
      if (isDoorLike(bot.blockAt(at) as CellProbe | null)) return true;
    }
  }
  return false;
}

/**
 * True when a door or fence gate is next to the bot or to the path node nearest to it (the node the
 * bot is walking to). A stall there is a doorway problem: digging or pillaring cannot clear it.
 */
export function nearDoor(bot: Bot): boolean {
  const here = bot.entity.position;
  if (touchesDoor(bot, here.floored())) return true;
  let nearest: PathNodeLike | undefined;
  let best = Number.POSITIVE_INFINITY;
  for (const node of records.get(bot)?.path ?? []) {
    const d = Math.hypot(node.x + 0.5 - here.x, node.z + 0.5 - here.z);
    if (d < best) {
      best = d;
      nearest = node;
    }
  }
  return (
    nearest !== undefined && touchesDoor(bot, new Vec3(nearest.x, nearest.y, nearest.z).floored())
  );
}
