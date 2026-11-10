import { type RequestOptions, request } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { McpConfig } from '../config.ts';
import { FakeTokenStore } from '../fakes/stores.fakes.ts';
import type { PlayerRecord, RateDecision, RateLimiter } from '../ports.ts';
import { tokenDigest } from './auth.ts';
import type { FrontDoor } from './front.ts';
import { createFrontDoor } from './front.ts';

const PEPPER = new TextEncoder().encode('handshake-owner-pepper-0123456789abcd');
const TOKEN_A = 'token-for-player-aa-0123456789';

const CONFIG = {
  bind: '127.0.0.1',
  port: 0,
  allowedHosts: ['localhost', '127.0.0.1'],
  publicHost: null,
} as McpConfig['http'];

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

function resourceRead(id: number): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'resources/read',
    params: { uri: 'geldar://none' },
  });
}

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

function makeServer(): McpServer {
  const mcp = new McpServer(
    { name: 'handshake-owner-test', version: '0.0.0' },
    {
      capabilities: { tools: {} },
    },
  );
  mcp.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [{ name: 'ping', inputSchema: { type: 'object' as const } }],
  }));
  mcp.server.setRequestHandler(CallToolRequestSchema, () => ({
    content: [{ type: 'text' as const, text: 'ok' }],
  }));
  return mcp;
}

/** Records every take in order. A bucket in `empty` refuses; every other bucket has room. */
class SwitchLimiter implements RateLimiter {
  readonly taken: string[] = [];
  readonly empty = new Set<string>();

  take(bucket: string): RateDecision {
    this.taken.push(bucket);
    return this.peek(bucket);
  }

  peek(bucket: string): RateDecision {
    return this.empty.has(bucket)
      ? { allowed: false, retryAfterMs: 1500 }
      : { allowed: true, retryAfterMs: 0 };
  }
}

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
}

function options(
  port: number,
  method: string,
  headers: Record<string, string>,
  hasBody: boolean,
): RequestOptions {
  return {
    host: '127.0.0.1',
    port,
    path: '/p/aa',
    method,
    headers: {
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${TOKEN_A}`,
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
  };
}

/** Sends and waits for the whole reply. */
function send(method: string, body: string | undefined, headers: Record<string, string> = {}) {
  return new Promise<Reply>((resolve, reject) => {
    const req = request(options(port, method, headers, body !== undefined), (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

/** Resolves on the status line and drops the connection, for a GET that opens an event stream. */
function probe(method: string, headers: Record<string, string>) {
  return new Promise<Reply>((resolve, reject) => {
    const req = request(options(port, method, headers, false), (res) => {
      resolve({ status: res.statusCode ?? 0, headers: res.headers });
      res.resume();
      req.destroy();
    });
    req.on('error', (error) => reject(error));
    req.end();
  });
}

async function openSession(): Promise<string> {
  const reply = await send('POST', INIT);
  const id = reply.headers['mcp-session-id'];
  if (typeof id !== 'string') throw new Error('initialize returned no session id');
  return id;
}

let door: FrontDoor;
let port: number;
let limiter: SwitchLimiter;

beforeEach(async () => {
  const store = new FakeTokenStore();
  store.add({
    tokenId: 'tok-a',
    tokenHash: tokenDigest(PEPPER, TOKEN_A),
    player: player('aa'),
    expiresAtMs: Number.POSITIVE_INFINITY,
    revoked: false,
  });
  limiter = new SwitchLimiter();
  door = createFrontDoor({
    http: CONFIG,
    pepper: PEPPER,
    store,
    limiter,
    createSession: () => makeServer(),
    log: () => undefined,
  });
  port = await door.listen(0);
});

afterEach(async () => {
  await door.close();
});

describe('front door: owner bucket for non-call methods', () => {
  it('refuses resources/read with 429 when the owner bucket is empty, though the handshake has room', async () => {
    const session = await openSession();
    limiter.empty.add('owner:owner-1');

    const refused = await send('POST', resourceRead(2), { 'mcp-session-id': session });

    expect(refused.status).toBe(429);
    expect(refused.headers['retry-after']).toBeDefined();
    expect(limiter.taken.slice(-2)).toEqual(['handshake:aa', 'owner:owner-1']);
  });
});

describe('front door: GET and DELETE on the handshake bucket', () => {
  it('takes one handshake token for a GET', async () => {
    const session = await openSession();
    const before = limiter.taken.length;

    const reply = await probe('GET', { 'mcp-session-id': session });

    expect(reply.status).not.toBe(429);
    expect(limiter.taken.slice(before)).toEqual(['handshake:aa']);
  });

  it('takes one handshake token for a DELETE', async () => {
    const session = await openSession();
    const before = limiter.taken.length;

    const reply = await send('DELETE', undefined, { 'mcp-session-id': session });

    expect(reply.status).not.toBe(429);
    expect(limiter.taken.slice(before)).toEqual(['handshake:aa']);
  });

  it('refuses a GET with 429 when the handshake bucket is empty', async () => {
    const session = await openSession();
    limiter.empty.add('handshake:aa');

    const refused = await probe('GET', { 'mcp-session-id': session });

    expect(refused.status).toBe(429);
    expect(refused.headers['retry-after']).toBeDefined();
  });
});
