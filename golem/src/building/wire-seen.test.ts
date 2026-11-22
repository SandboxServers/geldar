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

/** An in-memory KV that also lists keys by prefix, as the inheritance read needs. */
function listingKv(): SeenKv {
  const values = new Map<string, string>();
  return {
    put: async (key: string, value: string) => {
      values.set(key, value);
    },
    get: async (key: string) => values.get(key) ?? null,
    list: async (prefix: string) => [...values.keys()].filter((key) => key.startsWith(prefix)),
  } as unknown as SeenKv;
}

describe('createSeenWiring inheritance (decision 0424, 2026-11-22 addendum)', () => {
  it('a predecessor cell reads inherited with its last-seen tick; a fresh sighting clears the mark', async () => {
    const kv = listingKv();
    const base = {
      bot: {} as Bot,
      ticks: () => () => undefined,
      kv,
      agentId: 'ag_test_01',
      flushIntervalMs: 60_000,
    };
    const pred = createSeenWiring({ ...base, lifeId: 'ag_pred_01' });
    pred.map.record(0, 64, 0, 'stone', 5);
    await pred.flush();
    pred.stop();
    const succ = createSeenWiring({
      ...base,
      lifeId: 'ag_succ_01',
      predecessor: { lifeId: 'ag_pred_01', agentId: 'ag_test_01' },
    });
    await succ.ready;
    expect(succ.map.read(0, 64, 0)).toEqual({ name: 'stone', lastSeen: 5, inherited: true });
    succ.map.record(0, 64, 0, 'stone', 9);
    expect(succ.map.read(0, 64, 0)).toEqual({ name: 'stone', lastSeen: 9, inherited: false });
    succ.stop();
  });
});

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
