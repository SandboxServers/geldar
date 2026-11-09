import type { Bot } from 'mineflayer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ActionOutcome, completed } from './outcome.ts';
import { type ActionHandler, ActionRegistry, runAction } from './registry.ts';

/** A fake bot with only the world clock: `runAction` reads nothing else. */
function fakeBot(age = 0): { bot: Bot; time: { age: number } } {
  const time = { age };
  return { bot: { time } as unknown as Bot, time };
}

/** A `mine` handler whose run is `run`. */
function mineHandler(run: ActionHandler<'mine'>['run'], timeoutMs = 1_000): ActionHandler<'mine'> {
  return { kind: 'mine', timeoutMs, run };
}

const validMine = { do: 'mine', block: 'oak_log', count: 2 };

describe('ActionRegistry', () => {
  it('throws when a second handler registers for the same kind', () => {
    const registry = new ActionRegistry();
    registry.register(mineHandler(async () => completed()));
    expect(() => registry.register(mineHandler(async () => completed()))).toThrow(/mine/);
  });

  it('returns the handler for a kind and lists the kinds', () => {
    const registry = new ActionRegistry();
    const handler = mineHandler(async () => completed());
    registry.register(handler);
    expect(registry.get('mine')).toBe(handler);
    expect(registry.get('craft')).toBeUndefined();
    expect(registry.kinds()).toEqual(['mine']);
  });
});

describe('runAction', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns invalid_args without calling the handler when the action is invalid', async () => {
    const run = vi.fn(async () => completed());
    const registry = new ActionRegistry();
    registry.register(mineHandler(run));
    const { bot } = fakeBot();

    const out = await runAction(registry, bot, { do: 'mine', block: 'oak_log', count: 0 });

    expect(run).not.toHaveBeenCalled();
    expect(out.state).toBe('failed');
    expect(out.result.reason).toBe('invalid_args');
    expect(out.result.latency_ms).toBe(0);
    expect(out.result.message?.length).toBeLessThanOrEqual(200);
  });

  it('returns unsupported for a valid verb with no handler', async () => {
    const { bot } = fakeBot();
    const out = await runAction(new ActionRegistry(), bot, validMine);
    expect(out.state).toBe('failed');
    expect(out.result.reason).toBe('unsupported');
  });

  it.each([1, 4])('returns timeout at timeoutMs * timeScale (timeScale %i)', async (timeScale) => {
    let seen: AbortSignal | undefined;
    const registry = new ActionRegistry();
    registry.register(
      mineHandler((ctx) => {
        seen = ctx.signal;
        return new Promise(() => undefined); // never resolves, and ignores the signal
      }, 1_000),
    );
    const { bot } = fakeBot();

    let settled = false;
    const run = runAction(registry, bot, validMine, { timeScale }).then((out) => {
      settled = true;
      return out;
    });
    await vi.advanceTimersByTimeAsync(1_000 * timeScale - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const out = await run;

    expect(out.state).toBe('failed');
    expect(out.result.reason).toBe('timeout');
    expect(seen?.aborted).toBe(true);
  });

  it('returns internal when the handler throws, and logs it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const registry = new ActionRegistry();
    registry.register(
      mineHandler(async () => {
        throw new Error('boom');
      }),
    );
    const out = await runAction(registry, fakeBot().bot, validMine);
    expect(out.state).toBe('failed');
    expect(out.result.reason).toBe('internal');
    expect(out.result.message).toBe('boom');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('boom'));
    warn.mockRestore();
  });

  it('drops a handler result that arrives after the timeout', async () => {
    let seen: AbortSignal | undefined;
    let late: (outcome: ActionOutcome) => void = () => undefined;
    const registry = new ActionRegistry();
    registry.register(
      mineHandler((ctx) => {
        seen = ctx.signal;
        return new Promise((resolve) => {
          late = resolve;
        });
      }, 1_000),
    );

    const run = runAction(registry, fakeBot().bot, validMine);
    await vi.advanceTimersByTimeAsync(1_000);
    late(completed({ mined: 2 }));
    const out = await run;

    expect(out.state).toBe('failed');
    expect(out.result.reason).toBe('timeout');
    expect(seen?.aborted).toBe(true);
  });

  it('logs and drops a handler that rejects after the timeout', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let late: (error: Error) => void = () => undefined;
    const registry = new ActionRegistry();
    registry.register(
      mineHandler(
        () =>
          new Promise((_resolve, reject) => {
            late = reject;
          }),
        1_000,
      ),
    );

    const run = runAction(registry, fakeBot().bot, validMine);
    await vi.advanceTimersByTimeAsync(1_000);
    late(new Error('late boom'));
    await vi.advanceTimersByTimeAsync(0);
    const out = await run;

    expect(out.result.reason).toBe('timeout');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('late boom'));
    warn.mockRestore();
  });

  it.each([0, -2, Number.NaN])('uses timeScale 1 when timeScale is %s', async (timeScale) => {
    const registry = new ActionRegistry();
    registry.register(mineHandler(() => new Promise(() => undefined), 1_000));
    let settled = false;
    const run = runAction(registry, fakeBot().bot, validMine, { timeScale }).then((out) => {
      settled = true;
      return out;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await run).result.reason).toBe('timeout');
  });

  it('caps the wall timeout at the longest delay setTimeout accepts', async () => {
    const registry = new ActionRegistry();
    registry.register(mineHandler(() => new Promise(() => undefined), 1_000));
    let settled = false;
    const run = runAction(registry, fakeBot().bot, validMine, { timeScale: 1e9 }).then((out) => {
      settled = true;
      return out;
    });
    await vi.advanceTimersByTimeAsync(2_147_483_646);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await run).result.reason).toBe('timeout');
  });

  it('leaves no timer and no abort listener behind after a run completes', async () => {
    let seen: AbortSignal | undefined;
    const registry = new ActionRegistry();
    registry.register(
      mineHandler(async (ctx) => {
        seen = ctx.signal;
        return completed();
      }),
    );
    const controller = new AbortController();
    await runAction(registry, fakeBot().bot, validMine, { signal: controller.signal });

    expect(vi.getTimerCount()).toBe(0);
    controller.abort();
    expect(seen?.aborted).toBe(false);
  });

  it('reports latency as the wall time the handler took', async () => {
    const readings = [100, 350];
    const registry = new ActionRegistry();
    registry.register(mineHandler(async () => completed()));
    const out = await runAction(registry, fakeBot().bot, validMine, {
      now: () => readings.shift() ?? 0,
    });
    expect(out.result.latency_ms).toBe(250);
  });

  it('returns cancelled when the external signal aborts', async () => {
    const registry = new ActionRegistry();
    registry.register(mineHandler(() => new Promise(() => undefined)));
    const controller = new AbortController();

    const run = runAction(registry, fakeBot().bot, validMine, { signal: controller.signal });
    await vi.advanceTimersByTimeAsync(10);
    controller.abort();
    const out = await run;

    expect(out.state).toBe('cancelled');
    expect(out.result.status).toBe('cancelled');
    expect(out.result.reason).toBeUndefined();
  });

  it('reports world ticks as the bot.time.age difference', async () => {
    const registry = new ActionRegistry();
    const { bot, time } = fakeBot(1_000);
    registry.register(
      mineHandler(async () => {
        time.age += 42;
        return completed({ mined: 2 });
      }),
    );
    const out = await runAction(registry, bot, validMine);
    expect(out.state).toBe('completed');
    expect(out.result).toMatchObject({
      status: 'completed',
      world_ticks: 42,
      detail: { mined: 2 },
    });
  });

  it('reports null world ticks when bot.time.age is not a number', async () => {
    const registry = new ActionRegistry();
    registry.register(mineHandler(async () => completed()));
    const bot = { time: { age: Number.NaN } } as unknown as Bot;
    const out = await runAction(registry, bot, validMine);
    expect(out.result.world_ticks).toBeNull();
  });
});

describe('ActionRegistry.onFinished', () => {
  it('tells listeners the action and run of every runAction until removed', async () => {
    const registry = new ActionRegistry();
    registry.register(mineHandler(async () => completed()));
    const seen: Array<{ action: unknown; state: string }> = [];
    const remove = registry.onFinished((action, run) => seen.push({ action, state: run.state }));
    const { bot } = fakeBot();

    await runAction(registry, bot, validMine);
    await runAction(registry, bot, { do: 'mine', block: 'oak_log', count: 0 });
    remove();
    await runAction(registry, bot, validMine);

    expect(seen).toEqual([
      { action: validMine, state: 'completed' },
      { action: { do: 'mine', block: 'oak_log', count: 0 }, state: 'failed' },
    ]);
  });

  it('keeps going when a listener throws', async () => {
    const registry = new ActionRegistry();
    registry.register(mineHandler(async () => completed()));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const second = vi.fn();
    registry.onFinished(() => {
      throw new Error('boom');
    });
    registry.onFinished(second);
    const { bot } = fakeBot();

    const out = await runAction(registry, bot, validMine);

    expect(out.state).toBe('completed');
    expect(second).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
