import { Duplex } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TokenBuckets } from '../../src/kino/limits.ts';
import { startAuditPurge } from '../../src/kino/purge.ts';
import { type KinoConn, KinoRelay, type RefusalReason } from '../../src/kino/relay.ts';
import { type Access, type AgentScope, ANONYMOUS, type ScopeStore } from '../../src/kino/scope.ts';
import { handleKinoUpgrade, originAllowed } from '../../src/kino/ws.ts';

const OWNER: Access = { signedIn: true, admin: false, ownerId: 'o1', banned: false };
const sub = (a: string, mode = 'follow') =>
  JSON.stringify({ type: 'subscribe', target_agent_id: a, mode });

let access: Access;
let agent: AgentScope | null;
let failStore: boolean;
let clock: number;
let subs: string[];
let stopped: string[];
let refusals: RefusalReason[];

function relay(extra: Partial<ConstructorParameters<typeof KinoRelay>[0]> = {}): KinoRelay {
  const store: ScopeStore = {
    access: async (h) => {
      if (failStore) throw new Error('db');
      return h === null ? ANONYMOUS : access;
    },
    agent: async () => {
      if (failStore) throw new Error('db');
      return agent;
    },
  };
  return new KinoRelay({
    store,
    feed: {
      subscribe: (a) => {
        subs.push(a);
        return () => stopped.push(a);
      },
    },
    now: () => new Date(clock),
    onRefusal: (r) => refusals.push(r),
    ...extra,
  });
}

function conn() {
  const c = { sent: [] as string[], closed: 0 } as { sent: string[]; closed: number } & KinoConn;
  c.send = (t) => void c.sent.push(t);
  c.close = () => void c.closed++;
  return c;
}

beforeEach(() => {
  access = OWNER;
  agent = { owner: 'o1', publicCamera: true };
  failStore = false;
  clock = 1_000_000;
  subs = [];
  stopped = [];
  refusals = [];
});

describe('subscribe rate limit (1 per 2 s, burst 8)', () => {
  it('allows the burst, refuses the next, and refills one token per 2 s', async () => {
    const r = relay();
    const c = conn();
    const p = r.accept(c, 'h', 'h');
    for (let i = 0; i < 8; i++) await p?.message(sub('mine', i % 2 ? 'orbit' : 'follow'));
    expect(c.closed).toBe(0);
    await p?.message(sub('mine'));
    expect(c.sent.at(-1)).toBe(JSON.stringify({ type: 'bye', reason: 'feed_overloaded' }));
    expect(c.closed).toBe(1);
    expect(refusals).toContain('feed_overloaded');
    // A fresh pane of the same client shares the bucket; 2 s later one subscribe passes.
    const c2 = conn();
    const p2 = r.accept(c2, 'h', 'h');
    await p2?.message(sub('mine'));
    expect(c2.closed).toBe(1);
    clock += 2000;
    const c3 = conn();
    await r.accept(c3, 'h', 'h')?.message(sub('mine'));
    expect(c3.closed).toBe(0);
  });

  it('a four-pane page opening 4 panes at once is allowed', async () => {
    const r = relay();
    const conns = [0, 1, 2, 3].map(() => conn());
    const panes = conns.map((c) => r.accept(c, 'h', 'h'));
    await Promise.all(panes.map((p, i) => p?.message(sub(['mine', 'a', 'b', 'c'][i] ?? 'mine'))));
    expect(conns.map((c) => c.closed)).toEqual([0, 0, 0, 0]);
    expect(subs).toHaveLength(4);
    expect(refusals).toEqual([]);
  });

  it('a mode change on the same agent audits only and leaves the feed alone', async () => {
    const r = relay();
    const p = r.accept(conn(), 'h', 'h');
    await p?.message(sub('mine', 'follow'));
    await p?.message(sub('mine', 'orbit'));
    await p?.message(sub('mine', 'free'));
    expect(subs).toEqual(['mine']);
    expect(stopped).toEqual([]);
  });
});

describe('anonymous pane limits', () => {
  it('caps panes per client key at 4 and in total at the global ceiling', async () => {
    const r = relay({ anonCeiling: 6 });
    const open = (key: string) => {
      const c = conn();
      return { c, p: r.accept(c, key, null) };
    };
    for (let i = 0; i < 4; i++) expect(open('anon:192.0.2.11').p).not.toBeNull();
    const fifth = open('anon:192.0.2.11');
    expect(fifth.p).toBeNull();
    expect(fifth.c.sent[0]).toContain('pane_cap_reached');
    expect(open('anon:192.0.2.12').p).not.toBeNull();
    expect(open('anon:192.0.2.13').p).not.toBeNull();
    const over = open('anon:192.0.2.14');
    expect(over.p).toBeNull();
    expect(over.c.sent[0]).toContain('pane_cap_reached');
    // Signed-in viewers are not counted against the anonymous ceiling.
    expect(r.accept(conn(), 'h', 'h')).not.toBeNull();
  });

  it('frees ceiling slots when anonymous panes close', () => {
    const r = relay({ anonCeiling: 1 });
    const p = r.accept(conn(), 'anon:a', null);
    expect(r.accept(conn(), 'anon:b', null)).toBeNull();
    p?.closed();
    p?.closed();
    expect(r.accept(conn(), 'anon:b', null)).not.toBeNull();
  });
});

describe('open panes are re-validated', () => {
  async function live(id: string | null, expiresAt?: number) {
    const r = relay();
    const c = conn();
    const p = r.accept(c, id ?? 'anon:x', id, expiresAt === undefined ? {} : { expiresAt });
    await p?.message(sub('mine'));
    return { r, c };
  }
  const lastBye = (c: { sent: string[] }) => c.sent.at(-1) ?? '';

  it('keeps a permitted pane', async () => {
    const { r, c } = await live('h');
    await r.revalidateAll();
    expect(c.closed).toBe(0);
  });

  it('ends a pane whose identity was banned', async () => {
    const { r, c } = await live('h');
    access = { ...OWNER, banned: true };
    await r.revalidateAll();
    expect(lastBye(c)).toContain('target_not_permitted');
    expect(c.closed).toBe(1);
    expect(stopped).toEqual(['mine']);
  });

  it('ends an anonymous pane when the camera is switched off', async () => {
    const { r, c } = await live(null);
    expect(c.closed).toBe(0);
    agent = { owner: 'o1', publicCamera: false };
    await r.revalidateAll();
    expect(lastBye(c)).toContain('target_not_permitted');
    expect(c.closed).toBe(1);
  });

  it('ends a pane at the session expiry', async () => {
    const { r, c } = await live('h', clock + 1000);
    await r.revalidateAll();
    expect(c.closed).toBe(0);
    clock += 1000;
    await r.revalidateAll();
    expect(lastBye(c)).toContain('session_ended');
    expect(c.closed).toBe(1);
  });

  it('keeps the pane through a database error and ends it on the next good answer', async () => {
    const { r, c } = await live('h');
    failStore = true;
    access = { ...OWNER, banned: true };
    await r.revalidateAll();
    expect(c.closed).toBe(0);
    failStore = false;
    await r.revalidateAll();
    expect(c.closed).toBe(1);
  });
});

describe('WebSocket upgrade', () => {
  function fakeSocket(opts: { stalled?: boolean } = {}) {
    const chunks: Buffer[] = [];
    const s = new Duplex({
      read() {},
      write(chunk: Buffer, _e, cb) {
        chunks.push(chunk);
        if (opts.stalled !== true) cb();
      },
    });
    return { s, text: () => Buffer.concat(chunks).toString('latin1') };
  }
  function req(peer: string, headers: Record<string, string> = {}) {
    return {
      url: '/kino/ws',
      headers: { 'sec-websocket-key': 'k', upgrade: 'websocket', host: 'glass.test', ...headers },
      socket: { remoteAddress: peer },
    } as never;
  }

  it('keys anonymous panes by the trusted-proxy client address, not by the proxy', () => {
    const r = relay({ paneCap: 1 });
    const route = {
      relay: r,
      sessionKey: undefined,
      now: () => clock,
      trustedProxies: new Set(['192.0.2.7']),
    };
    handleKinoUpgrade(
      route,
      req('192.0.2.7', { 'x-geldar-client-ip': '203.0.113.1' }),
      fakeSocket().s,
    );
    handleKinoUpgrade(
      route,
      req('192.0.2.7', { 'x-geldar-client-ip': '203.0.113.2' }),
      fakeSocket().s,
    );
    expect(r.openPanes).toBe(2);
    // The same client again hits its own cap.
    handleKinoUpgrade(
      route,
      req('192.0.2.7', { 'x-geldar-client-ip': '203.0.113.1' }),
      fakeSocket().s,
    );
    expect(r.openPanes).toBe(2);
  });

  it('ignores the forwarded header from a peer that is not a trusted proxy', () => {
    const r = relay({ paneCap: 1 });
    const route = {
      relay: r,
      sessionKey: undefined,
      now: () => clock,
      trustedProxies: new Set<string>(),
    };
    handleKinoUpgrade(
      route,
      req('198.51.100.9', { 'x-geldar-client-ip': '203.0.113.1' }),
      fakeSocket().s,
    );
    handleKinoUpgrade(
      route,
      req('198.51.100.9', { 'x-geldar-client-ip': '203.0.113.2' }),
      fakeSocket().s,
    );
    expect(r.openPanes).toBe(1);
  });

  function maskedText(text: string): Buffer {
    const body = Buffer.from(text);
    const mask = Buffer.from([1, 2, 3, 4]);
    const out = Buffer.from(body);
    for (let i = 0; i < out.length; i++) out[i] = (out[i] as number) ^ (mask[i % 4] as number);
    return Buffer.concat([Buffer.from([0x81, 0x80 | body.length]), mask, out]);
  }

  async function slowReader(extra: { maxBuffered?: number; stallMs?: number }) {
    let push: (j: string) => void = () => {};
    const r = new KinoRelay({
      store: { access: async () => ANONYMOUS, agent: async () => agent },
      feed: {
        subscribe: (_a, on) => {
          push = on;
          return () => {};
        },
      },
      onRefusal: (x) => refusals.push(x),
    });
    const sock = fakeSocket({ stalled: true });
    handleKinoUpgrade(
      { relay: r, sessionKey: undefined, now: () => Date.now(), ...extra },
      req('198.51.100.9'),
      sock.s,
    );
    sock.s.emit('data', maskedText(sub('mine')));
    await vi.waitFor(() => expect(typeof push).toBe('function'));
    await vi.waitFor(() => expect(r.openPanes).toBe(1));
    await new Promise((res) => setTimeout(res, 20));
    return { r, sock, push: (j: string) => push(j) };
  }

  it('drops a client whose unread queue passes the byte cap, with a bye and a refusal', async () => {
    const { r, sock, push } = await slowReader({ maxBuffered: 4096 });
    const msg = JSON.stringify({
      type: 'chunk_section',
      chunk_x: 0,
      chunk_z: 0,
      section_y: 0,
      palette: ['minecraft:stone'],
      bits: 0,
      data: 'A'.repeat(1000),
    });
    for (let i = 0; i < 3; i++) push(msg);
    expect(r.openPanes).toBe(1);
    for (let i = 0; i < 10; i++) push(msg);
    expect(r.openPanes).toBe(0);
    expect(refusals).toEqual(['feed_overloaded']);
    // The queue never grew far past the cap: later messages are not buffered.
    expect(sock.s.writableLength).toBeLessThan(4096 + 1200);
  });

  it('drops a client whose queue does not move for the stall time', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    try {
      const { r, push } = await slowReader({ stallMs: 3000 });
      push(JSON.stringify({ type: 'entity_positions', entities: [] }));
      await vi.advanceTimersByTimeAsync(2000);
      expect(r.openPanes).toBe(1);
      await vi.advanceTimersByTimeAsync(3000);
      expect(r.openPanes).toBe(0);
      expect(refusals).toEqual(['feed_overloaded']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('answers 403 and opens no pane for a foreign Origin', () => {
    const r = relay();
    const sock = fakeSocket();
    handleKinoUpgrade(
      { relay: r, sessionKey: undefined, now: () => clock },
      req('198.51.100.9', { origin: 'https://map.test' }),
      sock.s,
    );
    expect(sock.text()).toContain('403 Forbidden');
    expect(sock.text()).not.toContain('101');
    expect(r.openPanes).toBe(0);
  });
});
describe('Origin check', () => {
  it('allows no Origin, the own host and listed hosts; refuses sibling subdomains', () => {
    expect(originAllowed(undefined, 'glass.example.org', [])).toBe(true);
    expect(originAllowed('https://glass.example.org', 'glass.example.org', [])).toBe(true);
    expect(originAllowed('https://GLASS.example.org', 'glass.example.org', [])).toBe(true);
    expect(originAllowed('https://map.example.org', 'glass.example.org', [])).toBe(false);
    expect(originAllowed('https://map.example.org', 'glass.example.org', ['map.example.org'])).toBe(
      true,
    );
    expect(originAllowed('null', 'glass.example.org', [])).toBe(false);
    expect(originAllowed('https://glass.example.org.evil.test', 'glass.example.org', [])).toBe(
      false,
    );
  });
});

describe('token buckets', () => {
  it('never holds more than maxKeys keys', () => {
    let t = 0;
    const b = new TokenBuckets({ burst: 1, refillMs: 1000, maxKeys: 2, now: () => t });
    expect(b.take('a')).toBe(true);
    expect(b.take('a')).toBe(false);
    b.take('b');
    b.take('c'); // evicts the oldest ('a'), which starts again with a full bucket
    expect(b.take('a')).toBe(true);
    t += 1000;
    expect(b.take('a')).toBe(true);
  });
});

describe('audit purge timer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs at start and daily, and logs and counts a failure', async () => {
    let calls = 0;
    let fail = true;
    const lines: string[] = [];
    const h = startAuditPurge(
      {
        purge: async () => {
          calls++;
          if (fail) throw new Error('permission denied');
        },
      },
      { log: (l) => lines.push(l) },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);
    expect(h.failures()).toBe(1);
    expect(lines).toEqual(['{"kino":"audit purge failed"}']);
    fail = false;
    await vi.advanceTimersByTimeAsync(86_400_000);
    expect(calls).toBe(2);
    expect(h.failures()).toBe(1);
    h.stop();
    await vi.advanceTimersByTimeAsync(86_400_000 * 3);
    expect(calls).toBe(2);
  });

  it('counts a synchronous throw too', async () => {
    const lines: string[] = [];
    const h = startAuditPurge(
      {
        purge: () => {
          throw new Error('boom');
        },
      },
      { log: (l) => lines.push(l) },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(h.failures()).toBe(1);
    h.stop();
  });
});
