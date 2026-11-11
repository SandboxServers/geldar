import { createHash, createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loginHash } from '../../src/kino/audit.ts';
import { controlledFeed } from '../../src/kino/control.ts';
import { type KinoConn, KinoRelay, RECHECK_ERROR_LIMIT } from '../../src/kino/relay.ts';
import { ANONYMOUS, sqlScopeStore } from '../../src/kino/scope.ts';
import { loadKinoEnv, requireAllowedOrigins } from '../../src/kino/wiring.ts';

const HELLO = JSON.stringify({ type: 'hello', target_agent_id: 'a1', radius: 4 });
const MOVED = JSON.stringify({ type: 'target_moved', target_agent_id: 'a1', x: 1, y: 2, z: 3 });

describe('hello and target_moved for a pane that joins a watched agent', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function rig() {
    const taps: Array<(j: string) => void> = [];
    const f = controlledFeed(
      {
        subscribe: (_a, on) => {
          taps.push(on);
          return () => {};
        },
      },
      { sink: { publish: () => {} }, enabled: () => true, graceMs: 1000, refreshMs: 5000 },
    );
    return { f, taps };
  }

  it('replays the cached hello and the last target_moved to the second pane', () => {
    const { f, taps } = rig();
    const first: string[] = [];
    f.subscribe('a1', (j) => first.push(j));
    taps[0]?.(HELLO);
    taps[0]?.(MOVED);
    const newer = JSON.stringify({ type: 'target_moved', target_agent_id: 'a1', x: 9, y: 9, z: 9 });
    taps[0]?.(newer);
    const second: string[] = [];
    f.subscribe('a1', (j) => second.push(j));
    expect(first).toEqual([HELLO, MOVED, newer]);
    expect(second).toEqual([HELLO, newer]);
  });

  it('sends nothing to the first pane, and the cache is gone after stop', () => {
    const { f, taps } = rig();
    const first: string[] = [];
    const un = f.subscribe('a1', (j) => first.push(j));
    expect(first).toEqual([]);
    taps[0]?.(HELLO);
    un();
    vi.advanceTimersByTime(1500); // grace over: stop sent, cache dropped
    const again: string[] = [];
    f.subscribe('a1', (j) => again.push(j));
    expect(again).toEqual([]);
  });

  it('does not replay across agents', () => {
    const { f, taps } = rig();
    f.subscribe('a1', () => {});
    taps[0]?.(HELLO);
    const other: string[] = [];
    f.subscribe('a2', (j) => other.push(j));
    expect(other).toEqual([]);
  });
});

describe('revalidation fails closed', () => {
  const sub = JSON.stringify({ type: 'subscribe', target_agent_id: 'mine', mode: 'follow' });
  function rig() {
    let fail = false;
    const refusals: string[] = [];
    const relay = new KinoRelay({
      store: {
        access: async () => {
          if (fail) throw new Error('db');
          return { signedIn: true, admin: false, ownerId: 'o1', banned: false };
        },
        agent: async () => ({ owner: 'o1', publicCamera: false }),
      },
      feed: { subscribe: () => () => {} },
      onRefusal: (r) => refusals.push(r),
    });
    const c = { sent: [] as string[], closed: 0 } as { sent: string[]; closed: number } & KinoConn;
    c.send = (t) => void c.sent.push(t);
    c.close = () => void c.closed++;
    return { relay, c, refusals, setFail: (v: boolean) => (fail = v) };
  }

  it('ends the pane with feed_unavailable on the second consecutive error, not the first', async () => {
    expect(RECHECK_ERROR_LIMIT).toBe(2);
    const { relay, c, refusals, setFail } = rig();
    const p = relay.accept(c, 'h', 'h');
    await p?.message(sub);
    setFail(true);
    await relay.revalidateAll();
    expect(c.closed).toBe(0);
    await relay.revalidateAll();
    expect(c.closed).toBe(1);
    expect(c.sent.at(-1)).toBe(JSON.stringify({ type: 'bye', reason: 'feed_unavailable' }));
    expect(refusals).toEqual(['feed_unavailable']);
    expect(relay.openPanes).toBe(0);
  });

  it('a success between two errors resets the count', async () => {
    const { relay, c, setFail } = rig();
    await relay.accept(c, 'h', 'h')?.message(sub);
    setFail(true);
    await relay.revalidateAll();
    setFail(false);
    await relay.revalidateAll();
    setFail(true);
    await relay.revalidateAll();
    expect(c.closed).toBe(0);
    expect(relay.openPanes).toBe(1);
  });
});

describe('anonymous audit key', () => {
  it('is neither a bare hash nor a constant key, and differs per process', async () => {
    const h = loginHash(null, 'anon:192.0.2.1');
    expect(h).not.toBe(createHash('sha256').update('anon:192.0.2.1').digest('hex'));
    for (const k of ['', Buffer.alloc(32), Buffer.alloc(32, 1), 'geldar', 'kino'])
      expect(h).not.toBe(createHmac('sha256', k).update('anon:192.0.2.1').digest('hex'));
    // A fresh module instance stands for a new process: its key, so its hash, must differ.
    vi.resetModules();
    const other = await import('../../src/kino/audit.ts');
    expect(other.loginHash(null, 'anon:192.0.2.1')).not.toBe(h);
    expect(loginHash(null, 'anon:192.0.2.1')).toBe(h); // stable inside one process
  });
});

describe('kino_agent_scope input guard', () => {
  it('never queries for an empty or NULL agent id', async () => {
    const queries: unknown[][] = [];
    const store = sqlScopeStore({
      query: async (_t: string, p: unknown[]) => {
        queries.push(p);
        return { rows: [] };
      },
    } as never);
    for (const bad of ['', null, undefined, ' ', 7])
      expect(await store.agent(bad as never)).toBeNull();
    expect(queries).toEqual([]);
    expect(await store.agent('ag_x')).toBeNull();
    expect(queries).toEqual([['ag_x']]);
    expect(await store.access(null)).toBe(ANONYMOUS);
  });
});

describe('allowed origins at startup', () => {
  it('refuses to start Kino with an empty list and names the variable', () => {
    expect(() => requireAllowedOrigins([])).toThrow(/GELDAR_KINO_ALLOWED_ORIGINS/);
    expect(() => requireAllowedOrigins(undefined)).toThrow(/GELDAR_KINO_ALLOWED_ORIGINS/);
    expect(() => requireAllowedOrigins(['https://glass.example.test'])).not.toThrow();
  });

  it('reads full origins, lower-cased, from the environment', () => {
    expect(
      loadKinoEnv({ GELDAR_KINO_ALLOWED_ORIGINS: ' https://Glass.example.test , ' }).allowedOrigins,
    ).toEqual(['https://glass.example.test']);
  });
});
