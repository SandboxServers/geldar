import { describe, expect, it } from 'vitest';
import { CheckpointStore, CheckpointUnreadable, parseEntry } from './checkpoint.ts';
import { fakeId, LIFE, thought } from './executor.fakes.ts';
import { fakeKv } from './restart.fakes.ts';

const intent = (
  thought({ intent: {} }) as { intent: Parameters<CheckpointStore['stepped']>[0]['intent'] }
).intent;

function store(kv = fakeKv()) {
  const lines: string[] = [];
  const made = new CheckpointStore({
    kv,
    lifeId: LIFE,
    bodyGeneration: 1,
    log: (line) => void lines.push(line),
    retryDelayMs: 1,
  });
  return { kv, lines, store: made };
}

const step = (steps: number) => ({
  intentId: fakeId('in', 1),
  intent,
  checkpoint: { steps },
  expiresTick: 1000,
});

describe('deleting a checkpoint', () => {
  it('retries a failed delete so no stale entry is left behind', async () => {
    const { kv, store: s, lines } = store();
    s.stepped(step(1));
    await s.flush();
    expect(kv.peek(LIFE)).toBeDefined();
    kv.failDeletes(2);
    s.ended(fakeId('in', 1));
    await s.flush();
    expect(kv.deletes).toBe(3);
    expect(kv.peek(LIFE)).toBeUndefined();
    expect(lines).toEqual([]);
  });

  it('gives up after its tries, saying that a stale entry stays', async () => {
    const { kv, store: s, lines } = store();
    s.stepped(step(1));
    await s.flush();
    kv.failDeletes(100);
    s.ended(fakeId('in', 1));
    await s.flush();
    expect(kv.deletes).toBe(4);
    expect(kv.peek(LIFE)).toBeDefined();
    expect(lines.some((l) => l.includes('a stale entry stays'))).toBe(true);
  });

  it('stops retrying once a newer write is waiting', async () => {
    const { kv, store: s } = store();
    s.stepped(step(1));
    await s.flush();
    kv.failDeletes(100);
    s.ended(fakeId('in', 1));
    s.stepped(step(2));
    await s.flush();
    expect(parseEntry(kv.peek(LIFE) ?? '')?.checkpoint).toEqual({ steps: 2 });
  });
});

describe('writing a checkpoint', () => {
  it('skips a step whose entry equals the one already stored', async () => {
    const { kv, store: s } = store();
    s.stepped(step(1));
    s.stepped(step(1));
    await s.flush();
    s.stepped(step(1));
    await s.flush();
    expect(kv.puts).toBe(1);
    s.stepped(step(2));
    await s.flush();
    expect(kv.puts).toBe(2);
  });

  it('writes an unchanged entry again when the earlier write failed', async () => {
    const { kv, store: s } = store();
    kv.failPuts(1);
    s.stepped(step(1));
    await s.flush();
    expect(kv.peek(LIFE)).toBeUndefined();
    s.stepped(step(1));
    await s.flush();
    expect(kv.puts).toBe(2);
    expect(kv.peek(LIFE)).toBeDefined();
  });

  it('writes again after a delete, even for the same content', async () => {
    const { kv, store: s } = store();
    s.stepped(step(1));
    await s.flush();
    s.ended(fakeId('in', 1));
    await s.flush();
    s.stepped(step(1));
    await s.flush();
    expect(kv.puts).toBe(2);
    expect(kv.peek(LIFE)).toBeDefined();
  });

  it('logs the first failure of a run and then one in thirty', async () => {
    const { kv, store: s, lines } = store();
    kv.failPuts(100);
    for (let n = 1; n <= 61; n++) {
      s.stepped(step(n));
      await s.flush();
    }
    expect(lines.filter((l) => l.includes('not written'))).toHaveLength(3);
  });
});

describe('reading a checkpoint', () => {
  it('retries a failing bucket and then returns the entry', async () => {
    const { kv, store: s } = store();
    s.stepped(step(1));
    await s.flush();
    kv.failGets(2);
    expect((await s.load())?.checkpoint).toEqual({ steps: 1 });
  });

  it('throws CheckpointUnreadable when the bucket keeps failing, and returns null for no entry', async () => {
    const { kv, store: s } = store();
    expect(await s.load()).toBeNull();
    kv.failGets(100);
    await expect(s.load()).rejects.toBeInstanceOf(CheckpointUnreadable);
  });
});
