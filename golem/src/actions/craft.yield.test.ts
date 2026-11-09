import type { Bot } from 'mineflayer';
import { describe, expect, it, vi } from 'vitest';
import { craftAction } from './craft.ts';
import {
  answerRequests,
  BAMBOO_STICK,
  bookAdd,
  fakeGame,
  openWithWindowState,
  PLANKS_STICK,
  STICK,
  TABLE,
  writesOf,
} from './craft-table.fakes.ts';
import { watchRecipeBook } from './craft-table.ts';

// The real recipe-book path, not a mock: the item has a bamboo display (1 stick) listed before the
// planks display (4 sticks), and the server accepts only the planks one.
vi.mock('./pathing.ts', () => ({ moveNear: vi.fn(async () => ({ ok: true, distance: 1 })) }));

/** A bot whose inventory grows by the stack of each shift-clicked result, as the server's would. */
function stickBot(table: boolean) {
  const fake = fakeGame(table ? openWithWindowState : undefined);
  watchRecipeBook(fake.bot);
  fake.client.emit(
    'recipe_book_add',
    bookAdd([
      [BAMBOO_STICK, 'crafting_shapeless', STICK.id, 1],
      [PLANKS_STICK, 'crafting_shaped', STICK.id, 4],
    ]),
  );
  answerRequests(fake.client, table ? 1 : 0, [PLANKS_STICK], { [PLANKS_STICK]: 4 }, STICK.id);
  const answer = fake.client.write.getMockImplementation() as (n: string, p: object) => void;
  let sticks = 0;
  fake.client.write.mockImplementation((name: string, params: object) => {
    answer(name, params);
    if (name === 'window_click') sticks += 4;
  });
  const recipe = {
    result: { id: STICK.id, count: 4 },
    delta: [{ id: 5, count: -2, metadata: null }],
    requiresTable: false,
  };
  Object.assign(fake.raw, {
    registry: {
      itemsByName: { stick: STICK },
      items: { 5: { name: 'oak_planks' }, [STICK.id]: STICK },
      blocksByName: { crafting_table: { id: 58 } },
    },
    inventory: { count: (id: number) => (id === STICK.id ? sticks : 100) },
    findBlock: () => (table ? TABLE : null),
    recipesFor: (_id: number, _m: unknown, _n: unknown, station: unknown) =>
      table && !station ? [] : [recipe],
    recipesAll: () => [recipe],
  });
  return fake;
}

function craftSticks(bot: Bot, count: number) {
  return craftAction.run(
    { bot, signal: new AbortController().signal, timeScale: 0.01 },
    { do: 'craft', item: 'stick', count },
  );
}

describe.each([
  ['the table', true],
  ['the 2x2 grid', false],
])('craftAction on %s with two displays of different yields', (_name, table) => {
  it('crafts 4 sticks in one craft, not the 16 a first-display yield of 1 would make', async () => {
    const fake = stickBot(table);
    const out = await craftSticks(fake.bot, 4);
    expect(writesOf(fake.client, 'window_click')).toHaveLength(1);
    expect(out).toMatchObject({ status: 'completed', detail: { item: 'stick', crafted: 4 } });
  });

  it('crafts 5 sticks as two crafts, ending with 8', async () => {
    const fake = stickBot(table);
    const out = await craftSticks(fake.bot, 5);
    expect(writesOf(fake.client, 'window_click')).toHaveLength(2);
    expect(out).toMatchObject({ status: 'completed', detail: { crafted: 8 } });
  });
});
