import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SeenKv } from '../building/seen/store.ts';
import { PlanPersistence } from '../building/wire-plan-store.ts';
import { boot, buckets } from './restart.fakes.ts';

/** A SeenKv in memory that counts the writes made to it. */
function countingSeenKv(): SeenKv & { puts: number; data: Map<string, string> } {
  const data = new Map<string, string>();
  const kv = {
    data,
    puts: 0,
    put: async (key: string, value: string) => {
      kv.puts++;
      data.set(key, value);
      return 1;
    },
    get: async (key: string) => data.get(key) ?? null,
    delete: async (key: string) => {
      data.delete(key);
    },
    list: async (prefix: string) => [...data.keys()].filter((key) => key.startsWith(prefix)),
  };
  return kv;
}

describe('restartBody stop(): the seen wiring', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('awaits the plan writer flush before stop() resolves', async () => {
    let flushed = false;
    const flush = vi.spyOn(PlanPersistence.prototype, 'flush').mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      flushed = true;
    });
    // The plan store is kept only when the plans bucket exists; an empty fake bucket is enough here.
    const kv = { ...buckets(), plans: buckets().checkpoints, seen: countingSeenKv() };
    const restarted = await boot(kv, { restart: { building: true } });
    await restarted.stop();
    expect(flush).toHaveBeenCalled();
    expect(flushed).toBe(true);
  });

  it('flushes the queued seen cells once and stops the flush timer', async () => {
    vi.useFakeTimers();
    const seen = countingSeenKv();
    const kv = { ...buckets(), seen };
    const restarted = await boot(kv, { restart: { building: true } });
    restarted.body.seen?.map.record(1, 64, 1, 'stone', 5);
    await restarted.stop();
    // The queued cell is written by stop itself.
    expect(seen.puts).toBeGreaterThan(0);
    const afterStop = seen.puts;
    // A cell queued after stop is not written by a timer left behind.
    restarted.body.seen?.map.record(2, 64, 2, 'dirt', 6);
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(seen.puts).toBe(afterStop);
  });
});
