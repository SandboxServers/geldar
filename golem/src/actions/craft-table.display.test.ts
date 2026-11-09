import type { Bot } from 'mineflayer';
import { describe, expect, it, vi } from 'vitest';
import {
  answerRequests,
  BED,
  bookAdd,
  DYE_BED,
  fakeGame,
  openWithWindowState,
  run,
  SHAPED_BED,
  TABLE,
  WINDOW,
  writesOf,
} from './craft-table.fakes.ts';
import { craftFromBook, hasUnlockedDisplay, watchRecipeBook } from './craft-table.ts';
import type { ActionContext } from './registry.ts';

describe('craftFromBook, the crafting display', () => {
  it('reports whether the book has an unlocked crafting display for the item', () => {
    const fake = fakeGame();
    watchRecipeBook(fake.bot);
    expect(hasUnlockedDisplay(fake.bot, BED)).toBe(false);
    fake.client.emit('recipe_book_add', bookAdd([[SHAPED_BED, 'crafting_shaped', BED.id]]));
    expect(hasUnlockedDisplay(fake.bot, BED)).toBe(true);
  });

  it('drops a display the server takes back with recipe_book_remove', () => {
    const fake = fakeGame();
    watchRecipeBook(fake.bot);
    fake.client.emit('recipe_book_add', bookAdd([[SHAPED_BED, 'crafting_shaped', BED.id]]));
    fake.client.emit('recipe_book_remove', { recipeIds: [SHAPED_BED] });
    expect(hasUnlockedDisplay(fake.bot, BED)).toBe(false);
  });

  it('watches nothing and does not throw for a bot without a protocol client', () => {
    const bot = {} as unknown as Bot;
    expect(() => watchRecipeBook(bot)).not.toThrow();
    expect(hasUnlockedDisplay(bot, BED)).toBe(false);
  });

  it('reads a result of type item, a bare item id, as the item it makes', () => {
    const fake = fakeGame();
    watchRecipeBook(fake.bot);
    fake.client.emit('recipe_book_add', {
      replace: false,
      entries: [
        {
          recipe: {
            displayId: SHAPED_BED,
            display: { type: 'crafting_shaped', data: { result: { type: 'item', data: BED.id } } },
          },
        },
      ],
    });
    expect(hasUnlockedDisplay(fake.bot, BED)).toBe(true);
  });

  it('moves to the next display when the first never answers, and tries the working one first next time', async () => {
    const fake = fakeGame(openWithWindowState);
    watchRecipeBook(fake.bot);
    fake.client.emit(
      'recipe_book_add',
      bookAdd([
        [DYE_BED, 'crafting_shapeless', BED.id],
        [SHAPED_BED, 'crafting_shaped', BED.id],
      ]),
    );
    answerRequests(fake.client, WINDOW.id, [SHAPED_BED]);

    expect(await run(fake.bot, 2)).toBeNull();

    // The silent display costs one result wait in the first craft only; the second craft asks the
    // display that worked first.
    expect(
      writesOf(fake.client, 'craft_recipe_request').map(
        (p) => (p as { recipeId: number }).recipeId,
      ),
    ).toEqual([DYE_BED, SHAPED_BED, SHAPED_BED]);
  });

  it('moves on at once from a display the server answers without a result', async () => {
    const fake = fakeGame(openWithWindowState);
    watchRecipeBook(fake.bot);
    fake.client.emit(
      'recipe_book_add',
      bookAdd([
        [DYE_BED, 'crafting_shapeless', BED.id],
        [SHAPED_BED, 'crafting_shaped', BED.id],
      ]),
    );
    answerRequests(fake.client, WINDOW.id, [SHAPED_BED]);
    const answer = fake.client.write.getMockImplementation() as (
      name: string,
      params: Record<string, unknown>,
    ) => void;
    const sentAt = new Map<number, number>();
    fake.client.write.mockImplementation((name: string, params: Record<string, unknown>) => {
      if (name === 'craft_recipe_request') {
        sentAt.set(params.recipeId as number, Date.now());
        if (params.recipeId === DYE_BED) {
          // The server's answer to a request: the placed recipe, with no result slot after it.
          fake.client.emit('craft_recipe_response', {
            windowId: WINDOW.id,
            recipeDisplay: { type: 'crafting_shapeless', data: {} },
          });
        }
      }
      answer(name, params);
    });
    // timeScale 0.1: the result wait is 500 ms, the answer grace 100 ms.
    const ctx: ActionContext = {
      bot: fake.bot,
      signal: new AbortController().signal,
      timeScale: 0.1,
    };

    expect(await craftFromBook(ctx, BED, 1, TABLE)).toBeNull();

    const gap = (sentAt.get(SHAPED_BED) ?? 0) - (sentAt.get(DYE_BED) ?? 0);
    expect(writesOf(fake.client, 'craft_recipe_request')).toHaveLength(2);
    // The result wait would be 500 ms: the answered miss must come well before it.
    expect(gap).toBeLessThan(400);
  });

  it('keeps only the displays of crafting types: a result with no crafting display is not unlocked', async () => {
    const fake = fakeGame(openWithWindowState);
    watchRecipeBook(fake.bot);
    fake.client.emit('recipe_book_add', bookAdd([[DYE_BED, 'crafting_special_dye', BED.id]]));

    const out = await run(fake.bot, 1);

    expect(out).toMatchObject({
      status: 'failed',
      reason: 'not_possible',
      detail: { unlocked: false },
    });
    expect(fake.raw.activateBlock).not.toHaveBeenCalled();
    expect(writesOf(fake.client, 'craft_recipe_request')).toEqual([]);
  });

  it('fails internal, and never opens the table, when a bot with a client was never watched', async () => {
    const fake = fakeGame(openWithWindowState);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const out = await run(fake.bot, 1);

    expect(out).toMatchObject({ status: 'failed', reason: 'internal' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('watchRecipeBook'));
    expect(fake.raw.activateBlock).not.toHaveBeenCalled();
    expect(writesOf(fake.client, 'craft_recipe_request')).toEqual([]);
    warn.mockRestore();
  });

  it('fails not_possible with a not-unlocked detail, and never opens the table, when the book has no display', async () => {
    const fake = fakeGame(openWithWindowState);
    watchRecipeBook(fake.bot);

    const out = await run(fake.bot, 1);

    expect(out).toMatchObject({
      status: 'failed',
      reason: 'not_possible',
      message: expect.stringMatching(/not unlocked/),
      detail: { item: 'white_bed', unlocked: false },
    });
    expect(fake.raw.activateBlock).not.toHaveBeenCalled();
    expect(fake.client.write).not.toHaveBeenCalled();
  });

  it('forgets the old book when the server resends it with replace', async () => {
    const fake = fakeGame(openWithWindowState);
    watchRecipeBook(fake.bot);
    fake.client.emit('recipe_book_add', bookAdd([[SHAPED_BED, 'crafting_shaped', BED.id]]));
    fake.client.emit('recipe_book_add', bookAdd([[DYE_BED, 'crafting_special_dye', BED.id]], true));

    const out = await run(fake.bot, 1);

    expect(out).toMatchObject({ status: 'failed', detail: { unlocked: false } });
  });
});
