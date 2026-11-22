import type { Bot } from 'mineflayer';
import { describe, expect, it, vi } from 'vitest';
import type { GolemMetrics } from '../metrics.ts';
import type { SeenKv } from './seen/store.ts';
import { createSeenWiring } from './wire-seen.ts';

/** An in-memory KV with the put and get the seen store uses. */
function memoryKv(): SeenKv {
  const values = new Map<string, string>();
  return {
    put: async (key: string, value: string) => {
      values.set(key, value);
    },
    get: async (key: string) => values.get(key) ?? null,
  } as unknown as SeenKv;
}

describe('createSeenWiring flush metrics (fix2c F4)', () => {
  it('reports the bytes of a store flush to seenFlush, once per flush', async () => {
    const seenFlush = vi.fn();
    const wiring = createSeenWiring({
      bot: {} as Bot,
      ticks: () => () => undefined,
      lifeId: 'ag_test_01',
      kv: memoryKv(),
      metrics: { seenFlush } as unknown as GolemMetrics,
      flushIntervalMs: 60_000,
    });
    wiring.map.record(0, 64, 0, 'stone', 5);
    const result = await wiring.flush();
    wiring.stop();
    expect(result).not.toBeNull();
    expect(result?.bytes).toBeGreaterThan(0);
    expect(seenFlush).toHaveBeenCalledTimes(1);
    expect(seenFlush).toHaveBeenCalledWith(result?.bytes);
  });

  it('reports no flush when no store is kept', async () => {
    const seenFlush = vi.fn();
    const wiring = createSeenWiring({
      bot: {} as Bot,
      ticks: () => () => undefined,
      lifeId: 'ag_test_01',
      metrics: { seenFlush } as unknown as GolemMetrics,
      flushIntervalMs: 60_000,
    });
    wiring.map.record(0, 64, 0, 'stone', 5);
    expect(await wiring.flush()).toBeNull();
    wiring.stop();
    expect(seenFlush).not.toHaveBeenCalled();
  });
});
