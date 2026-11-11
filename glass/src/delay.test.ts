import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createHandler } from './http.ts';
import { OPEN_POLICY, type PublicPolicy, visibilityAt } from './policy.ts';
import type { SqlClient } from './query.ts';
import { ROUTES } from './routes.ts';
import { streamFeed } from './server.ts';
import type { SseHub } from './sse.ts';

const T0 = Date.parse('2026-11-11T12:00:00.000Z');

/** A database that records the parameter array of each statement and returns no rows. */
function recorder(): { db: SqlClient; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const db: SqlClient = {
    query: async (_text, values) => {
      calls.push(values);
      return { rows: [] };
    },
  };
  return { db, calls };
}

/** The last value the last statement received: the cut-off, which every thought statement takes last. */
function lastCutoff(calls: unknown[][]): unknown {
  return calls[calls.length - 1]?.at(-1);
}

const servers: Server[] = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

async function start(policy: Partial<PublicPolicy>, db: SqlClient): Promise<number> {
  const hub = {} as unknown as SseHub;
  const server = createServer(createHandler({ db, hub, policy }));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

/** The status of a GET on a named route, with `:id` filled in. */
function getRoute(port: number, name: string): Promise<number> {
  const route = ROUTES.find((r) => r.name === name);
  if (route === undefined) throw new Error(`no route named ${name}`);
  const path = route.path.replace(':id', 'thought-1');
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method: 'GET', path }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('thought delay (0072 item 5)', () => {
  it('is off by default: every thought is shown at once', () => {
    expect(visibilityAt(OPEN_POLICY)).toEqual({ shownUntil: null });
  });

  it('the list cut-off is the fake clock minus the delay, and moves as the clock moves', async () => {
    const clock = { at: T0 };
    const { db, calls } = recorder();
    const port = await start({ delaySeconds: 30, now: () => clock.at }, db);
    expect(await getRoute(port, 'thoughts')).toBe(200);
    expect(lastCutoff(calls)).toBe(new Date(T0 - 30_000).toISOString());
    clock.at += 10_000;
    expect(await getRoute(port, 'thoughts')).toBe(200);
    expect(lastCutoff(calls)).toBe(new Date(T0 - 20_000).toISOString());
  });

  it('a thought detail takes the same cut-off, so a delayed thought is not found', async () => {
    const { db, calls } = recorder();
    const port = await start({ delaySeconds: 30, now: () => T0 }, db);
    expect(await getRoute(port, 'thought')).toBe(404);
    expect(lastCutoff(calls)).toBe(new Date(T0 - 30_000).toISOString());
  });

  it('the stream feed takes the same cut-off as the API', async () => {
    const clock = { at: T0 };
    const { db, calls } = recorder();
    const feed = streamFeed(db, { ...OPEN_POLICY, delaySeconds: 30, now: () => clock.at });
    await feed({ at: '2026-11-11 11:00:00+00', id: '' });
    expect(lastCutoff(calls)).toBe(new Date(T0 - 30_000).toISOString());
  });

  it('with no delay the stream and the list pass no cut-off', async () => {
    const { db, calls } = recorder();
    const port = await start({}, db);
    expect(await getRoute(port, 'thoughts')).toBe(200);
    expect(lastCutoff(calls)).toBeNull();
    await streamFeed(db, OPEN_POLICY)({ at: '2026-11-11 11:00:00+00', id: '' });
    expect(lastCutoff(calls)).toBeNull();
  });
});
