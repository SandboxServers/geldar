import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type OwnerTransport, startBlockOwners } from './block-owners.ts';

const WORLD = 'world';
const enc = new TextEncoder();
const dec = new TextDecoder();

interface Query {
  world: string;
  chunk_x: number;
  chunk_z: number;
}
interface Time {
  now: number;
}

const reply = (cx: number, cz: number, blocks: unknown[] = [], truncated = false) => ({
  world: WORLD,
  chunk_x: cx,
  chunk_z: cz,
  blocks,
  truncated,
});
const owned = (x: number, y: number, z: number, owner: string) => ({ x, y, z, owner });

/**
 * One Body's ownership client over a fake NATS. `answer` gets each query and the clock, so a test
 * can make a query take time (`time.now += 40`) or fail (throw: the request rejects).
 */
function start(answer: (query: Query, time: Time) => unknown) {
  const time: Time = { now: 0 };
  const lines: string[] = [];
  const transport: OwnerTransport = {
    request: async (_subject, data) => {
      const query = JSON.parse(dec.decode(data)) as Query;
      const value = await answer(query, time);
      return { data: enc.encode(JSON.stringify(value)) };
    },
    subscribe: () => ({ unsubscribe: () => undefined }),
  };
  const owners = startBlockOwners({
    transport,
    shard: 'phase0',
    now: () => time.now,
    log: () => undefined,
    diag: { log: (line: string) => lines.push(line), now: () => time.now },
  });
  return { owners, lines };
}

const lastLine = (lines: string[]) =>
  JSON.parse(lines[lines.length - 1] ?? 'null') as {
    event: string;
    total: Record<string, number | null>;
    interval: Record<string, number | null>;
  };

describe('ownership lookups are counted (decision 0217)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts an answered query, a cache hit and the latency, and keeps the answers', async () => {
    const { owners, lines } = start((_q, time) => {
      time.now += 40;
      return reply(0, 0, [owned(1, 64, 2, 'Ann')]);
    });
    expect(owners.ownerAt(WORLD, 1, 64, 2)).toEqual({ known: false });
    await owners.ensureChunk(WORLD, 0, 0);
    expect(owners.ownerAt(WORLD, 1, 64, 2)).toEqual({ known: true, owner: 'Ann' });
    expect(owners.ownerAt(WORLD, 2, 64, 2)).toEqual({ known: true, owner: null });
    vi.advanceTimersByTime(60_000);
    expect(lines).toHaveLength(1);
    expect(lastLine(lines).total).toMatchObject({
      lookups: 3,
      cache_hits: 2,
      queries: 1,
      answered: 1,
      truncated: 0,
      unknown: 0,
      errors: 0,
      avg_latency_ms: 40,
      max_latency_ms: 40,
    });
    owners.stop();
  });

  it('counts the parsed reply cells that carry a block name (with_block, per name in the interval)', async () => {
    const { owners, lines } = start(() => ({
      ...reply(0, 0, [
        { ...owned(1, 64, 2, 'Ann'), block: 'farmland' },
        { ...owned(3, 64, 3, 'Ann'), block: 'farmland' },
        owned(5, 64, 5, 'Ann'),
      ]),
    }));
    await owners.ensureChunk(WORLD, 0, 0);
    vi.advanceTimersByTime(60_000);
    expect(lastLine(lines).total).toMatchObject({ with_block: 2, answered: 1 });
    expect(lastLine(lines).interval).toMatchObject({ with_block: 2 });
    expect(lastLine(lines).interval.blocks).toEqual({ farmland: 2 });
    expect(lastLine(lines).interval.other).toBe(0);
    owners.stop();
  });

  it('counts a truncated reply as truncated, and its cells stay unknown', async () => {
    const { owners, lines } = start(() => reply(0, 0, [owned(1, 64, 2, 'Ann')], true));
    owners.ownerAt(WORLD, 1, 64, 2);
    await owners.ensureChunk(WORLD, 0, 0);
    expect(owners.ownerAt(WORLD, 1, 64, 2)).toEqual({ known: false });
    vi.advanceTimersByTime(60_000);
    expect(lastLine(lines).total).toMatchObject({
      truncated: 1,
      answered: 0,
      cache_hits: 0,
      lookups: 2,
    });
    owners.stop();
  });

  it('counts a request with no answer (timeout or no responder) as unknown', async () => {
    const { owners, lines } = start(() => {
      throw new Error('TIMEOUT');
    });
    owners.ownerAt(WORLD, 1, 64, 2);
    await owners.ensureChunk(WORLD, 0, 0);
    expect(owners.ownerAt(WORLD, 1, 64, 2)).toEqual({ known: false });
    vi.advanceTimersByTime(60_000);
    expect(lastLine(lines).total).toMatchObject({
      queries: 1,
      unknown: 1,
      answered: 0,
      errors: 0,
      truncated: 0,
    });
    owners.stop();
  });

  it('counts a reply that breaks the contract as an error', async () => {
    const { owners, lines } = start(() => ({ nope: true }));
    owners.ownerAt(WORLD, 1, 64, 2);
    await owners.ensureChunk(WORLD, 0, 0);
    vi.advanceTimersByTime(60_000);
    expect(lastLine(lines).total).toMatchObject({ queries: 1, errors: 1, answered: 0, unknown: 0 });
    owners.stop();
  });

  it('emits once per interval, not when idle, and the interval counts reset', async () => {
    const { owners, lines } = start(() => reply(0, 0));
    owners.ownerAt(WORLD, 1, 1, 1);
    await owners.ensureChunk(WORLD, 0, 0);
    vi.advanceTimersByTime(60_000);
    expect(lines).toHaveLength(1);
    vi.advanceTimersByTime(60_000);
    expect(lines).toHaveLength(1);
    owners.ownerAt(WORLD, 1, 1, 1);
    vi.advanceTimersByTime(60_000);
    expect(lines).toHaveLength(2);
    expect(lastLine(lines).interval).toMatchObject({ lookups: 1, cache_hits: 1, queries: 0 });
    expect(lastLine(lines).total).toMatchObject({ lookups: 2, queries: 1 });
    owners.stop();
  });

  it('stop ends the lines: nothing is logged after it', async () => {
    const { owners, lines } = start(() => reply(0, 0));
    owners.ownerAt(WORLD, 1, 1, 1);
    await owners.ensureChunk(WORLD, 0, 0);
    owners.stop();
    vi.advanceTimersByTime(120_000);
    expect(lines).toEqual([]);
  });
});
