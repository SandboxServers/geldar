import { PRESENCE_BUCKET, validatePresenceRecord } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import {
  type BucketManager,
  KvPresenceStore,
  openPresenceBucket,
  type PresenceBucket,
  presenceAt,
} from './presence.ts';

const LIFE = 'ag_jason_01';
const T0 = Date.parse('2026-11-09T12:00:00.000Z');

/**
 * An in-memory KV bucket that keeps the stored text and a revision per key, as NATS KV does.
 * `afterGet` is a race hook: it runs once, after the next get has read its value, before the get
 * returns. `conflicts` makes that many updates (or all, when infinite) lose their compare-and-set.
 */
class FakeBucket implements PresenceBucket {
  readonly values = new Map<string, string>();
  readonly revisions = new Map<string, number>();
  puts = 0;
  updates = 0;
  gets = 0;
  conflicts = 0;
  afterGet: (() => Promise<void>) | null = null;
  private lastRevision = 0;

  async get(key: string): Promise<{ string(): string; revision: number } | null> {
    this.gets++;
    const value = this.values.get(key);
    const revision = this.revisions.get(key) ?? 0;
    const hook = this.afterGet;
    this.afterGet = null;
    if (hook !== null) await hook();
    return value === undefined ? null : { string: () => value, revision };
  }

  async put(key: string, value: string): Promise<number> {
    this.puts++;
    return this.store(key, value);
  }

  async keys(): Promise<AsyncIterable<string>> {
    const snapshot = [...this.values.keys()];
    return (async function* () {
      yield* snapshot;
    })();
  }

  async update(key: string, value: string, revision: number): Promise<number> {
    this.updates++;
    if (this.conflicts > 0) {
      this.conflicts--;
      throw new Error(`conflict on ${key}`);
    }
    if ((this.revisions.get(key) ?? 0) !== revision) throw new Error(`conflict on ${key}`);
    this.puts++;
    return this.store(key, value);
  }

  private store(key: string, value: string): number {
    this.values.set(key, value);
    this.lastRevision++;
    this.revisions.set(key, this.lastRevision);
    return this.lastRevision;
  }
}

/**
 * What a bound name with no stream behind it does: `Kvm.open` only binds, so the first read fails
 * with `stream not found`, as NATS reports a missing `KV_<bucket>` stream.
 */
class UnbackedBucket implements PresenceBucket {
  async get(): Promise<never> {
    throw new Error('stream not found');
  }
  async put(): Promise<never> {
    throw new Error('stream not found');
  }
  async keys(): Promise<never> {
    throw new Error('stream not found');
  }
  async update(): Promise<never> {
    throw new Error('stream not found');
  }
}

/**
 * A bucket manager that behaves as the NATS `Kvm` does: `open` only binds a name, and `create`
 * makes a missing bucket or reuses an existing one. `calls` logs each call.
 */
class FakeManager implements BucketManager {
  readonly calls: string[] = [];
  readonly buckets = new Map<string, FakeBucket>();

  open(name: string): Promise<PresenceBucket> {
    this.calls.push(`open:${name}`);
    return Promise.resolve(this.buckets.get(name) ?? new UnbackedBucket());
  }

  async create(name: string): Promise<PresenceBucket> {
    this.calls.push(`create:${name}`);
    const existing = this.buckets.get(name);
    if (existing !== undefined) return existing;
    const bucket = new FakeBucket();
    this.buckets.set(name, bucket);
    return bucket;
  }
}

function storeAt(bucket: PresenceBucket, nowRef: { ms: number }): KvPresenceStore {
  return new KvPresenceStore(bucket, () => nowRef.ms);
}

function stored(bucket: FakeBucket): unknown {
  return JSON.parse(bucket.values.get(LIFE) ?? 'null');
}

describe('openPresenceBucket', () => {
  it('creates the presence bucket before anything uses it, when it is missing', async () => {
    const manager = new FakeManager();
    const bucket = await openPresenceBucket(manager);
    expect(manager.calls).toEqual([`create:${PRESENCE_BUCKET}`]);
    expect(manager.buckets.get(PRESENCE_BUCKET)).toBe(bucket);
  });

  it('uses the bucket that exists and creates no second one', async () => {
    const manager = new FakeManager();
    const first = await openPresenceBucket(manager);
    const second = await openPresenceBucket(manager);
    expect(second).toBe(first);
    expect(manager.buckets.size).toBe(1);
  });

  it('lets a touch and a settle run on the bucket it returns, with no stream error', async () => {
    const manager = new FakeManager();
    const bucket = await openPresenceBucket(manager);
    const now = { ms: T0 };
    await storeAt(bucket, now).touch(LIFE);
    now.ms = T0 + 700_000;
    await expect(storeAt(bucket, now).settle(LIFE)).resolves.toMatchObject({
      state: 'hibernating',
    });
  });
});

describe('KvPresenceStore', () => {
  it('touch writes an awake record with the Body up, as the contract shape', async () => {
    const bucket = new FakeBucket();
    const now = { ms: T0 };
    await storeAt(bucket, now).touch(LIFE);
    expect(stored(bucket)).toEqual({
      life_id: LIFE,
      state: 'awake',
      desired_body: 'up',
      at: '2026-11-09T12:00:00.000Z',
    });
    expect(validatePresenceRecord(stored(bucket)).ok).toBe(true);
  });

  it('skips the write of a touch while the awake record is under 5 s old, and writes at 5 s', async () => {
    const bucket = new FakeBucket();
    const now = { ms: T0 };
    const store = storeAt(bucket, now);
    await store.touch(LIFE);
    now.ms = T0 + 4_999;
    await store.touch(LIFE);
    expect(bucket.puts).toBe(1);
    now.ms = T0 + 5_000;
    await store.touch(LIFE);
    expect(bucket.puts).toBe(2);
    expect((stored(bucket) as { at: string }).at).toBe('2026-11-09T12:00:05.000Z');
  });

  it('a touch still writes when the life is hibernating, however recent its record', async () => {
    const bucket = new FakeBucket();
    const now = { ms: T0 };
    const store = storeAt(bucket, now);
    await store.touch(LIFE);
    now.ms = T0 + 700_000;
    await store.settle(LIFE);
    const puts = bucket.puts;
    await store.touch(LIFE);
    expect(bucket.puts).toBe(puts + 1);
    expect(stored(bucket)).toMatchObject({ state: 'awake', desired_body: 'up' });
  });

  it('wantBody writes an awake record stamped with the given time', async () => {
    const bucket = new FakeBucket();
    await new KvPresenceStore(bucket, () => 0).wantBody(LIFE, T0 + 5_000);
    expect(stored(bucket)).toMatchObject({ state: 'awake', desired_body: 'up' });
    expect((stored(bucket) as { at: string }).at).toBe('2026-11-09T12:00:05.000Z');
  });

  it('keeps the life awake for 60 s, dims it after, and hibernates it after 10 minutes', async () => {
    const bucket = new FakeBucket();
    const now = { ms: T0 };
    const store = storeAt(bucket, now);
    await store.touch(LIFE);

    now.ms = T0 + 59_999;
    expect(await store.settle(LIFE)).toMatchObject({ state: 'awake', desired_body: 'up' });

    now.ms = T0 + 60_000;
    expect(await store.settle(LIFE)).toMatchObject({ state: 'dim', desired_body: 'up' });

    now.ms = T0 + 600_000;
    expect(await store.settle(LIFE)).toMatchObject({ state: 'hibernating', desired_body: 'down' });
    expect(validatePresenceRecord(stored(bucket)).ok).toBe(true);
  });

  it('keeps the last touch time when it settles, so the record keeps aging', async () => {
    const bucket = new FakeBucket();
    const now = { ms: T0 };
    const store = storeAt(bucket, now);
    await store.touch(LIFE);
    now.ms = T0 + 700_000;
    await store.settle(LIFE);
    expect((stored(bucket) as { at: string }).at).toBe('2026-11-09T12:00:00.000Z');
    expect(stored(bucket)).toMatchObject({ state: 'hibernating', desired_body: 'down' });
  });

  it('writes only when the state changes, so a settle in the same state costs no put', async () => {
    const bucket = new FakeBucket();
    const now = { ms: T0 };
    const store = storeAt(bucket, now);
    await store.touch(LIFE);
    const puts = bucket.puts;
    now.ms = T0 + 10_000;
    await store.settle(LIFE);
    expect(bucket.puts).toBe(puts);
  });

  it('a touch wakes a hibernating life back to awake with the Body up', async () => {
    const bucket = new FakeBucket();
    const now = { ms: T0 };
    const store = storeAt(bucket, now);
    await store.touch(LIFE);
    now.ms = T0 + 700_000;
    await store.settle(LIFE);
    now.ms = T0 + 800_000;
    await store.touch(LIFE);
    expect(stored(bucket)).toMatchObject({ state: 'awake', desired_body: 'up' });
  });

  it('a touch that lands between settle reading and writing is not overwritten with down', async () => {
    const bucket = new FakeBucket();
    const now = { ms: T0 };
    const store = storeAt(bucket, now);
    await store.touch(LIFE);
    now.ms = T0 + 700_000;
    bucket.afterGet = () => store.touch(LIFE);
    await store.settle(LIFE);
    expect(stored(bucket)).toMatchObject({ state: 'awake', desired_body: 'up' });
  });

  it('after a lost compare-and-set, settle reads and decides again', async () => {
    const bucket = new FakeBucket();
    const now = { ms: T0 };
    const store = storeAt(bucket, now);
    await store.touch(LIFE);
    now.ms = T0 + 700_000;
    bucket.conflicts = 2;
    expect(await store.settle(LIFE)).toMatchObject({ state: 'hibernating', desired_body: 'down' });
    expect(bucket.updates).toBe(3);
    expect(bucket.gets).toBe(4);
  });

  it('gives up after three lost compare-and-set writes', async () => {
    const bucket = new FakeBucket();
    const now = { ms: T0 };
    const store = storeAt(bucket, now);
    await store.touch(LIFE);
    now.ms = T0 + 700_000;
    bucket.conflicts = Number.POSITIVE_INFINITY;
    await expect(store.settle(LIFE)).rejects.toThrow('conflict');
    expect(bucket.updates).toBe(3);
  });

  it('lists the lives the bucket holds, for a restarted world to seed from', async () => {
    const bucket = new FakeBucket();
    await storeAt(bucket, { ms: T0 }).touch(LIFE);
    await storeAt(bucket, { ms: T0 }).touch('ag_other_01');
    expect((await storeAt(bucket, { ms: T0 }).lifeIds()).sort()).toEqual([LIFE, 'ag_other_01']);
  });

  it('settle writes nothing and returns null for a life with no record', async () => {
    const bucket = new FakeBucket();
    expect(await storeAt(bucket, { ms: T0 }).settle(LIFE)).toBeNull();
    expect(bucket.puts).toBe(0);
  });

  it('reads null for a missing key and for a stored value that is not a presence record', async () => {
    const bucket = new FakeBucket();
    const store = storeAt(bucket, { ms: T0 });
    expect(await store.read(LIFE)).toBeNull();
    bucket.values.set(LIFE, '{"life_id":"ag_jason_01","state":"asleep"}');
    expect(await store.read(LIFE)).toBeNull();
    bucket.values.set(LIFE, '{not json');
    expect(await store.read(LIFE)).toBeNull();
  });
});

describe('presenceAt', () => {
  it('derives the state from the age of the last touch, never below zero', () => {
    expect(presenceAt(T0, T0 - 1_000)).toEqual({ state: 'awake', desired_body: 'up' });
    expect(presenceAt(T0, T0 + 600_000 - 1)).toEqual({ state: 'dim', desired_body: 'up' });
    expect(presenceAt(T0, T0 + 600_000)).toEqual({ state: 'hibernating', desired_body: 'down' });
  });
});
