import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tokenDigest } from './auth.ts';
import {
  type FrontRig,
  INIT,
  PEPPER,
  player,
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

describe('bearer authentication', () => {
  const expired = 'token-expired-aa-0123456789';
  it.each([
    ['no Authorization header', { Authorization: undefined }, `/p/aa`, 401],
    ['another scheme', { Authorization: `Basic ${TOKEN_A}` }, '/p/aa', 401],
    ['lowercase scheme', { Authorization: `bearer ${TOKEN_A}` }, '/p/aa', 401],
    ['double space after the scheme', { Authorization: `Bearer  ${TOKEN_A}` }, '/p/aa', 401],
    ['an unknown token', { Authorization: 'Bearer unknown-token-0123456789xyz' }, '/p/aa', 401],
    [
      'a token only in the query string',
      { Authorization: undefined },
      `/p/aa?token=${TOKEN_A}`,
      401,
    ],
    ['a token for another player', { Authorization: `Bearer ${TOKEN_A}` }, '/p/bb', 403],
    ['a token for an unknown player', { Authorization: `Bearer ${TOKEN_A}` }, '/p/cc', 403],
    [
      'an unknown player with an unknown token',
      { Authorization: `Bearer ${expired}` },
      '/p/cc',
      401,
    ],
  ])('refuses %s', async (_name, headers, path, status) => {
    const reply = await rig.send(path, { body: INIT, headers });
    expect(reply.status).toBe(status);
  });

  it('refuses a revoked token', async () => {
    rig.store.revoke('tok-b');
    const reply = await rig.send('/p/bb', {
      body: INIT,
      headers: { Authorization: `Bearer ${TOKEN_B}` },
    });
    expect(reply.status).toBe(401);
  });

  it('refuses an expired token', async () => {
    rig.store.add({
      tokenId: 'tok-expired',
      tokenHash: tokenDigest(PEPPER, expired),
      player: player('aa'),
      expiresAtMs: 0,
      revoked: false,
    });
    const reply = await rig.send('/p/aa', {
      body: INIT,
      headers: { Authorization: `Bearer ${expired}` },
    });
    expect(reply.status).toBe(401);
  });

  it('accepts a valid token and answers initialize with a session', async () => {
    const reply = await rig.send('/p/aa', { body: INIT });
    expect(reply.status).toBe(200);
    expect(typeof reply.headers['mcp-session-id']).toBe('string');
  });
});

describe('Origin and Host', () => {
  it.each(['https://evil.example', 'http://localhost:3000'])(
    'refuses Origin %s',
    async (origin) => {
      const reply = await rig.send('/p/aa', { body: INIT, headers: { Origin: origin } });
      expect(reply.status).toBe(403);
    },
  );

  it.each(['evil.example', 'localhost:9999', '127.0.0.1:1'])('refuses Host %s', async (host) => {
    const reply = await rig.send('/p/aa', { body: INIT, headers: { host } });
    expect(reply.status).toBe(403);
  });

  it('accepts an allowed host with the bound port', async () => {
    const reply = await rig.send('/p/aa', {
      body: INIT,
      headers: { host: `localhost:${rig.port}` },
    });
    expect(reply.status).toBe(200);
  });
});
