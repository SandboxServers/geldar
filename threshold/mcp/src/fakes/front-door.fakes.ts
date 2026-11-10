import { request } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpConfig } from '../config.ts';
import { tokenDigest } from '../http/auth.ts';
import type { FrontDoor, FrontDoorOptions } from '../http/front.ts';
import { createFrontDoor } from '../http/front.ts';
import type { PlayerRecord, RateDecision, RateLimiter, ResolvedToken } from '../ports.ts';
import { FakeTokenStore } from './stores.fakes.ts';

export const PEPPER = new TextEncoder().encode('front-door-test-pepper-0123456789');
export const TOKEN_A = 'token-for-player-aa-0123456789';
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

/** Only the failed-auth bucket of an address is capped (at `failedAuthCap`); every other bucket allows. */
export class CappedLimiter implements RateLimiter {
  private readonly used = new Map<string, number>();
  private readonly failedAuthCap: number;

  constructor(failedAuthCap = 30) {
    this.failedAuthCap = failedAuthCap;
  }

  private cap(bucket: string): number {
    return bucket.startsWith('auth-failed:address:')
      ? this.failedAuthCap
      : Number.POSITIVE_INFINITY;
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

/** A token store whose lookup takes `delayMs`, so a request sits in authentication for that long. */
export class DelayedTokenStore extends FakeTokenStore {
  private readonly delayMs: number;

  constructor(delayMs: number) {
    super();
    this.delayMs = delayMs;
  }

  override async resolve(tokenHash: Uint8Array, nowMs: number): Promise<ResolvedToken | null> {
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    return super.resolve(tokenHash, nowMs);
  }
}

/** A fake store holding TOKEN_A for player `aa`. */
export function storeWithTokenA(store: FakeTokenStore = new FakeTokenStore()): FakeTokenStore {
  store.add({
    tokenId: 'tok-a',
    tokenHash: tokenDigest(PEPPER, TOKEN_A),
    player: player('aa'),
    expiresAtMs: Number.POSITIVE_INFINITY,
    revoked: false,
  });
  return store;
}

export interface StartOptions {
  http?: Partial<McpConfig['http']>;
  store?: FakeTokenStore;
  limiter?: RateLimiter;
  limits?: FrontDoorOptions['limits'];
}

export interface Started {
  door: FrontDoor;
  port: number;
}

/** Starts a front door on 127.0.0.1 with the fakes above; the caller closes `door`. */
export async function startDoor(options: StartOptions = {}): Promise<Started> {
  const door = createFrontDoor({
    http: {
      bind: '127.0.0.1',
      port: 0,
      allowedHosts: ['localhost', '127.0.0.1'],
      publicHost: null,
      trustedProxies: [],
      clientIpHeader: 'cf-connecting-ip',
      maxConnections: 256,
      maxConnectionsPerAddress: 32,
      ...options.http,
    },
    pepper: PEPPER,
    store: options.store ?? storeWithTokenA(),
    limiter: options.limiter ?? new CappedLimiter(),
    createSession: () =>
      new McpServer({ name: 'front-door-test', version: '0.0.0' }, { capabilities: { tools: {} } }),
    log: () => undefined,
    ...(options.limits === undefined ? {} : { limits: options.limits }),
  });
  const port = await door.listen(0);
  return { door, port };
}

export interface Reply {
  status: number;
  sessionId: string | undefined;
}

export interface PostOptions {
  cf?: string;
  /** Destroy the client socket this many ms after sending; the reply status is then 0. */
  abortAfterMs?: number;
}

/** One POST of the initialize request to /p/aa with the bearer, and optionally a forwarded address. */
export function postInit(port: number, token: string, options: PostOptions = {}): Promise<Reply> {
  const headers: Record<string, string | number> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'content-length': Buffer.byteLength(INIT),
    authorization: `Bearer ${token}`,
  };
  if (options.cf !== undefined) headers['cf-connecting-ip'] = options.cf;
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path: '/p/aa', method: 'POST', headers },
      (res) => {
        res.resume();
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            sessionId: res.headers['mcp-session-id'] as string | undefined,
          }),
        );
      },
    );
    req.on('error', (error) => {
      if (options.abortAfterMs === undefined) reject(error);
    });
    req.end(INIT);
    if (options.abortAfterMs !== undefined) {
      setTimeout(() => {
        req.destroy();
        resolve({ status: 0, sessionId: undefined });
      }, options.abortAfterMs);
    }
  });
}

/** Opens the player's GET notification stream on a session; resolves once the headers arrive. */
export function openStream(
  port: number,
  token: string,
  sessionId: string,
  cf?: string,
): Promise<{ status: number; close: () => void }> {
  const headers: Record<string, string> = {
    accept: 'text/event-stream',
    authorization: `Bearer ${token}`,
    'mcp-session-id': sessionId,
  };
  if (cf !== undefined) headers['cf-connecting-ip'] = cf;
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: '/p/aa', method: 'GET', headers }, (res) =>
      resolve({ status: res.statusCode ?? 0, close: () => req.destroy() }),
    );
    req.on('error', reject);
    req.end();
  });
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
