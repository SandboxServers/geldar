import type { Snapshot } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { canSeeBlock } from '../notable-blocks.ts';

/** A hazard as the snapshot lists it. */
type Hazard = NonNullable<Snapshot['surroundings']['hazards']>[number];
/** A block as Mineflayer returns it from `blockAt`. */
type Block = NonNullable<ReturnType<Bot['blockAt']>>;

/** How far a hazard is listed: the distance from the feet to the centre of its cell, in whole blocks. */
export const HAZARD_RANGE = 8;
/** At most this many hazards are listed, nearest first. */
export const MAX_HAZARDS = 4;
/** A feet-row cell is a drop when this many cells below it are empty of floor and fluid. */
export const DROP_DEPTH = 3;

/** Block names that are hazards, and the kind each one reports as. Water is deep water here. */
const KIND_OF: ReadonlyMap<string, Hazard['kind']> = new Map<string, Hazard['kind']>([
  ['lava', 'lava'],
  ['water', 'deep_water'],
  ['fire', 'fire'],
  ['soul_fire', 'fire'],
  ['cactus', 'cactus'],
]);

/** The eight compass points as the schema spells them, clockwise from north (-z). */
const POINTS = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const;

/** A hazard the scan found, with the block it was read from, before the sight test. */
interface Candidate {
  hazard: Hazard;
  block: Block;
}

/** The direction of an offset in x and z, as one of the eight points. Called for non-zero offsets. */
function pointOf(dx: number, dz: number): Hazard['dir'] {
  const index = Math.round(Math.atan2(dx, -dz) / (Math.PI / 4));
  return POINTS[((index % 8) + 8) % 8] as Hazard['dir'];
}

/** Whole blocks from the feet to the centre of a cell. */
function distanceOf(cell: Vec3, feet: Vec3): number {
  return Math.round(cell.offset(0.5, 0.5, 0.5).distanceTo(feet));
}

/** True for a cell with nothing solid in it: air, water or lava. Mineflayer's shapes are empty there. */
function isOpen(block: Block): boolean {
  return block.shapes.length === 0;
}

/** Lava, water, fire and cactus cells within range, read from the bot's block search. */
function fluidCandidates(bot: Bot, feet: Vec3): Candidate[] {
  const found = bot.findBlocks({
    point: feet,
    matching: (block) => KIND_OF.has(block.name),
    maxDistance: HAZARD_RANGE,
    count: 4096,
  });
  const out: Candidate[] = [];
  for (const cell of found) {
    const block = bot.blockAt(cell);
    const kind = block ? KIND_OF.get(block.name) : undefined;
    if (!block || !kind) continue;
    const dist = distanceOf(cell, feet);
    if (dist > HAZARD_RANGE) continue;
    const dir = pointOf(cell.x + 0.5 - feet.x, cell.z + 0.5 - feet.z);
    out.push({ hazard: { kind, dir, dist }, block });
  }
  return out;
}

/** True when every cell below the cell is open and not a fluid, so stepping in lets the Body fall. */
function hasDepth(bot: Bot, cell: Vec3): boolean {
  for (let i = 1; i <= DROP_DEPTH; i++) {
    const below = bot.blockAt(cell.offset(0, -i, 0));
    if (!below || !isOpen(below) || KIND_OF.has(below.name)) return false;
  }
  return true;
}

/**
 * Feet-row cells within range that are open and have no floor for `DROP_DEPTH` cells below. The
 * Body's own column is left out: a hole under the feet is the hazard-escape reflex's business.
 */
function dropCandidates(bot: Bot, feet: Vec3): Candidate[] {
  const x0 = Math.floor(feet.x);
  const y0 = Math.floor(feet.y);
  const z0 = Math.floor(feet.z);
  const out: Candidate[] = [];
  for (let dx = -HAZARD_RANGE; dx <= HAZARD_RANGE; dx++) {
    for (let dz = -HAZARD_RANGE; dz <= HAZARD_RANGE; dz++) {
      if (dx === 0 && dz === 0) continue;
      const cell = new Vec3(x0 + dx, y0, z0 + dz);
      const dist = distanceOf(cell, feet);
      if (dist > HAZARD_RANGE) continue;
      const block = bot.blockAt(cell);
      if (!block || !isOpen(block) || KIND_OF.has(block.name)) continue;
      if (!hasDepth(bot, cell)) continue;
      const dir = pointOf(dx, dz);
      out.push({ hazard: { kind: 'drop', dir, dist }, block });
    }
  }
  return out;
}

/**
 * Hazards near the agent (PX-5): lava, deep water, drops, fire and cactus within 8 blocks, at most
 * 4, nearest first. Only cells the Body can see are listed; a cell in an unloaded chunk is skipped.
 * Fixed text by construction: the kinds and points are enumerated, nothing is read as prose.
 */
export function hazards(bot: Bot): Partial<Snapshot['surroundings']> {
  if (!bot.entity) return {};
  const feet = bot.entity.position;
  const candidates = [...fluidCandidates(bot, feet), ...dropCandidates(bot, feet)].sort(
    (a, b) => a.hazard.dist - b.hazard.dist,
  );
  const kept: Hazard[] = [];
  for (const { hazard, block } of candidates) {
    if (kept.length >= MAX_HAZARDS) break;
    if (canSeeBlock(bot, block)) kept.push(hazard);
  }
  // The field is left out when nothing is in sight, so open ground keeps its snapshot unchanged.
  // The generated type is a union of tuples up to four long; `kept` has at most MAX_HAZARDS entries.
  return kept.length > 0
    ? { hazards: kept as NonNullable<Snapshot['surroundings']['hazards']> }
    : {};
}
