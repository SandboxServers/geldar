import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import { describe, expect, it } from 'vitest';
import { bookAdd } from '../actions/craft-table.fakes.ts';
import { unlockedResultItems, watchRecipeBook } from '../actions/craft-table.ts';
import { createPerception } from './index.ts';
import { FakeWorld } from './perception.fakes.ts';

const ITEMS: Record<number, { name: string }> = {
  10: { name: 'oak_planks' },
  11: { name: 'stick' },
  12: { name: 'crafting_table' },
};

function botWithBook() {
  const client = new EventEmitter();
  const world = new FakeWorld();
  const bot = {
    ...(world.bot as object),
    _client: client,
    registry: { items: ITEMS },
  } as unknown as Bot;
  watchRecipeBook(bot);
  return { bot, client };
}

describe('unlocked recipes', () => {
  it('is empty before the server sends the book', () => {
    const { bot } = botWithBook();
    expect(unlockedResultItems(bot)).toEqual([]);
    expect(createPerception(bot).unlockedRecipes()).toEqual([]);
  });

  it('lists the result item names sorted and unique', () => {
    const { bot, client } = botWithBook();
    client.emit(
      'recipe_book_add',
      bookAdd([
        [1, 'crafting_shapeless', 11],
        [2, 'crafting_shaped', 12],
        [3, 'crafting_shapeless', 10],
        [4, 'crafting_shaped', 11],
      ]),
    );
    expect(createPerception(bot).unlockedRecipes()).toEqual([
      'crafting_table',
      'oak_planks',
      'stick',
    ]);
  });

  it('follows removals and skips results the registry does not know', () => {
    const { bot, client } = botWithBook();
    client.emit(
      'recipe_book_add',
      bookAdd([
        [1, 'crafting_shapeless', 10],
        [2, 'crafting_shaped', 11],
        [3, 'crafting_shaped', 99],
      ]),
    );
    client.emit('recipe_book_remove', { recipeIds: [1] });
    expect(unlockedResultItems(bot)).toEqual(['stick']);
  });

  it('caps the list at 1500 names', () => {
    const { bot, client } = botWithBook();
    const items: Record<number, { name: string }> = {};
    for (let i = 0; i < 1600; i++) items[i] = { name: `item_${String(i).padStart(4, '0')}` };
    (bot as unknown as { registry: unknown }).registry = { items };
    client.emit(
      'recipe_book_add',
      bookAdd(Array.from({ length: 1600 }, (_, i) => [i, 'crafting_shaped', i])),
    );
    expect(unlockedResultItems(bot)).toHaveLength(1600);
    expect(createPerception(bot).unlockedRecipes()).toHaveLength(1500);
  });
});
