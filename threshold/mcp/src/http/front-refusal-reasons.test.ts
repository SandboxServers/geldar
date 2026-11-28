import { type ClientRequest, request } from 'node:http';
import { connect, type Socket } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PUBLIC_DEFAULTS } from '../config-public.ts';
import { FakeTokenStore } from '../fakes/stores.fakes.ts';
import { tokenDigest } from './auth.ts';
import {
  CONFIG,
  FAILED_AUTH_PER_MINUTE,
  type FrontRig,
  MAX_OPEN_PER_PLAYER,
  PEPPER,
  player,
  startFrontRig,
  TOKEN_A,
  TOKEN_B,
} from './front.fixture.ts';
import { MAX_LOOKUPS_IN_FLIGHT } from './limits.ts';

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

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function until(test: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !test(); i++) await sleep(10);
  expect(test()).toBe(true);
}

/** A GET stream held open by the test: resolves with the status once the headers arrive. */
function holdStream(
  port: number,
  sessionId: string,
  address: string,
): Promise<{ status: number; req: ClientRequest }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        method: 'GET',
        path: '/p/aa',
        headers: {
          Accept: 'text/event-stream',
          Authorization: `Bearer ${TOKEN_A}`,
          'mcp-session-id': sessionId,
          'x-geldar-client-ip': address,
        },
      },
      (res) => {
        res.resume();
        resolve({ status: res.statusCode ?? 0, req });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/** A POST whose headers are sent and whose body is not: the front door holds an open-request slot for it. */
function holdPost(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.on('error', () => undefined);
    socket.once('error', reject);
    socket.once('connect', () => {
      socket.write(
        `POST /p/aa HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer ${TOKEN_A}\r\n` +
          'Content-Type: application/json\r\nAccept: application/json, text/event-stream\r\n' +
          'Content-Length: 10\r\n\r\n',
      );
      resolve(socket);
    });
  });
}

/** A store whose uncached lookups wait until the test releases them. */
class GatedStore extends FakeTokenStore {
  inFlight = 0;
  private gates: Array<() => void> = [];

  override isCachedHit(): boolean {
    return false;
  }

  override async resolve(hash: Uint8Array, nowMs: number) {
    this.inFlight += 1;
    try {
      await new Promise<void>((open) => this.gates.push(open));
      return await super.resolve(hash, nowMs);
    } finally {
      this.inFlight -= 1;
    }
  }

  releaseAll(): void {
    for (const open of this.gates.splice(0)) open();
  }
}

const bad = (n: number): string => `gmcp-${String(n).padStart(64, '0')}`;

function postWith(port: number, token: string): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/p/aa`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: BODY,
  });
}

// The refusals the front door and the mock make themselves, each reported once with its reason and status.
describe('the remaining refusal reasons call onRefusal once', () => {
  it('too_many_open_requests for a second GET stream from one address, once, with 429', async () => {
    const seen: Refusal[] = [];
    // Behind a trusted proxy the streams share one effective address; the TCP peer keeps its connection cap.
    await rig.restart({
      onRefusal: (refusal) => seen.push(refusal),
      http: { ...CONFIG, trustedProxies: ['127.0.0.1'] },
      limits: { maxConnectionsPerAddress: 1 },
    });
    const sessionId = await rig.openSession();
    const first = await holdStream(rig.port, sessionId, '127.0.0.2');
    try {
      expect(first.status).toBe(200);
      const second = await holdStream(rig.port, sessionId, '127.0.0.2');
      expect(second.status).toBe(429);
      expect(seen).toEqual([{ reason: 'too_many_open_requests', status: 429 }]);
    } finally {
      first.req.destroy();
    }
  });

  it('too_many_open_requests for a POST past the player open-request cap, once, with 429', async () => {
    const seen: Refusal[] = [];
    await rig.restart({ onRefusal: (refusal) => seen.push(refusal) });
    const held: Socket[] = [];
    try {
      for (let i = 0; i < MAX_OPEN_PER_PLAYER; i++) held.push(await holdPost(rig.port));
      await sleep(50);
      const reply = await rig.send('/p/aa', { body: BODY });
      expect(reply.status).toBe(429);
      expect(seen).toEqual([{ reason: 'too_many_open_requests', status: 429 }]);
    } finally {
      for (const socket of held) socket.destroy();
    }
  });

  it('kill_switch for a public request while the switch is on, once, with 503', async () => {
    const seen: Refusal[] = [];
    await rig.restart({
      onRefusal: (refusal) => seen.push(refusal),
      public: { ...PUBLIC_DEFAULTS, killSwitch: true },
    });
    const reply = await rig.send('/p/aa', { body: BODY });
    expect(reply.status).toBe(503);
    expect(seen).toEqual([{ reason: 'kill_switch', status: 503 }]);
  });

  it('lookup_busy for an uncached lookup past the in-flight cap, once, with 503', async () => {
    const store = new GatedStore();
    store.add({
      tokenId: 'tok-a',
      tokenHash: tokenDigest(PEPPER, TOKEN_A),
      player: player('aa'),
      expiresAtMs: Number.POSITIVE_INFINITY,
      revoked: false,
    });
    const seen: Refusal[] = [];
    await rig.restart({ onRefusal: (refusal) => seen.push(refusal), store });
    const running: Promise<Response>[] = [];
    try {
      for (let i = 0; i < MAX_LOOKUPS_IN_FLIGHT; i++) running.push(postWith(rig.port, bad(i)));
      await until(() => store.inFlight === MAX_LOOKUPS_IN_FLIGHT);
      const refused = await postWith(rig.port, bad(500));
      expect(refused.status).toBe(503);
      expect(seen).toEqual([{ reason: 'lookup_busy', status: 503 }]);
    } finally {
      store.releaseAll();
      await Promise.all(running);
    }
  });

  it('session_not_found for a POST with an unknown session id, once, with 404', async () => {
    const seen: Refusal[] = [];
    await rig.restart({ onRefusal: (refusal) => seen.push(refusal) });
    const reply = await rig.send('/p/aa', {
      body: BODY,
      headers: { 'mcp-session-id': 'no-such-session' },
    });
    expect(reply.status).toBe(404);
    expect(seen).toEqual([{ reason: 'session_not_found', status: 404 }]);
  });

  it('session_superseded for a POST on a session a newer one replaced, once, with 404', async () => {
    const seen: Refusal[] = [];
    await rig.restart({ onRefusal: (refusal) => seen.push(refusal) });
    const old = await rig.openSession();
    await rig.openSession();
    const reply = await rig.send('/p/aa', { body: BODY, headers: { 'mcp-session-id': old } });
    expect(reply.status).toBe(404);
    expect(seen).toEqual([{ reason: 'session_superseded', status: 404 }]);
  });
});
