import { request } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { McpConfig } from '../config.ts';
import { FakeTokenStore } from '../fakes/stores.fakes.ts';
import { bucketRules, tokenBucketLimiter } from '../main.ts';
import type { PlayerRecord } from '../ports.ts';
import { tokenDigest } from './auth.ts';
import type { FrontDoor } from './front.ts';
import { createFrontDoor } from './front.ts';

// The handshake bucket is small here so the test can reach its cap; the call rate stays the owner's 60.
const HANDSHAKE_PER_MINUTE = 3;
const CALLS_PER_MINUTE = 60;
const PEPPER = new TextEncoder().encode('handshake-test-pepper-0123456789ab');
const TOKEN_A = 'token-for-player-aa-0123456789';
const TOKEN_B = 'token-for-player-bb-0123456789';
const NOW = 1_700_000_000_000;

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

function call(id: number): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name: 'ping', arguments: {} },
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
    { name: 'handshake-test', version: '0.0.0' },
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

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
}

function send(
  port: number,
  body: string,
  headers: Record<string, string> = {},
  token = TOKEN_A,
  path = '/p/aa',
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: {
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...headers,
        },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers }));
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

let door: FrontDoor;
let port: number;
let taken: string[];

beforeEach(async () => {
  const store = new FakeTokenStore();
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
  // The real token buckets with the real rules, on a clock that never moves, so nothing refills.
  const rules = bucketRules({
    callsPerMinute: CALLS_PER_MINUTE,
    ownerCallsPerMinute: 600,
    failedAuthPerMinute: 30,
    actMinSeconds: 0,
    sayMinSeconds: 0,
    journalMinSeconds: 5,
    handshakePerMinute: HANDSHAKE_PER_MINUTE,
  });
  taken = [];
  const limiter = tokenBucketLimiter(rules);
  door = createFrontDoor({
    http: CONFIG,
    pepper: PEPPER,
    store,
    limiter: {
      take(bucket, nowMs) {
        taken.push(bucket);
        return limiter.take(bucket, nowMs);
      },
      peek(bucket, nowMs) {
        return limiter.peek(bucket, nowMs);
      },
    },
    createSession: () => makeServer(),
    log: () => undefined,
    now: () => NOW,
  });
  port = await door.listen(0);
});

afterEach(async () => {
  await door.close();
});

async function openSession(token = TOKEN_A): Promise<string> {
  const reply = await send(port, INIT, {}, token);
  const id = reply.headers['mcp-session-id'];
  if (typeof id !== 'string') throw new Error(`no session id, status ${reply.status}`);
  return id;
}

describe('the handshake bucket', () => {
  it('takes initialize and resources/read from the handshake bucket until it is empty', async () => {
    const session = await openSession();
    expect(taken).toEqual(['handshake:aa']);

    const second = await send(port, resourceRead(2), { 'mcp-session-id': session });
    const third = await send(port, resourceRead(3), { 'mcp-session-id': session });
    expect(second.status).not.toBe(429);
    expect(third.status).not.toBe(429);
    const handshakes = taken.filter((bucket) => bucket.startsWith('handshake:'));
    expect(handshakes).toEqual(['handshake:aa', 'handshake:aa', 'handshake:aa']);

    const fourth = await send(port, resourceRead(4), { 'mcp-session-id': session });
    expect(fourth.status).toBe(429);
    expect(fourth.headers['retry-after']).toBeDefined();
  });

  it('does not take a tool call from the handshake bucket', async () => {
    const session = await openSession();
    for (let id = 2; id < 2 + HANDSHAKE_PER_MINUTE - 1; id++) {
      await send(port, resourceRead(id), { 'mcp-session-id': session });
    }
    const exhausted = await send(port, resourceRead(99), { 'mcp-session-id': session });
    expect(exhausted.status).toBe(429);

    const answered = await send(port, call(100), { 'mcp-session-id': session });
    expect(answered.status).not.toBe(429);
    expect(taken).toContain('player:aa');
  });

  it('keeps one handshake bucket per player', async () => {
    await openSession();
    await openSession();
    await openSession();
    expect((await send(port, INIT, {}, TOKEN_A)).status).toBe(429);

    const other = await send(port, INIT, {}, TOKEN_B, '/p/bb');
    expect(other.status).not.toBe(429);
    // Handshake traffic takes only its own handshake token, so that token is the last one taken.
    expect(taken.at(-1)).toBe('handshake:bb');
  });
});

describe('bucketRules for the handshake bucket', () => {
  it('gives the handshake bucket its own capacity, not the call rate', () => {
    const rule = bucketRules({
      callsPerMinute: 60,
      ownerCallsPerMinute: 600,
      failedAuthPerMinute: 30,
      actMinSeconds: 0,
      sayMinSeconds: 0,
      journalMinSeconds: 5,
      handshakePerMinute: 300,
    });
    expect(rule('handshake:aa')).toEqual({ capacity: 300, perMinute: 300 });
    expect(rule('player:aa')).toEqual({ capacity: 60, perMinute: 60 });
  });
});
