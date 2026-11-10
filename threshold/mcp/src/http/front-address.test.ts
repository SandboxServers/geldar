import { request } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, describe, expect, it } from 'vitest';
import type { McpConfig } from '../config.ts';
import { FakeTokenStore } from '../fakes/stores.fakes.ts';
import type { PlayerRecord, RateDecision, RateLimiter, TokenStore } from '../ports.ts';
import { FakePool } from '../store/pg-fakes.ts';
import { PgTokenStore, type TokenRow } from '../store/pg-tokens.ts';
import { tokenDigest } from './auth.ts';
import type { FrontDoor } from './front.ts';
import { createFrontDoor } from './front.ts';

const PEPPER = new TextEncoder().encode('front-address-test-pepper-0123456789');
const TOKEN_A = 'token-for-player-aa-0123456789';
const BAD = 'wrong-token-for-nobody-0123456789';
const FAILED_AUTH_PER_ADDRESS = 30;
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

/** Only the failed-auth bucket of an address is capped (30 a minute in phase0.yaml); the rest allow. */
class FailedAuthLimiter implements RateLimiter {
  private readonly used = new Map<string, number>();

  take(bucket: string): RateDecision {
    const used = this.used.get(bucket) ?? 0;
    if (used >= capOf(bucket)) return { allowed: false, retryAfterMs: 1500 };
    this.used.set(bucket, used + 1);
    return { allowed: true, retryAfterMs: 0 };
  }

  peek(bucket: string): RateDecision {
    const used = this.used.get(bucket) ?? 0;
    return used >= capOf(bucket)
      ? { allowed: false, retryAfterMs: 1500 }
      : { allowed: true, retryAfterMs: 0 };
  }
}

function capOf(bucket: string): number {
  return bucket.startsWith('auth-failed:address:')
    ? FAILED_AUTH_PER_ADDRESS
    : Number.POSITIVE_INFINITY;
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

/** The row the PG store reads for TOKEN_A: active, unexpired, unrevoked, on an enabled harness. */
function tokenRow(): TokenRow {
  return {
    token_id: 'tok-a',
    token_hash: Buffer.from(tokenDigest(PEPPER, TOKEN_A)),
    player_id: 'aa',
    life_id: 'aa_life',
    owner_id: 'owner-1',
    display_name: 'AA',
    harness: 'test',
    status: 'active',
    expires_at: new Date(Date.now() + 86_400_000),
    revoked_at: null,
  };
}

let door: FrontDoor | undefined;
let port = 0;

afterEach(async () => {
  await door?.close();
  door = undefined;
});

/** A fake token store that holds TOKEN_A for player aa. */
function fakeTokenStore(): FakeTokenStore {
  const store = new FakeTokenStore();
  store.add({
    tokenId: 'tok-a',
    tokenHash: tokenDigest(PEPPER, TOKEN_A),
    player: player('aa'),
    expiresAtMs: Number.POSITIVE_INFINITY,
    revoked: false,
  });
  return store;
}

/** Starts a front door whose peer, 127.0.0.1, is the only address a test client really has. */
async function start(
  http: Partial<McpConfig['http']> = {},
  store: TokenStore = fakeTokenStore(),
): Promise<void> {
  door = createFrontDoor({
    http: {
      bind: '127.0.0.1',
      port: 0,
      allowedHosts: ['localhost', '127.0.0.1'],
      publicHost: null,
      trustedProxies: [],
      maxConnections: 256,
      maxConnectionsPerAddress: 32,
      ...http,
    },
    pepper: PEPPER,
    store,
    limiter: new FailedAuthLimiter(),
    createSession: () =>
      new McpServer({ name: 'address-test', version: '0.0.0' }, { capabilities: { tools: {} } }),
    log: () => undefined,
  });
  port = await door.listen(0);
}

/** One POST of the initialize request to the player's path, with the given bearer and forwarded address. */
function post(token: string, cfConnectingIp?: string): Promise<number> {
  const headers: Record<string, string | number> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'content-length': Buffer.byteLength(INIT),
    authorization: `Bearer ${token}`,
  };
  if (cfConnectingIp !== undefined) headers['cf-connecting-ip'] = cfConnectingIp;
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path: '/p/aa', method: 'POST', headers },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      },
    );
    req.on('error', reject);
    req.end(INIT);
  });
}

/** Spends the address's whole failed-auth allowance with bad tokens; each answers 401. */
async function exhaust(cfConnectingIp?: string): Promise<void> {
  for (let i = 0; i < FAILED_AUTH_PER_ADDRESS; i++) {
    expect(await post(BAD, cfConnectingIp)).toBe(401);
  }
}

describe('failed-auth state and token cache', () => {
  it('does not block a valid cached token while the address bucket is empty', async () => {
    await start();
    await exhaust();
    expect(await post(BAD)).toBe(429);
    // The fake store reports every valid token as a cached hit, so the empty bucket never refuses it.
    expect(await post(TOKEN_A)).toBe(200);
  });

  it('blocks an uncached bad token once the address bucket is empty', async () => {
    await start();
    await exhaust();
    expect(await post(BAD)).toBe(429);
  });

  it('refuses an uncached token behind an empty bucket, and passes it once cached', async () => {
    const pool = new FakePool(() => ({ rows: [tokenRow()] }));
    const store = new PgTokenStore(pool.asPool(), { test: true }, {});
    await start({}, store);
    await exhaust();
    expect(await post(TOKEN_A)).toBe(429);
    // A successful resolve caches the hit for 5 s, so the same token now passes the empty bucket.
    expect(await store.resolve(tokenDigest(PEPPER, TOKEN_A), Date.now())).not.toBeNull();
    expect(await post(TOKEN_A)).toBe(200);
  });
});

describe('client address behind a trusted proxy', () => {
  it('ignores CF-Connecting-IP from a peer that is not trusted', async () => {
    await start({ trustedProxies: [] });
    await exhaust('127.0.0.2');
    // The header names another client, but the peer 127.0.0.1 is what the bucket is keyed on.
    expect(await post(BAD, '127.0.0.3')).toBe(429);
  });

  it('uses CF-Connecting-IP from a trusted peer, so each client has its own bucket', async () => {
    await start({ trustedProxies: ['127.0.0.1'] });
    await exhaust('127.0.0.2');
    expect(await post(BAD, '127.0.0.2')).toBe(429);
    expect(await post(BAD, '127.0.0.3')).toBe(401);
  });

  it('falls back to the peer when the trusted header is not an IP literal', async () => {
    await start({ trustedProxies: ['127.0.0.1'] });
    await exhaust('not-an-ip');
    // Both invalid values fall back to the peer 127.0.0.1, so they share its bucket.
    expect(await post(BAD, 'also-not-an-ip')).toBe(429);
  });

  it('does not share a failed-auth bucket between two clients behind one trusted proxy', async () => {
    await start({ trustedProxies: ['127.0.0.1'] });
    await exhaust('127.0.0.2');
    expect(await post(BAD, '127.0.0.3')).toBe(401);
  });
});
