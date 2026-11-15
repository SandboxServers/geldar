import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setOwnerLookup } from './protected-blocks.ts';
import type { ActionContext } from './registry.ts';
import { unstick } from './unstick.ts';

/** A bot on a stone floor at y 63 with air around; `hang` makes every tick (and so every walk) never end. */
function stallBot(hang: boolean) {
  const stone = (cell: Vec3) => (cell.y === 63 ? { name: 'stone', boundingBox: 'block' } : null);
  const bot = {
    health: 20,
    game: { dimension: 'minecraft:overworld' },
    entity: { position: new Vec3(0.5, 64, 0.5), height: 1.62 },
    blockAt: (cell: Vec3) => stone(cell) ?? { name: 'air', boundingBox: 'empty' },
    async lookAt() {},
    setControlState() {},
    async waitForTicks() {
      if (hang) return new Promise<void>(() => {});
      // A free walk: each tick moves one block east, so the first walk reaches FREE_DISTANCE at once.
      bot.entity.position = bot.entity.position.plus(new Vec3(1, 0, 0));
    },
    async dig() {},
  };
  return bot;
}

function ctxOf(bot: unknown, signal = new AbortController().signal, timeScale = 1): ActionContext {
  return { bot: bot as Bot, signal, timeScale };
}

describe('unstick call deadline (decision 0210 follow-up)', () => {
  afterEach(() => {
    vi.useRealTimers();
    // Restore the owner lookup the way the other unstick describes do.
    setOwnerLookup(null);
  });

  function fakeClock(): void {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    vi.setSystemTime(0);
    setOwnerLookup(() => ({ known: true, owner: null }));
  }

  it('returns its own failure at 25 s when a walk never ends', async () => {
    fakeClock();
    let settled = false;
    const pending = unstick(ctxOf(stallBot(true))).then((outcome) => {
      settled = true;
      return outcome;
    });
    await vi.advanceTimersByTimeAsync(24_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toMatchObject({
      status: 'failed',
      reason: 'blocked',
      message: 'unstick stopped after 25 s; the way out was not cleared',
    });
  });

  it('scales the deadline with the time scale, as the action timeout is', async () => {
    fakeClock();
    let settled = false;
    const pending = unstick(ctxOf(stallBot(true), undefined, 2)).then((outcome) => {
      settled = true;
      return outcome;
    });
    await vi.advanceTimersByTimeAsync(25_000);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(await pending).toMatchObject({ status: 'failed', reason: 'blocked' });
  });

  it('a cancel while a walk hangs returns cancelled, not the deadline failure', async () => {
    fakeClock();
    const controller = new AbortController();
    const pending = unstick(ctxOf(stallBot(true), controller.signal));
    controller.abort();
    expect(await pending).toMatchObject({ status: 'cancelled' });
  });

  it('a call that completes first returns its completion and leaves no deadline timer behind', async () => {
    fakeClock();
    const outcome = await unstick(ctxOf(stallBot(false)));
    expect(outcome).toMatchObject({ status: 'completed' });
    expect(vi.getTimerCount()).toBe(0);
  });
});
