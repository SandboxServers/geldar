import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AT, ctxFor, harness } from './container.fakes.ts';
import { openAction, rememberedContainers } from './container.ts';

vi.mock('./pathing.ts', () => ({ moveNear: vi.fn() }));

const DAY = 24 * 60 * 60 * 1000;
const NOON = new Date('2026-03-01T12:00:00Z');
const OTHER = { x: 9, y: 200, z: 0 };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOON);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('open remembers what it saw', () => {
  it('recalls the contents of a chest it opened, with age_days 0 and then 2', async () => {
    const h = harness();
    h.chest.set(1, 2);
    await openAction.run(ctxFor(h.bot), { do: 'open', at: AT });
    const store = rememberedContainers(h.bot);
    expect(store.recall(AT, Date.now())).toEqual({
      status: 'known',
      age_days: 0,
      contents: [{ item: 'cobblestone', count: 2 }],
    });
    vi.setSystemTime(NOON.getTime() + 2 * DAY);
    expect(store.recall(AT, Date.now())).toMatchObject({ status: 'known', age_days: 2 });
  });

  it('answers unknown, with no contents, for a container never opened', async () => {
    const h = harness();
    h.chest.set(1, 2);
    await openAction.run(ctxFor(h.bot), { do: 'open', at: AT });
    expect(rememberedContainers(h.bot).recall(OTHER, Date.now())).toEqual({ status: 'unknown' });
  });

  it('remembers nothing when the open fails', async () => {
    const h = harness();
    vi.mocked(h.bot.openContainer).mockRejectedValueOnce(new Error('no window'));
    const outcome = await openAction.run(ctxFor(h.bot), { do: 'open', at: AT });
    expect(outcome).toMatchObject({ status: 'failed', reason: 'blocked' });
    expect(rememberedContainers(h.bot).recall(AT, Date.now())).toEqual({ status: 'unknown' });
  });

  it('remembers nothing when the open is aborted before it starts', async () => {
    const h = harness();
    const controller = new AbortController();
    controller.abort();
    const ctx = { ...ctxFor(h.bot), signal: controller.signal };
    const outcome = await openAction.run(ctx, { do: 'open', at: AT });
    expect(outcome).toMatchObject({ status: 'cancelled' });
    expect(h.bot.openContainer).not.toHaveBeenCalled();
    expect(rememberedContainers(h.bot).recall(AT, Date.now())).toEqual({ status: 'unknown' });
  });

  it('remembers nothing when the open race is lost', async () => {
    const h = harness();
    // The open never settles, so the race is lost at 5 ms (5 s scaled by 0.001).
    vi.mocked(h.bot.openContainer).mockImplementationOnce(() => new Promise<never>(() => {}));
    const outcome = await openAction.run(ctxFor(h.bot, 0.001), { do: 'open', at: AT });
    expect(outcome).toMatchObject({ status: 'failed', reason: 'blocked' });
    expect(rememberedContainers(h.bot).recall(AT, Date.now())).toEqual({ status: 'unknown' });
  });

  it('makes no store write when the bot ends', async () => {
    const h = harness();
    h.chest.set(1, 2);
    await openAction.run(ctxFor(h.bot), { do: 'open', at: AT });
    const store = rememberedContainers(h.bot);
    const before = store.recall(AT, Date.now());
    h.emitter.emit('end');
    expect(store.recall(AT, Date.now())).toEqual(before);
    expect(store.size).toBe(1);
  });
});
