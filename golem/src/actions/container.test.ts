import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { depositAction, openAction, withdrawAction } from './container.ts';
import { moveNear } from './pathing.ts';
import type { ActionContext } from './registry.ts';

vi.mock('./pathing.ts', () => ({ moveNear: vi.fn() }));

/** Item ids the fake registry knows, and their names. */
const NAMES: Record<number, string> = { 1: 'cobblestone', 2: 'stick' };
/** Simulated stacks: item id to count. */
type Stacks = Map<number, number>;

interface FakeOptions {
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
const AT = { x: 3, y: 200, z: 0 };

/**
 * A fake chest over the given stacks. `inv` is the open window's player region: clicks move
 * items there, and `count` reads it. `onClose` runs when the window closes.
 */
function fakeContainer(inv: Stacks, chest: Stacks, opts: FakeOptions, onClose: () => void) {
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
  };
}

/**
 * A fake bot with a container at `AT`, an inventory and an event emitter for `windowOpen`.
 * As in mineflayer, `bot.inventory` is a snapshot: it is stale while the window is open and
 * catches up only when the window closes.
 */
function harness(opts: FakeOptions = {}) {
  const inv: Stacks = new Map([[1, 10]]);
  const chest: Stacks = new Map();
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
    currentWindow: null,
  });
  return { bot: bot as unknown as Bot, inv, chest, container, emitter };
}

function ctxFor(bot: Bot, timeScale = 1): ActionContext {
  return { bot, signal: new AbortController().signal, timeScale };
}

beforeEach(() => {
  vi.mocked(moveNear).mockReset();
  vi.mocked(moveNear).mockResolvedValue({ ok: true, distance: 0 });
});

describe('open', () => {
  it('reports the container contents and closes the window', async () => {
    const h = harness();
    h.chest.set(1, 2);
    const outcome = await openAction.run(ctxFor(h.bot), { do: 'open', at: AT });
    expect(outcome).toEqual({
      status: 'completed',
      detail: { contents: [{ item: 'cobblestone', count: 2 }] },
    });
    expect(h.container.close).toHaveBeenCalledOnce();
  });

  it('returns not_found without opening when the block is not a container', async () => {
    const h = harness({ blockName: 'stone' });
    const outcome = await openAction.run(ctxFor(h.bot), { do: 'open', at: AT });
    expect(outcome).toMatchObject({ status: 'failed', reason: 'not_found' });
    expect(h.bot.openContainer).not.toHaveBeenCalled();
  });

  it('walks to a container out of reach, with range 3 and the signal', async () => {
    const h = harness();
    h.bot.entity.position = new Vec3(12, 200, 0);
    vi.mocked(moveNear).mockResolvedValueOnce({ ok: false, reason: 'blocked', message: 'walled' });
    const outcome = await openAction.run(ctxFor(h.bot), { do: 'open', at: AT });
    expect(moveNear).toHaveBeenCalledWith(h.bot, AT, 3, expect.objectContaining({ timeScale: 1 }));
    expect(outcome).toEqual({ status: 'failed', reason: 'blocked', message: 'walled', detail: {} });
    expect(h.bot.openContainer).not.toHaveBeenCalled();
  });

  it('closes a window that opens after the open race was lost, and fails blocked', async () => {
    const h = harness({ openDelayMs: 100 });
    // Scaled by 0.01: the race is lost at 50 ms, the window opens at 100 ms, and the late-window
    // listener is still armed (it is dropped at 150 ms).
    const outcome = await openAction.run(ctxFor(h.bot, 0.01), { do: 'open', at: AT });
    expect(outcome).toMatchObject({ status: 'failed', reason: 'blocked' });
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(h.bot.closeWindow).toHaveBeenCalledWith(h.container);
    expect(h.container.close).not.toHaveBeenCalled();
  });

  it('does not close the window of the next open after a lost race that never settled', async () => {
    type Container = Awaited<ReturnType<Bot['openContainer']>>;
    const h = harness();
    // The first open never gets a window: its race is lost and the open stays pending.
    vi.mocked(h.bot.openContainer).mockImplementationOnce(() => new Promise<Container>(() => {}));
    // 5 s scaled by 0.001 is 5 ms: the race is lost long before anything opens.
    const first = await openAction.run(ctxFor(h.bot, 0.001), { do: 'open', at: AT });
    expect(first).toMatchObject({ status: 'failed', reason: 'blocked' });
    // The next open gets a normal window, which the library announces on `windowOpen`.
    vi.mocked(h.bot.openContainer).mockImplementationOnce(async () => {
      h.emitter.emit('windowOpen', h.container);
      return h.container as unknown as Container;
    });
    const second = await openAction.run(ctxFor(h.bot), { do: 'open', at: AT });
    expect(second).toMatchObject({ status: 'completed' });
    expect(h.bot.closeWindow).not.toHaveBeenCalled();
    expect(h.container.close).toHaveBeenCalledOnce();
  });

  it('keeps a close error from replacing the outcome', async () => {
    const h = harness();
    h.container.close.mockRejectedValueOnce(new Error('connection gone'));
    const outcome = await openAction.run(ctxFor(h.bot), { do: 'open', at: AT });
    expect(outcome).toMatchObject({ status: 'completed' });
  });

  it('is cancelled without opening when the signal is already aborted', async () => {
    const h = harness();
    const controller = new AbortController();
    controller.abort();
    const ctx = { ...ctxFor(h.bot), signal: controller.signal };
    const outcome = await openAction.run(ctx, { do: 'open', at: AT });
    expect(outcome).toEqual({ status: 'cancelled', detail: {} });
    expect(h.bot.openContainer).not.toHaveBeenCalled();
  });
});

describe('deposit', () => {
  it('moves the items into the container and reports the new contents', async () => {
    const h = harness();
    const outcome = await depositAction.run(ctxFor(h.bot), {
      do: 'deposit',
      at: AT,
      item: 'cobblestone',
      count: 10,
    });
    expect(outcome).toEqual({
      status: 'completed',
      detail: { moved: 10, container: { cobblestone: 10 } },
    });
    expect(h.inv.get(1)).toBe(0);
    expect(h.container.close).toHaveBeenCalledOnce();
  });

  it('fails missing_materials without moving anything when the inventory holds less', async () => {
    const h = harness();
    const outcome = await depositAction.run(ctxFor(h.bot), {
      do: 'deposit',
      at: AT,
      item: 'cobblestone',
      count: 11,
    });
    expect(outcome).toEqual({
      status: 'failed',
      reason: 'missing_materials',
      message: 'inventory has only 10 cobblestone',
      detail: { moved: 0 },
    });
    expect(h.container.deposit).not.toHaveBeenCalled();
  });

  it('fails not_possible with the count moved when the container takes less', async () => {
    const h = harness({ moveLimit: 4 });
    const outcome = await depositAction.run(ctxFor(h.bot), {
      do: 'deposit',
      at: AT,
      item: 'cobblestone',
      count: 10,
    });
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'not_possible',
      message: 'container full',
      detail: { moved: 4 },
    });
  });

  it('fails invalid_args for an unknown item, before anything moves', async () => {
    const h = harness();
    const outcome = await depositAction.run(ctxFor(h.bot), {
      do: 'deposit',
      at: AT,
      item: 'not_an_item',
      count: 1,
    });
    expect(outcome).toMatchObject({ status: 'failed', reason: 'invalid_args' });
    expect(h.bot.openContainer).not.toHaveBeenCalled();
  });
});

describe('withdraw', () => {
  it('moves the items to the bot and reports the container left over', async () => {
    const h = harness();
    h.chest.set(1, 6);
    const outcome = await withdrawAction.run(ctxFor(h.bot), {
      do: 'withdraw',
      at: AT,
      item: 'cobblestone',
      count: 4,
    });
    expect(outcome).toEqual({
      status: 'completed',
      detail: { moved: 4, container: { cobblestone: 2 } },
    });
    expect(h.inv.get(1)).toBe(14);
  });

  it('fails not_found without withdrawing when the container holds less', async () => {
    const h = harness();
    h.chest.set(1, 3);
    const outcome = await withdrawAction.run(ctxFor(h.bot), {
      do: 'withdraw',
      at: AT,
      item: 'cobblestone',
      count: 4,
    });
    expect(outcome).toEqual({
      status: 'failed',
      reason: 'not_found',
      message: 'container has only 3 cobblestone',
      detail: { moved: 0 },
    });
    expect(h.container.withdraw).not.toHaveBeenCalled();
  });

  it('fails not_possible with inventory full when the library throws that', async () => {
    const h = harness({ withdrawError: 'Unable to withdraw, Bot inventory is full.' });
    h.chest.set(1, 5);
    const outcome = await withdrawAction.run(ctxFor(h.bot), {
      do: 'withdraw',
      at: AT,
      item: 'cobblestone',
      count: 5,
    });
    expect(outcome).toEqual({
      status: 'failed',
      reason: 'not_possible',
      message: 'inventory full',
      detail: { moved: 0 },
    });
  });

  it('fails not_possible, not internal, when the library says destination full', async () => {
    const h = harness({ withdrawError: 'destination full' });
    h.chest.set(1, 5);
    const outcome = await withdrawAction.run(ctxFor(h.bot), {
      do: 'withdraw',
      at: AT,
      item: 'cobblestone',
      count: 5,
    });
    expect(outcome).toMatchObject({ status: 'failed', reason: 'not_possible', detail: { moved: 0 } });
  });

  it('fails invalid_args for an unknown item', async () => {
    const h = harness();
    const outcome = await withdrawAction.run(ctxFor(h.bot), {
      do: 'withdraw',
      at: AT,
      item: 'nope',
      count: 1,
    });
    expect(outcome).toMatchObject({ status: 'failed', reason: 'invalid_args' });
  });

  it('closes the window and rethrows when the callback throws', async () => {
    const h = harness();
    h.container.containerCount.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    await expect(
      withdrawAction.run(ctxFor(h.bot), { do: 'withdraw', at: AT, item: 'stick', count: 1 }),
    ).rejects.toThrow('boom');
    expect(h.container.close).toHaveBeenCalledOnce();
  });
});
