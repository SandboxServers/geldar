import type { Bot } from 'mineflayer';
import type { Vec3 } from 'vec3';
import type { Block } from './bot-types.ts';

/** Blocks nobody can break in survival, whatever they hold. */
const UNBREAKABLE: ReadonlySet<string> = new Set([
  'bedrock',
  'barrier',
  'light',
  'command_block',
  'chain_command_block',
  'repeating_command_block',
  'structure_block',
  'structure_void',
  'jigsaw',
  'end_portal_frame',
  'end_portal',
  'end_gateway',
  'nether_portal',
  'reinforced_deepslate',
]);

const LIQUIDS: ReadonlySet<string> = new Set(['water', 'lava']);

/** Blocks that fall when the block under them is removed. */
const FALLING = (name: string | undefined): boolean =>
  name === 'sand' ||
  name === 'red_sand' ||
  name === 'gravel' ||
  name === 'anvil' ||
  (name?.endsWith('_concrete_powder') ?? false);

/** Margin on top of the computed dig time: ticks, and a share of the time. */
const DIG_MARGIN_TICKS = 40;
const DIG_MARGIN_SHARE = 0.25;
/** Milliseconds in one world tick. */
const TICK_MS = 50;

/** Why no one can break `block`, in plain words, or null. */
export function unbreakableReason(block: Block): string | null {
  if (UNBREAKABLE.has(block.name) || (block as { diggable?: boolean }).diggable === false) {
    return `${block.name} cannot be broken by anyone, with any tool`;
  }
  return null;
}

/**
 * Why digging `block` now would hurt the bot, in plain words, or null. Water or lava next to it
 * (or above it) would flow in; a falling block above it would drop into the gap. The bot's own
 * cells (`own`) do not count as a neighbour. `strictFalling` refuses a falling block above even
 * when the bot does not stand under it (a staircase is walked into the gap).
 */
export function hazardReason(
  bot: Bot,
  block: Block,
  at: Vec3,
  own: readonly Vec3[],
  strictFalling: boolean,
): string | null {
  for (const [dx, dy, dz] of [
    [0, 1, 0],
    [1, 0, 0],
    [-1, 0, 0],
    [0, 0, 1],
    [0, 0, -1],
  ] as const) {
    const cell = at.offset(dx, dy, dz);
    if (own.some((o) => o.equals(cell))) continue;
    const next = bot.blockAt(cell);
    if (next && LIQUIDS.has(next.name)) {
      return `${block.name} is unsafe to dig: ${next.name} would flow in on you`;
    }
    if (dy === 1 && next && FALLING(next.name)) {
      const under = own.some((o) => o.x === at.x && o.z === at.z);
      if (strictFalling || under) {
        return `${block.name} is unsafe to dig: ${next.name} above it would fall on you`;
      }
    }
  }
  return null;
}

/** Expected dig time of `block` with what is held now, in world ticks, or null when unknown. */
export function digTicks(bot: Bot, block: Block): number | null {
  const timer = (bot as unknown as { digTime?: (b: Block) => number }).digTime;
  if (typeof timer !== 'function') return null;
  const ms = timer.call(bot, block);
  return Number.isFinite(ms) ? Math.ceil(ms / TICK_MS) : null;
}

/** The dig time with its margin: how long a legitimate dig may run before anything aborts it. */
export function digTicksWithMargin(ticks: number): number {
  return Math.ceil(ticks * (1 + DIG_MARGIN_SHARE)) + DIG_MARGIN_TICKS;
}

/**
 * The note for a dig whose tool is wrong or missing, so the block breaks slowly and drops nothing.
 * Null when the held tool suits the block.
 */
export function handNote(
  block: Block,
  tool: { type: number } | null,
  ticks: number | null,
): string | null {
  if (!block.harvestTools || block.canHarvest(tool?.type ?? null)) return null;
  const secs = ticks === null ? '' : ` (about ${Math.round(ticks / 20)} s)`;
  return `${block.name} was dug without a suitable tool: it took longer${secs} and dropped nothing, so nothing was collected`;
}
