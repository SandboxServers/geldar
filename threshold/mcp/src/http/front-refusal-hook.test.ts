import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type FrontRig, startFrontRig, TOKEN_A } from './front.fixture.ts';

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

describe('the onRefusal hook (T-06d2)', () => {
  it('is called with the closed reason and 401 for an unknown token, and nothing else', async () => {
    const seen: Refusal[] = [];
    await rig.restart({ onRefusal: (refusal) => seen.push(refusal) });
    const reply = await rig.send('/p/aa', { body: BODY, headers: { Authorization: UNKNOWN } });
    expect(reply.status).toBe(401);
    expect(seen).toEqual([{ reason: 'unknown_token', status: 401 }]);
    expect(Object.keys(seen[0] ?? {}).sort()).toEqual(['reason', 'status']);
    expect(JSON.stringify(seen)).not.toMatch(/gmcp-|bearer|127\.0\.0\.1/i);
  });

  it('is called with the shape reason for a request with no header', async () => {
    const seen: Refusal[] = [];
    await rig.restart({ onRefusal: (refusal) => seen.push(refusal) });
    const reply = await rig.send('/p/aa', { body: BODY, headers: { Authorization: undefined } });
    expect(reply.status).toBe(401);
    expect(seen).toEqual([{ reason: 'no_header', status: 401 }]);
  });

  it('is not called for a valid token on an open session', async () => {
    const seen: Refusal[] = [];
    await rig.restart({ onRefusal: (refusal) => seen.push(refusal) });
    const session = await rig.openSession();
    const reply = await rig.send('/p/aa', {
      body: '{"jsonrpc":"2.0","id":3,"method":"ping"}',
      headers: { 'Mcp-Session-Id': session },
    });
    expect(reply.status).toBe(200);
    expect(seen).toEqual([]);
  });

  it('a hook that throws leaves the 401 and its body as they are', async () => {
    const plain = await rig.send('/p/aa', { body: BODY, headers: { Authorization: UNKNOWN } });
    await rig.restart({
      onRefusal: () => {
        throw new Error('exporter down');
      },
    });
    const reply = await rig.send('/p/aa', { body: BODY, headers: { Authorization: UNKNOWN } });
    expect(reply.status).toBe(401);
    expect(reply.text).toBe(plain.text);
    expect(reply.headers['www-authenticate']).toBe(plain.headers['www-authenticate']);
  });

  it('is called with auth_unavailable and 503 when the token store fails', async () => {
    const seen: Refusal[] = [];
    rig.store.resolve = async () => {
      throw new Error('connect ECONNREFUSED db-internal.example:5432');
    };
    await rig.restart({ onRefusal: (refusal) => seen.push(refusal) });
    const reply = await rig.send('/p/aa', {
      body: BODY,
      headers: { Authorization: `Bearer ${TOKEN_A}` },
    });
    expect(reply.status).toBe(503);
    expect(seen).toEqual([{ reason: 'auth_unavailable', status: 503 }]);
    expect(JSON.stringify(seen)).not.toContain('db-internal');
  });
});
