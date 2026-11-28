import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FAILED_AUTH_PER_MINUTE,
  type FrontRig,
  startFrontRig,
  TOKEN_A,
  TOKEN_B,
} from './front.fixture.ts';

type Refusal = { reason: string; status: number };

let rig: FrontRig;

beforeEach(async () => {
  rig = await startFrontRig();
});

afterEach(async () => {
  await rig.close();
});

const UNKNOWN = `Bearer gmcp-${'ff'.repeat(32)}`;
const BODY = '{}';

// Every refusal the front door sends reaches the onRefusal hook once, with its closed reason and status (Packet A).
describe('every refusal calls onRefusal once (mcp.auth_refused)', () => {
  it('batch_not_allowed for a JSON-RPC batch, once, with 400', async () => {
    const seen: Refusal[] = [];
    await rig.restart({ onRefusal: (refusal) => seen.push(refusal) });
    const reply = await rig.send('/p/aa', { body: '[]' });
    expect(reply.status).toBe(400);
    expect(seen).toEqual([{ reason: 'batch_not_allowed', status: 400 }]);
  });

  it('missing_session for a POST with no session id, once, with 400', async () => {
    const seen: Refusal[] = [];
    await rig.restart({ onRefusal: (refusal) => seen.push(refusal) });
    const reply = await rig.send('/p/aa', { body: BODY });
    expect(reply.status).toBe(400);
    expect(seen).toEqual([{ reason: 'missing_session', status: 400 }]);
  });

  it('origin_rejected for a request that carries an Origin, once, with 403', async () => {
    const seen: Refusal[] = [];
    await rig.restart({ onRefusal: (refusal) => seen.push(refusal) });
    const reply = await rig.send('/p/aa', {
      body: BODY,
      headers: { Origin: 'https://example.invalid' },
    });
    expect(reply.status).toBe(403);
    expect(seen).toEqual([{ reason: 'origin_rejected', status: 403 }]);
  });

  it('wrong_player for a valid token used on another player, once, with 403', async () => {
    const seen: Refusal[] = [];
    await rig.restart({ onRefusal: (refusal) => seen.push(refusal) });
    const reply = await rig.send('/p/bb', {
      body: BODY,
      headers: { Authorization: `Bearer ${TOKEN_A}` },
    });
    expect(reply.status).toBe(403);
    expect(seen).toEqual([{ reason: 'wrong_player', status: 403 }]);
    expect(TOKEN_B).not.toBe(TOKEN_A);
  });

  it('rate_limited (failed-auth gate, the limitedAnswer path) once per 429 and never twice', async () => {
    const seen: Refusal[] = [];
    await rig.restart({ onRefusal: (refusal) => seen.push(refusal) });
    const statuses: number[] = [];
    for (let i = 0; i < FAILED_AUTH_PER_MINUTE + 6; i += 1) {
      const reply = await rig.send('/p/aa', { body: BODY, headers: { Authorization: UNKNOWN } });
      statuses.push(reply.status);
    }
    expect(statuses).toContain(429);
    // One hook call per refused request, in order, and every 429 carries rate_limited.
    expect(seen.map((refusal) => refusal.status)).toEqual(statuses);
    for (const refusal of seen.filter((r) => r.status === 429)) {
      expect(refusal.reason).toBe('rate_limited');
    }
  });
});
