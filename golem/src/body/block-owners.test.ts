import { describe, expect, it } from 'vitest';
import {
  bukkitWorldOf,
  OWNER_CACHE_CHUNKS,
  OWNER_PREFETCH_WAIT_MS,
  OWNER_REQUEST_TIMEOUT_MS,
  OWNER_RETRY_MS,
  OWNER_TTL_MS,
  type OwnerTransport,
  startBlockOwners,
} from './block-owners.ts';

const WORLD = 'world';
const SHARD = 'phase0';
const QUERY_SUBJECT = 'geldar.phase0.blockowner.query';
const CHANGED_SUBJECT = 'geldar.phase0.blockowner.changed';
const enc = new TextEncoder();
const dec = new TextDecoder();

type Callback = (err: unknown, msg: { data: Uint8Array }) => void;
interface Query {
  world: string;
  chunk_x: number;
  chunk_z: number;
}

/** A fake NATS: `answer` decides each query's reply; `emit` delivers a change event. */
function fakeNats(answer: (query: Query) => Promise<unknown> | unknown) {
  const requests: Array<{ subject: string; query: Query; timeout: number }> = [];
  const callbacks: Array<{ subject: string; fn: Callback }> = [];
  const state = { unsubscribed: 0 };
  const transport: OwnerTransport = {
    request: async (subject, data, opts) => {
      const query = JSON.parse(dec.decode(data)) as Query;
      requests.push({ subject, query, timeout: opts.timeout });
      const value = await answer(query);
      return { data: enc.encode(JSON.stringify(value)) };
    },
    subscribe: (subject, opts) => {
      callbacks.push({ subject, fn: opts.callback });
      return {
        unsubscribe: () => {
          state.unsubscribed++;
        },
      };
    },
  };
  const emit = (value: unknown, raw?: Uint8Array): void => {
    for (const { subject, fn } of callbacks) {
      if (subject === CHANGED_SUBJECT) fn(null, { data: raw ?? enc.encode(JSON.stringify(value)) });
    }
  };
  return { transport, requests, emit, state };
}

const reply = (cx: number, cz: number, blocks: unknown[] = [], truncated = false) => ({
  world: WORLD,
  chunk_x: cx,
  chunk_z: cz,
  blocks,
  truncated,
});

const owned = (x: number, y: number, z: number, owner: string) => ({ x, y, z, owner });

describe('block owner cache', () => {
  it('fills a chunk from a reply, and a cell the reply does not list has no owner', async () => {
    const nats = fakeNats((q) => reply(q.chunk_x, q.chunk_z, [owned(1, 64, 2, 'ag_other_01')]));
    const owners = startBlockOwners({ transport: nats.transport, shard: SHARD });
    expect(owners.ownerAt(WORLD, 1, 64, 2)).toEqual({ known: false });
    await owners.ensureChunk(WORLD, 0, 0);
    expect(owners.ownerAt(WORLD, 1, 64, 2)).toEqual({ known: true, owner: 'ag_other_01' });
    expect(owners.ownerAt(WORLD, 3, 64, 3)).toEqual({ known: true, owner: null });
    expect(nats.requests).toEqual([
      { subject: QUERY_SUBJECT, query: { world: WORLD, chunk_x: 0, chunk_z: 0 }, timeout: 300 },
    ]);
    expect(OWNER_REQUEST_TIMEOUT_MS).toBe(300);
  });

  it('maps negative block coordinates to the chunk below them', async () => {
    const nats = fakeNats((q) => reply(q.chunk_x, q.chunk_z, [owned(-1, 64, -17, 'ag_other_01')]));
    const owners = startBlockOwners({ transport: nats.transport, shard: SHARD });
    owners.ownerAt(WORLD, -1, 64, -17);
    await owners.ensureChunk(WORLD, -1, -2);
    expect(owners.ownerAt(WORLD, -1, 64, -17)).toEqual({ known: true, owner: 'ag_other_01' });
  });

  it('a truncated reply is unknown for every cell, listed or not', async () => {
    const nats = fakeNats((q) =>
      reply(q.chunk_x, q.chunk_z, [owned(1, 64, 2, 'ag_other_01')], true),
    );
    const owners = startBlockOwners({ transport: nats.transport, shard: SHARD });
    await owners.ensureChunk(WORLD, 0, 0);
    expect(owners.ownerAt(WORLD, 1, 64, 2)).toEqual({ known: false });
    expect(owners.ownerAt(WORLD, 9, 64, 9)).toEqual({ known: false });
  });

  it('a reply that does not match the contract, or names another chunk, is unknown', async () => {
    const nats = fakeNats((q) => {
      if (q.chunk_x === 0) return { world: WORLD, chunk_x: 0, chunk_z: 0 };
      return reply(q.chunk_x + 5, q.chunk_z, []);
    });
    const owners = startBlockOwners({ transport: nats.transport, shard: SHARD });
    await owners.ensureChunk(WORLD, 0, 0);
    await owners.ensureChunk(WORLD, 1, 0);
    expect(owners.ownerAt(WORLD, 1, 64, 2)).toEqual({ known: false });
    expect(owners.ownerAt(WORLD, 17, 64, 2)).toEqual({ known: false });
  });

  it('a failed request is unknown, and is not asked again inside the retry window', async () => {
    let clock = 1_000;
    const nats = fakeNats(() => {
      throw new Error('timeout');
    });
    const owners = startBlockOwners({ transport: nats.transport, shard: SHARD, now: () => clock });
    await owners.ensureChunk(WORLD, 0, 0);
    expect(owners.ownerAt(WORLD, 1, 64, 2)).toEqual({ known: false });
    await owners.ensureChunk(WORLD, 0, 0);
    expect(nats.requests).toHaveLength(1);
    clock += OWNER_RETRY_MS;
    await owners.ensureChunk(WORLD, 0, 0);
    expect(nats.requests).toHaveLength(2);
  });

  it('a complete chunk is asked again only after the TTL', async () => {
    let clock = 0;
    const nats = fakeNats((q) => reply(q.chunk_x, q.chunk_z, []));
    const owners = startBlockOwners({ transport: nats.transport, shard: SHARD, now: () => clock });
    await owners.ensureChunk(WORLD, 0, 0);
    clock = OWNER_TTL_MS - 1;
    await owners.ensureChunk(WORLD, 0, 0);
    expect(nats.requests).toHaveLength(1);
    clock = OWNER_TTL_MS;
    await owners.ensureChunk(WORLD, 0, 0);
    expect(nats.requests).toHaveLength(2);
  });

  it('a change event sets or clears one cell in a cached chunk, and ignores what is not cached', async () => {
    const nats = fakeNats((q) => reply(q.chunk_x, q.chunk_z, [owned(1, 64, 2, 'ag_other_01')]));
    const owners = startBlockOwners({ transport: nats.transport, shard: SHARD });
    await owners.ensureChunk(WORLD, 0, 0);
    nats.emit({ world: WORLD, x: 1, y: 64, z: 2, owner: null });
    expect(owners.ownerAt(WORLD, 1, 64, 2)).toEqual({ known: true, owner: null });
    nats.emit({ world: WORLD, x: 2, y: 64, z: 2, owner: 'ag_jason_01' });
    expect(owners.ownerAt(WORLD, 2, 64, 2)).toEqual({ known: true, owner: 'ag_jason_01' });
    nats.emit({ world: WORLD, x: 400, y: 64, z: 400, owner: 'ag_other_01' });
    nats.emit(null, enc.encode('not json'));
    nats.emit({ world: WORLD, owner: 'ag_other_01' });
    expect(owners.chunkCount()).toBe(1);
    expect(nats.requests).toHaveLength(1);
  });

  it('keeps at most OWNER_CACHE_CHUNKS chunks and drops the least recently used', async () => {
    const nats = fakeNats((q) => reply(q.chunk_x, q.chunk_z, []));
    const owners = startBlockOwners({ transport: nats.transport, shard: SHARD });
    for (let cx = 0; cx <= OWNER_CACHE_CHUNKS; cx++) await owners.ensureChunk(WORLD, cx, 0);
    expect(owners.chunkCount()).toBe(OWNER_CACHE_CHUNKS);
    expect(owners.ownerAt(WORLD, OWNER_CACHE_CHUNKS * 16, 64, 0)).toEqual({
      known: true,
      owner: null,
    });
    // Chunk 0 was the oldest: it is gone, so the read is unknown (and asks again).
    expect(owners.ownerAt(WORLD, 0, 64, 0)).toEqual({ known: false });
  });

  it('prefetch fetches the 3x3 chunks around each point and returns once they are in', async () => {
    const nats = fakeNats((q) => reply(q.chunk_x, q.chunk_z, []));
    const owners = startBlockOwners({ transport: nats.transport, shard: SHARD });
    const started = Date.now();
    await owners.prefetch(WORLD, [{ x: 8, z: 8 }], new AbortController().signal);
    expect(Date.now() - started).toBeLessThan(OWNER_PREFETCH_WAIT_MS);
    expect(nats.requests).toHaveLength(9);
    expect(owners.ownerAt(WORLD, 8, 64, 8)).toEqual({ known: true, owner: null });
  });

  it('prefetch waits a bounded time when the plugin never answers', async () => {
    const nats = fakeNats(() => new Promise(() => undefined));
    const owners = startBlockOwners({ transport: nats.transport, shard: SHARD });
    const started = Date.now();
    await owners.prefetch(WORLD, [{ x: 0, z: 0 }], new AbortController().signal);
    const waited = Date.now() - started;
    expect(waited).toBeGreaterThanOrEqual(OWNER_PREFETCH_WAIT_MS - 20);
    expect(waited).toBeLessThan(OWNER_PREFETCH_WAIT_MS + 400);
  });

  it('prefetch returns at once when the walk aborts', async () => {
    const nats = fakeNats(() => new Promise(() => undefined));
    const owners = startBlockOwners({ transport: nats.transport, shard: SHARD });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10);
    const started = Date.now();
    await owners.prefetch(WORLD, [{ x: 0, z: 0 }], controller.signal);
    expect(Date.now() - started).toBeLessThan(OWNER_PREFETCH_WAIT_MS - 100);
  });

  it('stop drops the subscription and the cache, and asks nothing more', async () => {
    const nats = fakeNats((q) => reply(q.chunk_x, q.chunk_z, [owned(1, 64, 2, 'ag_other_01')]));
    const owners = startBlockOwners({ transport: nats.transport, shard: SHARD });
    await owners.ensureChunk(WORLD, 0, 0);
    owners.stop();
    expect(nats.state.unsubscribed).toBe(1);
    expect(owners.chunkCount()).toBe(0);
    await owners.ensureChunk(WORLD, 0, 0);
    expect(nats.requests).toHaveLength(1);
  });

  it('a change that arrives while the query is in flight is applied on top of the reply', async () => {
    let release!: (value: unknown) => void;
    const nats = fakeNats(() => new Promise((resolve) => (release = resolve)));
    const owners = startBlockOwners({ transport: nats.transport, shard: SHARD });
    const fetched = owners.ensureChunk(WORLD, 0, 0);
    // The reply predates both changes: the first clears a listed cell, the second sets an unlisted one.
    nats.emit({ world: WORLD, x: 1, y: 64, z: 2, owner: null });
    nats.emit({ world: WORLD, x: 3, y: 64, z: 3, owner: 'ag_jason_01' });
    release(reply(0, 0, [owned(1, 64, 2, 'ag_other_01')]));
    await fetched;
    expect(owners.ownerAt(WORLD, 1, 64, 2)).toEqual({ known: true, owner: null });
    expect(owners.ownerAt(WORLD, 3, 64, 3)).toEqual({ known: true, owner: 'ag_jason_01' });
  });

  it('a change from a failed query is dropped, and the retry starts from its own reply', async () => {
    let clock = 0;
    let fail = true;
    let release!: (value: unknown) => void;
    const nats = fakeNats(() => {
      if (fail) throw new Error('timeout');
      return new Promise((resolve) => (release = resolve));
    });
    const owners = startBlockOwners({ transport: nats.transport, shard: SHARD, now: () => clock });
    await owners.ensureChunk(WORLD, 0, 0);
    fail = false;
    clock = OWNER_RETRY_MS;
    const retried = owners.ensureChunk(WORLD, 0, 0);
    nats.emit({ world: WORLD, x: 1, y: 64, z: 2, owner: null });
    release(reply(0, 0, [owned(1, 64, 2, 'ag_other_01')]));
    await retried;
    // The change came in during the retry, so it applies: the failed query's list did not carry over.
    expect(owners.ownerAt(WORLD, 1, 64, 2)).toEqual({ known: true, owner: null });
    expect(nats.requests).toHaveLength(2);
  });
});

describe('the Bukkit world a dimension asks about', () => {
  const bot = (dimension: string | undefined) => ({
    game: dimension === undefined ? {} : { dimension },
  });

  it('strips the namespace, and maps the three dimensions to their Bukkit worlds', () => {
    expect(bukkitWorldOf(bot('minecraft:overworld'))).toBe('world');
    expect(bukkitWorldOf(bot('overworld'))).toBe('world');
    expect(bukkitWorldOf(bot('minecraft:the_nether'))).toBe('world_nether');
    expect(bukkitWorldOf(bot('the_nether'))).toBe('world_nether');
    expect(bukkitWorldOf(bot('minecraft:the_end'))).toBe('world_the_end');
    expect(bukkitWorldOf(bot('the_end'))).toBe('world_the_end');
  });

  it('an unknown or missing dimension names no world', () => {
    expect(bukkitWorldOf(bot('minecraft:overworld_caves'))).toBeNull();
    expect(bukkitWorldOf(bot('minecraft:the_moon'))).toBeNull();
    expect(bukkitWorldOf(bot('world'))).toBeNull();
    expect(bukkitWorldOf(bot(undefined))).toBeNull();
    expect(bukkitWorldOf({})).toBeNull();
  });
});
