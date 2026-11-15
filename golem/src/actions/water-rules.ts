import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';

/** Block names that put the Body in water: plain water, and the plants and bubbles that grow in it. */
export const WET_CELLS = new Set([
  'water',
  'bubble_column',
  'seagrass',
  'tall_seagrass',
  'kelp',
  'kelp_plant',
]);

/** A predicate over world cells: true when the cell is one of `WET_CELLS`. */
export function wetAt(bot: Bot): (x: number, y: number, z: number) => boolean {
  return (x, y, z) => {
    const name = bot.blockAt(new Vec3(x, y, z))?.name;
    return name !== undefined && WET_CELLS.has(name);
  };
}

/** True when the node's feet cell is water: a walk must not end there. */
export function isWetNode(
  bot: Bot,
  node: { x: number; y: number; z: number } | undefined,
): boolean {
  return node !== undefined && wetAt(bot)(node.x, node.y, node.z);
}
