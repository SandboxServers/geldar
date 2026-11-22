import { describe, expect, it } from 'vitest';
import {
  CHECKPOINT_LIMIT_BYTES,
  checkpointKey,
  encodeCheckpoint,
  loadCheckpoint,
  type PlanCheckpointState,
  PlanCheckpointWriter,
  saveCheckpoint,
} from './plan-checkpoint.ts';
import { fakePlanKv } from './plan-store.fakes.ts';
import { PlanStoreError } from './plan-store.ts';

const LIFE = 'life-1';

function state(overrides: Partial<PlanCheckpointState> = {}): PlanCheckpointState {
  return {
    life_id: LIFE,
    plan_id: 'plan-1',
    chunks: 7,
    cursor: 42,
    counts: { placed: 40, done_already: 2 },
    skipped: [{ at: [1, 64, -3], code: 'changed' }],
    ...overrides,
  };
}

function writer(kv = fakePlanKv(), options: { attempts?: number; logs?: string[] } = {}) {
  const logs = options.logs ?? [];
  const store = new PlanCheckpointWriter({
    kv,
    lifeId: LIFE,
    attempts: options.attempts ?? 4,
    retryDelayMs: 0,
    log: (line) => logs.push(line),
  });
  return { kv, store, logs };
}

describe('plan checkpoint (BLD-05)', () => {
  it('keys the checkpoint <life_id>.plan in the checkpoint bucket, apart from the intent entry', () => {
    expect(checkpointKey(LIFE)).toBe('life-1.plan');
    expect(checkpointKey(LIFE)).not.toBe(LIFE);
  });

  it('round-trips a small checkpoint with no summary dropped', async () => {
    const { kv, store } = writer();
    saveCheckpoint(store, state());
    await store.flush();
    const back = await loadCheckpoint(kv, LIFE);
    expect(back).toEqual({ ...state(), skipped_dropped: 0 });
  });

  it('a checkpoint over 4 KiB is cut back: the summary keeps its order and counts the dropped', () => {
    const skipped = Array.from({ length: 5000 }, (_, i) => ({
      at: [i, 64, i] as [number, number, number],
      code: 'changed',
    }));
    const text = encodeCheckpoint(state({ skipped }));
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(CHECKPOINT_LIMIT_BYTES);
    const back = JSON.parse(text) as { skipped: { at: number[] }[]; skipped_dropped: number };
    expect(back.skipped.length).toBeGreaterThan(0);
    expect(back.skipped.length + back.skipped_dropped).toBe(5000);
    expect(back.skipped[0]?.at[0]).toBe(0);
    expect(back.skipped[back.skipped.length - 1]?.at[0]).toBe(back.skipped.length - 1);
  });

  it('a checkpoint whose fixed fields are over 4 KiB is refused with too_large', () => {
    expect(() => encodeCheckpoint(state({ life_id: 'x'.repeat(5000) }))).toThrow(PlanStoreError);
    try {
      encodeCheckpoint(state({ life_id: 'x'.repeat(5000) }));
    } catch (error) {
      expect((error as PlanStoreError).code).toBe('too_large');
    }
  });

  it('writes in the background and coalesces: three saves in a row store the newest', async () => {
    const { kv, store } = writer();
    saveCheckpoint(store, state({ cursor: 1 }));
    saveCheckpoint(store, state({ cursor: 2 }));
    saveCheckpoint(store, state({ cursor: 3 }));
    await store.flush();
    expect(kv.puts).toBe(2);
    expect((await loadCheckpoint(kv, LIFE))?.cursor).toBe(3);
  });

  it('retries a put: a write that succeeds on the last allowed try is stored', async () => {
    const { kv, store, logs } = writer(fakePlanKv({ failPuts: 3 }), { attempts: 4 });
    saveCheckpoint(store, state());
    await store.flush();
    expect(kv.puts).toBe(4);
    expect(kv.data.has(checkpointKey(LIFE))).toBe(true);
    expect(logs).toEqual([]);
  });

  it('gives up after the last allowed try: logged, and the next save writes the same state again', async () => {
    const { kv, store, logs } = writer(fakePlanKv({ failPuts: 4 }), { attempts: 4 });
    saveCheckpoint(store, state());
    await store.flush();
    expect(kv.puts).toBe(4);
    expect(kv.data.has(checkpointKey(LIFE))).toBe(false);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('not written after 4 tries');
    saveCheckpoint(store, state());
    await store.flush();
    expect(kv.puts).toBe(5);
    expect(kv.data.has(checkpointKey(LIFE))).toBe(true);
  });

  it('a state that cannot be encoded is logged and not written', async () => {
    const { kv, store, logs } = writer();
    saveCheckpoint(store, state({ life_id: 'x'.repeat(5000) }));
    await store.flush();
    expect(kv.puts).toBe(0);
    expect(logs).toHaveLength(1);
  });

  it('a stored value that does not parse loads as null', async () => {
    const kv = fakePlanKv();
    kv.data.set(checkpointKey(LIFE), '{not json');
    expect(await loadCheckpoint(kv, LIFE)).toBeNull();
    expect(await loadCheckpoint(fakePlanKv(), LIFE)).toBeNull();
  });
});
