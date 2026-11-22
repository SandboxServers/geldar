import { describe, expect, it } from 'vitest';
import {
  BASE_GAP_TICKS,
  gapTicksFor,
  PAUSE_POLL_TICKS,
  SLOW_GAP_TICKS,
  TICK_MS,
  throttleWait,
} from './throttle.ts';

/** A fake clock: sleeps resolve at once and add their length to `elapsedMs`. */
function fakeSleep() {
  const calls: number[] = [];
  const sleep = async (ms: number, signal: AbortSignal): Promise<void> => {
    signal.throwIfAborted();
    calls.push(ms);
  };
  return { calls, sleep, elapsedMs: () => calls.reduce((sum, ms) => sum + ms, 0) };
}

/** Returns the TPS values in order, then the last one forever. */
function tpsSequence(values: (number | undefined)[]): () => number | undefined {
  let index = 0;
  return () => {
    const value = values[Math.min(index, values.length - 1)];
    index += 1;
    return value;
  };
}

describe('gapTicksFor (BLD-15 health throttle)', () => {
  it('keeps the base gap at 20 TPS', () => {
    expect(gapTicksFor(20)).toBe(BASE_GAP_TICKS);
    expect(BASE_GAP_TICKS).toBe(4);
  });

  it('keeps the base gap at exactly 18 TPS (the boundary is inclusive)', () => {
    expect(gapTicksFor(18)).toBe(BASE_GAP_TICKS);
  });

  it('doubles the gap at 15 TPS', () => {
    expect(gapTicksFor(15)).toBe(SLOW_GAP_TICKS);
    expect(SLOW_GAP_TICKS).toBe(BASE_GAP_TICKS * 2);
  });

  it('doubles the gap at exactly 12 TPS', () => {
    expect(gapTicksFor(12)).toBe(SLOW_GAP_TICKS);
  });

  it('pauses at 8 TPS', () => {
    expect(gapTicksFor(8)).toBeNull();
  });

  it('pauses just below 12 TPS', () => {
    expect(gapTicksFor(11.99)).toBeNull();
  });

  it('treats an unknown TPS as full speed, since no load is reported', () => {
    expect(gapTicksFor(undefined)).toBe(BASE_GAP_TICKS);
  });
});

describe('throttleWait', () => {
  it('waits the base gap at 20 TPS, scaled to milliseconds', async () => {
    const clock = fakeSleep();
    const result = await throttleWait({
      signal: new AbortController().signal,
      readTps: () => 20,
      sleep: clock.sleep,
    });
    expect(result).toEqual({ gapTicks: 4, paused: false });
    expect(clock.calls).toEqual([4 * TICK_MS]);
  });

  it('waits the doubled gap at 15 TPS', async () => {
    const clock = fakeSleep();
    const result = await throttleWait({
      signal: new AbortController().signal,
      readTps: () => 15,
      sleep: clock.sleep,
    });
    expect(result).toEqual({ gapTicks: 8, paused: false });
    expect(clock.calls).toEqual([8 * TICK_MS]);
  });

  it('respects the body timeScale', async () => {
    const clock = fakeSleep();
    await throttleWait({
      signal: new AbortController().signal,
      timeScale: 0.5,
      readTps: () => 20,
      sleep: clock.sleep,
    });
    expect(clock.calls).toEqual([4 * TICK_MS * 0.5]);
  });

  it('pauses at 8 TPS, reports waiting_tps once, and resumes when TPS recovers', async () => {
    const clock = fakeSleep();
    let pauses = 0;
    const readTps = tpsSequence([8, 8, 8, 20]);
    const result = await throttleWait({
      signal: new AbortController().signal,
      readTps,
      sleep: clock.sleep,
      onPause: () => {
        pauses += 1;
      },
    });
    expect(pauses).toBe(1);
    expect(result).toEqual({ gapTicks: 4, paused: true });
    // Three pause polls, then the base gap once TPS is back at 20.
    expect(clock.calls).toEqual([
      PAUSE_POLL_TICKS * TICK_MS,
      PAUSE_POLL_TICKS * TICK_MS,
      PAUSE_POLL_TICKS * TICK_MS,
      4 * TICK_MS,
    ]);
  });

  it('does not report a pause when TPS is healthy', async () => {
    let pauses = 0;
    await throttleWait({
      signal: new AbortController().signal,
      readTps: () => 15,
      sleep: fakeSleep().sleep,
      onPause: () => {
        pauses += 1;
      },
    });
    expect(pauses).toBe(0);
  });

  it('refuses with the abort reason when aborted while paused', async () => {
    const controller = new AbortController();
    const clock = fakeSleep();
    const sleep = async (ms: number, signal: AbortSignal) => {
      clock.calls.push(ms);
      controller.abort(new Error('plan cancelled'));
      signal.throwIfAborted();
    };
    await expect(
      throttleWait({ signal: controller.signal, readTps: () => 5, sleep }),
    ).rejects.toThrow('plan cancelled');
    expect(clock.calls).toEqual([PAUSE_POLL_TICKS * TICK_MS]);
  });

  it('refuses at once when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('stopped'));
    const clock = fakeSleep();
    await expect(
      throttleWait({ signal: controller.signal, readTps: () => 20, sleep: clock.sleep }),
    ).rejects.toThrow('stopped');
    expect(clock.calls).toEqual([]);
  });

  it('stops a real pause when the signal aborts during the wait', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new Error('cancelled')), 5);
    await expect(
      throttleWait({ signal: controller.signal, timeScale: 1, readTps: () => 5 }),
    ).rejects.toThrow('cancelled');
  });

  it('propagates an error from the TPS source instead of swallowing it', async () => {
    const readTps = () => {
      throw new Error('tps source failed');
    };
    await expect(
      throttleWait({
        signal: new AbortController().signal,
        readTps,
        sleep: fakeSleep().sleep,
      }),
    ).rejects.toThrow('tps source failed');
  });

  it('caps nothing: 100,000 cells all pass the throttle with a fake clock', async () => {
    const clock = fakeSleep();
    const signal = new AbortController().signal;
    let completed = 0;
    for (let cell = 0; cell < 100_000; cell += 1) {
      await throttleWait({ signal, readTps: () => 20, sleep: clock.sleep });
      completed += 1;
    }
    expect(completed).toBe(100_000);
    expect(clock.calls).toHaveLength(100_000);
    expect(clock.elapsedMs()).toBe(100_000 * BASE_GAP_TICKS * TICK_MS);
  });
});
