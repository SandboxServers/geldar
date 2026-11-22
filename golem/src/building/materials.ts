// Materials and pack counts (BLD-11). Which tool digs a cell, what a broken cell drops, and how
// many placeable items the agent holds. Pure: the caller reads the inventory and passes it in.
// Chest withdrawals are not automatic: the Mind asks for them with `withdraw`.

import type { HeldBlock } from './scaffold.ts';

/** The tool a cell needs to break. `none` is the hand. */
export type ToolKind = 'pickaxe' | 'shovel' | 'axe' | 'none';

const SHOVEL = new Set([
  'dirt',
  'grass_block',
  'coarse_dirt',
  'rooted_dirt',
  'podzol',
  'mycelium',
  'sand',
  'red_sand',
  'gravel',
  'clay',
  'snow_block',
  'soul_sand',
  'soul_soil',
  'mud',
]);

const PICKAXE =
  /stone|brick|concrete|terracotta|obsidian|netherrack|prismarine|basalt|_ore$|^furnace$|^anvil$/;

const AXE = /_(log|wood|planks|stem|hyphae|fence|fence_gate|sign|door|slab|stairs)$/;

/** The item a block drops when broken, where it differs from the block. */
const DROPS: ReadonlyMap<string, string> = new Map([
  ['stone', 'cobblestone'],
  ['grass_block', 'dirt'],
  ['coarse_dirt', 'dirt'],
  ['podzol', 'dirt'],
  ['mycelium', 'dirt'],
]);

/** The tool that breaks `block` quickest. Blocks not listed need no tool. */
export function toolFor(block: string): ToolKind {
  if (SHOVEL.has(block)) return 'shovel';
  if (PICKAXE.test(block)) return 'pickaxe';
  if (AXE.test(block)) return 'axe';
  return 'none';
}

/** The item breaking `block` gives the agent: the block's own name unless it drops another item. */
export function dropOf(block: string): string {
  return DROPS.get(block) ?? block;
}

/** How many of `item` the agent holds. */
export function countMaterials(held: HeldBlock[], item: string): number {
  let total = 0;
  for (const stack of held) if (stack.name === item) total += stack.count;
  return total;
}

/** True when a tool of `kind` is among the held item names; `none` needs no tool. */
export function holdsToolKind(names: readonly string[], kind: ToolKind): boolean {
  return kind === 'none' || names.some((name) => name.endsWith(kind));
}
