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
} from './craft-table.fakes.ts';
import { watchRecipeBook } from './craft-table.ts';
import type { ActionContext } from './registry.ts';

// The spare table: the place and mine handlers are stubbed so the test sees the calls and the
// table's presence, and the real craft path runs with the recipe book.
const spare = vi.hoisted(() => ({
  placed: false,
  placeCalls: [] as unknown[],
  mineCalls: [] as unknown[],
}));
vi.mock('./pathing.ts', () => ({ moveNear: vi.fn(async () => ({ ok: true, distance: 1 })) }));
vi.mock('./place.ts', () => ({
  placeAction: {
    run: vi.fn(async (_ctx: unknown, action: unknown) => {
      spare.placeCalls.push(action);
      spare.placed = true;
      return { status: 'completed', detail: {} };
    }),
  },
}));
vi.mock('./mine.ts', () => ({
  mineAction: {
    run: vi.fn(async (_ctx: unknown, action: unknown) => {
      spare.mineCalls.push(action);
      spare.placed = false;
      return { status: 'completed', detail: {} };
    }),
  },
}));

/** A bot whose stick recipe needs a table when `needsTable`; `planks` planks; a table carried or not. */
function stickBot(needsTable: boolean, planks: number, tableHeld = true) {
  const fake = fakeGame(needsTable ? openWithWindowState : undefined);
  watchRecipeBook(fake.bot);
  fake.client.emit(
    'recipe_book_add',
    bookAdd([
      [BAMBOO_STICK, 'crafting_shapeless', STICK.id, 1],
      [PLANKS_STICK, 'crafting_shaped', STICK.id, 4],
    ]),
  );
  answerRequests(
    fake.client,
    needsTable ? 1 : 0,
    [PLANKS_STICK],
    { [PLANKS_STICK]: 4 },
    STICK.id,
    fake.stock,
  );
  const recipe = {
    result: { id: STICK.id, count: 4 },
    delta: [{ id: 5, count: -2, metadata: null }],
    requiresTable: false,
  };
  Object.assign(fake.raw, {
    registry: {
      itemsByName: { stick: STICK, crafting_table: { id: 58, name: 'crafting_table' } },
      items: { 5: { name: 'oak_planks' }, [STICK.id]: STICK },
      blocksByName: { crafting_table: { id: 58 } },
    },
    entity: { position: { x: 0.5, y: 64, z: 0.5 } },
    blockAt: (p: { y: number }) => ({ name: p.y >= 64 ? 'air' : 'stone' }),
    inventory: {
      count: (id: number) => {
        if (id === STICK.id) return fake.stock.get(id) ?? 0;
        if (id === 5) return planks;
        if (id === 58) return tableHeld ? 1 : 0;
        return 100;
      },
    },
    findBlock: () => (spare.placed ? TABLE : null),
    recipesFor: (_id: number, _m: unknown, _n: unknown, station: unknown) =>
      needsTable && !station ? [] : [recipe],
    recipesAll: (_id: unknown, _m: unknown, station: unknown) =>
      needsTable && !station ? [] : [recipe],
  });
  return fake;
}

function craftSticks(bot: unknown, count: number) {
  const ctx = {
    bot,
    signal: new AbortController().signal,
    timeScale: 0.01,
  } as unknown as ActionContext;
  return craftAction.run(ctx, { do: 'craft', item: 'stick', count });
}

describe('craftAction with a carried table and a partial count', () => {
  it('places a carried table beside the bot, crafts with it, and mines it back', async () => {
    spare.placed = false;
    spare.placeCalls.length = 0;
    spare.mineCalls.length = 0;
    const fake = stickBot(true, 100);
    const out = await craftSticks(fake.bot, 4);
    expect(out).toMatchObject({
      status: 'completed',
      detail: { item: 'stick', crafted: 4, used_table: true },
    });
    expect(spare.placeCalls).toEqual([
      expect.objectContaining({ do: 'place', block: 'crafting_table' }),
    ]);
    expect(spare.mineCalls).toEqual([{ do: 'mine', block: 'crafting_table', count: 1 }]);
    expect(spare.placed).toBe(false);
  });

  it('keeps the no-table refusal when no table is carried either', async () => {
    spare.placed = false;
    spare.placeCalls.length = 0;
    const fake = stickBot(true, 100, false);
    const out = await craftSticks(fake.bot, 4);
    expect(out).toMatchObject({ status: 'failed', reason: 'missing_station' });
    expect(spare.placeCalls).toEqual([]);
  });

  it('crafts the 4 sticks two planks allow when 8 are asked, and says fewer were made', async () => {
    const fake = stickBot(false, 2);
    const out = await craftSticks(fake.bot, 8);
    expect(out).toMatchObject({
      status: 'completed',
      detail: { item: 'stick', crafted: 4, message: 'made fewer than asked; materials ran out' },
    });
  });
});
