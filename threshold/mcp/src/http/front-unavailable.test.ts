import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeTokenStore } from '../fakes/stores.fakes.ts';
import type { PlayerRecord, RateDecision, RateLimiter } from '../ports.ts';
import { tokenDigest } from './auth.ts';
import type { FrontDoor } from './front.ts';
import { createFrontDoor } from './front.ts';

const PEPPER = new TextEncoder().encode('front-unavailable-pepper-0123456789ab');
const TOKEN_A = 'token-for-player-aa-0123456789';
const DB_DETAIL = 'connect ECONNREFUSED db-internal.example:5432';

const open: RateLimiter = {
  take: (): RateDecision => ({ allowed: true, retryAfterMs: 0 }),
  peek: (): RateDecision => ({ allowed: true, retryAfterMs: 0 }),
};

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

let door: FrontDoor | undefined;

afterEach(async () => {
  await door?.close();
  door = undefined;
});

/** A front door whose token store is down: every resolve rejects with a message that names the database. */
async function startWithDownStore(logs: Record<string, string | number>[]): Promise<number> {
  const store = new FakeTokenStore();
  store.add({
    tokenId: 'tok-a',
    tokenHash: tokenDigest(PEPPER, TOKEN_A),
    player: player('aa'),
    expiresAtMs: Number.POSITIVE_INFINITY,
    revoked: false,
  });
  store.resolve = async () => {
    throw new Error(DB_DETAIL);
  };
  door = createFrontDoor({
    http: {
      bind: '127.0.0.1',
      port: 0,
      allowedHosts: ['localhost', '127.0.0.1'],
      publicHost: null,
      trustedProxies: [],
      clientIpHeader: 'cf-connecting-ip',
      maxConnections: 256,
      maxConnectionsPerAddress: 1,
      maxBodyBytes: 65536,
    },
    pepper: PEPPER,
    store,
    limiter: open,
    createSession: () =>
      new McpServer(
        { name: 'unavailable-test', version: '0.0.0' },
        { capabilities: { tools: {} } },
      ),
    log: (line) => logs.push(line),
  });
  return door.listen(0);
}

describe('RateLimiter', () => {
  it('requires peek: a limiter without it fails the type check, so the pre-check cannot fail open', () => {
    // If peek is optional again, this line stops being an error and `tsc` fails on the unused directive.
    // @ts-expect-error peek is required
    const withoutPeek: RateLimiter = { take: () => ({ allowed: true, retryAfterMs: 0 }) };
    expect(typeof withoutPeek.take).toBe('function');
  });
});

describe('front door when the token store fails', () => {
  it('answers 503 with a generic body, never the database error, and logs only the class', async () => {
    const logs: Record<string, string | number>[] = [];
    const port = await startWithDownStore(logs);
    const res = await fetch(`http://127.0.0.1:${port}/p/aa`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN_A}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(503);
    const body = await res.text();
    expect(body).not.toContain('ECONNREFUSED');
    expect(body).not.toContain('db-internal');
    expect(logs.some((line) => line.event === 'auth_unavailable' && line.error === 'Error')).toBe(
      true,
    );
    expect(JSON.stringify(logs)).not.toContain('db-internal');
  });

  it('releases the connection slot each time, so later requests are still answered', async () => {
    const port = await startWithDownStore([]);
    for (let i = 0; i < 3; i++) {
      const res = await fetch(`http://127.0.0.1:${port}/p/aa`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN_A}`, 'Content-Type': 'application/json' },
        body: '{}',
      });
      expect(res.status).toBe(503);
      await res.arrayBuffer();
    }
  });
});
