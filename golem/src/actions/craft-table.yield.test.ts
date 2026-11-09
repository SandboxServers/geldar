import { describe, expect, it } from 'vitest';
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
import { craftFromBook, watchRecipeBook } from './craft-table.ts';
import type { ActionContext } from './registry.ts';

// The same item has two displays with different yields (bamboo 1 stick, planks 4 sticks), the
// bamboo one first in the book. The result slot always shows 1, but a shift-click delivers the
// display's yield: the inventory gain, not the slot, must decide the number of crafts.
const YIELDS = { [PLANKS_STICK]: 4, [BAMBOO_STICK]: 1 };

function setup(table: boolean, accepted?: number[], yields: Record<number, number> = YIELDS) {
  const fake = fakeGame(table ? openWithWindowState : undefined);
  watchRecipeBook(fake.bot);
  fake.client.emit(
    'recipe_book_add',
    bookAdd([
      [BAMBOO_STICK, 'crafting_shapeless', STICK.id, 1],
      [PLANKS_STICK, 'crafting_shaped', STICK.id, 4],
    ]),
  );
  answerRequests(fake.client, table ? 1 : 0, accepted, yields, STICK.id, fake.stock);
  const ctx: ActionContext & { want?: number } = {
    bot: fake.bot,
    signal: new AbortController().signal,
    timeScale: 0.01,
  };
  return { fake, ctx };
}

describe.each([
  ['the table', true],
  ['the 2x2 grid', false],
])('craftFromBook on %s, two displays of different yields', (_name, table) => {
  it('crafts once for 4 sticks when the display the server accepts makes 4, not four times', async () => {
    const { fake, ctx } = setup(table, [PLANKS_STICK]);
    // The caller's guess from the first display (1 per craft) is 4 crafts: the observed 4 stops it.
    expect(await craftFromBook({ ...ctx, want: 4 }, STICK, 4, table ? TABLE : null)).toBeNull();
    expect(writesOf(fake.client, 'window_click')).toHaveLength(1);
  });

  it('shows the overshoot the fix removes: the guessed count alone makes 16 sticks', async () => {
    const { fake, ctx } = setup(table, [PLANKS_STICK]);
    expect(await craftFromBook(ctx, STICK, 4, table ? TABLE : null)).toBeNull();
    expect(writesOf(fake.client, 'window_click')).toHaveLength(4);
  });

  it('crafts twice for 5 sticks at a yield of 4, ending with 8', async () => {
    const { fake, ctx } = setup(table, [PLANKS_STICK]);
    expect(await craftFromBook({ ...ctx, want: 5 }, STICK, 5, table ? TABLE : null)).toBeNull();
    expect(writesOf(fake.client, 'window_click')).toHaveLength(2);
  });

  it('crafts four times for 4 sticks when the accepted display makes 1', async () => {
    const { fake, ctx } = setup(table, [BAMBOO_STICK]);
    expect(await craftFromBook({ ...ctx, want: 4 }, STICK, 1, table ? TABLE : null)).toBeNull();
    expect(writesOf(fake.client, 'window_click')).toHaveLength(4);
  });
});

describe.each([
  ['the table', true],
  ['the 2x2 grid', false],
])('craftFromBook on %s with a full inventory', (_name, table) => {
  it('gives up after two crafts that gain nothing, with a clear failure', async () => {
    const { fake, ctx } = setup(table, [PLANKS_STICK], { [PLANKS_STICK]: 0 });
    const outcome = await craftFromBook({ ...ctx, want: 4 }, STICK, 4, table ? TABLE : null);
    expect(outcome).toMatchObject({ status: 'failed', reason: 'not_possible' });
    expect(JSON.stringify(outcome)).toContain('inventory may be full');
    expect(writesOf(fake.client, 'window_click')).toHaveLength(2);
  });
});
