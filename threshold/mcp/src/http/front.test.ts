import { request } from 'node:http';
import { connect } from 'node:net';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { McpConfig } from '../config.ts';
import { FakeTokenStore } from '../fakes/stores.fakes.ts';
import type { PlayerRecord, RateDecision, RateLimiter } from '../ports.ts';
import { tokenDigest } from './auth.ts';
import type { FrontDoor, FrontDoorOptions } from './front.ts';
import { createFrontDoor } from './front.ts';
import { frontLog } from './log.ts';

// The owner's numbers from phase0.yaml (rate_limits) and the code constants.
const CALLS_PER_MINUTE = 60;
const OWNER_CALLS_PER_MINUTE = 600;
const FAILED_AUTH_PER_MINUTE = 30;
const MAX_OPEN_PER_PLAYER = 4;
const BODY_LIMIT = 64 * 1024;

const PEPPER = new TextEncoder().encode('front-door-test-pepper-0123456789');
const TOKEN_A = 'token-for-player-aa-0123456789';
const TOKEN_B = 'token-for-player-bb-0123456789';
// A canary the log scan must never find, in whole or in any prefix of 12 characters or more.
const CANARY = 'canary-7Qz9xLm2Vb4nKp8sWd1';

const CONFIG = {
  bind: '127.0.0.1',
  port: 0,
  allowedHosts: ['localhost', '127.0.0.1'],
  publicHost: null,
} as McpConfig['http'];

function player(playerId: string): PlayerRecord {
  return {
    playerId,
    lifeId: `${playerId}_life`,
    ownerId: 'owner-1',
    displayName: playerId.toUpperCase(),
    harness: 'test',
    status: 'active',
  };
}

/** Allows a call while the bucket is under its cap; the cap comes from the bucket name. */
class CapLimiter implements RateLimiter {
  private readonly used = new Map<string, number>();
  private readonly cap: (bucket: string) => number;

  constructor(cap: (bucket: string) => number) {
    this.cap = cap;
  }

  take(bucket: string): RateDecision {
    const used = this.used.get(bucket) ?? 0;
    if (used >= this.cap(bucket)) return { allowed: false, retryAfterMs: 1500 };
    this.used.set(bucket, used + 1);
    return { allowed: true, retryAfterMs: 0 };
  }

  peek(bucket: string): RateDecision {
    const used = this.used.get(bucket) ?? 0;
    return used >= this.cap(bucket)
      ? { allowed: false, retryAfterMs: 1500 }
      : { allowed: true, retryAfterMs: 0 };
  }
}

function defaultCap(bucket: string): number {
  if (bucket.startsWith('auth-failed:address:')) return FAILED_AUTH_PER_MINUTE;
  if (bucket.startsWith('auth-failed:global')) return 300;
  if (bucket.startsWith('owner:')) return OWNER_CALLS_PER_MINUTE;
  return CALLS_PER_MINUTE;
}

/** A server with `ping` (returns at once) and `wait` (returns only when the session ends). */
function makeServer(): McpServer {
  const mcp = new McpServer(
    { name: 'front-test', version: '0.0.0' },
    { capabilities: { tools: {} } },
  );
  mcp.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [
      { name: 'ping', inputSchema: { type: 'object' as const } },
      { name: 'wait', inputSchema: { type: 'object' as const } },
      { name: 'slow', inputSchema: { type: 'object' as const } },
    ],
  }));
  mcp.server.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (req.params.name === 'wait') {
      // Never answers: the revocation (or close) ends the request, so no reply is written after that.
      await new Promise<never>(() => undefined);
    }
    if (req.params.name === 'slow') {
      // Answers only after a held response, longer than the request timeouts the tests use.
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    return { content: [{ type: 'text' as const, text: 'ok' }] };
  });
  return mcp;
}

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  text: string;
}

interface Sent {
  method?: string;
  headers?: Record<string, string | undefined>;
  body?: string;
}

let door: FrontDoor;
let port: number;
let store: FakeTokenStore;
let logs: Record<string, string | number>[];
let limiter: RateLimiter;

/** Drops a header set to undefined, so a test can omit one of the defaults. */
function withoutUndefined(headers: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([, v]) => v !== undefined)) as Record<
    string,
    string
  >;
}

/** A raw HTTP request, so the test controls Host and Origin exactly. */
function send(path: string, sent: Sent = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: sent.method ?? 'POST',
        headers: withoutUndefined({
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${TOKEN_A}`,
          ...sent.headers,
        }),
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          text += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text }));
        res.on('error', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text }));
      },
    );
    req.on('error', reject);
    req.end(sent.body);
  });
}

const INIT = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 't', version: '0' },
  },
});

function call(name: string, id = 2): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name, arguments: {} },
  });
}

async function openSession(path = '/p/aa', token = TOKEN_A): Promise<string> {
  const reply = await send(path, { body: INIT, headers: { Authorization: `Bearer ${token}` } });
  const id = reply.headers['mcp-session-id'];
  if (typeof id !== 'string') throw new Error(`no session id, status ${reply.status}`);
  return id;
}

beforeEach(async () => {
  store = new FakeTokenStore();
  store.add({
    tokenId: 'tok-a',
    tokenHash: tokenDigest(PEPPER, TOKEN_A),
    player: player('aa'),
    expiresAtMs: Number.POSITIVE_INFINITY,
    revoked: false,
  });
  store.add({
    tokenId: 'tok-b',
    tokenHash: tokenDigest(PEPPER, TOKEN_B),
    player: player('bb'),
    expiresAtMs: Number.POSITIVE_INFINITY,
    revoked: false,
  });
  logs = [];
  limiter = new CapLimiter(defaultCap);
  door = createFrontDoor({
    http: CONFIG,
    pepper: PEPPER,
    store,
    limiter,
    createSession: () => makeServer(),
    log: (line) => logs.push(line),
  });
  port = await door.listen(0);
});

afterEach(async () => {
  await door.close();
});

describe('bearer authentication', () => {
  const expired = 'token-expired-aa-0123456789';
  it.each([
    ['no Authorization header', { Authorization: undefined }, `/p/aa`, 401],
    ['another scheme', { Authorization: `Basic ${TOKEN_A}` }, '/p/aa', 401],
    ['lowercase scheme', { Authorization: `bearer ${TOKEN_A}` }, '/p/aa', 401],
    ['double space after the scheme', { Authorization: `Bearer  ${TOKEN_A}` }, '/p/aa', 401],
    ['an unknown token', { Authorization: 'Bearer unknown-token-0123456789xyz' }, '/p/aa', 401],
    [
      'a token only in the query string',
      { Authorization: undefined },
      `/p/aa?token=${TOKEN_A}`,
      401,
    ],
    ['a token for another player', { Authorization: `Bearer ${TOKEN_A}` }, '/p/bb', 403],
    ['a token for an unknown player', { Authorization: `Bearer ${TOKEN_A}` }, '/p/cc', 403],
    [
      'an unknown player with an unknown token',
      { Authorization: `Bearer ${expired}` },
      '/p/cc',
      401,
    ],
  ])('refuses %s', async (_name, headers, path, status) => {
    const reply = await send(path, { body: INIT, headers });
    expect(reply.status).toBe(status);
  });

  it('refuses a revoked token', async () => {
    store.revoke('tok-b');
    const reply = await send('/p/bb', {
      body: INIT,
      headers: { Authorization: `Bearer ${TOKEN_B}` },
    });
    expect(reply.status).toBe(401);
  });

  it('refuses an expired token', async () => {
    store.add({
      tokenId: 'tok-expired',
      tokenHash: tokenDigest(PEPPER, expired),
      player: player('aa'),
      expiresAtMs: 0,
      revoked: false,
    });
    const reply = await send('/p/aa', {
      body: INIT,
      headers: { Authorization: `Bearer ${expired}` },
    });
    expect(reply.status).toBe(401);
  });

  it('accepts a valid token and answers initialize with a session', async () => {
    const reply = await send('/p/aa', { body: INIT });
    expect(reply.status).toBe(200);
    expect(typeof reply.headers['mcp-session-id']).toBe('string');
  });
});

describe('Origin and Host', () => {
  it.each(['https://evil.example', 'http://localhost:3000'])(
    'refuses Origin %s',
    async (origin) => {
      const reply = await send('/p/aa', { body: INIT, headers: { Origin: origin } });
      expect(reply.status).toBe(403);
    },
  );

  it.each(['evil.example', 'localhost:9999', '127.0.0.1:1'])('refuses Host %s', async (host) => {
    const reply = await send('/p/aa', { body: INIT, headers: { host } });
    expect(reply.status).toBe(403);
  });

  it('accepts an allowed host with the bound port', async () => {
    const reply = await send('/p/aa', { body: INIT, headers: { host: `localhost:${port}` } });
    expect(reply.status).toBe(200);
  });
});

describe('body and batch limits', () => {
  it('refuses a body one byte over 64 KiB with 413', async () => {
    const head = '{"jsonrpc":"2.0","id":1,"method":"ping","params":{"pad":"';
    const tail = '"}}';
    const pad = 'a'.repeat(BODY_LIMIT + 1 - head.length - tail.length);
    const reply = await send('/p/aa', { body: `${head}${pad}${tail}` });
    expect(reply.status).toBe(413);
  });

  it('accepts a body of exactly 64 KiB', async () => {
    const head = '{"jsonrpc":"2.0","id":1,"method":"ping","params":{"pad":"';
    const tail = '"}}';
    const pad = 'a'.repeat(BODY_LIMIT - head.length - tail.length);
    const reply = await send('/p/aa', { body: `${head}${pad}${tail}` });
    expect(reply.status).not.toBe(413);
  });

  it('refuses a batch array with 400', async () => {
    const sid = await openSession();
    const batch = JSON.stringify([JSON.parse(call('ping'))]);
    const reply = await send('/p/aa', { body: batch, headers: { 'mcp-session-id': sid } });
    expect(reply.status).toBe(400);
    expect(reply.text).toContain('batch_not_allowed');
  });
});

describe('scoping and limits', () => {
  it('will not let a session of one player serve another', async () => {
    const sid = await openSession('/p/aa', TOKEN_A);
    await openSession('/p/bb', TOKEN_B);
    const reply = await send('/p/bb', {
      body: call('ping'),
      headers: { 'mcp-session-id': sid, Authorization: `Bearer ${TOKEN_B}` },
    });
    expect(reply.status).toBe(404);
  });

  it('allows the 60th call a minute per player and refuses the 61st', async () => {
    const sid = await openSession();
    const statuses: number[] = [];
    for (let i = 0; i < CALLS_PER_MINUTE + 1; i += 1) {
      const reply = await send('/p/aa', {
        body: call('ping', i + 2),
        headers: { 'mcp-session-id': sid },
      });
      statuses.push(reply.status);
    }
    expect(statuses[CALLS_PER_MINUTE - 1]).toBe(200);
    expect(statuses[CALLS_PER_MINUTE]).toBe(429);
  });

  it('shares the owner budget across players and refuses past it', async () => {
    // Each openSession's initialize also draws on the owner, so two sessions leave three for the calls.
    limiter = new CapLimiter((bucket) => (bucket.startsWith('owner:') ? 5 : 1000));
    await door.close();
    door = createFrontDoor({
      http: CONFIG,
      pepper: PEPPER,
      store,
      limiter,
      createSession: () => makeServer(),
      log: (line) => logs.push(line),
    });
    port = await door.listen(0);
    const sidA = await openSession('/p/aa', TOKEN_A);
    const sidB = await openSession('/p/bb', TOKEN_B);
    const first = await send('/p/aa', {
      body: call('ping', 2),
      headers: { 'mcp-session-id': sidA },
    });
    const second = await send('/p/bb', {
      body: call('ping', 2),
      headers: { 'mcp-session-id': sidB, Authorization: `Bearer ${TOKEN_B}` },
    });
    const third = await send('/p/aa', {
      body: call('ping', 3),
      headers: { 'mcp-session-id': sidA },
    });
    const fourth = await send('/p/bb', {
      body: call('ping', 3),
      headers: { 'mcp-session-id': sidB, Authorization: `Bearer ${TOKEN_B}` },
    });
    expect([first.status, second.status, third.status]).toEqual([200, 200, 200]);
    expect(fourth.status).toBe(429);
    expect(Number(fourth.headers['retry-after'])).toBeGreaterThanOrEqual(1);
  });

  it('refuses the failed attempt past the 30 a minute per address', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < FAILED_AUTH_PER_MINUTE + 1; i += 1) {
      const reply = await send('/p/aa', {
        body: INIT,
        headers: { Authorization: 'Bearer wrong-token-0123456789wrong' },
      });
      statuses.push(reply.status);
    }
    expect(statuses[FAILED_AUTH_PER_MINUTE - 1]).toBe(401);
    expect(statuses[FAILED_AUTH_PER_MINUTE]).toBe(429);
  });

  it('answers 429 from the address bucket without a token lookup once it is empty', async () => {
    const lookup = store.resolve.bind(store);
    let lookups = 0;
    store.resolve = async (hash, nowMs) => {
      lookups += 1;
      return lookup(hash, nowMs);
    };
    const wrong = { body: INIT, headers: { Authorization: 'Bearer wrong-token-0123456789wrong' } };
    for (let i = 0; i < FAILED_AUTH_PER_MINUTE; i += 1) await send('/p/aa', wrong);
    expect(lookups).toBe(FAILED_AUTH_PER_MINUTE);
    const reply = await send('/p/aa', wrong);
    expect(reply.status).toBe(429);
    expect(lookups).toBe(FAILED_AUTH_PER_MINUTE);
  });

  it('holds at most 4 open requests per player and refuses the 5th', async () => {
    const sid = await openSession();
    const open = Array.from({ length: MAX_OPEN_PER_PLAYER }, (_, i) =>
      send('/p/aa', { body: call('wait', i + 10), headers: { 'mcp-session-id': sid } }),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    const fifth = await send('/p/aa', {
      body: call('ping', 99),
      headers: { 'mcp-session-id': sid },
    });
    expect(fifth.status).toBe(429);
    expect(fifth.text).toContain('too_many_open_requests');
    store.revoke('tok-a');
    await Promise.all(open);
  });
});

describe('connection limits', () => {
  /** Replaces the door of the test with one built with these limits. */
  async function restart(limits: NonNullable<FrontDoorOptions['limits']>): Promise<void> {
    await door.close();
    door = createFrontDoor({
      http: CONFIG,
      pepper: PEPPER,
      store,
      limiter,
      createSession: () => makeServer(),
      log: (line) => logs.push(line),
      limits,
    });
    port = await door.listen(0);
  }

  it('cuts a POST whose body stalls past the request timeout', async () => {
    await restart({ requestTimeoutMs: 300 });
    const req = request({
      host: '127.0.0.1',
      port,
      path: '/p/aa',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN_A}`,
        'Content-Type': 'application/json',
        'Content-Length': '100',
      },
    });
    req.on('error', () => undefined);
    req.write('{');
    const outcome = await new Promise<string>((resolve) => {
      const timer = setTimeout(() => resolve('still open'), 3000);
      req.on('close', () => {
        clearTimeout(timer);
        resolve('closed');
      });
      req.on('response', (res) => res.resume());
    });
    expect(outcome).toBe('closed');
  });

  it('delivers a response held longer than the request timeout', async () => {
    await restart({ requestTimeoutMs: 200 });
    const id = await openSession();
    const reply = await send('/p/aa', { body: call('slow', 3), headers: { 'mcp-session-id': id } });
    expect(reply.status).toBe(200);
    expect(reply.text).toContain('ok');
  });

  it('lets one address hold no more than its default cap of 32 connections', async () => {
    const held = Array.from({ length: 32 }, () => connect({ host: '127.0.0.1', port }));
    await Promise.all(held.map((s) => new Promise((resolve) => s.once('connect', resolve))));
    const extra = connect({ host: '127.0.0.1', port });
    const closed = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 2000);
      extra.once('close', () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
    for (const s of [...held, extra]) s.destroy();
    expect(closed).toBe(true);
  });

  it('closes the socket after a refused bearer', async () => {
    const reply = await send('/p/aa', {
      body: INIT,
      headers: { Authorization: 'Bearer wrong-token' },
    });
    expect(reply.status).toBe(401);
    expect(reply.headers.connection).toBe('close');
  });
});

describe('revocation', () => {
  it('ends the open requests with session_revoked within a second', async () => {
    const sid = await openSession();
    const open = send('/p/aa', { body: call('wait', 5), headers: { 'mcp-session-id': sid } });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const started = Date.now();
    store.revoke('tok-a');
    const reply = await Promise.race([
      open,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('still open')), 1000)),
    ]);
    expect(Date.now() - started).toBeLessThan(1000);
    // The reply may be an open event stream (200) or a plain 401; the body names the reason.
    expect(reply.text).toContain('session_revoked');
  });

  it('refuses the old session after revocation', async () => {
    const sid = await openSession();
    store.revoke('tok-a');
    await new Promise((resolve) => setTimeout(resolve, 50));
    const reply = await send('/p/aa', {
      body: call('ping', 4),
      headers: { 'mcp-session-id': sid },
    });
    expect(reply.status).toBe(401);
  });
});

describe('log lines', () => {
  it('never carry a token or a prefix of one', async () => {
    await send('/p/aa', { body: INIT, headers: { Authorization: `Bearer ${CANARY}` } });
    await send(`/p/aa?token=${CANARY}`, { body: INIT, headers: { Authorization: undefined } });
    await send('/p/aa', {
      body: `{"jsonrpc":"2.0","id":1,"method":"${CANARY}"}`,
      headers: { Authorization: `Bearer ${CANARY}` },
    });
    await send(`/p/aa`, {
      body: INIT,
      headers: { Authorization: `Bearer ${TOKEN_A}`, Origin: `https://${CANARY}.example` },
    });
    await send('/p/aa', { body: INIT, headers: { host: `${CANARY}.example` } });
    await send('/p/aa', { body: INIT });
    expect(logs.length).toBeGreaterThan(0);
    const text = JSON.stringify(logs);
    for (let length = 12; length <= CANARY.length; length += 1) {
      expect(text).not.toContain(CANARY.slice(0, length));
    }
    for (const token of [TOKEN_A, TOKEN_B]) {
      expect(text).not.toContain(token.slice(0, 12));
    }
  });
});

describe('log redaction', () => {
  it('keeps only the safe fields and reduces an error to its class', () => {
    const out: Record<string, string | number>[] = [];
    const log = frontLog((line) => out.push(line));
    log({
      event: 'unauthorized',
      player_id: 'aa',
      status: 401,
      authorization: `Bearer ${CANARY}`,
      body: CANARY,
      headers: { Authorization: `Bearer ${CANARY}` },
      error: `TypeError: ${CANARY}`,
    });
    expect(out).toEqual([
      { event: 'unauthorized', player_id: 'aa', status: 401, error: 'TypeError' },
    ]);
    expect(JSON.stringify(out)).not.toContain(CANARY.slice(0, 12));
  });
});
