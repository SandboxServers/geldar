import { describe, expect, it } from 'vitest';
import type { FlagQuery } from '../src/admin.ts';
import { AUDIT_LOST_CODE, productionApi } from '../src/production-api.ts';
import type { Store } from '../src/store.ts';

const SECRET = 'pg-password-do-not-log';
const noStore = {} as Store;

/** A fake pool client that answers each statement with the given result, or throws the given error. */
function fakeDb(answer: { rows?: Record<string, unknown>[] } | Error): FlagQuery & {
  statements: string[];
} {
  const statements: string[] = [];
  return {
    statements,
    async query(text: string) {
      statements.push(text);
      if (answer instanceof Error) throw answer;
      return { rows: answer.rows ?? [] };
    },
  };
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
});
