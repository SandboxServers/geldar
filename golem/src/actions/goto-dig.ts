import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { digTicks } from './bare-hand.ts';
import { isProtected, refusedByName } from './protected-blocks.ts';

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
/** A dig longer than this (world ticks, with the best held tool) is skipped: 3 s. */
export const MAX_DIG_TICKS = 60;
/** The throwaway blocks a walk may place to climb. Only the held ones are used (the library checks). */
export const SCAFFOLD_NAMES = ['dirt', 'cobblestone', 'cobbled_deepslate', 'netherrack'] as const;

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

/** A world block as `bot.blockAt` returns it, for the drop scan below the bot. */
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
  for (let k = 1; k <= MAX_DROP + 1; k++) {
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

/**
 * True when tier 2 may dig this block now. Refused: names never dug, protected blocks (built
 * material, natural blocks beside it, owned blocks), any liquid on a face, a falling block in the
 * three cells above, a dig longer than 3 s with the held tool, and a floor drop the bot would take.
 * A block whose dig time the bot cannot read is not refused for that (fakes, no timer).
 */
export function digAllowed(bot: Bot, m: DigMovements, block: DigBlock): boolean {
  if (block.type === undefined || !block.name) return false;
  if (refusedByName(block.name) || isProtected(bot, block)) return false;
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
  }
  const ticks = digTicks(bot, block as never);
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

/**
 * What a tier-2 walk dug and placed, for its completion text. Digs are counted from the library's
 * `diggingCompleted`; placements by wrapping `bot.placeBlock` while the walk runs (`stop` restores it).
 */
export class DigTally {
  dug = 0;
  placed: string[] = [];
  private restore: (() => void) | null = null;

  /** Starts counting on `bot` (the walk has just switched to tier 2). Idempotent. */
  start(bot: Bot): void {
    if (this.restore) return;
    const emitter = bot as unknown as {
      on?: (event: string, fn: () => void) => void;
      removeListener?: (event: string, fn: () => void) => void;
      placeBlock?: (...args: unknown[]) => Promise<unknown>;
      heldItem?: { name?: string } | null;
    };
    const onDug = (): void => {
      this.dug++;
    };
    emitter.on?.('diggingCompleted', onDug);
    const original = emitter.placeBlock;
    if (original) {
      emitter.placeBlock = async (...args: unknown[]) => {
        const name = emitter.heldItem?.name ?? 'block';
        const result = await original.apply(bot, args);
        this.placed.push(name.replace(/_/g, ' '));
        return result;
      };
    }
    this.restore = () => {
      emitter.removeListener?.('diggingCompleted', onDug);
      if (original) emitter.placeBlock = original;
    };
  }

  /** Stops counting and restores the bot's methods. Safe to call twice. */
  stop(): void {
    this.restore?.();
    this.restore = null;
  }

  /** The completion text, or undefined when nothing was dug or placed. No digits, plain words. */
  note(): string | undefined {
    const parts: string[] = [];
    if (this.dug > 0) {
      parts.push(`dug through ${countWord(this.dug)} ${this.dug === 1 ? 'block' : 'blocks'}`);
    }
    if (this.placed.length > 0) {
      const kind = this.placed[0] ?? 'block';
      const count = this.placed.length;
      parts.push(`placed ${countWord(count)} ${kind} ${count === 1 ? 'block' : 'blocks'} to climb`);
    }
    return parts.length > 0 ? parts.join(' and ') : undefined;
  }
}
