import type { Snapshot } from '@geldar/contract';
import type { Bot } from 'mineflayer';
import type { Block } from '../../actions/bot-types.ts';
import { FoodMemory } from '../food-memory.ts';
import { canSeeBlock, canSeePoint } from '../notable-blocks.ts';

/** How far the Body looks for food, in blocks. */
export const FOOD_RANGE = 24;
/** Most crop and berry candidates one scan reads. */
const MAX_CANDIDATES = 16;

/** Animals that drop or are food. */
const FOOD_ANIMALS = new Set(['cow', 'pig', 'sheep', 'chicken', 'rabbit', 'mooshroom']);
/** Blocks that grow food. */
const FOOD_BLOCKS = new Set([
  'wheat',
  'carrots',
  'potatoes',
  'beetroots',
  'sweet_berry_bush',
  'melon',
  'pumpkin',
]);
/** Dropped items that are food when picked up. */
const FOOD_ITEMS = new Set([
  'apple',
  'bread',
  'carrot',
  'potato',
  'baked_potato',
  'beetroot',
  'sweet_berries',
  'melon_slice',
  'cooked_beef',
  'beef',
  'cooked_porkchop',
  'porkchop',
  'cooked_chicken',
  'chicken',
  'cooked_mutton',
  'mutton',
  'cooked_rabbit',
  'rabbit',
  'cooked_cod',
  'cod',
  'cooked_salmon',
  'salmon',
  'cookie',
  'pumpkin_pie',
]);

/**
 * The age at which each crop is fully grown, so ripe (the game's own maximum age state, as
 * minecraft-data gives it for the pinned 26.1 line; the test checks each value against it).
 */
export const CROP_MAX_AGE: Readonly<Record<string, number>> = {
  wheat: 7,
  carrots: 7,
  potatoes: 7,
  beetroots: 3,
};

/**
 * A food block's kind. A crop with a readable age reads `wheat (ripe)` or `wheat (unripe)`: ripe at
 * its maximum age. Any other block, or a crop with no readable age, reads as its bare name.
 */
function foodKind(block: Block): string {
  const max = CROP_MAX_AGE[block.name];
  const properties = (block as { getProperties?: () => Record<string, unknown> }).getProperties?.();
  const age = Number(properties?.age);
  if (max === undefined || !Number.isInteger(age)) return block.name;
  return `${block.name} (${age >= max ? 'ripe' : 'unripe'})`;
}

/** The metadata slot that holds a dropped item's stack (the protocol's item index). */
const ITEM_STACK_SLOT = 8;

const memories = new WeakMap<Bot, FoodMemory>();

function memoryOf(bot: Bot): FoodMemory {
  let memory = memories.get(bot);
  if (!memory) {
    memory = new FoodMemory();
    memories.set(bot, memory);
  }
  return memory;
}

function droppedName(metadata: unknown[] | undefined): string | null {
  const name = (metadata?.[ITEM_STACK_SLOT] as { name?: unknown } | undefined)?.name;
  return typeof name === 'string' ? name : null;
}

/**
 * Food known: animals, crops, berries and dropped food the Body has seen, newest 10, each with its
 * kind and coordinates. An empty list is the structured fact "no food known".
 */
export function foodKnown(bot: Bot): Partial<Snapshot['surroundings']> {
  if (!bot.entity) return {};
  const memory = memoryOf(bot);
  const here = bot.entity.position;
  for (const [id, entity] of Object.entries(bot.entities ?? {})) {
    if (entity === bot.entity || entity.position.distanceTo(here) > FOOD_RANGE) continue;
    const kind = entity.name === 'item' ? droppedName(entity.metadata) : (entity.name ?? null);
    const isFood =
      entity.name === 'item' ? kind && FOOD_ITEMS.has(kind) : kind && FOOD_ANIMALS.has(kind);
    if (!kind || !isFood || !canSeePoint(bot, entity.position)) continue;
    const { x, y, z } = entity.position;
    memory.see(`e${id}`, { kind, x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) });
  }
  const found = bot.findBlocks({
    point: here,
    matching: (block) => FOOD_BLOCKS.has(block.name),
    maxDistance: FOOD_RANGE,
    count: MAX_CANDIDATES,
  });
  for (const at of found) {
    const block = bot.blockAt(at);
    if (!block || !canSeeBlock(bot, block)) continue;
    memory.see(`b${at.x},${at.y},${at.z}`, { kind: foodKind(block), x: at.x, y: at.y, z: at.z });
  }
  // The generated type is a tuple union of at most 10; the memory holds at most 10.
  return { food_known: memory.list() as NonNullable<Snapshot['surroundings']['food_known']> };
}
