import { describe, expect, it } from 'vitest';
import { bodyRoutes } from '../src/api/body.ts';
import type { ApiDeps } from '../src/api/route.ts';
import { baseDeps, CSRF, cookie, serve } from './owner-api-harness.ts';

const START = '/api/v1/agents/p1/body/start';
const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));

/** A supervisor link that answers started and records each subject. A refused write must not reach it. */
function recordingConn() {
  const subjects: string[] = [];
  const conn = {
    async request(subject: string) {
      subjects.push(subject);
      return { data: enc({ ok: true, code: 'started' }) };
    },
  };
  return { subjects, conn };
}

/** Cookie-session deps with body routes mounted. p1 is alice's and has a valid 3 to 16 display name. */
function bodyDeps(conn: ReturnType<typeof recordingConn>['conn']): ApiDeps {
  return baseDeps({
    agents: async (owner, player) =>
      player === 'p1' && owner === 'alice'
        ? { ownerId: 'alice', playerId: 'p1', displayName: 'Ranger' }
        : null,
    routes: bodyRoutes({ conn, shard: 'phase0', timeoutMs: 1000 }),
  });
}

describe('body routes over a cookie session need the CSRF token on the write', () => {
  it('accepts the right CSRF token and reaches the supervisor once (the control for the refusals)', async () => {
    const link = recordingConn();
    const srv = await serve(bodyDeps(link.conn));
    try {
      const r = await srv.call('POST', START, cookie);
      expect(r.status).toBe(202);
      expect(link.subjects).toEqual(['geldar.phase0.ctl.body.start']);
    } finally {
      await srv.stop();
    }
  });

  it.each([
    ['a wrong CSRF token', { cookie: cookie.cookie, 'x-csrf-token': 'not-the-token' }],
    ['a CSRF token one character off', { cookie: cookie.cookie, 'x-csrf-token': `${CSRF}x` }],
    ['no CSRF token', { cookie: cookie.cookie }],
  ])('refuses %s with 403 csrf_required and no supervisor call', async (_label, headers) => {
    const link = recordingConn();
    const srv = await serve(bodyDeps(link.conn));
    try {
      const r = await srv.call('POST', START, headers);
      expect(r.status).toBe(403);
      expect(JSON.parse(r.body).code).toBe('csrf_required');
      expect(link.subjects).toEqual([]);
    } finally {
      await srv.stop();
    }
  });
});

describe('body routes are not mounted by default', () => {
  it('answers 404 not_found for a body route when the deps carry no body routes', async () => {
    const srv = await serve(baseDeps());
    try {
      const r = await srv.call('POST', START, cookie);
      expect(r.status).toBe(404);
      expect(JSON.parse(r.body).code).toBe('not_found');
    } finally {
      await srv.stop();
    }
  });
});
