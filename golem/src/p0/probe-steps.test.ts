import type { Bot } from 'mineflayer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActionRun } from '../actions/registry.ts';
import { type CleanupSteps, cleanupProbe } from './probe-cleanup.ts';
import { bounded, gotoAction, gotoTarget, mineAction, receiptOf } from './probe-steps.ts';

afterEach(() => {
  vi.useRealTimers();
});

describe('bounded', () => {
  it('resolves with the work value and leaves no timer behind', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    await expect(bounded(Promise.resolve(7), 1000, 'late', controller.signal)).resolves.toBe(7);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects with the work error and leaves no timer behind', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const work = Promise.reject(new Error('kicked'));
    await expect(bounded(work, 1000, 'late', controller.signal)).rejects.toThrow('kicked');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects with the message when the time runs out', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const pending = bounded(
      new Promise<never>(() => undefined),
      500,
      'join timed out',
      controller.signal,
    );
    const check = expect(pending).rejects.toThrow('join timed out');
    await vi.advanceTimersByTimeAsync(500);
    await check;
  });

  it('rejects at once when the signal aborts, and drops its timer', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const pending = bounded(new Promise<never>(() => undefined), 500, 'late', controller.signal);
    const check = expect(pending).rejects.toThrow('interrupted: interrupted by SIGTERM');
    controller.abort(new Error('interrupted by SIGTERM'));
    await check;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects at once when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('interrupted by SIGINT'));
    await expect(
      bounded(new Promise<never>(() => undefined), 500, 'late', controller.signal),
    ).rejects.toThrow('interrupted: interrupted by SIGINT');
  });
});

describe('the probe actions and receipts', () => {
  const bot = { entity: { position: { x: 10.7, y: 64, z: -3.2 } } } as unknown as Bot;

  it('walks three blocks east of the floored spawn position', () => {
    expect(gotoTarget(bot)).toEqual({ x: 13, y: 64, z: -4 });
    expect(gotoAction(bot)).toEqual({ do: 'goto', target: { x: 13, y: 64, z: -4 } });
  });

  it('mines one stone block', () => {
    expect(mineAction()).toEqual({ do: 'mine', block: 'stone', count: 1 });
  });

  it('prints the state, status, reason and latency of a run', () => {
    const failed = {
      state: 'failed',
      result: { status: 'failed', reason: 'no_path', latency_ms: 42 },
    } as unknown as ActionRun;
    expect(receiptOf(failed)).toBe('failed status=failed reason=no_path latency_ms=42');
    const done = {
      state: 'completed',
      result: { status: 'completed', latency_ms: 9 },
    } as unknown as ActionRun;
    expect(receiptOf(done)).toBe('completed status=completed latency_ms=9');
  });
});

describe('cleanupProbe', () => {
  function steps(fail: Partial<Record<'disconnect' | 'unregister' | 'unwhitelist', string>>): {
    calls: string[];
    steps: CleanupSteps;
  } {
    const calls: string[] = [];
    const step = (name: 'disconnect' | 'unregister' | 'unwhitelist') => async () => {
      calls.push(name);
      const message = fail[name];
      if (message !== undefined) throw new Error(message);
    };
    return {
      calls,
      steps: {
        disconnect: step('disconnect'),
        unregister: step('unregister'),
        unwhitelist: step('unwhitelist'),
      },
    };
  }

  it('runs the three steps in order and reports both removed', async () => {
    const s = steps({});
    const out: string[] = [];
    const result = await cleanupProbe(
      s.steps,
      (l) => out.push(l),
      () => undefined,
    );
    expect(s.calls).toEqual(['disconnect', 'unregister', 'unwhitelist']);
    expect(result).toEqual({ registry: 'removed', whitelist: 'removed', disconnect: 'ok' });
    expect(out).toEqual(['p0 cleanup registry=removed whitelist=removed']);
  });

  it('still removes the whitelist entry when the registry delete fails, and prints the reason', async () => {
    const s = steps({ unregister: 'nats: delete failed' });
    const err: string[] = [];
    const out: string[] = [];
    const result = await cleanupProbe(
      s.steps,
      (l) => out.push(l),
      (l) => err.push(l),
    );
    expect(s.calls).toEqual(['disconnect', 'unregister', 'unwhitelist']);
    expect(result.registry).toBe('failed');
    expect(result.whitelist).toBe('removed');
    expect(err).toEqual(['p0 registry delete failed: nats: delete failed']);
    expect(out).toEqual(['p0 cleanup registry=failed whitelist=removed']);
  });

  it('reports a failed disconnect and still runs the two deletes', async () => {
    const s = steps({ disconnect: 'socket reset' });
    const err: string[] = [];
    const result = await cleanupProbe(
      s.steps,
      () => undefined,
      (l) => err.push(l),
    );
    expect(s.calls).toEqual(['disconnect', 'unregister', 'unwhitelist']);
    expect(result).toEqual({ registry: 'removed', whitelist: 'removed', disconnect: 'failed' });
    expect(err).toEqual(['p0 disconnect failed: socket reset']);
  });

  it('fails the whitelist step without throwing', async () => {
    const s = steps({ unwhitelist: 'RCON connect refused' });
    const out: string[] = [];
    const result = await cleanupProbe(
      s.steps,
      (l) => out.push(l),
      () => undefined,
    );
    expect(result.whitelist).toBe('failed');
    expect(out).toEqual(['p0 cleanup registry=removed whitelist=failed']);
  });
});
