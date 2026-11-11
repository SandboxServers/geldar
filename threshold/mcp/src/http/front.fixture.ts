import { request } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { McpConfig } from '../config.ts';
import { FakeTokenStore } from '../fakes/stores.fakes.ts';
import type { PlayerRecord, RateDecision, RateLimiter } from '../ports.ts';
import { tokenDigest } from './auth.ts';
import type { FrontDoor, FrontDoorOptions } from './front.ts';
import { createFrontDoor } from './front.ts';

// Shared by the front door test files: each file builds its own rig in beforeEach.

// The owner's numbers from phase0.yaml (rate_limits) and the code constants.
export const CALLS_PER_MINUTE = 60;
const OWNER_CALLS_PER_MINUTE = 600;
export const FAILED_AUTH_PER_MINUTE = 30;
export const MAX_OPEN_PER_PLAYER = 4;
export const BODY_LIMIT = 64 * 1024;

export const PEPPER = new TextEncoder().encode('front-door-test-pepper-0123456789');
export const TOKEN_A = 'gmcp-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
export const TOKEN_B = 'gmcp-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
// A canary the log scan must never find, in whole or in any prefix of 12 characters or more.
export const CANARY = 'canary-7Qz9xLm2Vb4nKp8sWd1';

export const CONFIG = {
  bind: '127.0.0.1',
  port: 0,
  allowedHosts: ['localhost', '127.0.0.1'],
  publicHost: null,
} as McpConfig['http'];

export function player(playerId: string): PlayerRecord {
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
export class CapLimiter implements RateLimiter {
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

export interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  text: string;
}

export interface Sent {
  method?: string;
  headers?: Record<string, string | undefined>;
  body?: string;
}

/** Drops a header set to undefined, so a test can omit one of the defaults. */
function withoutUndefined(headers: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([, v]) => v !== undefined)) as Record<
    string,
    string
  >;
}

export const INIT = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 't', version: '0' },
  },
});

export function call(name: string, id = 2): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name, arguments: {} },
  });
}

/** The state of one test: a token store with two players, a log sink, a limiter and a listening door. */
export class FrontRig {
  store = new FakeTokenStore();
  logs: Record<string, string | number>[] = [];
  limiter: RateLimiter = new CapLimiter(defaultCap);
  port = 0;
  private door: FrontDoor | undefined;

  /** Builds the door from the rig's stores and listens on a free port; `options` adds to the defaults. */
  async listen(options: Partial<FrontDoorOptions> = {}): Promise<void> {
    this.door = createFrontDoor({
      http: CONFIG,
      pepper: PEPPER,
      store: this.store,
      limiter: this.limiter,
      createSession: () => makeServer(),
      log: (line) => this.logs.push(line),
      ...options,
    });
    this.port = await this.door.listen(0);
  }

  /** Replaces the door with one built again from the rig's current stores and limiter. */
  async restart(options: Partial<FrontDoorOptions> = {}): Promise<void> {
    await this.door?.close();
    await this.listen(options);
  }

  async close(): Promise<void> {
    await this.door?.close();
  }

  /** A raw HTTP request, so the test controls Host and Origin exactly. */
  send(path: string, sent: Sent = {}): Promise<Reply> {
    const port = this.port;
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
          res.on('error', () =>
            resolve({ status: res.statusCode ?? 0, headers: res.headers, text }),
          );
        },
      );
      req.on('error', reject);
      req.end(sent.body);
    });
  }

  async openSession(path = '/p/aa', token = TOKEN_A): Promise<string> {
    const reply = await this.send(path, {
      body: INIT,
      headers: { Authorization: `Bearer ${token}` },
    });
    const id = reply.headers['mcp-session-id'];
    if (typeof id !== 'string') throw new Error(`no session id, status ${reply.status}`);
    return id;
  }
}

/** A rig with tokens for player aa (TOKEN_A) and player bb (TOKEN_B), listening on a free port. */
export async function startFrontRig(): Promise<FrontRig> {
  const rig = new FrontRig();
  rig.store.add({
    tokenId: 'tok-a',
    tokenHash: tokenDigest(PEPPER, TOKEN_A),
    player: player('aa'),
    expiresAtMs: Number.POSITIVE_INFINITY,
    revoked: false,
  });
  rig.store.add({
    tokenId: 'tok-b',
    tokenHash: tokenDigest(PEPPER, TOKEN_B),
    player: player('bb'),
    expiresAtMs: Number.POSITIVE_INFINITY,
    revoked: false,
  });
  await rig.listen();
  return rig;
}
