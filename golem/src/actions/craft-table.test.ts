import { describe, expect, it, vi } from 'vitest';
import {
  ackClicksLater,
  answerRequests,
  BED,
  bookAdd,
  CHEST,
  fakeGame,
  openWithWindowState,
  run,
  SHAPED_BED,
  WINDOW,
  writesOf,
} from './craft-table.fakes.ts';
import { craftFromBook, watchRecipeBook } from './craft-table.ts';
import type { ActionContext } from './registry.ts';

describe('craftFromBook', () => {
  it('crafts in the player grid at window 0 with no table: nothing opened, nothing closed', async () => {
    const fake = fakeGame();
    watchRecipeBook(fake.bot);
    fake.client.emit('recipe_book_add', bookAdd([[SHAPED_BED, 'crafting_shaped', BED.id]]));
    answerRequests(fake.client, 0);
    const ctx: ActionContext = {
      bot: fake.bot,
      signal: new AbortController().signal,
      timeScale: 0.01,
    };

    expect(await craftFromBook(ctx, BED, 1, null)).toBeNull();

    expect(fake.raw.activateBlock).not.toHaveBeenCalled();
    expect(fake.raw.closeWindow).not.toHaveBeenCalled();
    expect(writesOf(fake.client, 'craft_recipe_request')).toEqual([
      { windowId: 0, recipeId: SHAPED_BED, makeAll: false },
    ]);
    // Window 0's own stateId (6, from its result packet), not the table window's.
    expect(writesOf(fake.client, 'window_click')).toEqual([
      expect.objectContaining({ windowId: 0, stateId: 6, slot: 0, mode: 1 }),
    ]);
  });

  it('requests the shaped display of the recipe, then shift-clicks with the window own stateId', async () => {
    const fake = fakeGame(openWithWindowState);
    watchRecipeBook(fake.bot);
    fake.client.emit('recipe_book_add', bookAdd([[SHAPED_BED, 'crafting_shaped', BED.id]]));
    answerRequests(fake.client);

    expect(await run(fake.bot, 1)).toBeNull();

    expect(writesOf(fake.client, 'craft_recipe_request')).toEqual([
      { windowId: WINDOW.id, recipeId: SHAPED_BED, makeAll: false },
    ]);
    // 6 is the window's latest stateId, from its own result packet. Window 0's 9 is not used.
    expect(writesOf(fake.client, 'window_click')).toEqual([
      expect.objectContaining({
        windowId: WINDOW.id,
        stateId: 6,
        slot: 0,
        mode: 1,
        mouseButton: 0,
      }),
    ]);
    expect(fake.raw.closeWindow).toHaveBeenCalledWith(WINDOW);
    expect(fake.raw.currentWindow).toBeNull();
  });

  it('sends one request and one shift-click per craft, each at the latest stateId', async () => {
    const fake = fakeGame(openWithWindowState);
    watchRecipeBook(fake.bot);
    fake.client.emit('recipe_book_add', bookAdd([[SHAPED_BED, 'crafting_shaped', BED.id]]));
    answerRequests(fake.client);

    expect(await run(fake.bot, 2)).toBeNull();

    expect(writesOf(fake.client, 'craft_recipe_request')).toHaveLength(2);
    expect(
      writesOf(fake.client, 'window_click').map((p) => (p as { stateId: number }).stateId),
    ).toEqual([6, 7]);
  });

  it('waits for each shift-click to be acknowledged before the next craft and before the close', async () => {
    const fake = fakeGame(openWithWindowState);
    watchRecipeBook(fake.bot);
    fake.client.emit('recipe_book_add', bookAdd([[SHAPED_BED, 'crafting_shaped', BED.id]]));
    answerRequests(fake.client);
    const log: string[] = [];
    ackClicksLater(fake.client, 5, log);
    fake.raw.closeWindow.mockImplementation(async () => {
      log.push('close');
      fake.raw.currentWindow = null;
    });

    expect(await run(fake.bot, 2)).toBeNull();

    // Without the wait, the window closes and the second request goes out before any ack.
    expect(log).toEqual([
      'write craft_recipe_request',
      'write window_click',
      'ack',
      'write craft_recipe_request',
      'write window_click',
      'ack',
      'close',
    ]);
  });

  it('does not wait past the bound for an ack that never comes, and still closes', async () => {
    const fake = fakeGame(openWithWindowState);
    watchRecipeBook(fake.bot);
    fake.client.emit('recipe_book_add', bookAdd([[SHAPED_BED, 'crafting_shaped', BED.id]]));
    answerRequests(fake.client);

    expect(await run(fake.bot, 1)).toBeNull();

    expect(fake.raw.closeWindow).toHaveBeenCalledWith(WINDOW);
    expect(fake.raw.currentWindow).toBeNull();
  });

  it('aborts while waiting for the result: cancelled, no shift-click, window closed', async () => {
    const fake = fakeGame(openWithWindowState);
    watchRecipeBook(fake.bot);
    fake.client.emit('recipe_book_add', bookAdd([[SHAPED_BED, 'crafting_shaped', BED.id]]));
    const controller = new AbortController();
    // The server stays silent; the abort comes while the request is on its way.
    fake.client.write.mockImplementation(() => controller.abort());

    const out = await run(fake.bot, 1, controller.signal);

    expect(out).toMatchObject({ status: 'cancelled' });
    expect(writesOf(fake.client, 'window_click')).toEqual([]);
    expect(fake.raw.closeWindow).toHaveBeenCalledWith(WINDOW);
  });

  it('gives up after the bounded wait when no result arrives, with no shift-click', async () => {
    const fake = fakeGame(openWithWindowState);
    watchRecipeBook(fake.bot);
    fake.client.emit('recipe_book_add', bookAdd([[SHAPED_BED, 'crafting_shaped', BED.id]]));

    const out = await run(fake.bot, 1);

    expect(out).toMatchObject({
      status: 'failed',
      reason: 'timeout',
      detail: { item: 'white_bed' },
    });
    expect(writesOf(fake.client, 'window_click')).toEqual([]);
    expect(fake.raw.closeWindow).toHaveBeenCalledWith(WINDOW);
  });

  it('ignores a result in another window slot or an empty result, and waits for the table', async () => {
    const fake = fakeGame(openWithWindowState);
    watchRecipeBook(fake.bot);
    fake.client.emit('recipe_book_add', bookAdd([[SHAPED_BED, 'crafting_shaped', BED.id]]));
    fake.client.write.mockImplementation(() => {
      // The player's own result slot, and an empty table result: neither is the craft.
      fake.client.emit('set_slot', {
        windowId: 0,
        stateId: 10,
        slot: 0,
        item: { present: true, itemCount: 1 },
      });
      fake.client.emit('set_slot', {
        windowId: WINDOW.id,
        stateId: 11,
        slot: 0,
        item: { present: false },
      });
    });

    const out = await run(fake.bot, 1);

    expect(out).toMatchObject({ status: 'failed', reason: 'timeout' });
    expect(writesOf(fake.client, 'window_click')).toEqual([]);
  });

  it('fails timeout when the table window never opens, and sends nothing', async () => {
    const fake = fakeGame();
    fake.raw.activateBlock.mockImplementationOnce(async () => {});
    watchRecipeBook(fake.bot);
    fake.client.emit('recipe_book_add', bookAdd([[SHAPED_BED, 'crafting_shaped', BED.id]]));

    const out = await run(fake.bot, 1);

    expect(out).toMatchObject({ status: 'failed', reason: 'timeout' });
    expect(fake.client.write).not.toHaveBeenCalled();
  });

  it('blocks when the window that opens is not a crafting table, and sends nothing', async () => {
    const fake = fakeGame();
    fake.raw.activateBlock.mockImplementationOnce(async () => {
      fake.raw.currentWindow = CHEST;
      fake.raw.emit('windowOpen', CHEST);
    });
    watchRecipeBook(fake.bot);
    fake.client.emit('recipe_book_add', bookAdd([[SHAPED_BED, 'crafting_shaped', BED.id]]));

    const out = await run(fake.bot, 1);

    expect(out).toMatchObject({ status: 'failed', reason: 'blocked' });
    expect(fake.client.write).not.toHaveBeenCalled();
    // The window that did open is closed by the path, so the bot is not left in it.
    expect(fake.raw.closeWindow).toHaveBeenCalledWith(CHEST);
  });

  it('fails blocked when activating the table rejects, with the listeners removed', async () => {
    const fake = fakeGame();
    fake.raw.activateBlock.mockImplementationOnce(async () => {
      throw new Error('out of reach');
    });
    watchRecipeBook(fake.bot);
    fake.client.emit('recipe_book_add', bookAdd([[SHAPED_BED, 'crafting_shaped', BED.id]]));

    const out = await run(fake.bot, 1);

    expect(out).toMatchObject({ status: 'failed', reason: 'blocked' });
    expect(fake.client.listenerCount('set_slot')).toBe(0);
    expect(fake.client.listenerCount('window_items')).toBe(0);
    // The late-window listener stays for its bounded wait (50 ms here), then is gone.
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(fake.raw.listenerCount('windowOpen')).toBe(0);
  });

  it('cancels during the open wait, with the listeners removed', async () => {
    const fake = fakeGame();
    fake.raw.activateBlock.mockImplementationOnce(async () => {});
    watchRecipeBook(fake.bot);
    fake.client.emit('recipe_book_add', bookAdd([[SHAPED_BED, 'crafting_shaped', BED.id]]));
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 5);

    const out = await run(fake.bot, 1, controller.signal);

    expect(out).toMatchObject({ status: 'cancelled' });
    expect(fake.client.write).not.toHaveBeenCalled();
    expect(fake.client.listenerCount('set_slot')).toBe(0);
    expect(fake.client.listenerCount('window_items')).toBe(0);
  });

  it('closes a crafting window that opens after the open gave up, and never a chest', async () => {
    const fake = fakeGame();
    fake.raw.activateBlock.mockImplementationOnce(async () => {});
    watchRecipeBook(fake.bot);
    fake.client.emit('recipe_book_add', bookAdd([[SHAPED_BED, 'crafting_shaped', BED.id]]));
    expect(await run(fake.bot, 1)).toMatchObject({ status: 'failed', reason: 'timeout' });

    // The lost open is closed when its table window arrives; a chest that opens next is not.
    fake.raw.emit('windowOpen', CHEST);
    expect(fake.raw.closeWindow).not.toHaveBeenCalledWith(CHEST);
    fake.raw.emit('windowOpen', WINDOW);
    expect(fake.raw.closeWindow).toHaveBeenCalledWith(WINDOW);
  });

  it('leaves the late-window timer unref\'d, so it never keeps the process alive', async () => {
    const fake = fakeGame();
    fake.raw.activateBlock.mockImplementationOnce(async () => {});
    watchRecipeBook(fake.bot);
    fake.client.emit('recipe_book_add', bookAdd([[SHAPED_BED, 'crafting_shaped', BED.id]]));
    // Record the timers the craft creates: the open wait's timer is cleared at once, so the
    // last one made is the late-window timer.
    const real = globalThis.setTimeout;
    const made: NodeJS.Timeout[] = [];
    const spy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockImplementation(((handler: () => void, ms?: number) => {
        const timer = real(handler, ms);
        made.push(timer);
        return timer;
      }) as unknown as typeof setTimeout);
    try {
      expect(await run(fake.bot, 1)).toMatchObject({ status: 'failed', reason: 'timeout' });
    } finally {
      spy.mockRestore();
    }
    expect(made.at(-1)?.hasRef()).toBe(false);
  });

  it('drops the late-window listener when the next craft starts', async () => {
    const fake = fakeGame();
    fake.raw.activateBlock.mockImplementationOnce(async () => {});
    watchRecipeBook(fake.bot);
    fake.client.emit('recipe_book_add', bookAdd([[SHAPED_BED, 'crafting_shaped', BED.id]]));
    expect(await run(fake.bot, 1)).toMatchObject({ status: 'failed', reason: 'timeout' });

    // The second craft opens its own table and succeeds, so it arms no late listener of its own.
    answerRequests(fake.client);
    // Closes made by the window's own open event: a stale listener would close the table here.
    let closedAtOpen = -1;
    fake.raw.activateBlock.mockImplementationOnce(async () => {
      fake.raw.currentWindow = WINDOW;
      const before = fake.raw.closeWindow.mock.calls.length;
      fake.raw.emit('windowOpen', WINDOW);
      closedAtOpen = fake.raw.closeWindow.mock.calls.length - before;
      openWithWindowState(fake.client);
    });
    expect(await run(fake.bot, 1)).toBeNull();
    expect(closedAtOpen).toBe(0);
    expect(fake.raw.closeWindow).toHaveBeenCalledTimes(1);
  });

  it('closes window 0 when a grid craft times out, so the ingredients return to the inventory', async () => {
    const fake = fakeGame();
    watchRecipeBook(fake.bot);
    fake.client.emit('recipe_book_add', bookAdd([[SHAPED_BED, 'crafting_shaped', BED.id]]));
    const ctx: ActionContext = {
      bot: fake.bot,
      signal: new AbortController().signal,
      timeScale: 0.01,
    };
    // The server stays silent: the request is never answered, so the grid holds what it moved in.

    expect(await craftFromBook(ctx, BED, 1, null)).toMatchObject({
      status: 'failed',
      reason: 'timeout',
      message: 'the recipe did not produce white_bed',
    });

    expect(writesOf(fake.client, 'close_window')).toEqual([{ windowId: 0 }]);
    expect(fake.raw.closeWindow).not.toHaveBeenCalled();
  });

  it('closes window 0 when a grid craft is aborted between the request and the click', async () => {
    const fake = fakeGame();
    watchRecipeBook(fake.bot);
    fake.client.emit('recipe_book_add', bookAdd([[SHAPED_BED, 'crafting_shaped', BED.id]]));
    const controller = new AbortController();
    fake.client.write.mockImplementation(() => controller.abort());
    const ctx: ActionContext = { bot: fake.bot, signal: controller.signal, timeScale: 0.01 };

    expect(await craftFromBook(ctx, BED, 1, null)).toMatchObject({ status: 'cancelled' });

    expect(writesOf(fake.client, 'window_click')).toEqual([]);
    expect(writesOf(fake.client, 'close_window')).toEqual([{ windowId: 0 }]);
  });

  it('does not close window 0 after a grid craft that ran to the end', async () => {
    const fake = fakeGame();
    watchRecipeBook(fake.bot);
    fake.client.emit('recipe_book_add', bookAdd([[SHAPED_BED, 'crafting_shaped', BED.id]]));
    answerRequests(fake.client, 0);
    const ctx: ActionContext = {
      bot: fake.bot,
      signal: new AbortController().signal,
      timeScale: 0.01,
    };

    expect(await craftFromBook(ctx, BED, 1, null)).toBeNull();

    expect(writesOf(fake.client, 'close_window')).toEqual([]);
  });
});
