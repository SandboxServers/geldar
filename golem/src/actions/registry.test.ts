import { EventEmitter } from 'node:events';
import type { Bot } from 'mineflayer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ActionOutcome, completed, failed } from './outcome.ts';
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

/**
 * A bot that may be in a bed. The client's `entity_action` write is the wake request (`wake`); the
 * server's update clears `isSleeping` and emits 'wake' a moment later (10 ms), unless `serverWakes` is
 * false. `wakeError` makes the write throw.
 */
function sleepingBot(options: { asleep: boolean; wakeError?: Error; serverWakes?: boolean }) {
  const state = { asleep: options.asleep };
  const emitter = new EventEmitter();
  const wake = vi.fn((_name: string, _params: Record<string, unknown>) => {
    if (options.wakeError) throw options.wakeError;
    if (options.serverWakes === false) return;
    setTimeout(() => {
      state.asleep = false;
      emitter.emit('wake');
    }, 10);
  });
  const bot = Object.assign(emitter, {
    time: { age: 0 },
    entity: { id: 7 },
    _client: { write: wake },
  });
  Object.defineProperty(bot, 'isSleeping', { get: () => state.asleep });
  return { bot: bot as unknown as Bot, wake, emitter };
}

describe('runAction and a sleeping bot', () => {
  it('wakes the bot before a move runs, and the move starts once the wake is confirmed', async () => {
    const { bot, wake, emitter } = sleepingBot({ asleep: true });
    const order: string[] = [];
    emitter.on('wake', () => order.push('wake event'));
    const registry = new ActionRegistry();
    registry.register(
      mineHandler(async () => {
        order.push(bot.isSleeping ? 'run while asleep' : 'run awake');
        return completed();
      }, 5_000),
    );

    const out = await runAction(registry, bot, validMine);

    expect(wake).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['wake event', 'run awake']);
    expect(out.state).toBe('completed');
  });

  it('fails "you are still in bed" without running the move when the server never confirms the wake', async () => {
    const { bot, emitter } = sleepingBot({ asleep: true, serverWakes: false });
    const run = vi.fn(async () => completed());
    const registry = new ActionRegistry();
    registry.register(mineHandler(run, 5_000));

    const out = await runAction(registry, bot, validMine);

    expect(run).not.toHaveBeenCalled();
    expect(emitter.listenerCount('wake')).toBe(0);
    expect(out.state).toBe('failed');
    expect(out.result.reason).toBe('blocked');
    expect(out.result.message).toBe('you are still in bed');
  }, 5_000);

  it('does not wake the bot for a sleep action', async () => {
    const { bot, wake } = sleepingBot({ asleep: true });
    const registry = new ActionRegistry();
    registry.register({ kind: 'sleep', timeoutMs: 1_000, run: async () => completed() });

    const out = await runAction(registry, bot, { do: 'sleep' });

    expect(wake).not.toHaveBeenCalled();
    expect(out.state).toBe('completed');
  });

  it('does not wake the bot for wait or note', async () => {
    const { bot, wake } = sleepingBot({ asleep: true });
    const registry = new ActionRegistry();
    registry.register({ kind: 'wait', timeoutMs: 1_000, run: async () => completed() });
    registry.register({ kind: 'note', timeoutMs: 1_000, run: async () => completed() });

    const waited = await runAction(registry, bot, { do: 'wait', seconds: 1 });
    const noted = await runAction(registry, bot, { do: 'note', text: 'chest by the bed' });

    expect(wake).not.toHaveBeenCalled();
    expect(waited.state).toBe('completed');
    expect(noted.state).toBe('completed');
  });

  it('wakes the bot before goto runs', async () => {
    const { bot, wake } = sleepingBot({ asleep: true });
    const registry = new ActionRegistry();
    registry.register({ kind: 'goto', timeoutMs: 5_000, run: async () => completed() });

    await runAction(registry, bot, { do: 'goto', target: { x: 0, y: 0, z: 0 } });

    expect(wake).toHaveBeenCalledTimes(1);
  });

  it('does not wake an awake bot', async () => {
    const { bot, wake } = sleepingBot({ asleep: false });
    const registry = new ActionRegistry();
    registry.register(mineHandler(async () => completed()));

    await runAction(registry, bot, validMine);

    expect(wake).not.toHaveBeenCalled();
  });

  it('fails "you are still in bed" without running the move when the wake cannot be written', async () => {
    const { bot, wake, emitter } = sleepingBot({ asleep: true, wakeError: new Error('no bed') });
    const run = vi.fn(async () => completed());
    const registry = new ActionRegistry();
    registry.register(mineHandler(run));

    const out = await runAction(registry, bot, validMine);

    expect(wake).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
    expect(emitter.listenerCount('wake')).toBe(0);
    expect(out.result.message).toBe('you are still in bed');
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

/** A sink that keeps every line; its clock is `clock.t`. */
function lineSink() {
  const lines: string[] = [];
  const clock = { t: 0 };
  return { lines, clock, sink: { log: (line: string) => lines.push(line), now: () => clock.t } };
}

/** The parsed JSON of each line. */
function parsed(lines: string[]): Record<string, unknown>[] {
  return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** A bot with a clock and a position, for the failure log. */
function positionedBot(): Bot {
  return {
    time: { age: 0 },
    entity: { position: { x: 10.5, y: 64, z: -3.25 } },
  } as unknown as Bot;
}

describe('runAction failure log', () => {
  it('writes exactly one action_failed line for a failing handler, with do, reason, message and position', async () => {
    const registry = new ActionRegistry();
    registry.register(
      mineHandler(async () => failed('blocked', 'the way was blocked: target occupied')),
    );
    const { lines, sink } = lineSink();

    const out = await runAction(registry, positionedBot(), validMine, { failureSink: sink });

    expect(out.result.reason).toBe('blocked');
    expect(lines).toHaveLength(1);
    expect(parsed(lines)[0]).toMatchObject({
      event: 'action_failed',
      do: 'mine',
      reason: 'blocked',
      message: 'the way was blocked: target occupied',
      pos: { x: 10.5, y: 64, z: -3.25 },
    });
    expect(typeof parsed(lines)[0]?.ms).toBe('number');
  });

  it('logs the raw error behind a plain failure as raw, cut to 200 characters', async () => {
    const registry = new ActionRegistry();
    const raw = `Server refused to place dirt at (1, 2, 3): the block is still air ${'x'.repeat(300)}`;
    registry.register(
      mineHandler(async () =>
        failed('blocked', 'the server did not place the block: it is still air', {}, raw),
      ),
    );
    const { lines, sink } = lineSink();

    await runAction(registry, positionedBot(), validMine, { failureSink: sink });

    const line = parsed(lines)[0];
    expect(line?.message).toBe('the server did not place the block: it is still air');
    expect(typeof line?.raw).toBe('string');
    expect(line?.raw).toBe(raw.slice(0, 200));
    expect(String(line?.raw)).toContain('Server refused to place');
  });

  it('keeps raw out of the stored result the Mind sees, and writes no raw key without one', async () => {
    const registry = new ActionRegistry();
    registry.register(
      mineHandler(async () =>
        failed('blocked', 'the server did not place the block', {}, 'Server refused to place dirt'),
      ),
    );
    const { lines, sink } = lineSink();

    const out = await runAction(registry, positionedBot(), validMine, { failureSink: sink });

    expect(out.result).not.toHaveProperty('raw');
    expect(JSON.stringify(out.result)).not.toContain('Server refused');
    expect(out.result.message).toBe('the server did not place the block');
    expect(parsed(lines)[0]?.raw).toBe('Server refused to place dirt');

    const plain = new ActionRegistry();
    plain.register(mineHandler(async () => failed('blocked', 'plain words')));
    const quiet = lineSink();
    await runAction(plain, positionedBot(), validMine, { failureSink: quiet.sink });
    expect(parsed(quiet.lines)[0]).not.toHaveProperty('raw');
  });

  it('writes no line when the handler completes', async () => {
    const registry = new ActionRegistry();
    registry.register(mineHandler(async () => completed()));
    const { lines, sink } = lineSink();

    const out = await runAction(registry, positionedBot(), validMine, { failureSink: sink });

    expect(out.state).toBe('completed');
    expect(lines).toEqual([]);
  });

  it('logs a timeout and a cancel as failures', async () => {
    const registry = new ActionRegistry();
    registry.register(mineHandler(() => new Promise<never>(() => undefined), 5));
    const { lines, sink } = lineSink();
    await runAction(registry, positionedBot(), validMine, { failureSink: sink });

    const controller = new AbortController();
    controller.abort();
    await runAction(registry, positionedBot(), validMine, {
      failureSink: sink,
      signal: controller.signal,
    });

    expect(parsed(lines).map((line) => line.reason)).toEqual(['timeout', 'cancelled']);
  });

  it('suppresses duplicates for 2 s per bot and counts them on the next line for that key', async () => {
    const registry = new ActionRegistry();
    registry.register(mineHandler(async () => failed('blocked', 'no path')));
    const bot = positionedBot();
    const { lines, clock, sink } = lineSink();
    const run = (): Promise<unknown> => runAction(registry, bot, validMine, { failureSink: sink });

    await run();
    clock.t = 500;
    await run();
    clock.t = 1_000;
    await run();
    expect(lines).toHaveLength(1);

    clock.t = 2_500;
    await run();
    expect(lines).toHaveLength(2);
    expect(parsed(lines)[1]).toMatchObject({ message: 'no path', repeats: 2 });
    expect(parsed(lines)[0]).not.toHaveProperty('repeats');
  });

  it('keeps a different message on its own rate limit', async () => {
    let calls = 0;
    const registry = new ActionRegistry();
    registry.register(
      mineHandler(async () => failed('blocked', calls++ === 0 ? 'no path' : 'target occupied')),
    );
    const bot = positionedBot();
    const { lines, clock, sink } = lineSink();

    await runAction(registry, bot, validMine, { failureSink: sink });
    clock.t = 100;
    await runAction(registry, bot, validMine, { failureSink: sink });

    expect(parsed(lines).map((line) => line.message)).toEqual(['no path', 'target occupied']);
  });

  it('truncates long args so the line stays near 400 characters', async () => {
    const registry = new ActionRegistry();
    const { lines, sink } = lineSink();
    const huge = { do: 'mine', block: 'x'.repeat(5_000), count: 2 };

    await runAction(registry, positionedBot(), huge, { failureSink: sink });

    expect(lines).toHaveLength(1);
    expect(lines[0]?.length ?? 0).toBeLessThanOrEqual(480);
    expect(parsed(lines)[0]?.args).toEqual({ block: 'x'.repeat(80), count: 2 });
  });

  it('cuts args that stay too long after per-string truncation, so the line stays short', async () => {
    const registry = new ActionRegistry();
    const { lines, sink } = lineSink();
    const many = { do: 'mine', block: 'oak_log', list: Array.from({ length: 2_000 }, () => 7) };

    await runAction(registry, positionedBot(), many, { failureSink: sink });

    expect(lines).toHaveLength(1);
    expect(lines[0]?.length ?? 0).toBeLessThanOrEqual(480);
    expect(parsed(lines)[0]?.args).toHaveProperty('cut');
  });
});
