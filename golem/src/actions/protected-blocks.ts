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
 * What the ownership record says about one cell (decision 0165): `known: true` with the owner's name,
 * or null when no record holds the cell (world-generated); `known: false` when the record cannot
 * answer (not cached, truncated, a failed query). Unknown is protected (decision 0164).
 */
export type OwnerAnswer = { known: false } | { known: true; owner: string | null };

/**
 * The ownership record reader (the Body's cache, `body/block-owners.ts`). Off until a lookup is set
 * and `OWNERSHIP_RULE` is true, so the default walk ignores owners.
 */
export type OwnerLookup = (pos: Vec3) => OwnerAnswer;

/**
 * Fetches the chunks around the given points before a tier-2 walk plans, waiting a bounded time.
 * Resolves when the chunks are in, the wait runs out or the signal aborts.
 */
export type OwnerPrefetch = (points: ReadonlyArray<Vec3>, signal: AbortSignal) => Promise<void>;

/** The feature flag for the owner rule. On: the CoreProtect record is read (decision 0164, 0165). */
export const OWNERSHIP_RULE = true;

let ownerLookup: OwnerLookup | null = null;
let ownerPrefetch: OwnerPrefetch | null = null;

/** Sets the ownership record reader (the Body's cache calls this); null clears it. */
export function setOwnerLookup(lookup: OwnerLookup | null): void {
  ownerLookup = lookup;
}

/** Sets the tier-2 prefetch of the ownership record; null clears it. */
export function setOwnerPrefetch(prefetch: OwnerPrefetch | null): void {
  ownerPrefetch = prefetch;
}

/** Fetches the owner records around `points` before a tier-2 walk plans; resolves at once when unset. */
export function prefetchOwners(points: ReadonlyArray<Vec3>, signal: AbortSignal): Promise<void> {
  return ownerPrefetch ? ownerPrefetch(points, signal) : Promise.resolve();
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
  // Player redstone: buttons and pressure plates of every wood and stone (review N7).
  '_button',
  '_pressure_plate',
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
  // Player lights, redstone, slime and honey blocks, and decor the builders place (review N7).
  'glowstone',
  'shroomlight',
  'slime_block',
  'honey_block',
  'target',
  'dried_kelp_block',
  'bamboo_block',
  'bamboo_mosaic',
  'crimson_hyphae',
  'lightning_rod',
  'copper_bulb',
  'exposed_cut_copper',
  'scaffolding',
  'end_rod',
  'cake',
  'tripwire_hook',
  'lever',
  'redstone_wire',
  'repeater',
  'comparator',
  'sculk_sensor',
  'respawn_anchor',
  'conduit',
  'flower_pot',
  'item_frame',
  'painting',
  'chain',
  'iron_chain',
  'purpur_pillar',
  'trial_spawner',
  'vault',
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
  // Engine and structure blocks that no survival walk should ever break (review N7).
  'end_portal_frame',
  'barrier',
  'structure_block',
  'jigsaw',
  'reinforced_deepslate',
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

/**
 * True when a face of the block touches a built-material block (a natural block in a built wall). A
 * built block this Body placed itself does not count: its own pillar or scaffold shields nothing, so
 * the dirt and stone beside it stay diggable (decision 0164).
 */
function touchesBuilt(bot: Bot, block: ProtectBlock): boolean {
  const at = new Vec3(block.position.x, block.position.y, block.position.z);
  for (const [dx, dy, dz] of FACES) {
    const cell = at.offset(dx, dy, dz);
    const next = bot.blockAt(cell, false) as { name?: string } | null;
    if (next && isBuiltName(next.name) && !isOwnPlacement(bot, cell)) return true;
  }
  return false;
}

/**
 * True when `goto` must not dig this block. Built materials by type are protected. A natural block
 * on a face of a built block is protected too (a stone wall's floor, a dirt path beside a planked
 * floor). The ownership record protects any block recorded to someone else, once the flag is on.
 * A block this bot placed itself is its own work, so it is not protected (decision 0164).
 * "Part of an enclosed space" is not protected: owner decision 2026-11-13 (natural caves look the same).
 */
export function isProtected(bot: Bot, block: ProtectBlock): boolean {
  if (isOwnPlacement(bot, block.position)) return false;
  if (isBuiltName(block.name)) return true;
  if (touchesBuilt(bot, block)) return true;
  if (OWNERSHIP_RULE && ownerLookup) {
    const answer = ownerLookup(new Vec3(block.position.x, block.position.y, block.position.z));
    // Unknown is protected: a truncated or unanswered record may hide another player's work (0165).
    if (!answer.known) return true;
    // Someone else's record protects it; the bot's own record (owner === self) and none do not.
    if (answer.owner !== null && answer.owner !== bot.username) return true;
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
