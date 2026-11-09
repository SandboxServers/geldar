import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AT, ctxFor, harness, moveLikeLibrary } from './container.fakes.ts';
import { withdrawAction } from './container.ts';
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
    expect(transfer).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      h.container,
      'withdraw',
      1,
      4,
    );
  });

  it('reports cancelled with the moved count when the transfer was aborted', async () => {
    const h = harness();
    h.chest.set(1, 6);
    transfer.mockImplementationOnce(async () => {
      h.chest.set(1, 4);
      h.inv.set(1, 12);
      return { error: null, aborted: true };
    });
    const outcome = await withdrawAction.run(ctxFor(h.bot), {
      do: 'withdraw',
      at: AT,
      item: 'cobblestone',
      count: 5,
    });
    expect(outcome).toEqual({ status: 'cancelled', detail: { moved: 2 } });
  });

  it('fails internal with the error and the moved count on a transfer fault', async () => {
    const h = harness();
    h.chest.set(1, 6);
    transfer.mockImplementationOnce(async () => {
      h.chest.set(1, 5);
      h.inv.set(1, 11);
      return { error: 'window differs at slot 3', aborted: false };
    });
    const outcome = await withdrawAction.run(ctxFor(h.bot), {
      do: 'withdraw',
      at: AT,
      item: 'cobblestone',
      count: 5,
    });
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'internal',
      message: 'window differs at slot 3',
      detail: { moved: 1 },
    });
  });

  it('reports the real moved count when the server does not confirm after the transfer', async () => {
    const h = harness();
    h.chest.set(1, 6);
    h.sync.mockImplementationOnce(() => new Promise(() => {}));
    const outcome = await withdrawAction.run(ctxFor(h.bot, 0.01), {
      do: 'withdraw',
      at: AT,
      item: 'cobblestone',
      count: 4,
    });
    expect(outcome).toMatchObject({ status: 'failed', reason: 'internal', detail: { moved: 4 } });
  });

  it('never reports a negative moved count when the inventory shrinks during a withdraw', async () => {
    const h = harness();
    h.chest.set(1, 6);
    transfer.mockImplementationOnce(async () => {
      h.inv.set(1, 7);
      return { error: null, aborted: false };
    });
    const outcome = await withdrawAction.run(ctxFor(h.bot), {
      do: 'withdraw',
      at: AT,
      item: 'cobblestone',
      count: 4,
    });
    expect(outcome).toMatchObject({ status: 'failed', detail: { moved: 0 } });
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
    expect(outcome).toMatchObject({
      status: 'failed',
      reason: 'not_possible',
      detail: { moved: 0 },
    });
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
