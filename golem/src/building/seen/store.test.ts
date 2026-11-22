import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sectionOf } from './section.ts';
import {
  eraseLife,
  FLUSH_INTERVAL_MS,
  loadSection,
  type Predecessor,
  SECTION_BYTE_LIMIT,
  type SeenKv,
  SeenStore,
  sectionKey,
} from './store.ts';

class FakeKv implements SeenKv {
  readonly values = new Map<string, string>();
  /** How many of the next puts are refused. */
  failPuts = 0;

  async put(key: string, value: string): Promise<number> {
    if (this.failPuts > 0) {
      this.failPuts--;
      throw new Error('put refused');
    }
    this.values.set(key, value);
    return 1;
  }

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }

  async list(prefix: string): Promise<string[]> {
    return [...this.values.keys()].filter((key) => key.startsWith(prefix));
  }
}

/** The stored key of the section that holds block (x, y, z) of a life. */
function K(lifeId: string, x: number, y: number, z: number): string {
  return sectionKey(lifeId, sectionOf(x, y, z));
}

function predecessorOf(pred: Predecessor | null) {
  return async () => pred;
}

function storeFor(
  kv: SeenKv,
  lifeId: string,
  extra: Partial<ConstructorParameters<typeof SeenStore>[0]> = {},
) {
  return new SeenStore({ kv, lifeId, agentId: 'agent-a', ...extra });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('flush', () => {
  it('after 30 s writes only the dirty sections, and a clean flush writes nothing', async () => {
    vi.useFakeTimers();
    const kv = new FakeKv();
    const put = vi.spyOn(kv, 'put');
    const store = storeFor(kv, 'L1');
    await store.record(0, 0, 0, 'stone', 1);
    await store.record(16, 0, 0, 'dirt', 1);
    expect((await store.flush()).written).toBe(2);
    expect(put).toHaveBeenCalledTimes(2);
    put.mockClear();

    await store.record(1, 0, 0, 'grass_block', 40);
    store.start();
    try {
      await vi.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS);
    } finally {
      store.stop();
    }
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0]?.[0]).toBe(K('L1', 0, 0, 0));
    expect(await store.flush()).toEqual({ written: 0, failed: 0 });
  });

  it('coalesces a flush asked for while one is running into the same run', async () => {
    const kv = new FakeKv();
    const store = storeFor(kv, 'L1');
    await store.record(0, 0, 0, 'stone', 1);
    const first = store.flush();
    expect(store.flush()).toBe(first);
    expect((await first).written).toBe(1);
    expect(store.flushes).toBe(1);
  });

  it('a refused write keeps the section dirty and the next flush retries it', async () => {
    const kv = new FakeKv();
    const store = storeFor(kv, 'L1');
    await store.record(0, 0, 0, 'stone', 1);
    kv.failPuts = 1;
    expect(await store.flush()).toEqual({ written: 0, failed: 1 });
    expect(kv.values.has(K('L1', 0, 0, 0))).toBe(false);
    expect(await store.flush()).toEqual({ written: 1, failed: 0 });
    expect(kv.values.has(K('L1', 0, 0, 0))).toBe(true);
  });

  it('refuses a section over the byte limit: it is never written, counted failed, and stays dirty', async () => {
    const kv = new FakeKv();
    const store = storeFor(kv, 'L1');
    for (let i = 0; i < 4096; i++) {
      await store.record(
        i % 16,
        Math.floor(i / 16) % 16,
        Math.floor(i / 256),
        randomBytes(100).toString('hex'),
        1,
      );
    }
    expect(await store.flush()).toEqual({ written: 0, failed: 1 });
    expect(kv.values.size).toBe(0);
    expect(SECTION_BYTE_LIMIT).toBe(65536);
    expect(await store.flush()).toEqual({ written: 0, failed: 1 });
  });
});

describe('death and inheritance', () => {
  it('a death erases nothing: the sections stay in KV and read under the life that saw them', async () => {
    const kv = new FakeKv();
    const life1 = storeFor(kv, 'L1');
    await life1.record(5, 64, 5, 'oak_planks', 100);
    await life1.flush();
    storeFor(kv, 'L2', { predecessor: predecessorOf({ lifeId: 'L1', agentId: 'agent-a' }) });
    expect(kv.values.has(K('L1', 5, 64, 5))).toBe(true);
    const reread = storeFor(kv, 'L1');
    expect(await reread.read(5, 64, 5)).toEqual({
      name: 'oak_planks',
      lastSeen: 100,
      inherited: false,
    });
  });

  it('the successor reads inherited cells with their last-seen tick and the inherited mark', async () => {
    const kv = new FakeKv();
    const life1 = storeFor(kv, 'L1');
    await life1.record(5, 64, 5, 'oak_planks', 100);
    await life1.flush();
    const life2 = storeFor(kv, 'L2', {
      predecessor: predecessorOf({ lifeId: 'L1', agentId: 'agent-a' }),
    });
    expect(await life2.inherit()).toBe(1);
    expect(await life2.read(5, 64, 5)).toEqual({
      name: 'oak_planks',
      lastSeen: 100,
      inherited: true,
    });
    await life2.record(6, 64, 5, 'cobblestone', 200);
    expect(await life2.read(6, 64, 5)).toEqual({
      name: 'cobblestone',
      lastSeen: 200,
      inherited: false,
    });
    await life2.flush();
    expect(kv.values.has(K('L2', 5, 64, 5))).toBe(true);
  });

  it('an inherited map never holds a cell the predecessor did not see', async () => {
    const kv = new FakeKv();
    const life1 = storeFor(kv, 'L1');
    await life1.record(5, 64, 5, 'oak_planks', 100);
    await life1.flush();
    const life2 = storeFor(kv, 'L2', {
      predecessor: predecessorOf({ lifeId: 'L1', agentId: 'agent-a' }),
    });
    await life2.inherit();
    expect(await life2.read(6, 64, 5)).toBeUndefined();
    expect(await life2.read(5, 65, 5)).toBeUndefined();
  });

  it('a different agent life is never read', async () => {
    const kv = new FakeKv();
    const life1 = storeFor(kv, 'L1');
    await life1.record(5, 64, 5, 'oak_planks', 100);
    await life1.flush();
    const life2 = storeFor(kv, 'L2', {
      predecessor: predecessorOf({ lifeId: 'L1', agentId: 'agent-b' }),
    });
    expect(await life2.inherit()).toBe(0);
    expect(await life2.read(5, 64, 5)).toBeUndefined();
    expect([...kv.values.keys()].some((key) => key.startsWith('L2.'))).toBe(false);
  });

  it('a first life, and a life that is its own predecessor, inherit nothing', async () => {
    const kv = new FakeKv();
    const life1 = storeFor(kv, 'L1');
    await life1.record(5, 64, 5, 'oak_planks', 100);
    await life1.flush();
    expect(await storeFor(kv, 'L2').inherit()).toBe(0);
    expect(
      await storeFor(kv, 'L1', {
        predecessor: predecessorOf({ lifeId: 'L1', agentId: 'agent-a' }),
      }).inherit(),
    ).toBe(0);
  });

  it('a failed predecessor lookup rejects and writes nothing', async () => {
    const kv = new FakeKv();
    const store = storeFor(kv, 'L2', {
      predecessor: async () => {
        throw new Error('registry down');
      },
    });
    await expect(store.inherit()).rejects.toThrow('registry down');
    expect(kv.values.size).toBe(0);
  });

  it('erasure deletes every section of the life and leaves the others', async () => {
    const kv = new FakeKv();
    const life1 = storeFor(kv, 'L1');
    await life1.record(5, 64, 5, 'oak_planks', 100);
    await life1.record(20, 0, 0, 'dirt', 100);
    await life1.flush();
    const life2 = storeFor(kv, 'L2');
    await life2.record(0, 0, 0, 'stone', 1);
    await life2.flush();
    expect(await eraseLife(kv, 'L1')).toBe(2);
    expect([...kv.values.keys()].some((key) => key.startsWith('L1.'))).toBe(false);
    expect(kv.values.has(K('L2', 0, 0, 0))).toBe(true);
  });

  it('an erasure that fails a delete throws and leaves the rest for a retry', async () => {
    const kv = new FakeKv();
    const life1 = storeFor(kv, 'L1');
    await life1.record(5, 64, 5, 'oak_planks', 100);
    await life1.record(20, 0, 0, 'dirt', 100);
    await life1.flush();
    const realDelete = kv.delete.bind(kv);
    let calls = 0;
    kv.delete = async (key: string) => {
      calls++;
      if (calls === 1) throw new Error('delete refused');
      await realDelete(key);
    };
    await expect(eraseLife(kv, 'L1')).rejects.toThrow('1 section(s) not deleted');
    expect(kv.values.size).toBe(1);
  });
});

describe('corrupt sections and memory', () => {
  it('a corrupt stored section is dropped, not fatal, and is re-seen later', async () => {
    const kv = new FakeKv();
    kv.values.set(K('L1', 0, 0, 0), 'not a section');
    const store = storeFor(kv, 'L1');
    expect(await store.read(0, 0, 0)).toBeUndefined();
    expect(store.dropped).toBe(1);
    await store.record(0, 0, 0, 'stone', 5);
    await store.flush();
    expect(await storeFor(kv, 'L1').read(0, 0, 0)).toEqual({
      name: 'stone',
      lastSeen: 5,
      inherited: false,
    });
  });

  it('a corrupt predecessor section is skipped while the good ones are inherited', async () => {
    const kv = new FakeKv();
    const life1 = storeFor(kv, 'L1');
    await life1.record(5, 64, 5, 'oak_planks', 100);
    await life1.flush();
    kv.values.set(K('L1', 144, 144, 144), 'bad');
    const life2 = storeFor(kv, 'L2', {
      predecessor: predecessorOf({ lifeId: 'L1', agentId: 'agent-a' }),
    });
    expect(await life2.inherit()).toBe(1);
    expect(life2.dropped).toBe(1);
  });

  it('loadSection reads a stored section by cell, and is null when it is missing or corrupt', async () => {
    const kv = new FakeKv();
    const store = storeFor(kv, 'L1');
    await store.record(5, 64, 5, 'oak_planks', 100);
    await store.flush();
    const ref = sectionOf(5, 64, 5);
    const cells = await loadSection(kv, 'L1', ref);
    expect(cells?.get(ref.local)).toEqual({ name: 'oak_planks', lastSeen: 100, inherited: false });
    expect(cells?.size).toBe(1);
    expect(await loadSection(kv, 'L2', ref)).toBeNull();
    kv.values.set(K('L1', 5, 64, 5), 'bad');
    expect(await loadSection(kv, 'L1', ref)).toBeNull();
  });

  it('evicts clean sections beyond the limit and reads them back from KV', async () => {
    const kv = new FakeKv();
    const store = storeFor(kv, 'L1', { memoryLimit: 1 });
    await store.record(0, 0, 0, 'stone', 10);
    await store.record(16, 0, 0, 'dirt', 20);
    await store.flush();
    expect(await store.read(0, 0, 0)).toEqual({ name: 'stone', lastSeen: 10, inherited: false });
    expect(await store.read(16, 0, 0)).toEqual({ name: 'dirt', lastSeen: 20, inherited: false });
  });

  it('a section evicted from memory keeps its stored cells when it is recorded again', async () => {
    const kv = new FakeKv();
    const store = storeFor(kv, 'L1', { memoryLimit: 1 });
    await store.record(0, 0, 0, 'stone', 10);
    await store.record(16, 0, 0, 'dirt', 20);
    await store.flush();
    await store.record(1, 0, 0, 'grass_block', 30);
    await store.flush();
    expect(await storeFor(kv, 'L1').read(0, 0, 0)).toEqual({
      name: 'stone',
      lastSeen: 10,
      inherited: false,
    });
    expect(await storeFor(kv, 'L1').read(1, 0, 0)).toEqual({
      name: 'grass_block',
      lastSeen: 30,
      inherited: false,
    });
  });
});
