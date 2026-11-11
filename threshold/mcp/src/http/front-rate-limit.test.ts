import { afterEach, describe, expect, it } from 'vitest';
import { INIT, startDoor, TOKEN_A } from '../fakes/front-door.fakes.ts';
import type { FrontDoor } from './front.ts';

// The 0090 rate-limit shape, byte for byte; the Retry-After header carries the same seconds.
const RATE_BODY_ONE_SECOND =
  '{"error":{"code":"rate_limited","message":"Too many requests"},"retryAfter":1}';

let door: FrontDoor | undefined;

afterEach(async () => {
  await door?.close();
  door = undefined;
});

async function post(port: number, client?: string): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/p/aa`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN_A}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(client === undefined ? {} : { 'x-geldar-client-ip': client }),
    },
    body: INIT,
  });
}

describe('public rate limit (public.rate_limit)', () => {
  it('serves the last request in the burst and refuses the first one past it with 429', async () => {
    const clock = 0;
    const started = await startDoor({
      public: { rateLimit: { perMinute: 60, burst: 2 } },
      now: () => clock,
    });
    door = started.door;
    expect((await post(started.port)).status).toBe(200);
    const last = await post(started.port);
    expect(last.status).toBe(200);
    const refused = await post(started.port);
    expect(refused.status).toBe(429);
    expect(refused.headers.get('retry-after')).toBe('1');
    expect(refused.headers.get('content-type')).toBe('application/json');
    expect(await refused.text()).toBe(RATE_BODY_ONE_SECOND);
  });

  it('does not limit a door whose public block has no rate limit (rateLimit null)', async () => {
    const started = await startDoor({ public: { rateLimit: null }, now: () => 0 });
    door = started.door;
    for (let i = 0; i < 200; i++) {
      expect((await post(started.port)).status).toBe(200);
    }
  });

  it('serves again once the clock has refilled one token', async () => {
    let clock = 0;
    const started = await startDoor({
      public: { rateLimit: { perMinute: 60, burst: 1 } },
      now: () => clock,
    });
    door = started.door;
    expect((await post(started.port)).status).toBe(200);
    expect((await post(started.port)).status).toBe(429);
    clock = 2000;
    expect((await post(started.port)).status).toBe(200);
  });

  it('counts each client address on its own behind a trusted proxy', async () => {
    const started = await startDoor({
      http: { trustedProxies: ['127.0.0.1'] },
      public: { rateLimit: { perMinute: 60, burst: 1 } },
      now: () => 0,
    });
    door = started.door;
    expect((await post(started.port, '198.51.100.1')).status).toBe(200);
    expect((await post(started.port, '198.51.100.1')).status).toBe(429);
    expect((await post(started.port, '198.51.100.2')).status).toBe(200);
  });

  it('answers a refused request without serving the body: the refusal is the whole reply', async () => {
    const started = await startDoor({
      public: { rateLimit: { perMinute: 60, burst: 1 } },
      now: () => 0,
    });
    door = started.door;
    await (await post(started.port)).text();
    const refused = await post(started.port);
    expect(refused.status).toBe(429);
    expect(await refused.text()).not.toContain('jsonrpc');
  });
});
