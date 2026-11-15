import type { Bot } from 'mineflayer';
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
