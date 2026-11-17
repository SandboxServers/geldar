import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushTelemetry, TELEMETRY_FLUSH_MS } from './telemetry-flush.ts';

describe('flushTelemetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns after the bound when stop never settles', async () => {
    let returned = false;
    const log = vi.fn();
    const run = flushTelemetry(() => new Promise<void>(() => {}), TELEMETRY_FLUSH_MS, log).then(
      () => {
        returned = true;
      },
    );
    await vi.advanceTimersByTimeAsync(TELEMETRY_FLUSH_MS - 1);
    expect(returned).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await run;
    expect(returned).toBe(true);
    expect(log).not.toHaveBeenCalled();
  });

  it('defaults to a 2 s bound', () => {
    expect(TELEMETRY_FLUSH_MS).toBe(2000);
  });

  it('swallows a rejection and logs it once', async () => {
    const log = vi.fn();
    await flushTelemetry(() => Promise.reject(new Error('boom')), 2000, log);
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]?.[0])).not.toContain('boom');
  });

  it('swallows a synchronous throw', async () => {
    const log = vi.fn();
    await expect(
      flushTelemetry(
        () => {
          throw new Error('sync');
        },
        2000,
        log,
      ),
    ).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('does not throw when the logger throws', async () => {
    await expect(
      flushTelemetry(
        () => Promise.reject(new Error('x')),
        2000,
        () => {
          throw new Error('log');
        },
      ),
    ).resolves.toBeUndefined();
  });

  it('returns at once for a fast stop and clears its timer', async () => {
    const stop = vi.fn(async () => {});
    await flushTelemetry(stop, 2000, vi.fn());
    expect(stop).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
