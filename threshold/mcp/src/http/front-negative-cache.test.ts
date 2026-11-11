import { afterEach, describe, expect, it } from 'vitest';
import {
  CappedLimiter,
  INIT,
  startDoor,
  storeWithTokenA,
  TOKEN_A,
} from '../fakes/front-door.fakes.ts';
import { FakeTokenStore } from '../fakes/stores.fakes.ts';
import type { MissReason } from '../ports.ts';
import type { FrontDoor } from './front.ts';
import { NEGATIVE_CACHE_MS } from './negative-cache.ts';

/** A store that counts the questions about why a bearer missed. */
class CountingStore extends FakeTokenStore {
  explained = 0;
  override async explainMiss(hash: Uint8Array, nowMs: number): Promise<MissReason> {
    this.explained += 1;
    return super.explainMiss(hash, nowMs);
  }
}

let door: FrontDoor | undefined;

afterEach(async () => {
  await door?.close();
  door = undefined;
});

function post(port: number, authorization: string | undefined, client = '198.51.100.1') {
  return fetch(`http://127.0.0.1:${port}/p/aa`, {
    method: 'POST',
    headers: {
      ...(authorization === undefined ? {} : { Authorization: authorization }),
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'x-geldar-client-ip': client,
    },
    body: INIT,
  });
}

const bad = (n: number): string => `Bearer gmcp-${String(n).padStart(64, '0')}`;

async function start(clock: () => number) {
  const store = storeWithTokenA(new CountingStore()) as CountingStore;
  const started = await startDoor({
    http: { trustedProxies: ['127.0.0.1'] },
    store,
    limiter: new CappedLimiter(1000),
    now: clock,
  });
  door = started.door;
  return { store, port: started.port };
}

describe('negative cache for unauthenticated requests', () => {
  it('stops asking the store why after a flood of failures from one address', async () => {
    const { store, port } = await start(() => 0);
    // 40 distinct bad tokens. The store explains one miss in eight (the 1st, 9th, 17th ...). The
    // address is flagged after 16 failures, so from the 17th on nothing is explained: 2 questions,
    // where 5 would be asked without the cache.
    for (let n = 0; n < 40; n++) expect((await post(port, bad(n))).status).toBe(401);
    expect(store.explained).toBe(2);
  });

  it('answers every failure with the same status, body and no reason', async () => {
    const { port } = await start(() => 0);
    const bodies = new Set<string>();
    for (const header of [undefined, 'Basic abc', bad(1), bad(2), bad(1)]) {
      const reply = await post(port, header);
      expect(reply.status).toBe(401);
      bodies.add(await reply.text());
    }
    expect(bodies.size).toBe(1);
  });

  it('explains again once the window has passed', async () => {
    let clock = 0;
    const { store, port } = await start(() => clock);
    for (let n = 0; n < 40; n++) await post(port, bad(n));
    expect(store.explained).toBe(2);
    clock = NEGATIVE_CACHE_MS + 1;
    // The skipped misses were not counted, so the counter stands at 16 and the next miss explains.
    await post(port, bad(100));
    expect(store.explained).toBe(3);
  });

  it('still accepts a valid token from an address that has failed', async () => {
    const { port } = await start(() => 0);
    for (let n = 0; n < 20; n++) await post(port, bad(n));
    expect((await post(port, `Bearer ${TOKEN_A}`)).status).toBe(200);
  });

  it('keeps the 403 for a valid token of another player', async () => {
    const { port } = await start(() => 0);
    await post(port, bad(1));
    const reply = await fetch(`http://127.0.0.1:${port}/p/bb`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN_A}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'x-geldar-client-ip': '198.51.100.1',
      },
      body: INIT,
    });
    expect(reply.status).toBe(403);
  });
});
