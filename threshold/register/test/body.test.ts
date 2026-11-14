import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bodyRoutes, START_WINDOW_MAX, START_WINDOW_MS } from '../src/api/body.ts';
import { handleApi } from '../src/api/index.ts';
import type { ApiDeps } from '../src/api/route.ts';
import { sendProblem } from '../src/problem.ts';

const NOW = Date.parse('2026-11-14T00:00:00.000Z');
const hash = (v: string): Buffer => createHash('sha256').update(v).digest();
const KEY_ALL = `gowner-${'a1'.repeat(32)}`; // alice: read, body
const KEY_BODY = `gowner-${'b1'.repeat(32)}`; // bob: body only
const KEY_READ = `gowner-${'c1'.repeat(32)}`; // carol: read only
const OWNERS = new Map<string, { ownerId: string; scopes: string[] }>([
  [hash(KEY_ALL).toString('hex'), { ownerId: 'alice', scopes: ['read', 'body'] }],
  [hash(KEY_BODY).toString('hex'), { ownerId: 'bob', scopes: ['body'] }],
  [hash(KEY_READ).toString('hex'), { ownerId: 'carol', scopes: ['read'] }],
]);
/** Agents by player id. The display name is the supervisor's player name; the player id is `ag-` and never sent. */
const AGENTS = new Map<
  string,
  { ownerId: string; playerId: string; displayName: string; status?: string }
>([
  ['ag-one-01', { ownerId: 'alice', playerId: 'ag-one-01', displayName: 'Ranger' }],
  ['ag-two-01', { ownerId: 'bob', playerId: 'ag-two-01', displayName: 'Scout' }],
  ['ag-odd-01', { ownerId: 'alice', playerId: 'ag-odd-01', displayName: 'My Agent' }],
  ['ag-short-01', { ownerId: 'alice', playerId: 'ag-short-01', displayName: 'ab' }],
  [
    'ag-sixteen-01',
    { ownerId: 'alice', playerId: 'ag-sixteen-01', displayName: 'abcdefghijklmnop' },
  ],
  [
    'ag-seventeen-01',
    { ownerId: 'alice', playerId: 'ag-seventeen-01', displayName: 'abcdefghijklmnopq' },
  ],
  [
    'ag-retired-01',
    { ownerId: 'alice', playerId: 'ag-retired-01', displayName: 'ab', status: 'retired' },
  ],
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
  const clock = { now: NOW };
  const deps: ApiDeps = {
    now: () => clock.now,
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
    // Returns the agent whoever owns it: the ownership check is the route's, not the lookup's.
    agents: async (_owner, player) => AGENTS.get(player) ?? null,
    routes: bodyRoutes({ conn, shard: 'phase0', timeoutMs: 1000 }),
  };
  let server: Server;
  let base = '';
  return {
    clock,
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

const START = '/api/v1/agents/ag-one-01/body/start';
const STOP = '/api/v1/agents/ag-one-01/body/stop';
const RESTART = '/api/v1/agents/ag-one-01/body/restart';
const STATUS = '/api/v1/agents/ag-one-01/body/status';
const LOG = '/api/v1/agents/ag-one-01/body/log';
const FOREIGN = '/api/v1/agents/ag-two-01/body';

describe('body start (C7-04c reply mapping)', () => {
  const fake = fakeConn(() => reply('started', true));
  const h = harness(fake.conn);
  beforeAll(() => h.start());
  afterAll(() => h.stop());

  it('maps a started reply to 202 BodyOp done, and sends its own op with the display name', async () => {
    const r = await h.call('POST', START, bearer(KEY_ALL));
    expect(r.status).toBe(202);
    expect(JSON.parse(r.body)).toMatchObject({ state: 'done' });
    expect(fake.subjects[0]).toBe('geldar.phase0.ctl.body.start');
    expect(fake.payloads[0]).toMatchObject({ op: 'start', ownerId: 'alice', playerName: 'Ranger' });
  });

  it('answers a foreign or unknown agent 404 before any supervisor call', async () => {
    const before = fake.subjects.length;
    const r = await h.call('POST', '/api/v1/agents/ag-two-01/body/start', bearer(KEY_ALL));
    expect(r.status).toBe(404);
    expect(JSON.parse(r.body).code).toBe('not_found');
    const missing = await h.call('POST', '/api/v1/agents/p2/body/start', bearer(KEY_ALL));
    expect(missing.status).toBe(404);
    expect(fake.subjects.length).toBe(before);
  });

  it('refuses a display name outside the player-name shape with 422 and the fixed text, with no supervisor call', async () => {
    const before = fake.subjects.length;
    const r = await h.call('POST', '/api/v1/agents/ag-odd-01/body/start', bearer(KEY_ALL));
    expect(r.status).toBe(422);
    expect(JSON.parse(r.body).code).toBe('invalid');
    expect(JSON.parse(r.body).detail).toBe(
      "The player's name must be 3 to 16 letters, digits or underscore.",
    );
    expect(fake.subjects.length).toBe(before);
  });
  it.each(['ag-short-01', 'ag-seventeen-01'])(
    '%s has a display name outside 3 to 16 characters: 422 with no supervisor call',
    async (id) => {
      const before = fake.subjects.length;
      const r = await h.call('POST', `/api/v1/agents/${id}/body/start`, bearer(KEY_ALL));
      expect(r.status).toBe(422);
      expect(JSON.parse(r.body).code).toBe('invalid');
      expect(fake.subjects.length).toBe(before);
    },
  );

  it('a 16-character display name is accepted and sent as the player name', async () => {
    const before = fake.subjects.length;
    const r = await h.call('POST', '/api/v1/agents/ag-sixteen-01/body/start', bearer(KEY_ALL));
    expect(r.status).toBe(202);
    expect(fake.subjects.length).toBe(before + 1);
    expect(fake.payloads.at(-1)).toMatchObject({ playerName: 'abcdefghijklmnop' });
  });
});

describe('body retired agent (404 on every body route, before the name check)', () => {
  const fake = fakeConn(() => reply('started', true));
  const h = harness(fake.conn);
  beforeAll(() => h.start());
  afterAll(() => h.stop());

  it.each([
    ['POST', '/start'],
    ['POST', '/stop'],
    ['POST', '/restart'],
    ['GET', '/status'],
    ['GET', '/log'],
  ])('%s on %s answers 404 not_found with no supervisor call', async (method, suffix) => {
    // The retired agent's display name is 'ab', outside the name shape: 404 must win over 422.
    const before = fake.subjects.length;
    const r = await h.call(method, `/api/v1/agents/ag-retired-01/body${suffix}`, bearer(KEY_ALL));
    expect(r.status).toBe(404);
    expect(JSON.parse(r.body).code).toBe('not_found');
    expect(fake.subjects.length).toBe(before);
  });
});

describe('body refuses a game player token on the owner API', () => {
  const fake = fakeConn(() => reply('started', true));
  const h = harness(fake.conn);
  beforeAll(() => h.start());
  afterAll(() => h.stop());

  it.each([
    ['POST', START],
    ['GET', STATUS],
  ])(
    'a gmcp- Bearer on %s %s is 401 unauthenticated, with no supervisor call',
    async (method, path) => {
      const before = fake.subjects.length;
      const r = await h.call(method, path, bearer(`gmcp-${'d1'.repeat(32)}`));
      expect(r.status).toBe(401);
      expect(JSON.parse(r.body).code).toBe('unauthenticated');
      expect(fake.subjects.length).toBe(before);
    },
  );
});

describe('body foreign agent (404 on every body route, no supervisor call)', () => {
  const fake = fakeConn(() => reply('logs', true, []));
  const h = harness(fake.conn);
  beforeAll(() => h.start());
  afterAll(() => h.stop());

  it.each([
    ['POST', `${FOREIGN}/start`],
    ['POST', `${FOREIGN}/stop`],
    ['POST', `${FOREIGN}/restart`],
    ['GET', `${FOREIGN}/status`],
    ['GET', `${FOREIGN}/log`],
  ])("%s %s answers 404 for another owner's agent", async (method, path) => {
    const before = fake.subjects.length;
    const r = await h.call(method, path, bearer(KEY_ALL));
    expect(r.status).toBe(404);
    expect(JSON.parse(r.body).code).toBe('not_found');
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
    const r = await h.call('POST', STOP, bearer(KEY_ALL));
    expect(r.status).toBe(429);
    expect(JSON.parse(r.body).code).toBe('quota');
    expect(r.retryAfter).toBe('3600');
  });

  it('unknown is 404 not_found', async () => {
    next = 'unknown';
    const r = await h.call('POST', STOP, bearer(KEY_ALL));
    expect(r.status).toBe(404);
  });

  it('login_name is 422 invalid with the fixed text, never the supervisor text', async () => {
    next = 'login_name';
    const r = await h.call('POST', START, bearer(KEY_ALL));
    expect(r.status).toBe(422);
    expect(JSON.parse(r.body).detail).toContain('3 to 16 letters, digits or underscore');
    expect(r.body).not.toContain('supervisor');
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

describe('body stop, restart and status success codes', () => {
  let next = 'stopped';
  const fake = fakeConn(() => reply(next, true));
  const h = harness(fake.conn);
  beforeAll(() => h.start());
  afterAll(() => h.stop());

  it('a stopped reply to stop is 202 BodyOp done', async () => {
    next = 'stopped';
    const r = await h.call('POST', STOP, bearer(KEY_ALL));
    expect(r.status).toBe(202);
    expect(JSON.parse(r.body)).toMatchObject({ state: 'done' });
    expect(fake.subjects.at(-1)).toBe('geldar.phase0.ctl.body.stop');
    expect(fake.payloads.at(-1)).toMatchObject({
      op: 'stop',
      ownerId: 'alice',
      playerName: 'Ranger',
    });
  });

  it('a restarted reply to restart is 202 BodyOp done', async () => {
    next = 'restarted';
    const r = await h.call('POST', RESTART, bearer(KEY_ALL));
    expect(r.status).toBe(202);
    expect(fake.subjects.at(-1)).toBe('geldar.phase0.ctl.body.restart');
    expect(fake.payloads.at(-1)).toMatchObject({
      op: 'restart',
      ownerId: 'alice',
      playerName: 'Ranger',
    });
  });

  it('a running reply to status is 200 state running, and only state is returned', async () => {
    next = 'running';
    const r = await h.call('GET', STATUS, bearer(KEY_ALL));
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ state: 'running' });
    expect(fake.payloads.at(-1)).toMatchObject({ ownerId: 'alice', playerName: 'Ranger' });
  });

  it('an idle reply to status is 200 state stopped', async () => {
    next = 'idle';
    const r = await h.call('GET', STATUS, bearer(KEY_ALL));
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ state: 'stopped' });
  });
});

describe('body unreachable, abort and in-flight slot', () => {
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

  it('a timed-out stop is 503, and the retry of the same stop is 202', async () => {
    mode = 'timeout';
    const first = await h.call('POST', STOP, bearer(KEY_ALL));
    expect(first.status).toBe(503);
    expect(JSON.parse(first.body).code).toBe('body_unavailable');
    mode = 'ok';
    const retry = await h.call('POST', STOP, bearer(KEY_ALL));
    expect(retry.status).toBe(202);
  });

  it('a second request while the first is pending is 409 conflict with no supervisor call', async () => {
    let release: () => void = () => {};
    gate = new Promise<void>((ok) => {
      release = ok;
    });
    const first = h.call('POST', RESTART, bearer(KEY_ALL));
    await new Promise((ok) => setTimeout(ok, 50));
    const calls = fake.subjects.length;
    const second = await h.call('POST', STOP, bearer(KEY_ALL));
    expect(second.status).toBe(409);
    expect(JSON.parse(second.body).code).toBe('conflict');
    expect(fake.subjects.length).toBe(calls);
    release();
    gate = null;
    expect((await first).status).toBe(202);
    expect((await h.call('POST', START, bearer(KEY_ALL))).status).toBe(202);
  });
});

describe('body scope (write needs body, read needs read)', () => {
  const fake = fakeConn(() => reply('started', true));
  const h = harness(fake.conn);
  beforeAll(() => h.start());
  afterAll(() => h.stop());

  it.each([START, STOP, RESTART])(
    'a read-only key is 403 scope_missing on %s with no supervisor call',
    async (path) => {
      const before = fake.subjects.length;
      const r = await h.call('POST', path, bearer(KEY_READ));
      expect(r.status).toBe(403);
      expect(JSON.parse(r.body).code).toBe('scope_missing');
      expect(fake.subjects.length).toBe(before);
    },
  );
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

  it('a start 1 ms before the window closes is still refused, and the start at the edge is accepted', async () => {
    const edge = harness(fakeConn(() => reply('started', true)).conn);
    await edge.start();
    try {
      for (let i = 0; i < START_WINDOW_MAX; i++) {
        expect((await edge.call('POST', START, bearer(KEY_ALL))).status).toBe(202);
      }
      edge.clock.now = NOW + START_WINDOW_MS - 1;
      const early = await edge.call('POST', START, bearer(KEY_ALL));
      expect(early.status).toBe(429);
      expect(early.retryAfter).toBe('1');
      edge.clock.now = NOW + START_WINDOW_MS;
      expect((await edge.call('POST', START, bearer(KEY_ALL))).status).toBe(202);
    } finally {
      await edge.stop();
    }
  });

  it('after the window, five new starts are accepted and the sixth is refused again', async () => {
    const again = harness(fakeConn(() => reply('started', true)).conn);
    await again.start();
    try {
      for (let i = 0; i < START_WINDOW_MAX; i++) {
        expect((await again.call('POST', START, bearer(KEY_ALL))).status).toBe(202);
      }
      again.clock.now = NOW + START_WINDOW_MS;
      for (let i = 0; i < START_WINDOW_MAX; i++) {
        expect((await again.call('POST', START, bearer(KEY_ALL))).status).toBe(202);
      }
      const r = await again.call('POST', START, bearer(KEY_ALL));
      expect(r.status).toBe(429);
      expect(r.retryAfter).toBe('60');
    } finally {
      await again.stop();
    }
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
    expect(fake.payloads.at(-1)).toMatchObject({ ownerId: 'alice', playerName: 'Ranger' });
  });

  it('a read needs scope read: a body-only key is refused on the log', async () => {
    const r = await h.call('GET', LOG, bearer(KEY_BODY));
    expect(r.status).toBe(403);
    expect(JSON.parse(r.body).code).toBe('scope_missing');
  });
});

describe('body log tail limit (newest events, at most 200)', () => {
  const events = Array.from({ length: 250 }, (_, i) => ({
    at: new Date(NOW - (250 - i) * 1000).toISOString(),
    code: 'started',
  }));
  const fake = fakeConn(() => reply('logs', true, events));
  const h = harness(fake.conn);
  beforeAll(() => h.start());
  afterAll(() => h.stop());

  it('with no limit, 250 events return the newest 200', async () => {
    const r = await h.call('GET', LOG, bearer(KEY_ALL));
    expect(r.status).toBe(200);
    const lines = JSON.parse(r.body).lines as { at: string }[];
    expect(lines.length).toBe(200);
    expect(lines[0]?.at).toBe(events[50]?.at);
    expect(lines[199]?.at).toBe(events[249]?.at);
  });

  it('limit=5 returns the newest 5 events', async () => {
    const r = await h.call('GET', `${LOG}?limit=5`, bearer(KEY_ALL));
    expect(r.status).toBe(200);
    const lines = JSON.parse(r.body).lines as { at: string }[];
    expect(lines.length).toBe(5);
    expect(lines[0]?.at).toBe(events[245]?.at);
    expect(lines[4]?.at).toBe(events[249]?.at);
  });

  it('limit=200 is accepted', async () => {
    expect((await h.call('GET', `${LOG}?limit=200`, bearer(KEY_ALL))).status).toBe(200);
  });

  it.each(['0', '', '1e2', '-1'])('limit=%s is 422 with no supervisor call', async (raw) => {
    const before = fake.subjects.length;
    const r = await h.call('GET', `${LOG}?limit=${raw}`, bearer(KEY_ALL));
    expect(r.status).toBe(422);
    expect(fake.subjects.length).toBe(before);
  });
});
