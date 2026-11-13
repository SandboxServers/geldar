import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { isOwnPlacement } from './own-placements.ts';

/**
 * Which blocks `goto` may never dig (decision 0164). The owner's rule: a walk never digs through
 * someone else's work, and natural blocks that were placed or sit in a built area are someone's
 * work too. Digging for `mine` is not covered: `mine` stays free.
 */

/** A block as the pathfinder hands it over: a name, an id and a position. */
export interface ProtectBlock {
  name?: string;
  position: { x: number; y: number; z: number };
}

/**
 * The ownership record (plugin, later; subject `geldar.<shard>.blockowner.query`). It returns the
 * owner's name for a cell, or null and undefined when nobody is recorded. Off until a lookup is set
 * and `OWNERSHIP_RULE` is true, so the default walk ignores owners.
 */
export type OwnerLookup = (pos: Vec3) => string | null | undefined;

/** The feature flag for the owner rule. Off: the ownership record is not read yet (0164). */
export const OWNERSHIP_RULE = false;

let ownerLookup: OwnerLookup | null = null;

/** Sets the ownership record reader (the plugin packet calls this); null clears it. */
export function setOwnerLookup(lookup: OwnerLookup | null): void {
  ownerLookup = lookup;
}

/** Built materials by name suffix: planks, slabs, stairs, walls, fences, wool, concrete, terracotta. */
const BUILT_SUFFIXES = [
  '_planks',
  '_slab',
  '_stairs',
  '_wall',
  '_fence',
  '_door',
  '_trapdoor',
  '_carpet',
  '_wool',
  '_concrete',
  '_concrete_powder',
  '_glazed_terracotta',
  '_stained_glass',
  '_stained_glass_pane',
  '_bed',
  '_banner',
  '_candle',
  '_shulker_box',
  '_bricks',
  '_tiles',
  '_wood',
  '_sign',
  '_lantern',
];

/** Built materials by exact name (plain terracotta is natural, so it is not here). */
const BUILT_NAMES = new Set([
  'cobblestone',
  'mossy_cobblestone',
  'cobbled_deepslate',
  'mossy_cobblestone_stairs',
  'glass',
  'glass_pane',
  'bookshelf',
  'bricks',
  'quartz_block',
  'quartz_pillar',
  'hay_block',
  'lantern',
  'soul_lantern',
  'chest',
  'trapped_chest',
  'ender_chest',
  'barrel',
  'crafting_table',
  'furnace',
  'blast_furnace',
  'smoker',
  'chest_minecart',
  // Metal and gem storage blocks, and the crafted workstations, mechanisms and fixtures of players.
  'iron_block',
  'gold_block',
  'diamond_block',
  'emerald_block',
  'lapis_block',
  'redstone_block',
  'coal_block',
  'netherite_block',
  'raw_iron_block',
  'raw_gold_block',
  'raw_copper_block',
  'copper_block',
  'exposed_copper',
  'weathered_copper',
  'oxidized_copper',
  'cut_copper',
  'smithing_table',
  'loom',
  'grindstone',
  'stonecutter',
  'cartography_table',
  'fletching_table',
  'composter',
  'cauldron',
  'bell',
  'lodestone',
  'beacon',
  'piston',
  'sticky_piston',
  'observer',
  'note_block',
  'redstone_lamp',
  'tnt',
  'iron_bars',
  'sea_lantern',
  'purpur_block',
  'bone_block',
  'infested_cobblestone',
]);

/** Natural blocks that a built prefix would catch (amethyst geodes' smooth basalt). */
const NATURAL_NAMES = new Set(['smooth_basalt']);

/** Built materials by name prefix: polished, smooth, cut, chiseled, and stripped wood. */
const BUILT_PREFIXES = ['polished_', 'smooth_', 'cut_', 'chiseled_', 'stripped_', 'waxed_'];

/**
 * Never dig, whoever built it: block entities (storage, signs, beds, furnaces), doors, gates,
 * trapdoors, crafting and enchanting tables, anvils, ladders, torches, rails, glass, obsidian and
 * bedrock. The library's `blocksCantBreak` covers only chests and undiggable blocks.
 */
const REFUSED_SUFFIXES = [
  '_door',
  '_trapdoor',
  '_fence_gate',
  '_bed',
  '_sign',
  '_banner',
  '_shulker_box',
  '_torch',
  '_rail',
  '_glass',
  '_glass_pane',
  '_obsidian',
  '_anvil',
  '_stained_glass_pane',
];

const REFUSED_NAMES = new Set([
  'chest',
  'trapped_chest',
  'ender_chest',
  'barrel',
  'hopper',
  'dropper',
  'dispenser',
  'furnace',
  'blast_furnace',
  'smoker',
  'lectern',
  'brewing_stand',
  'beehive',
  'bee_nest',
  'spawner',
  'campfire',
  'soul_campfire',
  'decorated_pot',
  'chiseled_bookshelf',
  'crafter',
  'jukebox',
  'crafting_table',
  'enchanting_table',
  'anvil',
  'ladder',
  'torch',
  'rail',
  'glass',
  'glass_pane',
  'obsidian',
  'bedrock',
  'chain_command_block',
  'command_block',
  'repeating_command_block',
]);

/** Why `goto` never digs this block at all (independent of who built it), or false. */
export function refusedByName(name: string | undefined): boolean {
  if (!name) return true;
  if (REFUSED_NAMES.has(name)) return true;
  return REFUSED_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

/** True for a block made by builders, by its type, whoever placed it. */
export function isBuiltName(name: string | undefined): boolean {
  if (!name) return false;
  if (BUILT_NAMES.has(name)) return true;
  if (NATURAL_NAMES.has(name)) return false;
  if (BUILT_PREFIXES.some((prefix) => name.startsWith(prefix))) return true;
  return BUILT_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

/** The six faces of a block, as offsets. */
const FACES: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/** True when a face of the block touches a built-material block (a natural block in a built wall). */
function touchesBuilt(bot: Bot, block: ProtectBlock): boolean {
  const at = new Vec3(block.position.x, block.position.y, block.position.z);
  for (const [dx, dy, dz] of FACES) {
    const next = bot.blockAt(at.offset(dx, dy, dz), false) as { name?: string } | null;
    if (next && isBuiltName(next.name)) return true;
  }
  return false;
}

/**
 * True when `goto` must not dig this block. Built materials by type are protected. A natural block
 * on a face of a built block is protected too (a stone wall's floor, a dirt path beside a planked
 * floor). The ownership record protects any block recorded to someone else, once the flag is on.
 * A block this bot placed itself is its own work, so it is not protected (decision 0164).
 * TODO (0164): "part of an enclosed space" is not checked yet; no cheap local check was found.
 */
export function isProtected(bot: Bot, block: ProtectBlock): boolean {
  if (isOwnPlacement(bot, block.position)) return false;
  if (isBuiltName(block.name)) return true;
  if (touchesBuilt(bot, block)) return true;
  if (OWNERSHIP_RULE && ownerLookup) {
    const owner = ownerLookup(new Vec3(block.position.x, block.position.y, block.position.z));
    if (owner && owner !== bot.username) return true;
  }
  return false;
}

/**
 * The refusal an escape dig (the ladder, the stairs, a pillar's headroom or side cell) gives for a
 * protected block, or null. The escape ladder never digs someone else's work (decision 0164).
 */
export function protectedReason(
  bot: Bot,
  block: { name?: string },
  at: ProtectBlock['position'],
): string | null {
  const probe: ProtectBlock =
    block.name === undefined ? { position: at } : { name: block.name, position: at };
  if (!isProtected(bot, probe)) return null;
  return "the block is someone else's work, and the way out does not dig it";
}
