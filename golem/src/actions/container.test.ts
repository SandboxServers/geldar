import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AT, ctxFor, harness, moveLikeLibrary } from './container.fakes.ts';
import { depositAction, openAction } from './container.ts';
import { moveNear } from './pathing.ts';

vi.mock('./pathing.ts', () => ({ moveNear: vi.fn() }));
// The click protocol is covered by container-transfer.test.ts; here the fake container moves the items.
const transfer = vi.hoisted(() => vi.fn());
vi.mock('./container-transfer.ts', () => ({ transferItems: transfer }));
beforeEach(() => {
  transfer.mockReset();
  transfer.mockImplementation(moveLikeLibrary);
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

  it('does not close a late crafting window, which the next action may be waiting for', async () => {
    type Container = Awaited<ReturnType<Bot['openContainer']>>;
    const h = harness();
    vi.mocked(h.bot.openContainer).mockImplementationOnce(() => new Promise<Container>(() => {}));
    const first = await openAction.run(ctxFor(h.bot, 0.01), { do: 'open', at: AT });
    expect(first).toMatchObject({ status: 'failed', reason: 'blocked' });
    // The late window is a crafting table's: the listener is still armed, but must leave it open.
    h.emitter.emit('windowOpen', { id: 7, type: 'minecraft:crafting' });
    expect(h.bot.closeWindow).not.toHaveBeenCalled();
  });

  it('clears the grace timer once the late window arrives', async () => {
    type Container = Awaited<ReturnType<Bot['openContainer']>>;
    vi.useFakeTimers();
    try {
      const h = harness();
      vi.mocked(h.bot.openContainer).mockImplementationOnce(() => new Promise<Container>(() => {}));
      const pending = openAction.run(ctxFor(h.bot), { do: 'open', at: AT });
      await vi.advanceTimersByTimeAsync(5_000);
      expect(await pending).toMatchObject({ status: 'failed', reason: 'blocked' });
      // The grace timer is armed. The late window arrives and runs the drop, which clears it.
      expect(vi.getTimerCount()).toBe(1);
      h.emitter.emit('windowOpen', h.container);
      expect(vi.getTimerCount()).toBe(0);
      expect(h.bot.closeWindow).toHaveBeenCalledWith(h.container);
    } finally {
      vi.useRealTimers();
    }
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
    expect(transfer).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      h.container,
      'deposit',
      1,
      10,
    );
    expect(h.container.close).toHaveBeenCalledOnce();
  });

  it('returns only after the server has the chest contents, not just the client view', async () => {
    const h = harness();
    const outcome = await depositAction.run(ctxFor(h.bot), {
      do: 'deposit',
      at: AT,
      item: 'cobblestone',
      count: 10,
    });
    expect(outcome.status).toBe('completed');
    expect(h.sync).toHaveBeenCalledOnce();
    expect(h.serverChest.get(1)).toBe(10);
  });

  it('fails internal when the server does not confirm the window in time', async () => {
    const h = harness();
    h.sync.mockImplementationOnce(() => new Promise(() => {}));
    const outcome = await depositAction.run(ctxFor(h.bot, 0.01), {
      do: 'deposit',
      at: AT,
      item: 'cobblestone',
      count: 10,
    });
    expect(outcome).toMatchObject({ status: 'failed', reason: 'internal' });
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

  it('never reports a negative moved count when the inventory grows during a deposit', async () => {
    const h = harness();
    transfer.mockImplementationOnce(async () => {
      h.inv.set(1, 13);
      return { error: null, aborted: false };
    });
    const outcome = await depositAction.run(ctxFor(h.bot), {
      do: 'deposit',
      at: AT,
      item: 'cobblestone',
      count: 4,
    });
    expect(outcome).toMatchObject({ status: 'failed', detail: { moved: 0 } });
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
