import { describe, expect, it } from 'vitest';
import type { FlagQuery } from '../src/admin.ts';
import { AUDIT_LOST_CODE, auditActor, productionApi } from '../src/production-api.ts';
import type { Store } from '../src/store.ts';
import type { TokenStore } from '../src/tokens-service.ts';
import { cookie, serve, sessions } from './owner-api-harness.ts';

const SECRET = 'pg-password-do-not-log';
const noStore = {} as Store & TokenStore;

/** A fake pool client that answers each statement with the given result, or throws the given error. */
function fakeDb(answer: { rows?: Record<string, unknown>[] } | Error): FlagQuery & {
  statements: string[];
  values: unknown[][];
} {
  const statements: string[] = [];
  const values: unknown[][] = [];
  return {
    statements,
    values,
    async query(text: string, params?: unknown[]) {
      statements.push(text);
      values.push(params ?? []);
      if (answer instanceof Error) throw answer;
      return { rows: answer.rows ?? [] };
    },
  };
}

/** A token store fake: the database side of renew, revoke and info. The calls are recorded in order. */
function fakeTokenStore(): Store & TokenStore & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    renewToken: async () => {
      calls.push('renew');
      return true;
    },
    revokeTokens: async () => {
      calls.push('revoke');
      return 1;
    },
    tokenInfo: async () => null,
  } as unknown as Store & TokenStore & { calls: string[] };
}

function wiring(db: FlagQuery, log: (line: string) => void = () => undefined) {
  return productionApi({ db, store: noStore, tokenPepper: 'x'.repeat(32), log });
}

describe('production owner API wiring (C7-04b-5)', () => {
  it('reads the admin flag through register_is_admin and reports true only for the flagged owner', async () => {
    const api = wiring(fakeDb({ rows: [{ admin: true }] }));
    expect(await api.isAdmin?.('reg-owner-admin')).toBe(true);
  });

  it('fails closed: a query error or a missing flag is not admin (the limit applies)', async () => {
    const failing = wiring(fakeDb(new Error(`connection refused ${SECRET}`)));
    expect(await failing.isAdmin?.('reg-owner-x')).toBe(false);
    const missing = wiring(fakeDb({ rows: [] }));
    expect(await missing.isAdmin?.('reg-owner-x')).toBe(false);
    const notTrue = wiring(fakeDb({ rows: [{ admin: 'yes' }] }));
    expect(await notTrue.isAdmin?.('reg-owner-x')).toBe(false);
  });

  it('logs a lost audit row as the fixed code and a counter, never the error text', async () => {
    const lines: string[] = [];
    const api = wiring(fakeDb(new Error(SECRET)), (line) => lines.push(line));
    api.onAuditLost?.({
      ownerId: 'reg-owner-x',
      action: 'token.mint',
      target: 'a',
      outcome: 'ok',
      admin: false,
    });
    api.onAuditLost?.({
      ownerId: 'reg-owner-x',
      action: 'token.mint',
      target: 'a',
      outcome: 'ok',
      admin: false,
    });
    expect(lines).toEqual([`${AUDIT_LOST_CODE} count=1`, `${AUDIT_LOST_CODE} count=2`]);
    expect(lines.join('\n')).not.toContain(SECRET);
  });

  it('writes the audit row through register_audit, and a failed write rejects so the router answers 500', async () => {
    const ok = fakeDb({ rows: [{ admin: false }] });
    await wiring(ok).audit?.({
      ownerId: 'reg-owner-x',
      action: 'key.mint',
      target: 'k1',
      outcome: 'ok',
      admin: false,
    });
    expect(ok.statements.some((s) => s.startsWith('INSERT INTO register_audit'))).toBe(true);
    const broken = wiring(fakeDb(new Error(SECRET)));
    await expect(
      broken.audit?.({
        ownerId: 'reg-owner-x',
        action: 'key.mint',
        target: 'k1',
        outcome: 'ok',
        admin: false,
      }),
    ).rejects.toThrow(SECRET);
  });

  it('wires the owner-key store, the hash and the owner-id agent loaders (C7-04b-5)', () => {
    const api = wiring(fakeDb({ rows: [] }));
    expect(api.ownerKeys?.hash('gowner-x').length).toBe(32);
    expect(api.ownerKeySessions?.hash('gowner-x')).toEqual(api.ownerKeys?.hash('gowner-x'));
    expect(typeof api.agents).toBe('function');
    expect(typeof api.listAgents).toBe('function');
  });

  it('returns the token services over the store, so the rotate and revoke routes are wired (H1)', () => {
    const api = wiring(fakeDb({ rows: [] }));
    expect(api.tokens?.store).toBe(noStore);
    const minted = api.tokens?.issue();
    expect(minted?.secret.length).toBeGreaterThan(0);
    expect(minted?.tokenHash.length).toBe(32);
  });

  it('writes the audit actor as the SHA-256 prefix of the owner id, the form the SQL functions write (M1)', async () => {
    const db = fakeDb({ rows: [{ admin: false }] });
    await wiring(db).audit?.({
      ownerId: 'reg-owner-x',
      action: 'key.mint',
      target: 'k1',
      outcome: 'ok',
      admin: false,
    });
    const at = db.statements.findIndex((s) => s.startsWith('INSERT INTO register_audit'));
    // Literal: first 16 hex chars of SHA-256 over the UTF-8 bytes of 'reg-owner-x' (the SQL formula in 0025 and 0035).
    const pinned = 'c45c62f23b8d5e0c';
    expect(at).toBeGreaterThanOrEqual(0);
    expect(db.values[at]?.[0]).toBe(pinned);
    expect(auditActor('reg-owner-x')).toBe(pinned);
    expect(db.values[at]?.[0]).not.toBe('reg-owner-x');
  });
});

describe('the production composition answers the token routes (H1)', () => {
  it('rotates to 201 and revokes to 204 through the cookie API, not 500', async () => {
    const store = fakeTokenStore();
    const api = productionApi({
      db: fakeDb({ rows: [{ admin: false }] }),
      store,
      tokenPepper: 'x'.repeat(32),
      log: () => undefined,
    });
    // The router deps as server.ts composes them. Only the agent loader is a fixture; the token services are production's.
    const srv = await serve({
      ...api,
      agents: async (owner, player) =>
        owner === 'alice' && player === 'p1' ? { ownerId: 'alice', playerId: 'p1' } : null,
      now: () => 0,
      csrfKey: 'session-key',
      sessions,
      charge: () => 0,
    });
    try {
      const renewed = await srv.call('POST', '/api/v1/agents/p1/tokens', cookie);
      expect(renewed.status).toBe(201);
      const revoked = await srv.call('POST', '/api/v1/agents/p1/tokens/revoke', cookie);
      expect(revoked.status).toBe(204);
      expect(store.calls).toEqual(['renew', 'revoke']);
    } finally {
      await srv.stop();
    }
  });
});
