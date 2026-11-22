import { describe, expect, it } from 'vitest';
import { fakePlanKv } from './plan-store.fakes.ts';
import {
  CHUNK_LIMIT_BYTES,
  chunkKey,
  deletePlan,
  PlanStoreError,
  putPlanChunk,
  readPlan,
  splitIntoChunks,
  utf8Length,
  writePlan,
} from './plan-store.ts';

const LIFE = 'life-1';
const PLAN = 'plan-1';

async function expectRejects(promise: Promise<unknown>, code: string): Promise<void> {
  const failure = await promise.then(
    () => null,
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(PlanStoreError);
  expect((failure as PlanStoreError).code).toBe(code);
}

describe('plan store (BLD-05)', () => {
  it('stores a million-cell plan in chunks, none over 64 KiB, and reads it back whole', async () => {
    const parts: string[] = [];
    for (let i = 0; i < 1_000_000; i++) {
      parts.push(`[${i % 64},${Math.floor(i / 4096) % 64},${i % 4096},"minecraft:stone"]`);
    }
    const text = `[${parts.join(',')}]`;
    const kv = fakePlanKv();
    const count = await writePlan(kv, LIFE, PLAN, text);
    expect(count).toBeGreaterThan(400);
    expect(kv.largestPut).toBeLessThanOrEqual(CHUNK_LIMIT_BYTES);
    expect(kv.data.size).toBe(count);
    const back = await readPlan(kv, LIFE, PLAN, count);
    expect(back === text).toBe(true);
  }, 60_000);

  it('names each chunk <life_id>.<plan_id>.<n>', () => {
    expect(chunkKey('L', 'P', 3)).toBe('L.P.3');
  });

  it('splits on code points: a surrogate pair is never cut, every chunk fits', () => {
    const text = '\u{1F600}'.repeat(20_000);
    const chunks = splitIntoChunks(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe(text);
    for (const chunk of chunks) {
      expect(utf8Length(chunk)).toBeLessThanOrEqual(CHUNK_LIMIT_BYTES);
      expect(/[\uD800-\uDBFF]$/.test(chunk)).toBe(false);
    }
  });

  it('refuses a chunk over 64 KiB before any write; exactly 64 KiB is accepted', async () => {
    const kv = fakePlanKv();
    await putPlanChunk(kv, LIFE, PLAN, 0, 'x'.repeat(CHUNK_LIMIT_BYTES));
    expect(kv.puts).toBe(1);
    await expectRejects(
      putPlanChunk(kv, LIFE, PLAN, 1, 'x'.repeat(CHUNK_LIMIT_BYTES + 1)),
      'too_large',
    );
    // Two bytes per character: 32769 of these is 65538 bytes, over the cap by bytes not characters.
    await expectRejects(
      putPlanChunk(kv, LIFE, PLAN, 2, 'é'.repeat(CHUNK_LIMIT_BYTES / 2 + 1)),
      'too_large',
    );
    expect(kv.puts).toBe(1);
  });

  it('a chunk lost in the middle makes the read fail with store, not a partial plan', async () => {
    const kv = fakePlanKv();
    const count = await writePlan(kv, LIFE, PLAN, 'a'.repeat(CHUNK_LIMIT_BYTES * 2 + 10));
    expect(count).toBe(3);
    kv.data.delete(chunkKey(LIFE, PLAN, 1));
    await expectRejects(readPlan(kv, LIFE, PLAN, count), 'store');
  });

  it('a read that fails on a chunk is a store failure too', async () => {
    const kv = fakePlanKv();
    const count = await writePlan(kv, LIFE, PLAN, 'a'.repeat(CHUNK_LIMIT_BYTES + 10));
    kv.failGets = 1;
    await expectRejects(readPlan(kv, LIFE, PLAN, count), 'store');
  });

  it('a write that fails is a store failure', async () => {
    const kv = fakePlanKv({ failPuts: 1 });
    await expectRejects(writePlan(kv, LIFE, PLAN, 'abc'), 'store');
  });

  it('deleting a plan leaves no key behind', async () => {
    const kv = fakePlanKv();
    const count = await writePlan(kv, LIFE, PLAN, 'a'.repeat(CHUNK_LIMIT_BYTES * 2 + 10));
    await deletePlan(kv, LIFE, PLAN, count);
    expect(kv.data.size).toBe(0);
  });

  it('a delete that fails is a store failure; the chunks it did not reach stay', async () => {
    const kv = fakePlanKv();
    const count = await writePlan(kv, LIFE, PLAN, 'a'.repeat(CHUNK_LIMIT_BYTES * 2 + 10));
    kv.failDeletes = 1;
    await expectRejects(deletePlan(kv, LIFE, PLAN, count), 'store');
    expect(kv.deletes).toBe(count);
    expect(kv.data.size).toBe(1);
  });
});
