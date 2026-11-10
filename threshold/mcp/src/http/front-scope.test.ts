import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BODY_LIMIT,
  CALLS_PER_MINUTE,
  CapLimiter,
  call,
  FAILED_AUTH_PER_MINUTE,
  type FrontRig,
  INIT,
  MAX_OPEN_PER_PLAYER,
  startFrontRig,
  TOKEN_A,
  TOKEN_B,
} from './front.fixture.ts';

let rig: FrontRig;

beforeEach(async () => {
  rig = await startFrontRig();
});

afterEach(async () => {
  await rig.close();
});

describe('body and batch limits', () => {
  it('refuses a body one byte over 64 KiB with 413', async () => {
    const head = '{"jsonrpc":"2.0","id":1,"method":"ping","params":{"pad":"';
    const tail = '"}}';
    const pad = 'a'.repeat(BODY_LIMIT + 1 - head.length - tail.length);
    const reply = await rig.send('/p/aa', { body: `${head}${pad}${tail}` });
    expect(reply.status).toBe(413);
  });

  it('accepts a body of exactly 64 KiB', async () => {
    const head = '{"jsonrpc":"2.0","id":1,"method":"ping","params":{"pad":"';
    const tail = '"}}';
    const pad = 'a'.repeat(BODY_LIMIT - head.length - tail.length);
    const reply = await rig.send('/p/aa', { body: `${head}${pad}${tail}` });
    expect(reply.status).not.toBe(413);
  });

  it('refuses a batch array with 400', async () => {
    const sid = await rig.openSession();
    const batch = JSON.stringify([JSON.parse(call('ping'))]);
    const reply = await rig.send('/p/aa', { body: batch, headers: { 'mcp-session-id': sid } });
    expect(reply.status).toBe(400);
    expect(reply.text).toContain('batch_not_allowed');
  });
});

describe('scoping and limits', () => {
  it('will not let a session of one player serve another', async () => {
    const sid = await rig.openSession('/p/aa', TOKEN_A);
    await rig.openSession('/p/bb', TOKEN_B);
    const reply = await rig.send('/p/bb', {
      body: call('ping'),
      headers: { 'mcp-session-id': sid, Authorization: `Bearer ${TOKEN_B}` },
    });
    expect(reply.status).toBe(404);
  });

  it('allows the 60th call a minute per player and refuses the 61st', async () => {
    const sid = await rig.openSession();
    const statuses: number[] = [];
    for (let i = 0; i < CALLS_PER_MINUTE + 1; i += 1) {
      const reply = await rig.send('/p/aa', {
        body: call('ping', i + 2),
        headers: { 'mcp-session-id': sid },
      });
      statuses.push(reply.status);
    }
    expect(statuses[CALLS_PER_MINUTE - 1]).toBe(200);
    expect(statuses[CALLS_PER_MINUTE]).toBe(429);
  });

  it('shares the owner budget across players and refuses past it', async () => {
    // Initialize draws no owner token, so the owner's three are all for the calls that follow.
    rig.limiter = new CapLimiter((bucket) => (bucket.startsWith('owner:') ? 3 : 1000));
    await rig.restart();
    const sidA = await rig.openSession('/p/aa', TOKEN_A);
    const sidB = await rig.openSession('/p/bb', TOKEN_B);
    const first = await rig.send('/p/aa', {
      body: call('ping', 2),
      headers: { 'mcp-session-id': sidA },
    });
    const second = await rig.send('/p/bb', {
      body: call('ping', 2),
      headers: { 'mcp-session-id': sidB, Authorization: `Bearer ${TOKEN_B}` },
    });
    const third = await rig.send('/p/aa', {
      body: call('ping', 3),
      headers: { 'mcp-session-id': sidA },
    });
    const fourth = await rig.send('/p/bb', {
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
      const reply = await rig.send('/p/aa', {
        body: INIT,
        headers: { Authorization: 'Bearer wrong-token-0123456789wrong' },
      });
      statuses.push(reply.status);
    }
    expect(statuses[FAILED_AUTH_PER_MINUTE - 1]).toBe(401);
    expect(statuses[FAILED_AUTH_PER_MINUTE]).toBe(429);
  });

  it('answers 429 from the address bucket without a token lookup once it is empty', async () => {
    const lookup = rig.store.resolve.bind(rig.store);
    let lookups = 0;
    rig.store.resolve = async (hash, nowMs) => {
      lookups += 1;
      return lookup(hash, nowMs);
    };
    const wrong = { body: INIT, headers: { Authorization: 'Bearer wrong-token-0123456789wrong' } };
    for (let i = 0; i < FAILED_AUTH_PER_MINUTE; i += 1) await rig.send('/p/aa', wrong);
    // The refused token is remembered after its first lookup, so the repeats cost no lookup at all.
    expect(lookups).toBe(1);
    const reply = await rig.send('/p/aa', wrong);
    expect(reply.status).toBe(429);
    expect(lookups).toBe(1);
  });

  it('holds at most 4 open requests per player and refuses the 5th', async () => {
    const sid = await rig.openSession();
    const open = Array.from({ length: MAX_OPEN_PER_PLAYER }, (_, i) =>
      rig.send('/p/aa', { body: call('wait', i + 10), headers: { 'mcp-session-id': sid } }),
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    const fifth = await rig.send('/p/aa', {
      body: call('ping', 99),
      headers: { 'mcp-session-id': sid },
    });
    expect(fifth.status).toBe(429);
    expect(fifth.text).toContain('too_many_open_requests');
    rig.store.revoke('tok-a');
    await Promise.all(open);
  });
});
