import { describe, expect, it } from 'vitest';
import type { AgentFlagStore } from '../src/api/route.ts';
import { baseDeps, cookie, serve } from './owner-api-harness.ts';

const PATH = '/api/v1/agents/p1';

/** A flag store that records every write; a write that reaches it is a test failure. */
function recordingFlags() {
  const calls: string[] = [];
  const store: AgentFlagStore = {
    async setPublicCamera(h, p, v) {
      calls.push(`camera:${h}:${p}:${v}`);
      return true;
    },
    async setThoughtsDelayedPublic(h, p, v) {
      calls.push(`thoughts:${h}:${p}:${v}`);
      return true;
    },
  };
  return { store, calls };
}

describe('PATCH /agents/{playerId} on a retired agent (404, nothing written)', () => {
  it('answers 404 not_found for a retired agent and writes no flag, whatever the body says', async () => {
    const { store, calls } = recordingFlags();
    const srv = await serve(
      baseDeps({
        flags: store,
        agents: async (owner, player) =>
          player === 'p1' && owner === 'alice'
            ? { ownerId: 'alice', playerId: 'p1', status: 'retired' }
            : null,
      }),
    );
    try {
      const r = await srv.call('PATCH', PATH, cookie, '{"publicCamera":true}');
      expect(r.status).toBe(404);
      expect(JSON.parse(r.body).code).toBe('not_found');
      expect(calls).toEqual([]);
    } finally {
      await srv.stop();
    }
  });
});

describe('PATCH /agents/{playerId} body bounds (422 invalid, nothing written)', () => {
  it.each([
    ['an empty object', '{}'],
    ['an array', '[true]'],
    ['an array of flag objects', '[{"publicCamera":true}]'],
    ['a body over 4096 bytes', `{"publicCamera":true,"pad":"${'a'.repeat(4096)}"}`],
  ])('answers 422 invalid for %s, and no store write', async (_label, body) => {
    const { store, calls } = recordingFlags();
    const srv = await serve(baseDeps({ flags: store }));
    try {
      const r = await srv.call('PATCH', PATH, cookie, body);
      expect(r.status).toBe(422);
      expect(JSON.parse(r.body).code).toBe('invalid');
      expect(calls).toEqual([]);
    } finally {
      await srv.stop();
    }
  });
});
