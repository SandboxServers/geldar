import { describe, expect, it } from 'vitest';
import { shortfallOf } from './craft-ingredients.ts';
import {
  answerRequests,
  BED,
  bookAdd,
  DYE_BED,
  fakeGame,
  openWithWindowState,
  run,
  SHAPED_BED,
  writesOf,
} from './craft-table.fakes.ts';
import { craftFromBook, watchRecipeBook } from './craft-table.ts';
import type { ActionContext } from './registry.ts';

const WOOL = 10;
const PLANKS = 11;
const DYE = 12;
const REGISTRY = { items: { [WOOL]: { name: 'white_wool' }, [PLANKS]: { name: 'oak_planks' } } };

/** A game with a shaped bed (3 wool, 3 planks) and a recolour (a bed and a dye) unlocked. */
function bedGame() {
  const fake = fakeGame(openWithWindowState);
  Object.assign(fake.raw, { registry: REGISTRY });
  watchRecipeBook(fake.bot);
  fake.client.emit(
    'recipe_book_add',
    bookAdd([
      [
        SHAPED_BED,
        'crafting_shaped',
        BED.id,
        1,
        [[WOOL], [WOOL], [WOOL], [PLANKS], [PLANKS], [PLANKS]],
      ],
      [DYE_BED, 'crafting_shapeless', BED.id, 1, [[BED.id], [DYE]]],
    ]),
  );
  return fake;
}

describe('table craft ingredient pre-check', () => {
  it('refuses with a precise reason and sends no request or click when short', async () => {
    const fake = bedGame();
    fake.stock.set(WOOL, 3);
    fake.stock.set(PLANKS, 1);
    answerRequests(fake.client);

    const outcome = await run(fake.bot, 1);

    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'missing_materials',
      message: 'missing 2 more oak_planks to craft white_bed',
    });
    expect(writesOf(fake.client, 'craft_recipe_request')).toEqual([]);
    expect(writesOf(fake.client, 'window_click')).toEqual([]);
    expect(fake.raw.closeWindow).toHaveBeenCalledTimes(1);
  });

  it('crafts through the second variant when only it is covered', async () => {
    const fake = bedGame();
    fake.stock.set(WOOL, 1);
    fake.stock.set(BED.id, 1);
    fake.stock.set(DYE, 1);
    answerRequests(fake.client, undefined, [DYE_BED], {}, BED.id, fake.stock);

    expect(await run(fake.bot, 1)).toBeNull();

    expect(writesOf(fake.client, 'craft_recipe_request').map((w) => w.recipeId)).toEqual([DYE_BED]);
  });

  it('does not shift-click a result slot that holds another item', async () => {
    const fake = bedGame();
    fake.stock.set(WOOL, 3);
    fake.stock.set(PLANKS, 3);
    // The server fills the slot with item 999, not the bed.
    fake.client.write.mockImplementation((name: string) => {
      if (name !== 'craft_recipe_request') return;
      fake.client.emit('set_slot', {
        windowId: 1,
        stateId: 6,
        slot: 0,
        item: { present: true, itemId: 999, itemCount: 1 },
      });
    });

    expect(await run(fake.bot, 1)).toMatchObject({ status: 'failed', reason: 'timeout' });

    expect(writesOf(fake.client, 'window_click')).toEqual([]);
  });

  it('closes window 0 after a success that left an item in the 2x2 grid', async () => {
    const fake = bedGame();
    fake.stock.set(WOOL, 3);
    fake.stock.set(PLANKS, 3);
    // A bucket from a cake recipe stays in grid slot 2.
    Object.assign(fake.raw.inventory, { slots: [null, null, { type: 77, count: 1 }, null, null] });
    answerRequests(fake.client, 0);
    const ctx: ActionContext = {
      bot: fake.bot,
      signal: new AbortController().signal,
      timeScale: 0.01,
    };

    expect(await craftFromBook(ctx, BED, 1, null)).toBeNull();

    expect(writesOf(fake.client, 'close_window')).toEqual([{ windowId: 0 }]);
  });

  it('closes the table window and returns the grid when aborted mid-craft', async () => {
    const fake = bedGame();
    fake.stock.set(WOOL, 3);
    fake.stock.set(PLANKS, 3);
    const controller = new AbortController();
    fake.client.write.mockImplementation(() => controller.abort());

    expect(await run(fake.bot, 1, controller.signal)).toMatchObject({ status: 'cancelled' });

    expect(fake.raw.closeWindow).toHaveBeenCalledTimes(1);
  });
});

describe('shortfallOf', () => {
  it('covers a cell from any alternative and does not refuse on a greedy choice', () => {
    const held = (id: number) => ({ 1: 1, 2: 1 })[id as 1 | 2] ?? 0;
    // Cell A takes 1 or 2, cell B takes only 1: A must take 2.
    expect(shortfallOf([[1, 2], [1]], held)).toBeNull();
  });

  it('counts the cells left short against their first alternative', () => {
    expect(shortfallOf([[5], [5], [5]], (id) => (id === 5 ? 1 : 0))).toEqual({ id: 5, short: 2 });
  });
});
