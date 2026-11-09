import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import { describe, expect, it, vi } from 'vitest';
import type { Block } from './bot-types.ts';
import { craftFromBook, hasUnlockedDisplay, watchRecipeBook } from './craft-table.ts';
import type { ActionContext } from './registry.ts';

const TABLE = { position: { x: 1, y: 200, z: 3 } } as unknown as Block;
const BED = { id: 900, name: 'white_bed' };
/** The table window's id: the id a crafting table window gets in the vanilla open. */
const WINDOW = { id: 1, type: 'minecraft:crafting' };
/** A chest window, as another action opens; the table path must never close it. */
const CHEST = { id: 2, type: 'minecraft:generic_9x3' };
/** The recipe display of the shaped bed, and the dye recolour that shares its result. */
const SHAPED_BED = 1454;
const DYE_BED = 499;

/** A `recipe_book_add` packet with one entry per `[displayId, type, resultId]`. */
function bookAdd(entries: [number, string, number][], replace = false) {
  return {
    replace,
    entries: entries.map(([displayId, type, resultId]) => ({
      recipe: {
        displayId,
        display: {
          type,
          data: { result: { type: 'item_stack', data: { itemId: resultId, itemCount: 1 } } },
        },
      },
    })),
  };
}

/**
 * A fake bot with its protocol client. `activateBlock` opens the window, and `onOpen` sends the
 * window packets a server would send then. The client records writes and emits server packets.
 */
function fakeGame(onOpen?: (client: EventEmitter) => void) {
  const client = Object.assign(new EventEmitter(), { write: vi.fn() });
  const raw = Object.assign(new EventEmitter(), {
    _client: client,
    currentWindow: null as object | null,
    activateBlock: vi.fn(async () => {
      raw.currentWindow = WINDOW;
      raw.emit('windowOpen', WINDOW);
      onOpen?.(client);
    }),
    closeWindow: vi.fn(async () => {
      raw.currentWindow = null;
    }),
    // A real 1 ms tick, so a timer the server sets (an ack) can fire between the polls.
    waitForTicks: vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 1))),
  });
  return { bot: raw as unknown as Bot, client, raw };
}

/** The window's own packets at open: its stateId is 5, and window 0 (the player) is at 9. */
function openWithWindowState(client: EventEmitter): void {
  client.emit('window_items', { windowId: WINDOW.id, stateId: 5, items: [], carriedItem: null });
  client.emit('set_slot', { windowId: 0, stateId: 9, slot: 45, item: { present: false } });
}

/**
 * A server that fills the result slot of `windowId` after each recipe request, with stateIds 6, 7, ...
 * A request for a display not in `displayIds` gets no answer, as a wrong display does.
 */
function answerRequests(
  client: { write: ReturnType<typeof vi.fn> } & EventEmitter,
  windowId = WINDOW.id,
  displayIds?: number[],
): void {
  let next = 6;
  client.write.mockImplementation((name: string, params: Record<string, unknown>) => {
    if (name !== 'craft_recipe_request') return;
    if (displayIds && !displayIds.includes(params.recipeId as number)) return;
    client.emit('set_slot', {
      windowId,
      stateId: next++,
      slot: 0,
      item: { present: true, itemId: BED.id, itemCount: 1 },
    });
  });
}

/**
 * Acknowledges each shift-click `delayMs` after it is written, by clearing the result slot, and logs
 * every write and ack in `log`, so a test can check their order against the window's close.
 */
function ackClicksLater(
  client: EventEmitter & { write: ReturnType<typeof vi.fn> },
  delayMs: number,
  log: string[],
): void {
  const answer = client.write.getMockImplementation() as
    | ((name: string, params: Record<string, unknown>) => void)
    | undefined;
  client.write.mockImplementation((name: string, params: Record<string, unknown>) => {
    log.push(`write ${name}`);
    answer?.(name, params);
    if (name !== 'window_click') return;
    setTimeout(() => {
      log.push('ack');
      client.emit('set_slot', {
        windowId: WINDOW.id,
        stateId: 50,
        slot: 0,
        item: { present: false },
      });
    }, delayMs);
  });
}

/** Runs the table path with a fresh signal and a short wait (timeScale 0.01 is 50 ms). */
function run(bot: Bot, times: number, signal = new AbortController().signal) {
  const ctx: ActionContext = { bot, signal, timeScale: 0.01 };
  return craftFromBook(ctx, BED, times, TABLE);
}

/** The writes of one packet name, with their params. */
function writesOf(client: { write: ReturnType<typeof vi.fn> }, name: string) {
  return client.write.mock.calls.filter(([n]) => n === name).map(([, params]) => params);
}

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

  it('keeps only the displays of crafting types: a result with no crafting display is not unlocked', async () => {
    const fake = fakeGame(openWithWindowState);
    watchRecipeBook(fake.bot);
    fake.client.emit('recipe_book_add', bookAdd([[DYE_BED, 'crafting_special_dye', BED.id]]));

    const out = await run(fake.bot, 1);

    expect(out).toMatchObject({
      status: 'failed',
      reason: 'missing_materials',
      detail: { unlocked: false },
    });
    expect(fake.raw.activateBlock).not.toHaveBeenCalled();
    expect(writesOf(fake.client, 'craft_recipe_request')).toEqual([]);
  });

  it('fails missing_materials with a not-unlocked detail, and never opens the table, when the book has no display', async () => {
    const fake = fakeGame(openWithWindowState);
    watchRecipeBook(fake.bot);

    const out = await run(fake.bot, 1);

    expect(out).toMatchObject({
      status: 'failed',
      reason: 'missing_materials',
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
});
