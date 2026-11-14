import { describe, expect, it } from 'vitest';
import type { AgentFlagStore } from '../src/api/route.ts';
import { OwnerRefusedError } from '../src/owner-agents-pg.ts';
import {
  baseDeps,
  bearer,
  CSRF,
  cookie,
  hash,
  IDENT,
  KEY_ALL,
  SID,
  serve,
} from './owner-api-harness.ts';

interface FlagState {
  camera: boolean;
  thoughts: boolean;
}

/** A fake flag store that records each call and sets the flag on p1 only (p2 is not alice's). */
function fakeFlags(state: FlagState, fail?: unknown) {
  const calls: string[] = [];
  const store: AgentFlagStore = {
    async setPublicCamera(h, p, v) {
      calls.push(`camera:${h}:${p}:${v}`);
      if (fail !== undefined) throw fail;
      if (p !== 'p1') return false;
      state.camera = v;
      return true;
    },
    async setThoughtsDelayedPublic(h, p, v) {
      calls.push(`thoughts:${h}:${p}:${v}`);
      if (fail !== undefined) throw fail;
      if (p !== 'p1') return false;
      state.thoughts = v;
      return true;
    },
  };
  return { store, calls };
}

/** A Bearer key with exactly the given scopes (the harness has only the all-scope key). */
function keyWith(scopes: string[]) {
  const value = `gowner-${'b2'.repeat(32)}`;
  return {
    value,
    ownerKeys: {
      hash,
      store: {
        resolve: async (h: Buffer) => (h.equals(hash(value)) ? { ownerId: 'alice', scopes } : null),
        mint: async () => null,
        revoke: async () => null,
        list: async () => null,
      },
    },
  };
}

describe('PATCH /agents/{playerId} visibility flags (C7-04e)', () => {
  it('sets publicCamera through the store with the session identity, and answers 200 with the agent', async () => {
    const state = { camera: false, thoughts: false };
    const { store, calls } = fakeFlags(state);
    const srv = await serve(baseDeps({ flags: store }));
    try {
      const r = await srv.call('PATCH', '/api/v1/agents/p1', cookie, '{"publicCamera":true}');
      expect(r.status).toBe(200);
      expect(JSON.parse(r.body).playerId).toBe('p1');
      expect(calls).toEqual([`camera:${IDENT}:p1:true`]);
      expect(state.camera).toBe(true);
    } finally {
      await srv.stop();
    }
  });

  it('sets thoughtsDelayedPublic through its own store method, and not the camera one', async () => {
    const state = { camera: false, thoughts: false };
    const { store, calls } = fakeFlags(state);
    const srv = await serve(baseDeps({ flags: store }));
    try {
      const r = await srv.call(
        'PATCH',
        '/api/v1/agents/p1',
        cookie,
        '{"thoughtsDelayedPublic":false}',
      );
      expect(r.status).toBe(200);
      expect(calls).toEqual([`thoughts:${IDENT}:p1:false`]);
      expect(state.camera).toBe(false);
    } finally {
      await srv.stop();
    }
  });

  it('sets both flags together, each through its store method', async () => {
    const state = { camera: false, thoughts: false };
    const { store, calls } = fakeFlags(state);
    const srv = await serve(baseDeps({ flags: store }));
    try {
      const r = await srv.call(
        'PATCH',
        '/api/v1/agents/p1',
        cookie,
        '{"publicCamera":true,"thoughtsDelayedPublic":true}',
      );
      expect(r.status).toBe(200);
      expect(calls).toEqual([`camera:${IDENT}:p1:true`, `thoughts:${IDENT}:p1:true`]);
    } finally {
      await srv.stop();
    }
  });

  it('refuses displayName with 422 invalid and writes nothing (rename is C7-07)', async () => {
    const state = { camera: false, thoughts: false };
    const { store, calls } = fakeFlags(state);
    const srv = await serve(baseDeps({ flags: store }));
    try {
      // A boolean, so only the field name refuses it: an allowed displayName would write and answer 200.
      const r = await srv.call('PATCH', '/api/v1/agents/p1', cookie, '{"displayName":true}');
      expect(r.status).toBe(422);
      expect(JSON.parse(r.body).code).toBe('invalid');
      expect(calls).toEqual([]);
      expect(state.camera).toBe(false);
      expect(state.thoughts).toBe(false);
    } finally {
      await srv.stop();
    }
  });

  it('refuses an unknown field and a non-boolean flag with 422 invalid, and writes nothing', async () => {
    const state = { camera: false, thoughts: false };
    const { store, calls } = fakeFlags(state);
    const srv = await serve(baseDeps({ flags: store }));
    try {
      for (const body of [
        '{"status":"retired"}',
        '{"publicCamera":"true"}',
        '{"publicCamera":true,"extra":1}',
        '{}',
        '[true]',
        'not json',
      ]) {
        const r = await srv.call('PATCH', '/api/v1/agents/p1', cookie, body);
        expect(r.status, body).toBe(422);
        expect(JSON.parse(r.body).code, body).toBe('invalid');
      }
      expect(calls).toEqual([]);
    } finally {
      await srv.stop();
    }
  });

  it('answers 403 csrf_required for a missing or wrong CSRF token and writes nothing', async () => {
    const state = { camera: false, thoughts: false };
    const { store, calls } = fakeFlags(state);
    const srv = await serve(baseDeps({ flags: store }));
    try {
      const none = await srv.call(
        'PATCH',
        '/api/v1/agents/p1',
        { cookie: `__Host-gr_session=${SID}` },
        '{"publicCamera":true}',
      );
      expect(none.status).toBe(403);
      expect(JSON.parse(none.body).code).toBe('csrf_required');
      const wrong = await srv.call(
        'PATCH',
        '/api/v1/agents/p1',
        { cookie: `__Host-gr_session=${SID}`, 'x-csrf-token': `${CSRF}x` },
        '{"publicCamera":true}',
      );
      expect(wrong.status).toBe(403);
      expect(JSON.parse(wrong.body).code).toBe('csrf_required');
      expect(calls).toEqual([]);
      expect(state.camera).toBe(false);
    } finally {
      await srv.stop();
    }
  });

  it('refuses every Bearer owner key, of any scope, with 401 unauthenticated and writes nothing', async () => {
    const state = { camera: false, thoughts: false };
    const { store, calls } = fakeFlags(state);
    const readOnly = keyWith(['read']);
    const srv = await serve(baseDeps({ flags: store, ownerKeys: readOnly.ownerKeys }));
    try {
      for (const key of [readOnly.value, KEY_ALL]) {
        const r = await srv.call(
          'PATCH',
          '/api/v1/agents/p1',
          bearer(key),
          '{"publicCamera":true}',
        );
        expect(r.status).toBe(401);
        expect(JSON.parse(r.body).code).toBe('unauthenticated');
      }
      expect(calls).toEqual([]);
      expect(state.camera).toBe(false);
    } finally {
      await srv.stop();
    }
  });

  it('answers 404 for a foreign agent and does not call the store', async () => {
    const state = { camera: false, thoughts: false };
    const { store, calls } = fakeFlags(state);
    const srv = await serve(baseDeps({ flags: store }));
    try {
      const r = await srv.call('PATCH', '/api/v1/agents/p2', cookie, '{"publicCamera":true}');
      expect(r.status).toBe(404);
      expect(JSON.parse(r.body).code).toBe('not_found');
      expect(calls).toEqual([]);
    } finally {
      await srv.stop();
    }
  });

  it("answers 404, not 200, when the store says the player is not the owner's", async () => {
    const state = { camera: false, thoughts: false };
    const { store } = fakeFlags(state);
    // The loader says p1 is alice's, but the store refuses the write (false).
    const srv = await serve(baseDeps({ flags: { ...store, setPublicCamera: async () => false } }));
    try {
      const r = await srv.call('PATCH', '/api/v1/agents/p1', cookie, '{"publicCamera":true}');
      expect(r.status).toBe(404);
      expect(JSON.parse(r.body).code).toBe('not_found');
    } finally {
      await srv.stop();
    }
  });

  it('answers 500 internal (no success reported) when the store throws for another reason', async () => {
    const state = { camera: false, thoughts: false };
    const { store } = fakeFlags(state, new Error('connection reset'));
    const srv = await serve(baseDeps({ flags: store }));
    try {
      const r = await srv.call('PATCH', '/api/v1/agents/p1', cookie, '{"publicCamera":true}');
      expect(r.status).toBe(500);
      expect(JSON.parse(r.body).code).toBe('internal');
      expect(r.body).not.toContain('connection reset');
    } finally {
      await srv.stop();
    }
  });

  it('answers 429 rate_limited with Retry-After when the database refuses a toggle as too frequent, flag unchanged', async () => {
    const state = { camera: false, thoughts: false };
    const tooFrequent = Object.assign(new Error('too many changes'), { code: '54000' });
    const { store } = fakeFlags(state, tooFrequent);
    const srv = await serve(baseDeps({ flags: store }));
    try {
      const r = await srv.call('PATCH', '/api/v1/agents/p1', cookie, '{"publicCamera":true}');
      expect(r.status).toBe(429);
      expect(JSON.parse(r.body).code).toBe('rate_limited');
      expect(r.retryAfter).toBe('10');
      expect(state.camera).toBe(false);
    } finally {
      await srv.stop();
    }
  });

  it('writes the turn-off before the turn-on, so a refused second write never widens exposure', async () => {
    const state = { camera: false, thoughts: false };
    const { store, calls } = fakeFlags(state);
    const srv = await serve(baseDeps({ flags: store }));
    try {
      const widen = await srv.call(
        'PATCH',
        '/api/v1/agents/p1',
        cookie,
        '{"publicCamera":true,"thoughtsDelayedPublic":false}',
      );
      expect(widen.status).toBe(200);
      expect(calls).toEqual([`thoughts:${IDENT}:p1:false`, `camera:${IDENT}:p1:true`]);
      calls.length = 0;
      const narrow = await srv.call(
        'PATCH',
        '/api/v1/agents/p1',
        cookie,
        '{"publicCamera":false,"thoughtsDelayedPublic":true}',
      );
      expect(narrow.status).toBe(200);
      expect(calls).toEqual([`camera:${IDENT}:p1:false`, `thoughts:${IDENT}:p1:true`]);
    } finally {
      await srv.stop();
    }
  });

  it('answers 401 unauthenticated when the database refuses the write with 42501 (owner banned mid-request)', async () => {
    const state = { camera: false, thoughts: false };
    const denied = Object.assign(new Error('banned'), { code: '42501' });
    const { store } = fakeFlags(state, denied);
    const srv = await serve(baseDeps({ flags: store }));
    try {
      const r = await srv.call('PATCH', '/api/v1/agents/p1', cookie, '{"publicCamera":true}');
      expect(r.status).toBe(401);
      expect(JSON.parse(r.body).code).toBe('unauthenticated');
      expect(state.camera).toBe(false);
    } finally {
      await srv.stop();
    }
  });

  it('answers 401 for a banned owner at the guard and writes nothing', async () => {
    const state = { camera: false, thoughts: false };
    const { store, calls } = fakeFlags(state);
    const refuse = async (): Promise<never> => {
      throw new OwnerRefusedError();
    };
    const srv = await serve(baseDeps({ flags: store, agents: refuse }));
    try {
      const r = await srv.call('PATCH', '/api/v1/agents/p1', cookie, '{"publicCamera":true}');
      expect(r.status).toBe(401);
      expect(JSON.parse(r.body).code).toBe('unauthenticated');
      expect(calls).toEqual([]);
      expect(state.camera).toBe(false);
    } finally {
      await srv.stop();
    }
  });

  it('answers 500 internal when no flag store is wired (never a silent 200)', async () => {
    const srv = await serve(baseDeps());
    try {
      const r = await srv.call('PATCH', '/api/v1/agents/p1', cookie, '{"publicCamera":true}');
      expect(r.status).toBe(500);
      expect(JSON.parse(r.body).code).toBe('internal');
    } finally {
      await srv.stop();
    }
  });
});
