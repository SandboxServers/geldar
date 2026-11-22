import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { feetCell } from './feet-cell.ts';
import { entityInCell } from './pillar.ts';
import type { Footprint } from './place-footprint.ts';

/** Cells a placement may replace: the target cell must hold one of these. */
export const REPLACEABLE = new Set([
  'air',
  'cave_air',
  'void_air',
  'water',
  'short_grass',
  'tall_grass',
  'fern',
  'large_fern',
  'dead_bush',
  'seagrass',
  'tall_seagrass',
  'vine',
  'glow_lichen',
  'short_dry_grass',
  'tall_dry_grass',
  'dandelion',
  'poppy',
  'blue_orchid',
  'allium',
  'azure_bluet',
  'red_tulip',
  'orange_tulip',
  'white_tulip',
  'pink_tulip',
  'oxeye_daisy',
  'cornflower',
  'lily_of_the_valley',
  'wither_rose',
  'torchflower',
  'open_eyeblossom',
  'closed_eyeblossom',
  'pink_petals',
  'brown_mushroom',
  'red_mushroom',
  'sunflower',
  'lilac',
  'rose_bush',
  'peony',
  'pitcher_plant',
  'snow',
]);

/** Reference candidates for a block at a position, in the order they are tried. */
export const NEIGHBOR_OFFSETS: readonly Vec3[] = [
  new Vec3(0, -1, 0),
  new Vec3(1, 0, 0),
  new Vec3(-1, 0, 0),
  new Vec3(0, 0, 1),
  new Vec3(0, 0, -1),
  new Vec3(0, 1, 0),
];

/** The four horizontal steps, in a fixed order. */
const CARDINALS: readonly Vec3[] = [
  new Vec3(1, 0, 0),
  new Vec3(0, 0, 1),
  new Vec3(-1, 0, 0),
  new Vec3(0, 0, -1),
];

/** True when the cell is the bot's feet cell or the cell above it. */
export function inBody(bot: Bot, cell: Vec3): boolean {
  const feet = feetCell(bot);
  return cell.equals(feet) || cell.equals(feet.offset(0, 1, 0));
}

/**
 * The first cell beside the bot, in facing order, that is open and has a solid neighbor. A bed
 * also needs the cell one further on, where its second half goes.
 */
export function freeBeside(
  bot: Bot,
  body: Vec3,
  footprint: Footprint,
): { target: Vec3; step: Vec3 } | null {
  for (const step of stepsFromFacing(bot.entity.yaw)) {
    const cell = body.plus(step);
    if (!isFree(bot, cell)) continue;
    if (footprint === 'bed' && !isOpen(bot, cell.plus(step))) continue;
    if (footprint === 'up' && !isOpen(bot, cell.offset(0, 1, 0))) continue;
    return { target: cell, step };
  }
  return null;
}

/** The cardinal step the bot faces, then the other three in their fixed order. */
export function stepsFromFacing(yaw: number): Vec3[] {
  const dx = -Math.sin(yaw);
  const dz = -Math.cos(yaw);
  const facing =
    Math.abs(dx) > Math.abs(dz) ? new Vec3(Math.sign(dx), 0, 0) : new Vec3(0, 0, Math.sign(dz));
  return [facing, ...CARDINALS.filter((step) => !step.equals(facing))];
}

/** True when a block may replace the cell and no entity's box overlaps it. */
function isOpen(bot: Bot, cell: Vec3): boolean {
  const name = bot.blockAt(cell)?.name;
  return name !== undefined && REPLACEABLE.has(name) && !entityInCell(bot, cell);
}

/** True when the cell is open and one of its neighbors is solid to place against. */
function isFree(bot: Bot, cell: Vec3): boolean {
  return (
    isOpen(bot, cell) &&
    NEIGHBOR_OFFSETS.some((o) => bot.blockAt(cell.plus(o))?.boundingBox === 'block')
  );
}
