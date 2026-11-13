// Portions adapted from Mindcraft (https://github.com/mindcraft-bots/mindcraft), MIT License,
// Copyright (c) 2024 Kolby Nottingham. The notice is in THIRD_PARTY_NOTICES.md at the repo root.
// The idea is Mindcraft's craftRecipe (src/agent/library/skills.js): a recipe that needs a table is
// crafted with a table placed beside the bot, which is picked back up afterwards; a partial count
// makes what the materials allow.

import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import type { Block, Recipe } from './bot-types.ts';
import { heldCount } from './inventory-count.ts';
import { mineAction } from './mine.ts';
import { type ActionOutcome, failed } from './outcome.ts';
import { placeAction } from './place.ts';
import type { ActionContext } from './registry.ts';

/** The item and block name of the table the bot places and picks back up. */
export const SPARE_TABLE = 'crafting_table';
/** Said when a craft makes fewer than asked because the materials ran out. */
export const FEWER_MESSAGE = 'made fewer than asked; materials ran out';
const TABLE_RANGE = 32;
const NO_SPACE = 'no free space beside you for a crafting table';
const SIDES = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** The outcome of placing a spare table, or null when no placement was needed or it worked. */
export interface SpareTable {
  outcome: ActionOutcome | null;
  table: Block | null;
  placed: boolean;
}

/** The nearest crafting table within reach, or null. */
function nearestTable(bot: Bot): Block | null {
  const id = bot.registry.blocksByName[SPARE_TABLE]?.id;
  if (id === undefined) return null;
  return bot.findBlock({ matching: id, maxDistance: TABLE_RANGE });
}

/** A free cell beside the bot with solid ground under it, or null when there is none. */
export function freeSpotBeside(bot: Bot): { x: number; y: number; z: number } | null {
  const p = bot.entity.position;
  const base = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
  for (const [dx, dz] of SIDES) {
    const at = base.offset(dx, 0, dz);
    const cell = bot.blockAt(at);
    const ground = bot.blockAt(at.offset(0, -1, 0));
    if (cell?.name === 'air' && ground && ground.name !== 'air') {
      return { x: at.x, y: at.y, z: at.z };
    }
  }
  return null;
}

/**
 * Places a carried crafting table beside the bot when the item needs a table and none is in reach.
 * Places nothing when a table is already near, the item needs no table, or no table is carried.
 */
export async function placeSpareTable(
  ctx: ActionContext,
  itemId: number,
  count: number,
): Promise<SpareTable> {
  const { bot } = ctx;
  const table = nearestTable(bot);
  const tableId = bot.registry.itemsByName[SPARE_TABLE]?.id;
  const needsTable =
    bot.recipesFor(itemId, null, count, null).length === 0 &&
    bot.recipesAll(itemId, null, true).length > 0;
  if (table || !needsTable || tableId === undefined || heldCount(bot, tableId) === 0) {
    return { outcome: null, table, placed: false };
  }
  const spot = freeSpotBeside(bot);
  if (!spot) return { outcome: failed('blocked', NO_SPACE), table: null, placed: false };
  const put = await placeAction.run(ctx, { do: 'place', block: SPARE_TABLE, at: spot });
  if (put.status !== 'completed') return { outcome: put, table: null, placed: false };
  return { outcome: null, table: nearestTable(bot), placed: true };
}

/** Mines the spare table back, so its drop returns to the inventory. Never throws. */
export async function pickUpSpareTable(ctx: ActionContext): Promise<void> {
  const clean = { ...ctx, signal: new AbortController().signal };
  const out = await mineAction
    .run(clean, { do: 'mine', block: SPARE_TABLE, count: 1 })
    .catch(() => failed('internal', 'the spare table was not picked up'));
  if (out.status !== 'completed') console.warn(`spare crafting table was not picked up`);
}

/** How many crafts of this recipe the ingredients in the inventory allow now. */
export function craftsPossible(bot: Bot, recipe: Recipe): number {
  let crafts = Number.POSITIVE_INFINITY;
  for (const d of recipe.delta) {
    if (d.count >= 0) continue;
    crafts = Math.min(crafts, Math.floor(heldCount(bot, d.id, d.metadata) / -d.count));
  }
  return Number.isFinite(crafts) ? crafts : 0;
}
