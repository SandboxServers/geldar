import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { runAccountDelete } from '../src/account-delete-page.ts';
import {
  type AccountDeleteDeps,
  accountDeleteDeps,
  accountDeleteRoutes,
  DELETE_PHRASE,
  deleteAccountData,
  MOVED_IN_DETAIL,
} from '../src/api/account-data-delete.ts';
import type { ApiContext } from '../src/api/route.ts';

/** A response that records the status, the headers and the body. */
function fakeRes() {
  const seen = { status: 0, headers: {} as Record<string, unknown>, body: '' };
  const res = {
    writeHead(code: number, h: Record<string, unknown>) {
      seen.status = code;
      seen.headers = h;
      return this;
    },
    end(body?: string) {
      seen.body = body ?? '';
    },
  } as unknown as ServerResponse;
  return { res, seen };
}

/** A route context with the typed phrase as the JSON body, a cookie session owner and no other fields. */
function routeCtx(res: ServerResponse): ApiContext {
  const req = Readable.from([
    Buffer.from(JSON.stringify({ confirm: DELETE_PHRASE })),
  ]) as unknown as IncomingMessage;
  return { req, res, identityHash: 'a'.repeat(64), ownerId: 'owner-1' } as unknown as ApiContext;
}

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

  it('a move made during the body stops is refused before the erase (the guard is read twice)', async () => {
    const h = harness([{ name: 'ag-own-02', status: 'active' }], []);
    let reads = 0;
    const deps: AccountDeleteDeps = {
      ...h.deps,
      movedInPlayers: async () => (reads++ === 0 ? [] : [{ status: 'active' }]),
    };
    expect(await deleteAccountData(deps, OWNER, 'owner-1')).toBe('moved_in');
    expect(reads).toBe(2);
    expect(h.erased).toEqual([]);
    expect(h.logs).toEqual(['account delete refused reason=moved-in']);
  });

  it('the production deps ask the store, so a moved-in row refuses the delete', async () => {
    const erased: string[] = [];
    const asked: string[] = [];
    const store = {
      findOwner: async () => ({ banned: false }),
      listPlayers: async () => [],
      eraseAccount: async (h: string) => {
        erased.push(h);
        return true;
      },
      movedInPlayers: async (h: string) => {
        asked.push(h);
        return [{ status: 'active' }];
      },
    };
    const deps = accountDeleteDeps(store, null, []);
    expect(await deleteAccountData(deps, OWNER, 'owner-1')).toBe('moved_in');
    expect(asked).toEqual([OWNER]);
    expect(erased).toEqual([]);
  });

  it('the API route answers 409 problem, sets no session cookie and erases nothing', async () => {
    const h = harness([{ name: 'ag-moved-03', status: 'active' }], [{ status: 'active' }]);
    const { res, seen } = fakeRes();
    const [route] = accountDeleteRoutes(h.deps);
    await route?.handler(routeCtx(res));
    expect(seen.status).toBe(409);
    expect(seen.headers['content-type']).toBe('application/problem+json');
    expect(seen.body).toContain(MOVED_IN_DETAIL);
    expect(seen.headers['set-cookie']).toBeUndefined();
    expect(h.erased).toEqual([]);
  });

  it('the account page answers 409 with the refusal text, clears no cookie and erases nothing', async () => {
    const h = harness([{ name: 'ag-moved-04', status: 'active' }], [{ status: 'active' }]);
    const { res, seen } = fakeRes();
    await runAccountDelete(
      res,
      h.deps,
      { csrf: 'csrf-value', identityHash: OWNER, ownerId: 'owner-1' },
      new URLSearchParams({ phrase: DELETE_PHRASE }),
      () => undefined,
    );
    expect(seen.status).toBe(409);
    expect(seen.body).toContain(MOVED_IN_DETAIL);
    expect(seen.headers['set-cookie']).toBeUndefined();
    expect(h.erased).toEqual([]);
  });
});
