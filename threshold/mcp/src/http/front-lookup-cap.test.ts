import { afterEach, describe, expect, it } from 'vitest';
import {
  INIT,
  PEPPER,
  player,
  postInit,
  sleep,
  startDoor,
  TOKEN_A,
} from '../fakes/front-door.fakes.ts';
import { FakeTokenStore } from '../fakes/stores.fakes.ts';
import type { RateDecision, RateLimiter, ResolvedToken } from '../ports.ts';
import { tokenDigest } from './auth.ts';
import type { FrontDoor } from './front.ts';
import { MAX_LOOKUPS_IN_FLIGHT } from './limits.ts';

const UNAVAILABLE_BODY = '{"error":{"code":"unavailable","message":"Service unavailable"}}';

/** Failed-auth buckets as in the shard: 30 a minute per address and 300 global, none refilling. */
class AddressAndGlobalLimiter implements RateLimiter {
  private readonly used = new Map<string, number>();

  private cap(bucket: string): number {
    if (bucket === 'auth-failed:global') return 300;
    return bucket.startsWith('auth-failed:address:') ? 30 : Number.POSITIVE_INFINITY;
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

/** A store with no hit cache whose lookups wait until the test lets them go, then answer or throw. */
class GatedStore extends FakeTokenStore {
  inFlight = 0;
  lookups = 0;
  failWith: Error | undefined;
  private gates: (() => void)[] = [];
  gated = false;

  override isCachedHit(): boolean {
    return false;
  }

  override async resolve(hash: Uint8Array, nowMs: number): Promise<ResolvedToken | null> {
    this.lookups += 1;
    this.inFlight += 1;
    try {
      if (this.gated) await new Promise<void>((open) => this.gates.push(open));
      if (this.failWith !== undefined) throw this.failWith;
      return await super.resolve(hash, nowMs);
    } finally {
      this.inFlight -= 1;
    }
  }

  releaseAll(): void {
    for (const open of this.gates.splice(0)) open();
  }
}

let door: FrontDoor | undefined;
let held: GatedStore | undefined;

afterEach(async () => {
  held?.releaseAll();
  await door?.close();
  door = undefined;
  held = undefined;
});

function storeA(): GatedStore {
  const store = new GatedStore();
  store.add({
    tokenId: 'tok-a',
    tokenHash: tokenDigest(PEPPER, TOKEN_A),
    player: player('aa'),
    expiresAtMs: Number.POSITIVE_INFINITY,
    revoked: false,
  });
  held = store;
  return store;
}

const bad = (n: number): string => `bad-token-number-${String(n).padStart(8, '0')}`;
const client = (n: number): string => `198.51.${Math.floor(n / 250)}.${(n % 250) + 1}`;

function post(port: number, token: string, address: string): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/p/aa`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'x-geldar-client-ip': address,
    },
    body: INIT,
  });
}

async function until(test: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !test(); i++) await sleep(10);
  expect(test()).toBe(true);
}

async function start(store: GatedStore) {
  const started = await startDoor({
    http: { trustedProxies: ['127.0.0.1'] },
    store,
    limiter: new AddressAndGlobalLimiter(),
  });
  door = started.door;
  return started.port;
}

describe('failed auth from other addresses cannot lock out a valid user (R24)', () => {
  it('serves a valid uncached token from an eleventh address after ten spend 30 failures each', async () => {
    const port = await start(storeA());
    for (let a = 0; a < 10; a++) {
      for (let n = 0; n < 30; n++) {
        expect((await post(port, bad(a * 100 + n), client(a))).status).toBe(401);
      }
      expect((await post(port, bad(9999), client(a))).status).toBe(429);
    }
    expect((await post(port, TOKEN_A, client(10))).status).toBe(200);
  });
});

describe('in-flight cap on uncached lookups (R24)', () => {
  it('lets 16 lookups run, answers the 17th with the 503 body, and frees the slots on success', async () => {
    const store = storeA();
    store.gated = true;
    const port = await start(store);
    const running: Promise<Response>[] = [];
    for (let i = 0; i < MAX_LOOKUPS_IN_FLIGHT; i++) running.push(post(port, bad(i), client(i)));
    await until(() => store.inFlight === MAX_LOOKUPS_IN_FLIGHT);
    const refused = await post(port, bad(500), client(500));
    expect(refused.status).toBe(503);
    expect(await refused.text()).toBe(UNAVAILABLE_BODY);
    expect(store.lookups).toBe(MAX_LOOKUPS_IN_FLIGHT);
    store.releaseAll();
    for (const response of await Promise.all(running)) expect(response.status).toBe(401);
    store.gated = false;
    expect((await post(port, TOKEN_A, client(600))).status).toBe(200);
  });

  it('frees the slot when the store throws', async () => {
    const store = storeA();
    const port = await start(store);
    store.failWith = new Error('db down');
    for (let i = 0; i < MAX_LOOKUPS_IN_FLIGHT + 4; i++) {
      expect((await post(port, bad(i), client(i))).status).toBe(503);
    }
    // Every one reached the store: none was refused by the cap, so each slot came back.
    expect(store.lookups).toBe(MAX_LOOKUPS_IN_FLIGHT + 4);
    store.failWith = undefined;
    expect((await post(port, TOKEN_A, client(700))).status).toBe(200);
  });

  it('frees the slot when the client aborts while the lookup is pending', async () => {
    const store = storeA();
    store.gated = true;
    const port = await start(store);
    const aborted: Promise<unknown>[] = [];
    for (let i = 0; i < MAX_LOOKUPS_IN_FLIGHT; i++) {
      aborted.push(postInit(port, bad(i), { cf: client(i), abortAfterMs: 50 }));
    }
    await until(() => store.inFlight === MAX_LOOKUPS_IN_FLIGHT);
    await Promise.all(aborted);
    store.releaseAll();
    await until(() => store.inFlight === 0);
    store.gated = false;
    expect((await post(port, TOKEN_A, client(800))).status).toBe(200);
  });
});
