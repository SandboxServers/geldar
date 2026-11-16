import { describe, expect, it } from 'vitest';
import { bodyRoutes } from '../src/api/body.ts';
import { bodyRetireRoutes } from '../src/api/body-retire.ts';
import { createBodySlot } from '../src/api/body-slot.ts';
import type { TokenDeps, TokenStore } from '../src/tokens-service.ts';
import { baseDeps, bearer, CSRF, cookie, IDENT, KEY_ALL, serve } from './owner-api-harness.ts';

const RETIRE = '/api/v1/agents/p1/retire';
const STOP = '/api/v1/agents/p1/body/stop';
const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));

type StopMode = 'stopped' | 'unknown' | 'busy' | 'error' | 'unreachable';

/**
 * The agents of alice (p1 ok, p3 retired, p4 a bad display name, p5 retired with a bad display name) and bob (p2).
 * p9 does not exist.
 */
const ROWS: Record<string, Record<string, unknown>> = {
  p1: { ownerId: 'alice', playerId: 'p1', displayName: 'Ranger' },
  p2: { ownerId: 'bob', playerId: 'p2', displayName: 'Scout' },
  p3: { ownerId: 'alice', playerId: 'p3', displayName: 'Ghost', status: 'retired' },
  p4: { ownerId: 'alice', playerId: 'p4', displayName: 'ab' },
  p5: { ownerId: 'alice', playerId: 'p5', displayName: 'ab', status: 'retired' },
};

/**
 * A server with the body stop and the retire route on one shared slot (C7-04c2 and C7-04d). Every call is logged in
 * order: 'stop' (the supervisor), 'revoke' (the token service) and 'retire' (the database).
 */
async function withWorld(
  run: (w: ReturnType<typeof worldOf>) => Promise<void>,
  opts: { mountRetire?: boolean; noTokens?: boolean } = {},
): Promise<void> {
  const w = worldOf();
  const srv = await serve(
    baseDeps({
      agents: async (owner, player) => {
        const row = ROWS[player];
        return row && row.ownerId === owner ? row : null;
      },
      ...(opts.noTokens ? {} : { tokens: w.tokens }),
      routes: [
        ...bodyRoutes({ conn: w.conn, shard: 'phase0', timeoutMs: 1000, slot: w.slot }),
        ...(opts.mountRetire === false
          ? []
          : bodyRetireRoutes({
              conn: w.conn,
              shard: 'phase0',
              timeoutMs: 1000,
              slot: w.slot,
              retirePlayer: w.retirePlayer,
            })),
      ],
    }),
  );
  try {
    await run({ ...w, srv });
  } finally {
    await srv.stop();
  }
}

function worldOf() {
  const log: string[] = [];
  const payloads: Record<string, unknown>[] = [];
  const retireArgs: string[][] = [];
  const mode: {
    stop: StopMode;
    hold: boolean;
    revoke: 'ok' | 'none' | 'zero' | 'throw';
    retire: 'true' | 'false' | 'throw';
    charge: number;
  } = { stop: 'stopped', hold: false, revoke: 'ok', retire: 'true', charge: 0 };
  let arrive: () => void = () => undefined;
  let release: () => void = () => undefined;
  const held = new Promise<void>((ok) => {
    arrive = ok;
  });
  const gate = new Promise<void>((ok) => {
    release = ok;
  });
  const slot = createBodySlot();
  const conn = {
    async request(_subject: string, data: Uint8Array) {
      log.push('stop');
      payloads.push(JSON.parse(new TextDecoder().decode(data)) as Record<string, unknown>);
      if (mode.hold) {
        arrive();
        await gate;
      }
      if (mode.stop === 'unreachable') throw new Error('no responders');
      const reply =
        mode.stop === 'stopped' ? { ok: true, code: 'stopped' } : { ok: false, code: mode.stop };
      return { data: enc(reply) };
    },
  };
  const store: TokenStore = {
    renewToken: async () => {
      throw new Error('not used by retire');
    },
    revokeTokens: async () => {
      log.push('revoke');
      if (mode.revoke === 'throw') throw new Error('db down');
      if (mode.revoke === 'zero') return 0;
      return mode.revoke === 'none' ? null : 1;
    },
    tokenInfo: async () => null,
  };
  const tokens: TokenDeps = {
    store,
    isAdmin: async () => false,
    charge: () => mode.charge,
    audit: async () => undefined,
    issue: () => {
      throw new Error('not used by retire');
    },
    now: () => new Date(0),
  };
  const retirePlayer = async (identityHash: string, playerId: string): Promise<boolean> => {
    log.push('retire');
    retireArgs.push([identityHash, playerId]);
    if (mode.retire === 'throw') throw new Error('db down');
    return mode.retire === 'true';
  };
  return {
    log,
    payloads,
    retireArgs,
    mode,
    slot,
    conn,
    tokens,
    retirePlayer,
    held,
    release: () => release(),
  };
}

describe('owner API retire route (C7-04d)', () => {
  it('answers 202 after the stop, the token revoke and the retire, in that order', async () => {
    await withWorld(async (w) => {
      const r = await w.srv.call('POST', RETIRE, cookie);
      expect(r.status).toBe(202);
      const body = JSON.parse(r.body) as { opId: string; state: string };
      expect(body.state).toBe('done');
      expect(body.opId).toMatch(/^[0-9a-f-]{36}$/);
      expect(w.log).toEqual(['stop', 'revoke', 'retire']);
      expect(w.payloads[0]).toMatchObject({ ownerId: 'alice', playerName: 'Ranger', op: 'stop' });
      expect(w.retireArgs).toEqual([[IDENT, 'p1']]);
    });
  });

  it('answers 503 body_unavailable with Retry-After when the supervisor is unreachable, and nothing else runs', async () => {
    await withWorld(async (w) => {
      w.mode.stop = 'unreachable';
      const r = await w.srv.call('POST', RETIRE, cookie);
      expect(r.status).toBe(503);
      expect(JSON.parse(r.body).code).toBe('body_unavailable');
      expect(r.retryAfter).toBe('30');
      expect(w.log).toEqual(['stop']);
    });
  });

  it('answers 503 when the supervisor refuses the stop as busy, and nothing else runs', async () => {
    await withWorld(async (w) => {
      w.mode.stop = 'busy';
      const r = await w.srv.call('POST', RETIRE, cookie);
      expect(r.status).toBe(503);
      expect(JSON.parse(r.body).code).toBe('body_unavailable');
      expect(w.log).toEqual(['stop']);
    });
  });

  it('answers 503 when the supervisor answers error (a helper failure on stop, the code the supervisor sends), nothing is retired and the slot is freed', async () => {
    await withWorld(async (w) => {
      w.mode.stop = 'error';
      const r = await w.srv.call('POST', RETIRE, cookie);
      expect(r.status).toBe(503);
      expect(JSON.parse(r.body).code).toBe('body_unavailable');
      expect(r.retryAfter).toBe('30');
      expect(w.log).toEqual(['stop']);
      expect(w.retireArgs).toEqual([]);
      expect(w.slot.size).toBe(0);
    });
  });

  it('retries safely: after the supervisor is back the same retire answers 202 (the slot was freed)', async () => {
    await withWorld(async (w) => {
      w.mode.stop = 'unreachable';
      expect((await w.srv.call('POST', RETIRE, cookie)).status).toBe(503);
      w.mode.stop = 'stopped';
      const retry = await w.srv.call('POST', RETIRE, cookie);
      expect(retry.status).toBe(202);
      expect(w.log).toEqual(['stop', 'stop', 'revoke', 'retire']);
      expect(w.slot.size).toBe(0);
    });
  });

  it('retires when the supervisor does not know the body (unknown): no body is left to stop', async () => {
    await withWorld(async (w) => {
      w.mode.stop = 'unknown';
      const r = await w.srv.call('POST', RETIRE, cookie);
      expect(r.status).toBe(202);
      expect(w.log).toEqual(['stop', 'revoke', 'retire']);
    });
  });

  it("answers 404 for another owner's, a missing and a retired agent, byte-equal, with no supervisor call", async () => {
    await withWorld(async (w) => {
      const foreign = await w.srv.call('POST', '/api/v1/agents/p2/retire', cookie);
      const missing = await w.srv.call('POST', '/api/v1/agents/p9/retire', cookie);
      const retired = await w.srv.call('POST', '/api/v1/agents/p3/retire', cookie);
      expect(foreign.status).toBe(404);
      expect(foreign.body).toBe(missing.body);
      expect(retired.status).toBe(404);
      expect(retired.body).toBe(missing.body);
      expect(w.log).toEqual([]);
    });
  });

  it('refuses a Bearer key with every scope (401) and a cookie write without or with a wrong CSRF token (403)', async () => {
    await withWorld(async (w) => {
      const key = await w.srv.call('POST', RETIRE, bearer(KEY_ALL));
      expect(key.status).toBe(401);
      expect(JSON.parse(key.body).code).toBe('unauthenticated');
      const foreignKey = await w.srv.call('POST', '/api/v1/agents/p2/retire', bearer(KEY_ALL));
      expect(foreignKey.status).toBe(401);
      expect(JSON.parse(foreignKey.body).code).toBe('unauthenticated');
      const badNameKey = await w.srv.call('POST', '/api/v1/agents/p4/retire', bearer(KEY_ALL));
      expect(badNameKey.status).toBe(401);
      expect(JSON.parse(badNameKey.body).code).toBe('unauthenticated');
      const none = await w.srv.call('POST', RETIRE, { cookie: cookie.cookie });
      expect(none.status).toBe(403);
      expect(JSON.parse(none.body).code).toBe('csrf_required');
      const wrong = await w.srv.call('POST', RETIRE, {
        ...cookie,
        'x-csrf-token': `${CSRF}x`,
      });
      expect(wrong.status).toBe(403);
      expect(JSON.parse(wrong.body).code).toBe('csrf_required');
      expect(w.log).toEqual([]);
    });
  });

  it('answers 404 for a retired agent whose display name is also outside the shape: retired is checked first, byte-equal to missing', async () => {
    await withWorld(async (w) => {
      const retiredBadName = await w.srv.call('POST', '/api/v1/agents/p5/retire', cookie);
      const missing = await w.srv.call('POST', '/api/v1/agents/p9/retire', cookie);
      expect(retiredBadName.status).toBe(404);
      expect(retiredBadName.body).toBe(missing.body);
      expect(w.log).toEqual([]);
    });
  });

  it('answers 422 invalid before any supervisor call when the display name is outside the player-name shape', async () => {
    await withWorld(async (w) => {
      const r = await w.srv.call('POST', '/api/v1/agents/p4/retire', cookie);
      expect(r.status).toBe(422);
      expect(JSON.parse(r.body).code).toBe('invalid');
      expect(w.log).toEqual([]);
    });
  });

  it('answers 409 conflict while a stop of the same owner is in flight, with no supervisor call for the retire', async () => {
    await withWorld(async (w) => {
      w.mode.hold = true;
      const stopping = w.srv.call('POST', STOP, cookie);
      await w.held;
      const r = await w.srv.call('POST', RETIRE, cookie);
      expect(r.status).toBe(409);
      expect(JSON.parse(r.body).code).toBe('conflict');
      expect(w.log).toEqual(['stop']);
      expect(w.retireArgs).toEqual([]);
      w.release();
      expect((await stopping).status).toBe(202);
      expect(w.slot.size).toBe(0);
    });
  });

  it('answers 500 internal and does not retire when the token revoke throws', async () => {
    await withWorld(async (w) => {
      w.mode.revoke = 'throw';
      const r = await w.srv.call('POST', RETIRE, cookie);
      expect(r.status).toBe(500);
      expect(JSON.parse(r.body).code).toBe('internal');
      expect(w.log).toEqual(['stop', 'revoke']);
      expect(w.slot.size).toBe(0);
    });
  });

  it('answers 500 internal when the retire write throws, and frees the slot', async () => {
    await withWorld(async (w) => {
      w.mode.retire = 'throw';
      const r = await w.srv.call('POST', RETIRE, cookie);
      expect(r.status).toBe(500);
      expect(JSON.parse(r.body).code).toBe('internal');
      expect(w.log).toEqual(['stop', 'revoke', 'retire']);
      expect(w.slot.size).toBe(0);
    });
  });

  it('answers 404 when the database refuses the retire, and reports no success', async () => {
    await withWorld(async (w) => {
      w.mode.retire = 'false';
      const r = await w.srv.call('POST', RETIRE, cookie);
      expect(r.status).toBe(404);
      expect(JSON.parse(r.body).code).toBe('not_found');
      expect(r.body).not.toContain('retired');
    });
  });

  it('retries after the retire write throws: the second run stops, revokes (0 rows, not an error) and retires', async () => {
    await withWorld(async (w) => {
      w.mode.retire = 'throw';
      expect((await w.srv.call('POST', RETIRE, cookie)).status).toBe(500);
      w.mode.retire = 'true';
      w.mode.revoke = 'zero';
      const retry = await w.srv.call('POST', RETIRE, cookie);
      expect(retry.status).toBe(202);
      expect(w.log).toEqual(['stop', 'revoke', 'retire', 'stop', 'revoke', 'retire']);
      expect(w.slot.size).toBe(0);
    });
  });

  it('answers 500 internal before any supervisor call when the token services are not wired, and holds no slot', async () => {
    await withWorld(
      async (w) => {
        const r = await w.srv.call('POST', RETIRE, cookie);
        expect(r.status).toBe(500);
        expect(JSON.parse(r.body).code).toBe('internal');
        expect(w.log).toEqual([]);
        expect(w.slot.size).toBe(0);
      },
      { noTokens: true },
    );
  });

  it('charges the owner window once, at the router: a service charge of 5 does not limit the retire', async () => {
    await withWorld(async (w) => {
      w.mode.charge = 5;
      const r = await w.srv.call('POST', RETIRE, cookie);
      expect(r.status).toBe(202);
      expect(w.log).toEqual(['stop', 'revoke', 'retire']);
    });
  });

  it('answers 404 when the token revoke finds nothing to revoke, and does not retire', async () => {
    await withWorld(async (w) => {
      w.mode.revoke = 'none';
      const r = await w.srv.call('POST', RETIRE, cookie);
      expect(r.status).toBe(404);
      expect(w.log).toEqual(['stop', 'revoke']);
    });
  });

  it('is not mounted unless bodyRetireRoutes is in the route table (404 through the router)', async () => {
    await withWorld(
      async (w) => {
        const r = await w.srv.call('POST', RETIRE, cookie);
        expect(r.status).toBe(404);
        expect(w.log).toEqual([]);
      },
      { mountRetire: false },
    );
  });
});
