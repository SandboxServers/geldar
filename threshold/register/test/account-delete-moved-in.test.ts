import { describe, expect, it } from 'vitest';
import { type AccountDeleteDeps, deleteAccountData } from '../src/api/account-data-delete.ts';

interface Harness {
  readonly deps: AccountDeleteDeps;
  readonly erased: string[];
  readonly logs: string[];
}

/** A fake delete with one owner, the given players, and the given moved-in marks (their statuses only). */
function harness(
  players: readonly { name: string; status: string }[],
  moved: readonly { status: string }[],
): Harness {
  const erased: string[] = [];
  const logs: string[] = [];
  const deps: AccountDeleteDeps = {
    findOwner: async () => ({ banned: false }),
    listPlayers: async () => players,
    eraseAccount: async (identityHash: string) => {
      erased.push(identityHash);
      return true;
    },
    clearCookies: [],
    body: null,
    log: (line: string) => logs.push(line),
    movedInPlayers: async () => moved,
  };
  return { deps, erased, logs };
}

const OWNER = 'a'.repeat(64);

describe('account delete refuses while a player was moved in by the operator', () => {
  it('refuses when a live moved-in player exists, erases nothing, logs no identifier', async () => {
    const h = harness([{ name: 'ag-moved-01', status: 'active' }], [{ status: 'active' }]);
    expect(await deleteAccountData(h.deps, OWNER, 'owner-1')).toBe('moved_in');
    expect(h.erased).toEqual([]);
    expect(h.logs).toEqual(['account delete refused reason=moved-in']);
    expect(h.logs.join('\n')).not.toContain('ag-moved-01');
  });

  it('refuses for a paused moved-in player too (only retired does not count)', async () => {
    const h = harness([{ name: 'ag-moved-02', status: 'paused' }], [{ status: 'paused' }]);
    expect(await deleteAccountData(h.deps, OWNER, 'owner-1')).toBe('moved_in');
    expect(h.erased).toEqual([]);
  });

  it('an owner with only self-registered players can still delete', async () => {
    const h = harness([{ name: 'ag-own-01', status: 'active' }], []);
    expect(await deleteAccountData(h.deps, OWNER, 'owner-1')).toBe('deleted');
    expect(h.erased).toHaveLength(1);
    expect(h.logs).toEqual([]);
  });

  it('a retired moved-in player does not block the delete', async () => {
    const h = harness([{ name: 'ag-old-01', status: 'retired' }], [{ status: 'retired' }]);
    expect(await deleteAccountData(h.deps, OWNER, 'owner-1')).toBe('deleted');
    expect(h.erased).toHaveLength(1);
  });
});
