import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { placedCell, recordOwnPlacement } from './own-placements.ts';
import { isProtected, refusedByName } from './protected-blocks.ts';
import { MIN_DIG_HEALTH } from './soft-dig.ts';

/**
 * Tier 2 of `goto` (decision 0164): the walk may dig and build its own way when the plain walk
 * finds no path. These rules set what it may break and place; the library asks `safeToBreak` for
 * every dig, so the safety rules live there.
 */

/** Cost of one dig, against the library's 1 (soft digs cost 2 in tier 1). */
export const DIG_COST = 4;
/** Cost of one scaffold placement (the library's 1). */
export const PLACE_COST = 2;
/** The longest drop a walk may create by digging the floor (blocks). */
export const MAX_DROP = 3;
/** Liquid is crossed only when it clearly saves distance. */
export const LIQUID_COST = 3;
/** A dig longer than this (world ticks, with the best tool the bot carries) is skipped: 3 s. */
export const MAX_DIG_TICKS = 60;
/** The throwaway blocks a walk may place to climb. Only the held ones are used (the library checks). */
export const SCAFFOLD_NAMES = ['dirt', 'cobblestone', 'cobbled_deepslate', 'netherrack'] as const;
/** Blocks that fall when the cell under them is air: a dig beneath one lets it drop on the bot. */
const FALLING_NAMES = new Set([
  'sand',
  'red_sand',
  'suspicious_sand',
  'gravel',
  'suspicious_gravel',
  'anvil',
  'chipped_anvil',
  'damaged_anvil',
  'dragon_egg',
  'pointed_dripstone',
]);

/** The parts of a pathfinder `Movements` that the tier-2 rules set or read. */
interface DigMovements {
  canDig: boolean;
  digCost: number;
  placeCost: number;
  liquidCost: number;
  maxDropDown: number;
  allow1by1towers: boolean;
  dontCreateFlow: boolean;
  dontMineUnderFallingBlock: boolean;
  scafoldingBlocks: number[];
  blocksCantBreak?: Set<number>;
  safeToBreak(block: DigBlock): boolean;
  getBlock(pos: DigBlock['position'], dx: number, dy: number, dz: number): DigCell;
  getNumEntitiesAt?: (pos: DigBlock['position'], dx: number, dy: number, dz: number) => number;
}

/** A block as the library hands it to `safeToBreak`. */
interface DigBlock {
  name?: string;
  type?: number;
  position: { x: number; y: number; z: number };
}

/** The neighbour facts the rules read (the library's `getBlock` cell). */
interface DigCell {
  liquid?: boolean;
  canFall?: boolean;
}

/** A world block as `bot.blockAt` returns it, for the drop and falling scans. */
interface WorldCell {
  name?: string;
  boundingBox?: string;
  position?: unknown;
}

/** The held-item ids of the scaffold names, looked up in the registry (missing in fakes: skipped). */
export function scaffoldIds(bot: Bot): number[] {
  const items = (bot.registry as { itemsByName?: Record<string, { id: number } | undefined> })
    .itemsByName;
  const ids: number[] = [];
  for (const name of SCAFFOLD_NAMES) {
    const id = items?.[name]?.id;
    if (id !== undefined) ids.push(id);
  }
  return ids;
}

/** Why the floor under the bot must not go: a drop past `MAX_DROP` or any liquid in the way. */
function dropRefused(bot: Bot, block: DigBlock): boolean {
  const feet = bot.entity?.position;
  if (!feet) return false;
  const under =
    block.position.x === Math.floor(feet.x) &&
    block.position.z === Math.floor(feet.z) &&
    block.position.y === Math.floor(feet.y) - 1;
  if (!under) return false;
  for (let k = 1; k <= MAX_DROP; k++) {
    const cell = bot.blockAt(
      new Vec3(block.position.x, block.position.y - k, block.position.z),
      false,
    ) as WorldCell | null;
    if (!cell) return true;
    if (cell.name === 'water' || cell.name === 'lava') return true;
    if (cell.boundingBox !== undefined && cell.boundingBox !== 'empty') return false;
  }
  return true;
}

/** True for a block that falls when its support is dug: a name in the list, or concrete powder. */
function isFallingName(name: string | undefined): boolean {
  if (!name) return false;
  return FALLING_NAMES.has(name) || name.endsWith('_concrete_powder');
}

/**
 * The dig time in world ticks with the best tool the bot carries (the library's choice in
 * `movements.js`), or null when the block cannot tell its dig time (test fakes).
 */
function bestDigTicks(bot: Bot, block: DigBlock): number | null {
  const timer = (block as { digTime?: (...args: unknown[]) => number }).digTime;
  if (typeof timer !== 'function') return null;
  const planner = bot.pathfinder as unknown as
    | { bestHarvestTool?: (b: DigBlock) => { type: number; enchants?: unknown[] } | null }
    | undefined;
  const tool = planner?.bestHarvestTool?.(block) ?? null;
  const effects = (bot.entity as { effects?: unknown } | undefined)?.effects ?? {};
  const ms = timer.call(
    block,
    tool ? tool.type : null,
    false,
    false,
    false,
    tool?.enchants ?? [],
    effects,
  );
  return Number.isFinite(ms) ? Math.ceil(ms / 50) : null;
}

/**
 * True when tier 2 may dig this block now. Refused: names never dug, protected blocks (built
 * material, natural blocks beside it, owned blocks), blocks the library never breaks, any liquid on
 * a face, a falling block in the three cells above, a dig longer than 3 s with the best tool, a
 * floor drop past three blocks, and any dig below the health gate. A block whose dig time the bot
 * cannot read is not refused for that (fakes, no timer).
 */
export function digAllowed(bot: Bot, m: DigMovements, block: DigBlock): boolean {
  if (block.type === undefined || !block.name) return false;
  if (refusedByName(block.name) || isProtected(bot, block)) return false;
  if (m.blocksCantBreak?.has(block.type)) return false;
  const health = (bot as { health?: number }).health;
  if (health !== undefined && health < MIN_DIG_HEALTH) return false;
  const at = block.position;
  for (const [dx, dy, dz] of [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ] as const) {
    if (m.getBlock(at, dx, dy, dz).liquid) return false;
  }
  for (let dy = 1; dy <= 3; dy++) {
    if (m.getBlock(at, 0, dy, 0).canFall) return false;
    if (m.getNumEntitiesAt?.(at, 0, dy, 0)) return false;
    const above = bot.blockAt(new Vec3(at.x, at.y + dy, at.z), false) as WorldCell | null;
    if (isFallingName(above?.name)) return false;
  }
  const ticks = bestDigTicks(bot, block);
  if (ticks !== null && ticks > MAX_DIG_TICKS) return false;
  return !dropRefused(bot, block);
}

/**
 * Sets the tier-2 rules on a fresh `Movements`: digging at cost 4, one-by-one towers with
 * scaffolding (dirt, cobblestone, cobbled deepslate, netherrack), placing at cost 2, drops up to 3,
 * liquid at cost 3, and `digAllowed` as the only dig test. Doors, corner rules and the soft-dig
 * whitelist are the caller's (pathing.ts). Parkour and sprinting keep the library defaults.
 */
export function applyDigRules(movements: unknown, bot: Bot): void {
  const m = movements as DigMovements;
  m.canDig = true;
  m.digCost = DIG_COST;
  m.placeCost = PLACE_COST;
  m.liquidCost = LIQUID_COST;
  m.maxDropDown = MAX_DROP;
  m.allow1by1towers = true;
  m.dontCreateFlow = true;
  m.dontMineUnderFallingBlock = true;
  m.scafoldingBlocks = scaffoldIds(bot);
  m.safeToBreak = (block: DigBlock): boolean => digAllowed(bot, m, block);
}

/** A count as a word, never a digit (agent text: no digits in result text). */
const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
function countWord(n: number): string {
  return COUNT_WORDS[n] ?? 'several';
}

/** The parts of the bot the tally wraps: its dig and its placement, as properties. */
interface TallyEmitter {
  dig?: (...args: unknown[]) => Promise<unknown>;
  placeBlock?: (...args: unknown[]) => Promise<unknown>;
  heldItem?: { name?: string } | null;
}

/**
 * One bot's wrappers, shared by every tally counting on that bot. Overlapping or nested walks join
 * the same pair, so the originals are put back exactly once, by the last tally to leave.
 */
interface Wrapped {
  originalDig?: TallyEmitter['dig'];
  originalPlace?: TallyEmitter['placeBlock'];
  dig: (...args: unknown[]) => Promise<unknown>;
  place: (...args: unknown[]) => Promise<unknown>;
  tallies: Set<DigTally>;
}

const wrapped = new WeakMap<object, Wrapped>();

/** Adds `tally` to the bot's wrappers, installing them on the first join. */
function joinWrappers(bot: Bot, tally: DigTally): void {
  const emitter = bot as unknown as TallyEmitter;
  let entry = wrapped.get(bot);
  if (!entry) {
    const originalDig = emitter.dig;
    const originalPlace = emitter.placeBlock;
    const made: Wrapped = {
      originalDig,
      originalPlace,
      tallies: new Set(),
      dig: async (...args: unknown[]): Promise<unknown> => {
        const result = await originalDig?.apply(bot, args);
        for (const t of made.tallies) t.countDig();
        return result;
      },
      place: async (...args: unknown[]): Promise<unknown> => {
        const held = emitter.heldItem?.name;
        const result = await originalPlace?.apply(bot, args);
        for (const t of made.tallies) t.countPlace(held ?? 'block');
        // The scaffold this walk placed is the bot's own work (its digs are not someone else's).
        const cell = placedCell(args[0], args[1]);
        if (held && cell) recordOwnPlacement(bot, cell, held);
        return result;
      },
    };
    if (originalDig) emitter.dig = made.dig;
    if (originalPlace) emitter.placeBlock = made.place;
    wrapped.set(bot, made);
    entry = made;
  }
  entry.tallies.add(tally);
}

/** Removes `tally`; the last one out puts the bot's original methods back, if they are still ours. */
function leaveWrappers(bot: Bot, tally: DigTally): void {
  const entry = wrapped.get(bot);
  if (!entry) return;
  entry.tallies.delete(tally);
  if (entry.tallies.size > 0) return;
  const emitter = bot as unknown as TallyEmitter;
  if (entry.originalDig && emitter.dig === entry.dig) emitter.dig = entry.originalDig;
  if (entry.originalPlace && emitter.placeBlock === entry.place) {
    emitter.placeBlock = entry.originalPlace;
  }
  wrapped.delete(bot);
}

/**
 * What a tier-2 walk dug and placed, for its completion text. Both are counted by wrapping the
 * bot's own methods while the walk runs: `bot.dig` (a dig that completes) and `bot.placeBlock`.
 * The library clears `diggingCompleted` listeners on its own, so the event is not used. Each
 * placed scaffold block is recorded as the bot's own work (see own-placements.ts). Walks may
 * overlap or nest: `stop` leaves the wrappers in place until the last tally has stopped.
 */
export class DigTally {
  dug = 0;
  placed: string[] = [];
  private bot: Bot | null = null;

  /** Starts counting on `bot` (the walk has just switched to tier 2). Idempotent. */
  start(bot: Bot): void {
    if (this.bot) return;
    this.bot = bot;
    joinWrappers(bot, this);
  }

  /** Stops counting and lets go of the bot's methods. Safe to call twice. */
  stop(): void {
    if (!this.bot) return;
    leaveWrappers(this.bot, this);
    this.bot = null;
  }

  countDig(): void {
    this.dug++;
  }

  countPlace(name: string): void {
    this.placed.push(name.replace(/_/g, ' '));
  }

  /** The completion text, or undefined when nothing was dug or placed. No digits, plain words. */
  note(): string | undefined {
    const parts: string[] = [];
    if (this.dug > 0) {
      parts.push(`dug through ${countWord(this.dug)} ${this.dug === 1 ? 'block' : 'blocks'}`);
    }
    if (this.placed.length > 0) {
      const kinds = new Map<string, number>();
      for (const kind of this.placed) kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
      const listed = [...kinds]
        .map(([kind, n]) => `${countWord(n)} ${kind} ${n === 1 ? 'block' : 'blocks'}`)
        .join(' and ');
      parts.push(`placed ${listed} to climb`);
    }
    return parts.length > 0 ? parts.join(' and ') : undefined;
  }
}
