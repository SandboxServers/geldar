/** A block as the scan reads it: the prismarine fields it needs. */
export interface ScanBlock {
  name: string;
  boundingBox: string;
}

/** Reads one block by coordinates; null when the chunk is not loaded. */
export type BlockReader = (x: number, y: number, z: number) => ScanBlock | null;

/** Blocks the Body must not stand in: they burn, drown, slow or hold it. */
export const HAZARD_CELLS = new Set([
  'lava',
  'water',
  'fire',
  'soul_fire',
  'cobweb',
  'powder_snow',
  'sweet_berry_bush',
  'bubble_column',
  'seagrass',
  'tall_seagrass',
  'kelp',
  'kelp_plant',
]);
/** Solid blocks that still hurt to stand on or against. */
export const HAZARD_FLOORS = new Set(['magma_block', 'cactus', 'campfire', 'soul_campfire']);

/** True when the Body can stand in this cell: passable and not a hazard. Unloaded is not safe. */
export function isOpenCell(block: ScanBlock | null): boolean {
  return block !== null && block.boundingBox === 'empty' && !HAZARD_CELLS.has(block.name);
}
