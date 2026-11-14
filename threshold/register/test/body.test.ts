import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bodyRoutes, START_WINDOW_MAX } from '../src/api/body.ts';
import { handleApi } from '../src/api/index.ts';
import type { ApiDeps } from '../src/api/route.ts';
import { sendProblem } from '../src/problem.ts';

const NOW = Date.parse('2026-11-14T00:00:00.000Z');
const hash = (v: string): Buffer => createHash('sha256').update(v).digest();
const KEY_ALL = `gowner-${'a1'.repeat(32)}`; // alice: read, body
const KEY_BODY = `gowner-${'b1'.repeat(32)}`; // bob: body only
const OWNERS = new Map<string, { ownerId: string; scopes: string[] }>([
  [hash(KEY_ALL).toString('hex'), { ownerId: 'alice', scopes: ['read', 'body'] }],
  [hash(KEY_BODY).toString('hex'), { ownerId: 'bob', scopes: ['body'] }],
]);
const bearer = (k: string) => ({ authorization: `Bearer ${k}` });
const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));

/** A fake NATS link: each request is answered by `answer`, and every subject and payload is recorded. */
function fakeConn(answer: (subject: string) => Promise<Uint8Array> | Uint8Array) {
  const subjects: string[] = [];
  const payloads: Record<string, unknown>[] = [];
  const conn = {
    async request(subject: string, data: Uint8Array) {
      subjects.push(subject);
      payloads.push(JSON.parse(new TextDecoder().decode(data)) as Record<string, unknown>);
      return { data: await answer(subject) };
    },
  };
  return { conn, subjects, payloads };
}

const reply = (code: string, ok = false, events?: unknown[]) => enc({ ok, code, events });

function harness(conn: ReturnType<typeof fakeConn>['conn']) {
  const deps: ApiDeps = {
    now: () => NOW,
    csrfKey: 'session-key',
    ownerKeys: {
      hash,
      store: {
        resolve: async (h) => OWNERS.get(h.toString('hex')) ?? null,
        mint: async () => null,
        revoke: async () => null,
        list: async () => null,
      },
    },
    agents: async (owner, player) =>
      owner === 'alice' && player === 'p1' ? { ownerId: 'alice', playerId: 'p1' } : null,
    routes: bodyRoutes({ conn, shard: 'phase0', timeoutMs: 1000 }),
  };
  let server: Server;
  let base = '';
  return {
    async start() {
      server = createServer((req, res) => {
        void handleApi(req, res, new URL(req.url ?? '/', 'http://local'), deps).then((handled) => {
          if (!handled) sendProblem(res, 'not_found');
        });
      });
      await new Promise<void>((ok) => server.listen(0, '127.0.0.1', () => ok()));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    },
    stop: () => new Promise<void>((ok) => server.close(() => ok())),
    call: (method: string, path: string, headers: Record<string, string> = {}) =>
      fetch(`${base}${path}`, { method, headers }).then(async (r) => ({
        status: r.status,
        retryAfter: r.headers.get('retry-after'),
        body: await r.text(),
      })),
  };
}

const START = '/api/v1/agents/p1/body/start';
const LOG = '/api/v1/agents/p1/body/log';

describe('body start (C7-04c reply mapping)', () => {
  const fake = fakeConn(() => reply('started', true));
  const h = harness(fake.conn);
  beforeAll(() => h.start());
  afterAll(() => h.stop());

  it('maps a started reply to 202 BodyOp done, and sends its own op to the subject', async () => {
    const r = await h.call('POST', START, bearer(KEY_ALL));
    expect(r.status).toBe(202);
    expect(JSON.parse(r.body)).toMatchObject({ state: 'done' });
    expect(fake.subjects[0]).toBe('geldar.phase0.ctl.body.start');
    expect(fake.payloads[0]).toMatchObject({ op: 'start', ownerId: 'alice', playerName: 'p1' });
  });

  it('answers a foreign or unknown agent 404 before any supervisor call', async () => {
    const before = fake.subjects.length;
    const r = await h.call('POST', '/api/v1/agents/p2/body/start', bearer(KEY_ALL));
    expect(r.status).toBe(404);
    expect(fake.subjects.length).toBe(before);
  });
});

describe('body reply table (one row per code)', () => {
  let next = 'started';
  let okNext = false;
  const fake = fakeConn(() => reply(next, okNext));
  const h = harness(fake.conn);
  beforeAll(() => h.start());
  afterAll(() => h.stop());

  it('quota is 429 quota with Retry-After', async () => {
    next = 'quota';
    const r = await h.call('POST', '/api/v1/agents/p1/body/stop', bearer(KEY_ALL));
    expect(r.status).toBe(429);
    expect(JSON.parse(r.body).code).toBe('quota');
    expect(r.retryAfter).not.toBeNull();
  });

  it('unknown is 404 not_found', async () => {
    next = 'unknown';
    const r = await h.call('POST', '/api/v1/agents/p1/body/stop', bearer(KEY_ALL));
    expect(r.status).toBe(404);
  });

  it('login_name is 422 invalid with the fixed text, never the supervisor text', async () => {
    next = 'login_name';
    const r = await h.call('POST', START, bearer(KEY_ALL));
    expect(r.status).toBe(422);
    expect(JSON.parse(r.body).detail).toContain('3 to 16 letters, digits or underscore');
  });

  it('invalid is a register bug: 500 internal', async () => {
    next = 'invalid';
    const r = await h.call('POST', START, bearer(KEY_ALL));
    expect(r.status).toBe(500);
    expect(JSON.parse(r.body).code).toBe('internal');
  });

  it('an ok reply with an unknown code zzz is 503, never 200', async () => {
    next = 'zzz';
    okNext = true;
    const r = await h.call('POST', START, bearer(KEY_ALL));
    okNext = false;
    expect(r.status).toBe(503);
    expect(JSON.parse(r.body).code).toBe('body_unavailable');
  });

  it('error and an unknown code zzz are 503 body_unavailable, never 200', async () => {
    next = 'error';
    expect((await h.call('POST', START, bearer(KEY_ALL))).status).toBe(503);
    next = 'zzz';
    const r = await h.call('POST', START, bearer(KEY_ALL));
    expect(r.status).toBe(503);
    expect(r.retryAfter).not.toBeNull();
    expect(JSON.parse(r.body).code).toBe('body_unavailable');
  });
});

describe('body unreachable and in-flight slot', () => {
  let mode: 'timeout' | 'ok' = 'timeout';
  let gate: Promise<void> | null = null;
  const fake = fakeConn(async () => {
    if (gate) await gate;
    if (mode === 'timeout') throw new Error('no responders');
    return reply('started', true);
  });
  const h = harness(fake.conn);
  beforeAll(() => h.start());
  afterAll(() => h.stop());

  it('a timeout is 503 and releases the slot, so the next request is accepted', async () => {
    const r = await h.call('POST', START, bearer(KEY_ALL));
    expect(r.status).toBe(503);
    mode = 'ok';
    expect((await h.call('POST', START, bearer(KEY_ALL))).status).toBe(202);
  });

  it('a second request while the first is pending is 409 conflict with no supervisor call', async () => {
    let release: () => void = () => {};
    gate = new Promise<void>((ok) => {
      release = ok;
    });
    const first = h.call('POST', '/api/v1/agents/p1/body/restart', bearer(KEY_ALL));
    await new Promise((ok) => setTimeout(ok, 50));
    const calls = fake.subjects.length;
    const second = await h.call('POST', '/api/v1/agents/p1/body/stop', bearer(KEY_ALL));
    expect(second.status).toBe(409);
    expect(JSON.parse(second.body).code).toBe('conflict');
    expect(fake.subjects.length).toBe(calls);
    release();
    gate = null;
    expect((await first).status).toBe(202);
    expect((await h.call('POST', START, bearer(KEY_ALL))).status).toBe(202);
  });
});

describe('repeat start window', () => {
  const fake = fakeConn(() => reply('started', true));
  const h = harness(fake.conn);
  beforeAll(() => h.start());
  afterAll(() => h.stop());

  it('the N+1th start in the window is 429 rate_limited, and the supervisor is called N times', async () => {
    for (let i = 0; i < START_WINDOW_MAX; i++) {
      expect((await h.call('POST', START, bearer(KEY_ALL))).status).toBe(202);
    }
    const r = await h.call('POST', START, bearer(KEY_ALL));
    expect(r.status).toBe(429);
    expect(JSON.parse(r.body).code).toBe('rate_limited');
    expect(r.retryAfter).toBe('60');
    expect(fake.subjects.length).toBe(START_WINDOW_MAX);
  });
});

describe('body status and log reads', () => {
  const fake = fakeConn(() =>
    reply('logs', true, [
      { at: new Date(NOW - 8 * 86_400_000).toISOString(), code: 'started' },
      { at: new Date(NOW - 1000).toISOString(), code: 'stopped' },
      { at: new Date(NOW - 500).toISOString(), code: 'hi there 42 model text' },
    ]),
  );
  const h = harness(fake.conn);
  beforeAll(() => h.start());
  afterAll(() => h.stop());

  it('a limit above 200 is 422 invalid and sends no supervisor call', async () => {
    const before = fake.subjects.length;
    const r = await h.call('GET', `${LOG}?limit=201`, bearer(KEY_ALL));
    expect(r.status).toBe(422);
    expect(fake.subjects.length).toBe(before);
  });

  it('drops an event 8 days old and renders every text as a fixed string', async () => {
    const r = await h.call('GET', LOG, bearer(KEY_ALL));
    expect(r.status).toBe(200);
    const lines = JSON.parse(r.body).lines as { text: string }[];
    expect(lines.map((l) => l.text)).toEqual(['Body stopped.', 'Event.']);
  });

  it('a read needs scope read: a body-only key is refused on the log', async () => {
    const r = await h.call('GET', LOG, bearer(KEY_BODY));
    expect(r.status).toBe(403);
    expect(JSON.parse(r.body).code).toBe('scope_missing');
  });
});
