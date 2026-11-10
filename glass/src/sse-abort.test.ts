import { createServer, type IncomingMessage, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHandler } from './http.ts';
import type { Row } from './query.ts';
import { SseHub } from './sse.ts';

/** Real sockets and real timers: a client abort is a socket close, which only a socket can test. */
const servers: Server[] = [];
const hubs: SseHub[] = [];

function makeHub(maxClients: number) {
  const fetch = vi.fn(async (): Promise<Row[]> => []);
  const hub = new SseHub({
    maxClients,
    bufferFrames: 10,
    pollMs: 5,
    heartbeatMs: 60_000,
    start: async () => ({ at: '2026-11-10 00:00:00+00', id: '' }),
    fetch,
  });
  hubs.push(hub);
  return { hub, fetch };
}

async function listen(hub: SseHub): Promise<number> {
  const db = {
    query: async () => {
      throw new Error('the stream route does not query');
    },
  };
  const server = createServer(createHandler({ db, hub }));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

interface Open {
  status: number;
  abort: () => void;
  /** Resolves when the server ends this stream, or the socket closes. */
  ended: Promise<void>;
}

/** Opens /api/stream and resolves with the status once the first bytes arrive. */
function openStream(port: number): Promise<Open> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, method: 'GET', path: '/api/stream' },
      (res: IncomingMessage) => {
        res.on('error', () => undefined);
        const ended = new Promise<void>((done) => {
          res.on('end', done);
          res.on('close', done);
        });
        res.once('data', () =>
          resolve({ status: res.statusCode ?? 0, abort: () => req.destroy(), ended }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/** Polls a condition every few milliseconds until it holds, or fails after two seconds. */
async function waitFor(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** The private state that must return to zero: the client set and both timer handles. */
function internals(hub: SseHub): { clients: number; pollTimer: unknown; beatTimer: unknown } {
  const state = hub as unknown as { clients: Set<unknown>; pollTimer: unknown; beatTimer: unknown };
  return { clients: state.clients.size, pollTimer: state.pollTimer, beatTimer: state.beatTimer };
}

afterEach(async () => {
  for (const hub of hubs.splice(0)) hub.close();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

describe('the SSE hub under client aborts and server close', () => {
  it('a client that aborts mid-stream frees its slot, and the next client takes it', async () => {
    const { hub } = makeHub(1);
    const port = await listen(hub);
    const first = await openStream(port);
    expect(first.status).toBe(200);
    expect(internals(hub).clients).toBe(1);
    first.abort();
    await waitFor(() => internals(hub).clients === 0, 'the aborted slot to be released');
    const second = await openStream(port);
    expect(second.status).toBe(200);
    expect(hub.stats()).toMatchObject({ clients: 1, rejected: 0 });
    second.abort();
    await waitFor(() => internals(hub).clients === 0, 'the second slot to be released');
  });

  it('the connection cap holds over real sockets: a third client gets 503 until a slot frees', async () => {
    const { hub } = makeHub(2);
    const port = await listen(hub);
    const a = await openStream(port);
    const b = await openStream(port);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await openStream(port).then((o) => o.status)).toBe(503);
    expect(hub.stats()).toMatchObject({ clients: 2, rejected: 1 });
    a.abort();
    await waitFor(() => internals(hub).clients === 1, 'one slot to free');
    const d = await openStream(port);
    expect(d.status).toBe(200);
    expect(internals(hub).clients).toBe(2);
    b.abort();
    d.abort();
    await waitFor(() => internals(hub).clients === 0, 'every slot to free');
  });

  it('after 100 abort cycles the slots and both timers are released, and no poll runs', async () => {
    const { hub, fetch } = makeHub(2);
    const port = await listen(hub);
    for (let cycle = 0; cycle < 100; cycle += 1) {
      const stream = await openStream(port);
      expect(stream.status).toBe(200);
      stream.abort();
      await waitFor(() => internals(hub).clients === 0, `cycle ${cycle} to release its slot`);
    }
    expect(internals(hub)).toEqual({ clients: 0, pollTimer: null, beatTimer: null });
    expect(hub.stats()).toMatchObject({ clients: 0, rejected: 0 });
    const polls = fetch.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(fetch.mock.calls.length, 'no poll after the last abort').toBe(polls);
  }, 60_000);

  it('server close clears the poll and heartbeat timers and ends the open stream', async () => {
    const { hub, fetch } = makeHub(2);
    const port = await listen(hub);
    const stream = await openStream(port);
    expect(stream.status).toBe(200);
    expect(internals(hub).pollTimer).not.toBeNull();
    hub.close();
    await stream.ended;
    expect(internals(hub)).toEqual({ clients: 0, pollTimer: null, beatTimer: null });
    const polls = fetch.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(fetch.mock.calls.length, 'no poll after close').toBe(polls);
  });
});
