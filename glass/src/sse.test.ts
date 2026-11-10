import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Row, ThoughtCursor } from './query.ts';
import { SseHub } from './sse.ts';

/** A response that records writes, can say "full" (write returns false) and can be closed. */
class FakeRes extends EventEmitter {
  writes: string[] = [];
  writableEnded = false;
  accept = true;
  status = 0;
  writeHead(status: number): this {
    this.status = status;
    return this;
  }
  write(chunk: string): boolean {
    this.writes.push(chunk);
    return this.accept;
  }
  end(): this {
    this.writableEnded = true;
    this.emit('close');
    return this;
  }
}

const row = (id: string, at: string): Row => ({
  thought_id: id,
  cursor_at: at,
  life_id: 'kestrel',
});

function makeHub(
  fetch: (after: ThoughtCursor) => Promise<Row[]>,
  overrides: { maxClients?: number; bufferFrames?: number } = {},
) {
  const start = vi.fn(async () => ({ at: '2026-11-10 00:00:00+00', id: '' }));
  const fetchSpy = vi.fn(fetch);
  const hub = new SseHub({
    maxClients: overrides.maxClients ?? 2,
    bufferFrames: overrides.bufferFrames ?? 100,
    pollMs: 1000,
    heartbeatMs: 15000,
    start,
    fetch: fetchSpy,
  });
  return { hub, start, fetchSpy };
}

const attach = (hub: SseHub, res: FakeRes) => hub.attach(res as unknown as ServerResponse);

describe('the SSE hub', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends a new thought as one event with its cursor column removed', async () => {
    const { hub } = makeHub(async () => [row('t1', '2026-11-10 00:00:01+00')]);
    const res = new FakeRes();
    expect(attach(hub, res)).toBe(true);
    expect(res.status).toBe(200);
    await vi.advanceTimersByTimeAsync(1000);
    const frame = res.writes.find((w) => w.startsWith('event: thought'));
    expect(frame).toBe('event: thought\nid: t1\ndata: {"thought_id":"t1","life_id":"kestrel"}\n\n');
    expect(hub.stats()).toMatchObject({ clients: 1, delivered: 1, polls: 1 });
  });

  it('refuses a client over the cap without writing to it, and frees the slot on close', () => {
    const { hub } = makeHub(async () => [], { maxClients: 1 });
    const first = new FakeRes();
    const second = new FakeRes();
    expect(attach(hub, first)).toBe(true);
    expect(attach(hub, second)).toBe(false);
    expect(second.writes).toEqual([]);
    expect(hub.stats()).toMatchObject({ clients: 1, rejected: 1 });
    first.end();
    expect(hub.stats().clients).toBe(0);
    expect(attach(hub, new FakeRes())).toBe(true);
  });

  it('drops the oldest queued frame for a slow client', async () => {
    // a is written at once and the socket is then full, so b, c and d queue; with room for two,
    // d evicts b.
    const { hub } = makeHub(
      async () => [row('a', '1'), row('b', '2'), row('c', '3'), row('d', '4')],
      {
        bufferFrames: 2,
      },
    );
    const res = new FakeRes();
    res.accept = false;
    attach(hub, res);
    await vi.advanceTimersByTimeAsync(1000);
    expect(hub.stats().dropped).toBe(1);
    res.accept = true;
    res.emit('drain');
    const ids = res.writes
      .filter((w) => w.startsWith('event: thought'))
      .map((w) => w.split('\n')[1]);
    expect(ids).toEqual(['id: a', 'id: c', 'id: d']);
  });

  it('a poll that finishes after its client closed writes nothing and stops the timers', async () => {
    let finish: (rows: Row[]) => void = () => undefined;
    const pending = new Promise<Row[]>((resolve) => {
      finish = resolve;
    });
    const { hub, fetchSpy } = makeHub(() => pending);
    const res = new FakeRes();
    attach(hub, res);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    res.end();
    finish([row('late', '1')]);
    await vi.advanceTimersByTimeAsync(60000);
    expect(res.writes.some((w) => w.includes('late'))).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(hub.stats()).toMatchObject({ clients: 0, pollErrors: 0 });
  });

  it('does not deliver rows from a stream that closed to a later client', async () => {
    let finish: (rows: Row[]) => void = () => undefined;
    const pending = new Promise<Row[]>((resolve) => {
      finish = resolve;
    });
    const { hub } = makeHub(() => pending);
    const first = new FakeRes();
    attach(hub, first);
    await vi.advanceTimersByTimeAsync(1000);
    first.end();
    const second = new FakeRes();
    attach(hub, second);
    finish([row('stale', '1')]);
    await vi.advanceTimersByTimeAsync(0);
    expect(second.writes.some((w) => w.includes('stale'))).toBe(false);
  });

  it('a failed poll is counted, sends nothing, and the next poll still delivers', async () => {
    const fetch = vi
      .fn<(after: ThoughtCursor) => Promise<Row[]>>()
      .mockRejectedValueOnce(new Error('connection refused at db.internal'))
      .mockResolvedValue([row('t2', '2')]);
    const hub = new SseHub({
      maxClients: 1,
      bufferFrames: 10,
      pollMs: 1000,
      heartbeatMs: 15000,
      start: async () => ({ at: 'x', id: '' }),
      fetch,
    });
    const res = new FakeRes();
    attach(hub, res);
    await vi.advanceTimersByTimeAsync(1000);
    expect(hub.stats().pollErrors).toBe(1);
    expect(res.writes.join('')).not.toContain('db.internal');
    await vi.advanceTimersByTimeAsync(1000);
    expect(res.writes.some((w) => w.includes('t2'))).toBe(true);
  });

  it('counts a failed start as a poll error and retries it on the next tick', async () => {
    const start = vi
      .fn<() => Promise<ThoughtCursor>>()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue({ at: 'x', id: '' });
    const hub = new SseHub({
      maxClients: 1,
      bufferFrames: 10,
      pollMs: 1000,
      heartbeatMs: 15000,
      start,
      fetch: async () => [],
    });
    attach(hub, new FakeRes());
    await vi.advanceTimersByTimeAsync(1000);
    expect(hub.stats().pollErrors).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(start).toHaveBeenCalledTimes(2);
  });

  it('sends a heartbeat comment every 15 seconds to each client', async () => {
    const { hub } = makeHub(async () => []);
    const res = new FakeRes();
    attach(hub, res);
    await vi.advanceTimersByTimeAsync(15000);
    expect(res.writes.filter((w) => w === ': heartbeat\n\n')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(15000);
    expect(res.writes.filter((w) => w === ': heartbeat\n\n')).toHaveLength(2);
  });

  it('does not start a second poll while one is in flight', async () => {
    const { hub, fetchSpy } = makeHub(() => new Promise<Row[]>(() => undefined));
    attach(hub, new FakeRes());
    await vi.advanceTimersByTimeAsync(3000);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(hub.stats().polls).toBe(1);
  });

  it('stops the timers when the last client leaves', async () => {
    const { hub, fetchSpy } = makeHub(async () => []);
    const res = new FakeRes();
    attach(hub, res);
    await vi.advanceTimersByTimeAsync(1000);
    res.end();
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(hub.stats().clients).toBe(0);
  });

  it('close() ends every stream', () => {
    const { hub } = makeHub(async () => []);
    const a = new FakeRes();
    const b = new FakeRes();
    attach(hub, a);
    attach(hub, b);
    hub.close();
    expect(a.writableEnded).toBe(true);
    expect(b.writableEnded).toBe(true);
    expect(hub.stats().clients).toBe(0);
  });

  it('keeps a newline in a thought id from starting a new SSE field', async () => {
    const hub = new SseHub({
      maxClients: 1,
      bufferFrames: 10,
      pollMs: 1000,
      heartbeatMs: 15000,
      start: async () => ({ at: 'x', id: '' }),
      fetch: async () => [row('t1\nevent: injected', '1')],
    });
    const res = new FakeRes();
    attach(hub, res);
    await vi.advanceTimersByTimeAsync(1000);
    const frame = res.writes.find((w) => w.startsWith('event: thought')) ?? '';
    const lines = frame.split('\n');
    expect(lines.filter((l) => l.startsWith('event:'))).toEqual(['event: thought']);
    expect(lines[1]).toBe('id: t1event: injected');
  });

  it('logs a poll error at most once a minute, with its code and nothing from the message', async () => {
    const log = vi.fn();
    const err = Object.assign(new Error('password=hunter2 at db.internal'), { code: '57014' });
    const hub = new SseHub({
      maxClients: 1,
      bufferFrames: 10,
      pollMs: 1000,
      heartbeatMs: 15000,
      start: async () => ({ at: 'x', id: '' }),
      fetch: async () => {
        throw err;
      },
      log,
    });
    attach(hub, new FakeRes());
    await vi.advanceTimersByTimeAsync(11_000);
    expect(hub.stats().pollErrors).toBeGreaterThan(1);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith({ event: 'glass_poll_error', code: '57014' });
    expect(JSON.stringify(log.mock.calls)).not.toContain('hunter2');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(log).toHaveBeenCalledTimes(2);
  });

  it('logs an error code that is not a plain token as unknown', async () => {
    const log = vi.fn();
    const bad = Object.assign(new Error('x'), { code: 'bad\nevent: y' });
    const hub = new SseHub({
      maxClients: 1,
      bufferFrames: 10,
      pollMs: 1000,
      heartbeatMs: 15000,
      start: async () => ({ at: 'x', id: '' }),
      fetch: async () => {
        throw bad;
      },
      log,
    });
    attach(hub, new FakeRes());
    await vi.advanceTimersByTimeAsync(1000);
    expect(log).toHaveBeenCalledWith({ event: 'glass_poll_error', code: 'unknown' });
  });
});
