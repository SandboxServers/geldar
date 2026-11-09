import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createShutdown } from './shutdown.ts';

interface Rig {
  stop: (signal: string) => void;
  close: ReturnType<typeof vi.fn>;
  exit: ReturnType<typeof vi.fn>;
  logs: Record<string, unknown>[];
  unref: ReturnType<typeof vi.fn>;
}

function rig(close: () => Promise<void>): Rig {
  const closeFn = vi.fn(close);
  const exit = vi.fn();
  const unref = vi.fn();
  const logs: Record<string, unknown>[] = [];
  const stop = createShutdown({
    close: closeFn,
    log: (line) => logs.push(line),
    exit,
    setTimer: (fn, ms) => {
      const handle = setTimeout(fn, ms);
      return {
        unref: () => {
          unref();
          return handle.unref();
        },
      };
    },
  });
  return { stop, close: closeFn, exit, logs, unref };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createShutdown', () => {
  it('logs stopping, then exits 0 when close succeeds', async () => {
    const r = rig(async () => {});
    r.stop('SIGTERM');
    expect(r.logs[0]).toMatchObject({ event: 'stopping' });
    await vi.advanceTimersByTimeAsync(0);
    expect(r.exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('logs stop_failed with a message cut to 200 chars and exits 1 when close rejects', async () => {
    const r = rig(async () => {
      throw new Error('x'.repeat(500));
    });
    r.stop('SIGINT');
    await vi.advanceTimersByTimeAsync(0);
    const failed = r.logs.find((l) => l.event === 'stop_failed');
    expect(failed?.error).toBe('x'.repeat(200));
    expect(r.exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('exits 1 through the timer when close hangs', async () => {
    const r = rig(() => new Promise<void>(() => {}));
    r.stop('SIGTERM');
    await vi.advanceTimersByTimeAsync(4999);
    expect(r.exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(r.exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(r.logs.some((l) => l.event === 'stop_failed')).toBe(true);
  });

  it('closes once when a second signal arrives', async () => {
    const r = rig(() => new Promise<void>(() => {}));
    r.stop('SIGINT');
    r.stop('SIGTERM');
    expect(r.close).toHaveBeenCalledTimes(1);
    expect(r.logs.filter((l) => l.event === 'stopping')).toHaveLength(1);
  });

  it('unrefs the force-exit timer', () => {
    const r = rig(() => new Promise<void>(() => {}));
    r.stop('SIGTERM');
    expect(r.unref).toHaveBeenCalledTimes(1);
  });
});
