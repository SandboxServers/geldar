import { request } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { McpConfig } from '../config.ts';
import { FakeTokenStore } from '../fakes/stores.fakes.ts';
import type {
  MissReason,
  PlayerRecord,
  RateDecision,
  RateLimiter,
  ResolvedToken,
} from '../ports.ts';
import { MISS_CACHE_MS, MissCache, tokenDigest } from './auth.ts';
import type { FrontDoor } from './front.ts';
import { createFrontDoor } from './front.ts';

const PEPPER = new TextEncoder().encode('auth-reasons-test-pepper-0123456789');
const NOW = 1_000_000;
const FAR = NOW + 1_000_000_000;
const TOKEN_A = 'token-for-player-aa-0123456789';
const TOKEN_R = 'token-revoked-cc-0123456789';
const TOKEN_X = 'token-expired-dd-0123456789';
const TOKEN_P = 'token-paused-ee-0123456789';
const UNKNOWN = 'unknown-token-0123456789xyz';
// A canary the log scan must never find, in whole or in any prefix of 12 characters or more.
const CANARY = 'canary-7Qz9xLm2Vb4nKp8sWd1';
const INIT = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 't', version: '0' },
  },
});

const CONFIG = {
  bind: '127.0.0.1',
  port: 0,
  allowedHosts: ['localhost', '127.0.0.1'],
  publicHost: null,
} as McpConfig['http'];

const OPEN: RateLimiter = {
  take: (): RateDecision => ({ allowed: true, retryAfterMs: 0 }),
  peek: (): RateDecision => ({ allowed: true, retryAfterMs: 0 }),
};

function player(playerId: string, status: PlayerRecord['status'] = 'active'): PlayerRecord {
  return {
    playerId,
    lifeId: `${playerId}_life`,
    ownerId: 'owner-1',
    displayName: playerId.toUpperCase(),
    harness: 'test',
    status,
  };
}

/** A store that counts the explanations asked for, and can be made to fail when asked. */
class ExplainSpy extends FakeTokenStore {
  calls = 0;
  lookups = 0;
  failExplain = false;

  override async resolve(tokenHash: Uint8Array, nowMs: number): Promise<ResolvedToken | null> {
    this.lookups += 1;
    return super.resolve(tokenHash, nowMs);
  }

  override async explainMiss(tokenHash: Uint8Array, nowMs: number): Promise<MissReason> {
    this.calls += 1;
    if (this.failExplain) throw new Error('the database is down');
    return super.explainMiss(tokenHash, nowMs);
  }
}

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

let door: FrontDoor;
let port: number;
let store: ExplainSpy;
let logs: Record<string, string | number>[];

function withoutUndefined(headers: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([, v]) => v !== undefined)) as Record<
    string,
    string
  >;
}

/** A raw POST with the given headers. Only the answer's status, headers and body are kept. */
function send(path: string, headers: Record<string, string | undefined>): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: 'POST',
        headers: withoutUndefined({
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
          ...headers,
        }),
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          body += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on('error', reject);
    req.end(INIT);
  });
}

/** The log line is written when the response closes, which can land just after the client's end. */
function pause(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

/** The answer as a client sees it, without the Date header that changes on every reply. */
function visible(reply: Reply): string {
  const headers = { ...reply.headers };
  delete headers.date;
  return JSON.stringify({ status: reply.status, headers, body: reply.body });
}

beforeEach(async () => {
  store = new ExplainSpy();
  store.add({
    tokenId: 'tok-a',
    tokenHash: tokenDigest(PEPPER, TOKEN_A),
    player: player('aa'),
    expiresAtMs: FAR,
    revoked: false,
  });
  store.add({
    tokenId: 'tok-r',
    tokenHash: tokenDigest(PEPPER, TOKEN_R),
    player: player('cc'),
    expiresAtMs: FAR,
    revoked: true,
  });
  store.add({
    tokenId: 'tok-x',
    tokenHash: tokenDigest(PEPPER, TOKEN_X),
    player: player('dd'),
    expiresAtMs: 0,
    revoked: false,
  });
  store.add({
    tokenId: 'tok-p',
    tokenHash: tokenDigest(PEPPER, TOKEN_P),
    player: player('ee', 'paused'),
    expiresAtMs: FAR,
    revoked: false,
  });
  logs = [];
  door = createFrontDoor({
    http: CONFIG,
    pepper: PEPPER,
    store,
    limiter: OPEN,
    createSession: () =>
      new McpServer({ name: 'auth-reasons', version: '0.0.0' }, { capabilities: {} }),
    log: (line) => logs.push(line),
    now: () => NOW,
  });
  port = await door.listen(0);
});

afterEach(async () => {
  await door.close();
});

/** Each refused request: its path, its headers, the status it gets and the reason it must log. */
const REFUSALS: [string, string, Record<string, string | undefined>, number, string][] = [
  ['no_header', '/p/aa', { Authorization: undefined }, 401, 'no_header'],
  ['malformed_scheme', '/p/aa', { Authorization: `Basic ${TOKEN_A}` }, 401, 'malformed_scheme'],
  ['token_shape', '/p/aa', { Authorization: 'Bearer short' }, 401, 'token_shape'],
  ['unknown_token', '/p/aa', { Authorization: `Bearer ${UNKNOWN}` }, 401, 'unknown_token'],
  ['token_revoked', '/p/cc', { Authorization: `Bearer ${TOKEN_R}` }, 401, 'token_revoked'],
  ['token_expired', '/p/dd', { Authorization: `Bearer ${TOKEN_X}` }, 401, 'token_expired'],
  ['player_not_active', '/p/ee', { Authorization: `Bearer ${TOKEN_P}` }, 401, 'player_not_active'],
  ['wrong_player', '/p/bb', { Authorization: `Bearer ${TOKEN_A}` }, 403, 'wrong_player'],
];

describe('refusal reasons in the log', () => {
  it.each(REFUSALS)(
    'logs %s for its cause, with the status it got',
    async (_name, path, headers, status, reason) => {
      const reply = await send(path, headers);
      await pause();
      expect(reply.status).toBe(status);
      expect(logs).toEqual([
        {
          event: status === 401 ? 'unauthorized' : 'forbidden',
          player_id: path.slice(3),
          status,
          reason,
        },
      ]);
    },
  );

  it('answers byte-identically for every 401 reason', async () => {
    const answers: string[] = [];
    for (const [, path, headers, status] of REFUSALS.filter((row) => row[3] === 401)) {
      answers.push(visible(await send(path, headers)));
    }
    expect(new Set(answers).size).toBe(1);
  });

  it('answers byte-identically for a store that cannot explain the miss', async () => {
    store.failExplain = true;
    const reply = await send('/p/aa', { Authorization: `Bearer ${UNKNOWN}` });
    await pause();
    expect(logs.at(-1)?.reason).toBe('internal');
    const plain = await send('/p/aa', { Authorization: undefined });
    expect(visible(reply)).toBe(visible(plain));
  });

  it('logs internal, not the error text, when the explanation fails', async () => {
    store.failExplain = true;
    await send('/p/aa', { Authorization: `Bearer ${UNKNOWN}` });
    await pause();
    expect(logs).toEqual([
      { event: 'unauthorized', player_id: 'aa', status: 401, reason: 'internal' },
    ]);
  });

  it('never carries the token, its digest or a prefix of either in a log line', async () => {
    const presented = [CANARY, TOKEN_A, TOKEN_R, UNKNOWN];
    await send('/p/aa', { Authorization: `Bearer ${CANARY}` });
    await send('/p/bb', { Authorization: `Bearer ${TOKEN_A}` });
    await send('/p/cc', { Authorization: `Bearer ${TOKEN_R}` });
    await send('/p/aa', { Authorization: `Bearer ${UNKNOWN}` });
    await pause();
    const digests = [TOKEN_A, TOKEN_R].map((t) =>
      Buffer.from(tokenDigest(PEPPER, t)).toString('hex'),
    );
    const text = JSON.stringify(logs);
    expect(logs.length).toBe(4);
    for (const secret of [...presented, ...digests]) {
      for (let length = 12; length <= secret.length; length += 1) {
        expect(text).not.toContain(secret.slice(0, length));
      }
    }
  });

  it('does not ask the store to explain a success', async () => {
    const reply = await send('/p/aa', { Authorization: `Bearer ${TOKEN_A}` });
    expect(reply.status).toBe(200);
    expect(store.calls).toBe(0);
    await send('/p/aa', { Authorization: `Bearer ${UNKNOWN}` });
    expect(store.calls).toBe(1);
  });

  it('answers a repeated refused bearer from the miss cache, with no second lookup', async () => {
    for (let i = 0; i < 3; i++) await send('/p/aa', { Authorization: `Bearer ${UNKNOWN}` });
    expect(store.lookups).toBe(1);
    expect(store.calls).toBe(1);
  });

  it('asks the store why for one uncached miss in eight, not for each', async () => {
    for (let i = 0; i < 16; i++) {
      await send('/p/aa', { Authorization: `Bearer ${UNKNOWN}-${i}-0123456789abcdef` });
    }
    expect(store.lookups).toBe(16);
    expect(store.calls).toBe(2);
  });
});

describe('MissCache', () => {
  const DIGEST = new Uint8Array([1, 2, 3]);

  it('remembers a refused digest until its window closes, then forgets it', () => {
    const misses = new MissCache();
    misses.remember(DIGEST, 'token_revoked', 0);
    expect(misses.get(DIGEST, MISS_CACHE_MS - 1)).toBe('token_revoked');
    expect(misses.get(DIGEST, MISS_CACHE_MS)).toBeUndefined();
  });

  it('clears itself rather than grow past its bound', () => {
    const misses = new MissCache();
    for (let i = 0; i < 1024; i++)
      misses.remember(new Uint8Array([i >> 8, i & 255]), 'unknown_token', 0);
    misses.remember(DIGEST, 'token_expired', 0);
    expect(misses.get(new Uint8Array([0, 0]), 0)).toBeUndefined();
    expect(misses.get(DIGEST, 0)).toBe('token_expired');
  });
});
