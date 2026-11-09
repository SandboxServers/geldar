import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import { vi } from 'vitest';
import type { Block } from './bot-types.ts';
import { craftFromBook } from './craft-table.ts';
import type { ActionContext } from './registry.ts';

// Test doubles shared by craft-table.test.ts and craft-table.display.test.ts. No production code imports this file.
// A build or lint config that includes *.test.ts must exclude *.fakes.ts too, or the doubles ship.

/** The crafting table block the table path opens; only its position is read. */
export const TABLE = { position: { x: 1, y: 200, z: 3 } } as unknown as Block;
/** The item the table tests craft: a white bed, made from the shaped recipe or a dye recolour. */
export const BED = { id: 900, name: 'white_bed' };
/** The table window's id: the id a crafting table window gets in the vanilla open. */
export const WINDOW = {
  id: 1,
  type: 'minecraft:crafting',
  inventoryStart: 10,
  // The open table window holds the items in its own inventory slots, from slot 10 on.
  get slots(): unknown[] {
    return [...Array(10).fill(null), ...[...gameStock].map(([type, count]) => ({ type, count }))];
  },
};
/** The stock of the game made last: the window above reads it, as a window reads its own bot's slots. */
let gameStock = new Map<number, number>();
/** A chest window, as another action opens; the table path must never close it. */
export const CHEST = { id: 2, type: 'minecraft:generic_9x3' };
/** The recipe display of the shaped bed, and the dye recolour that shares its result. */
export const SHAPED_BED = 1454;
export const DYE_BED = 499;

/** The stick the yield tests craft: a planks display makes 4, a bamboo display makes 1. */
export const STICK = { id: 901, name: 'stick' };
export const PLANKS_STICK = 2001;
export const BAMBOO_STICK = 2002;

/** A `recipe_book_add` packet with one entry per `[displayId, type, resultId, yield = 1]`. */
export function bookAdd(entries: [number, string, number, number?][], replace = false) {
  return {
    replace,
    entries: entries.map(([displayId, type, resultId, yieldPer = 1]) => ({
      recipe: {
        displayId,
        display: {
          type,
          data: { result: { type: 'item_stack', data: { itemId: resultId, itemCount: yieldPer } } },
        },
      },
    })),
  };
}

/**
 * A fake bot with its protocol client. `activateBlock` opens the window, and `onOpen` sends the
 * window packets a server would send then. The client records writes and emits server packets.
 */
export function fakeGame(onOpen?: (client: EventEmitter) => void) {
  const client = Object.assign(new EventEmitter(), { write: vi.fn() });
  // What the bot holds, by item id: a shift-click adds to it (see `answerRequests`).
  const stock = new Map<number, number>();
  // As in Mineflayer, `bot.inventory` is stale while a table window is open: it catches up on close.
  let snapshot = new Map<number, number>();
  gameStock = stock;
  const raw = Object.assign(new EventEmitter(), {
    _client: client,
    inventory: { count: (id: number) => (raw.currentWindow ? snapshot : stock).get(id) ?? 0 },
    currentWindow: null as object | null,
    activateBlock: vi.fn(async () => {
      snapshot = new Map(stock);
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
  return { bot: raw as unknown as Bot, client, raw, stock };
}

/** The window's own packets at open: its stateId is 5, and window 0 (the player) is at 9. */
export function openWithWindowState(client: EventEmitter): void {
  client.emit('window_items', { windowId: WINDOW.id, stateId: 5, items: [], carriedItem: null });
  client.emit('set_slot', { windowId: 0, stateId: 9, slot: 45, item: { present: false } });
}

/**
 * A server that fills the result slot of `windowId` after each recipe request, with stateIds 6, 7, ...
 * A request for a display not in `displayIds` gets no answer, as a wrong display does. The result
 * slot always shows a stack of 1, as the live 26.1 server does whatever a craft makes. `yields`
 * gives the count a shift-click of a display really delivers to `stock` (default 1) and `itemId` its item.
 */
export function answerRequests(
  client: { write: ReturnType<typeof vi.fn> } & EventEmitter,
  windowId = WINDOW.id,
  displayIds?: number[],
  yields: Record<number, number> = {},
  itemId = BED.id,
  stock?: Map<number, number>,
): void {
  let next = 6;
  let requested = 0;
  client.write.mockImplementation((name: string, params: Record<string, unknown>) => {
    if (name === 'window_click' && stock) {
      stock.set(itemId, (stock.get(itemId) ?? 0) + (yields[requested] ?? 1));
    }
    if (name !== 'craft_recipe_request') return;
    const displayId = params.recipeId as number;
    if (displayIds && !displayIds.includes(displayId)) return;
    requested = displayId;
    client.emit('set_slot', {
      windowId,
      stateId: next++,
      slot: 0,
      item: { present: true, itemId, itemCount: 1 },
    });
  });
}

/**
 * Acknowledges each shift-click `delayMs` after it is written, by clearing the result slot, and logs
 * every write and ack in `log`, so a test can check their order against the window's close.
 */
export function ackClicksLater(
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
export function run(bot: Bot, times: number, signal = new AbortController().signal) {
  const ctx: ActionContext = { bot, signal, timeScale: 0.01 };
  return craftFromBook(ctx, BED, times, TABLE);
}

/** The writes of one packet name, with their params. */
export function writesOf(client: { write: ReturnType<typeof vi.fn> }, name: string) {
  return client.write.mock.calls.filter(([n]) => n === name).map(([, params]) => params);
}
