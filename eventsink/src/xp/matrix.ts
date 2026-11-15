// The XP evidence matrix's data (AN-09a). Every set here is proposed under D-CS-04 and needs the
// owner's approval in the P0 ADR: a name added or removed changes which accomplishments count.

/** Items that count as mining when collected from a `mine` action (unmeasured defaults). */
export const MINING_ITEMS: ReadonlySet<string> = new Set([
  'cobblestone',
  'stone',
  'deepslate',
  'cobbled_deepslate',
  'raw_iron',
  'raw_copper',
  'raw_gold',
  'coal',
  'diamond',
  'emerald',
  'lapis_lazuli',
  'redstone',
]);

/** Crop items that count as harvest when collected from a `mine` action. */
export const CROP_ITEMS: ReadonlySet<string> = new Set([
  'wheat',
  'carrot',
  'potato',
  'beetroot',
  'melon_slice',
  'pumpkin',
]);

/**
 * Crop blocks that count as sowing when placed: the values of `SEED_CROPS` in
 * golem/src/actions/place.ts, the blocks a seed item becomes on farmland.
 */
export const CROP_BLOCKS: ReadonlySet<string> = new Set([
  'wheat',
  'beetroots',
  'carrots',
  'potatoes',
  'pumpkin_stem',
  'melon_stem',
  'torchflower_crop',
  'pitcher_crop',
]);

/** Whether a collected item is a mining item: a listed name, or any name ending `_ore`. */
export function isMiningItem(name: string): boolean {
  return MINING_ITEMS.has(name) || name.endsWith('_ore');
}
