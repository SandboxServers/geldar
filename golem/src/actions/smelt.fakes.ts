import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { vi } from 'vitest';
import type { ActionContext } from './registry.ts';
import { watchSmeltBook } from './smelt-book.ts';

// Item ids of the fake registry.
export const ID = { rawIron: 1, ironIngot: 2, coal: 3, plank: 4, pickaxe: 5, furnace: 6 };
const NAMES: Record<number, string> = {
  1: 'raw_iron',
  2: 'iron_ingot',
  3: 'coal',
  4: 'oak_planks',
  5: 'iron_pickaxe',
  6: 'furnace',
};

type Stack = { type: number; count: number } | null;

export interface FurnaceOptions {
  /** Items already in slots 0 to 2. */
  slots?: [Stack, Stack, Stack];
  /** The number of items the furnace finishes per waitForTicks call. */
  perPoll?: number;
  /** The bot's inventory: item id to count. */
  inv?: Record<number, number>;
  /** Abort the signal once the wait has begun. */
  abortOnWait?: AbortController;
}

/** A fake furnace window over three slots and a player inventory map. */
export function fakeFurnace(opts: FurnaceOptions = {}) {
  const slots: Stack[] = [...(opts.slots ?? [null, null, null])];
  const inv = new Map<number, number>(
    Object.entries(opts.inv ?? { 1: 20, 3: 5, 4: 10, 5: 1 }).map(([k, v]) => [Number(k), v]),
  );
  const window = {
    id: 7,
    slots,
    inventoryStart: 3,
    inventoryEnd: 39,
    count: (id: number) => inv.get(id) ?? 0,
    close: vi.fn(async () => undefined),
  };
  return { window, slots, inv };
}

/** The stand-in for transferItems: moves items between the slot region and the inventory map. */
export function fakeTransfer(f: ReturnType<typeof fakeFurnace>, calls: string[]) {
  return async (
    _ctx: unknown,
    _container: unknown,
    direction: 'withdraw' | 'deposit',
    id: number,
    count: number,
    region?: [number, number],
  ) => {
    calls.push(`${direction}:${id}:${count}:${region?.[0]}`);
    const slot = region?.[0] ?? 0;
    if (direction === 'deposit') {
      f.inv.set(id, (f.inv.get(id) ?? 0) - count);
      f.slots[slot] = { type: id, count: (f.slots[slot]?.count ?? 0) + count };
    } else {
      f.slots[slot] = null;
      f.inv.set(id, (f.inv.get(id) ?? 0) + count);
    }
    return { error: null, aborted: false };
  };
}

/** A fake bot with a furnace in reach and a recipe book that holds raw_iron to iron_ingot. */
export function furnaceBot(f: ReturnType<typeof fakeFurnace>, opts: FurnaceOptions = {}) {
  const client = new EventEmitter();
  let waits = 0;
  const bot = {
    _client: client,
    registry: {
      items: {
        1: { id: 1, name: 'raw_iron', maxDurability: 0 },
        2: { id: 2, name: 'iron_ingot', maxDurability: 0 },
        3: { id: 3, name: 'coal', maxDurability: 0 },
        4: { id: 4, name: 'oak_planks', maxDurability: 0 },
        5: { id: 5, name: 'iron_pickaxe', maxDurability: 250 },
        6: { id: 6, name: 'furnace', maxDurability: 0 },
      },
      itemsByName: Object.fromEntries(
        Object.entries(NAMES).map(([id, name]) => [name, { id: Number(id), name }]),
      ),
      blocksByName: { furnace: { id: 100, name: 'furnace' } },
    },
    entity: { position: new Vec3(0, 64, 0) },
    inventory: {
      items: () =>
        [...f.inv].map(([type, count]) => ({ type, name: NAMES[type] ?? '?', count, slot: 9 })),
      count: (id: number) => f.inv.get(id) ?? 0,
    },
    findBlock: vi.fn(() => ({ name: 'furnace', position: new Vec3(2, 64, 0) })),
    openContainer: vi.fn(async () => f.window),
    waitForTicks: vi.fn(async () => {
      waits++;
      if (opts.abortOnWait && waits === 1) opts.abortOnWait.abort();
      // The furnace makes `perPoll` ingots per poll from the input slot.
      const input = f.slots[0];
      if (input && (opts.perPoll ?? 0) > 0) {
        const n = Math.min(opts.perPoll ?? 0, input.count);
        f.slots[0] = input.count - n > 0 ? { type: input.type, count: input.count - n } : null;
        f.slots[2] = { type: ID.ironIngot, count: (f.slots[2]?.count ?? 0) + n };
      }
    }),
  } as unknown as Bot;
  watchSmeltBook(bot);
  client.emit('recipe_book_add', {
    replace: true,
    entries: [
      {
        recipe: {
          displayId: 1,
          display: {
            type: 'furnace',
            data: {
              ingredient: { type: 'item', data: ID.rawIron },
              result: { type: 'item', data: ID.ironIngot },
              craftingStation: { type: 'item', data: ID.furnace },
            },
          },
        },
      },
    ],
  });
  return { bot, waits: () => waits };
}

export function smeltCtx(bot: Bot, signal = new AbortController().signal): ActionContext {
  return { bot, signal, timeScale: 1 };
}
