import { describe, expect, it } from 'vitest';
import { OwnerRefusedError } from '../src/owner-agents-pg.ts';
import { baseDeps, cookie, serve } from './owner-api-harness.ts';

const ADA = { ownerId: 'alice', playerId: 'p1', displayName: 'Ada', status: 'live' };

describe('owner API agent read projection (C7-04b, L1)', () => {
  it('returns only the Agent shape on GET /agents/{playerId}: the owner id and a stored token hash are dropped', async () => {
    const srv = await serve(
      baseDeps({
        agents: async (owner, player) =>
          owner === 'alice' && player === 'p1' ? { ...ADA, tokenHash: 'deadbeef' } : null,
      }),
    );
    try {
      const r = await srv.call('GET', '/api/v1/agents/p1', cookie);
      expect(r.status).toBe(200);
      expect(JSON.parse(r.body)).toEqual({ playerId: 'p1', displayName: 'Ada', status: 'live' });
    } finally {
      await srv.stop();
    }
  });
});

describe('owner API refused owner (C7-04b, L3)', () => {
  const refuse = async (): Promise<never> => {
    throw new OwnerRefusedError();
  };

  it('answers 401 unauthenticated on GET /agents/{playerId} for a cookie session of a banned owner', async () => {
    const srv = await serve(baseDeps({ agents: refuse }));
    try {
      const r = await srv.call('GET', '/api/v1/agents/p1', cookie);
      expect(r.status).toBe(401);
      expect(JSON.parse(r.body).code).toBe('unauthenticated');
    } finally {
      await srv.stop();
    }
  });

  it('answers 401 unauthenticated on GET /agents for a cookie session of a banned owner', async () => {
    const srv = await serve(baseDeps({ listAgents: refuse }));
    try {
      const r = await srv.call('GET', '/api/v1/agents', cookie);
      expect(r.status).toBe(401);
      expect(JSON.parse(r.body).code).toBe('unauthenticated');
    } finally {
      await srv.stop();
    }
  });

  it('keeps any other loader error at 500 internal (only the refusal maps to 401)', async () => {
    const srv = await serve(
      baseDeps({
        agents: async () => {
          throw new Error('connection reset');
        },
      }),
    );
    try {
      const r = await srv.call('GET', '/api/v1/agents/p1', cookie);
      expect(r.status).toBe(500);
      expect(JSON.parse(r.body).code).toBe('internal');
    } finally {
      await srv.stop();
    }
  });
});
