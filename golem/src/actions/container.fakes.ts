import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { vi } from 'vitest';
import type { ActionContext } from './registry.ts';

// Shared by container.test.ts and container-withdraw.test.ts. Each test file declares its own
// `vi.mock` calls and installs `moveLikeLibrary` as the transfer stand-in.

/** The stand-in transfer: the fake container moves the items, as the click sequence would. */
export async function moveLikeLibrary(
  _ctx: unknown,
  container: {
    withdraw(id: number, meta: null, count: number): Promise<void>;
    deposit(id: number, meta: null, count: number): Promise<void>;
  },
  direction: 'withdraw' | 'deposit',
  id: number,
  count: number,
): Promise<{ error: string | null; aborted: boolean }> {
  try {
    await container[direction](id, null, count);
    return { error: null, aborted: false };
  } catch (caught) {
    return { error: caught instanceof Error ? caught.message : String(caught), aborted: false };
  }
}

/** Item ids the fake registry knows, and their names. */
export const NAMES: Record<number, string> = { 1: 'cobblestone', 2: 'stick' };
/** Simulated stacks: item id to count. */
export type Stacks = Map<number, number>;

export interface FakeOptions {
  /** How many items one deposit or withdraw moves at most; the rest stay where they were. */
  moveLimit?: number;
  /** A message the library throws from `withdraw`, before it moves anything. */
  withdrawError?: string;
  /** Milliseconds before the window opens; `openContainer` resolves only after that. */
  openDelayMs?: number;
  /** The name of the block at the position. */
  blockName?: string;
}

/** A position 3.6 blocks from the bot: inside reach, so `moveNear` is not called. */
export const AT = { x: 3, y: 200, z: 0 };

/**
 * A fake chest over the given stacks. `inv` is the open window's player region: clicks move
 * items there, and `count` reads it. `onClose` runs when the window closes.
 */
export function fakeContainer(inv: Stacks, chest: Stacks, opts: FakeOptions, onClose: () => void) {
  const limit = opts.moveLimit ?? Number.POSITIVE_INFINITY;
  return {
    containerItems: () => [...chest].map(([id, count]) => ({ name: NAMES[id] ?? '', count })),
    containerCount: vi.fn((id: number) => chest.get(id) ?? 0),
    count: vi.fn((id: number) => inv.get(id) ?? 0),
    deposit: vi.fn(async (id: number, _meta: number | null, count: number | null) => {
      const n = Math.min(count ?? 0, limit, inv.get(id) ?? 0);
      inv.set(id, (inv.get(id) ?? 0) - n);
      chest.set(id, (chest.get(id) ?? 0) + n);
    }),
    withdraw: vi.fn(async (id: number, _meta: number | null, count: number | null) => {
      if (opts.withdrawError) throw new Error(opts.withdrawError);
      const n = Math.min(count ?? 0, limit, chest.get(id) ?? 0);
      chest.set(id, (chest.get(id) ?? 0) - n);
      inv.set(id, (inv.get(id) ?? 0) + n);
    }),
    close: vi.fn(async () => {
      onClose();
    }),
    /** A chest's window type, as mineflayer names it. */
    type: 'minecraft:generic_9x3',
  };
}

/**
 * A fake bot with a container at `AT`, an inventory and an event emitter for `windowOpen`.
 * As in mineflayer, `bot.inventory` is a snapshot: it is stale while the window is open and
 * catches up only when the window closes.
 */
export function harness(opts: FakeOptions = {}) {
  const inv: Stacks = new Map([[1, 10]]);
  const chest: Stacks = new Map();
  // The server's chest. Clicks reach the client view at once; the server has them only after a sync.
  const serverChest: Stacks = new Map();
  const sync = vi.fn(async () => {
    serverChest.clear();
    for (const [id, count] of chest) serverChest.set(id, count);
  });
  let synced: [number, number][] = [...inv];
  const container = fakeContainer(inv, chest, opts, () => {
    synced = [...inv];
  });
  const emitter = new EventEmitter();
  const bot = Object.assign(emitter, {
    registry: {
      itemsByName: {
        cobblestone: { id: 1, name: 'cobblestone' },
        stick: { id: 2, name: 'stick' },
      },
    },
    entity: { position: new Vec3(0, 200, 0) },
    inventory: {
      items: () => synced.map(([type, count]) => ({ type, name: NAMES[type], count, slot: 9 })),
    },
    blockAt: () => ({ name: opts.blockName ?? 'chest', position: new Vec3(AT.x, AT.y, AT.z) }),
    openContainer: vi.fn(async () => {
      if (opts.openDelayMs === undefined) return container;
      return new Promise((resolve) => {
        setTimeout(() => {
          emitter.emit('windowOpen', container);
          resolve(container);
        }, opts.openDelayMs);
      });
    }),
    closeWindow: vi.fn(async () => undefined),
    // As in mineflayer 1.17.1+: the sync resolves once the server has the window's clicks.
    _syncWindow: sync,
    currentWindow: null,
  });
  return { bot: bot as unknown as Bot, inv, chest, serverChest, sync, container, emitter };
}

export function ctxFor(bot: Bot, timeScale = 1): ActionContext {
  return { bot, signal: new AbortController().signal, timeScale };
}
