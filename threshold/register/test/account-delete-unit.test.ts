import type { ServerResponse } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signOutCookies } from '../src/account.ts';
import { runAccountDelete } from '../src/account-delete-page.ts';
import { accountDeleteWiring, mountAccountDelete } from '../src/account-delete-wiring.ts';
import {
  type AccountDeleteDeps,
  DELETE_PHRASE,
  deleteAccountData,
} from '../src/api/account-data-delete.ts';
import type { BodyStopLink } from '../src/api/body-retire.ts';
import { createBodySlot } from '../src/api/body-slot.ts';
import type { ApiRoute } from '../src/api/route.ts';
import { requestBodyOp } from '../src/nats-ctl.ts';

vi.mock('../src/nats-ctl.ts', () => ({
  requestBodyOp: vi.fn(),
  BodyUnavailable: class BodyUnavailable extends Error {},
  MalformedReply: class MalformedReply extends Error {},
}));

const OWNER = 'reg-unit-delete';
const IDENT = 'ab'.repeat(32);

function linkWithSlot(): BodyStopLink {
  return {
    conn: {} as never,
    shard: 'shard-1',
    timeoutMs: 1000,
    slot: createBodySlot(),
  } as unknown as BodyStopLink;
}

function depsWith(
  link: BodyStopLink | null,
  over: Partial<AccountDeleteDeps> = {},
): AccountDeleteDeps {
  return {
    findOwner: async () => ({ banned: false }),
    listPlayers: async () => [{ name: 'Alpha_1', status: 'live' }],
    eraseAccount: async () => true,
    clearCookies: ['__Host-gr_session=; Max-Age=0'],
    body: link,
    movedInPlayers: async () => [],
    ...over,
  };
}

/** A response that records the status, the headers and the body the page action writes. */
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

beforeEach(() => {
  vi.mocked(requestBodyOp).mockReset();
});

describe('the owner slot (C7-09a review fix)', () => {
  it('releases the slot after a stop that is not ok (body_unavailable)', async () => {
    vi.mocked(requestBodyOp).mockResolvedValue({ ok: false, code: 'unavailable' } as never);
    const link = linkWithSlot();
    expect(await deleteAccountData(depsWith(link), IDENT, OWNER)).toBe('body_unavailable');
    expect(link.slot.has(OWNER)).toBe(false);
  });

  it('releases the slot when the erase throws, and the throw reaches the caller', async () => {
    vi.mocked(requestBodyOp).mockResolvedValue({ ok: true, code: 'stopped' } as never);
    const link = linkWithSlot();
    const failing = depsWith(link, {
      eraseAccount: async () => {
        throw new Error('database down');
      },
    });
    await expect(deleteAccountData(failing, IDENT, OWNER)).rejects.toThrow('database down');
    expect(link.slot.has(OWNER)).toBe(false);
  });

  it('releases the slot after a successful delete', async () => {
    vi.mocked(requestBodyOp).mockResolvedValue({ ok: true, code: 'stopped' } as never);
    const link = linkWithSlot();
    expect(await deleteAccountData(depsWith(link), IDENT, OWNER)).toBe('deleted');
    expect(link.slot.has(OWNER)).toBe(false);
  });
});

describe('a stored name that is not a Body login (F9)', () => {
  it('skips the stop for it and still erases, because no supervisor body can carry that name', async () => {
    vi.mocked(requestBodyOp).mockResolvedValue({ ok: false, code: 'unavailable' } as never);
    const erased: string[] = [];
    const deps = depsWith(linkWithSlot(), {
      listPlayers: async () => [{ name: 'bad name!', status: 'live' }],
      eraseAccount: async () => {
        erased.push('erase');
        return true;
      },
    });
    expect(await deleteAccountData(deps, IDENT, OWNER)).toBe('deleted');
    expect(requestBodyOp).not.toHaveBeenCalled();
    expect(erased).toEqual(['erase']);
  });
});

describe('the page action with a failing stop (C7-09a review fix)', () => {
  it('answers 503 with the page, erases nothing, and the erase never runs after the failed stop', async () => {
    vi.mocked(requestBodyOp).mockResolvedValue({ ok: false, code: 'unavailable' } as never);
    const order: string[] = [];
    const deps = depsWith(linkWithSlot(), {
      listPlayers: async () => {
        order.push('list');
        return [{ name: 'Alpha_1', status: 'live' }];
      },
      eraseAccount: async () => {
        order.push('erase');
        return true;
      },
    });
    const { res, seen } = fakeRes();
    await runAccountDelete(
      res,
      deps,
      { csrf: 'csrf-value', identityHash: IDENT, ownerId: OWNER },
      new URLSearchParams({ phrase: DELETE_PHRASE }),
      () => undefined,
    );
    expect(seen.status).toBe(503);
    expect(seen.body).toContain('Nothing was deleted');
    expect(order).toEqual(['list']);
  });
});

describe('the sign-out cookies and their wiring (F3)', () => {
  const named = (list: readonly string[], name: string) =>
    list.find((value) => value.startsWith(`${name}=`));

  it('signOutCookies clears the __Host- session, the legacy session and state, and the kino cookie with Max-Age=0', () => {
    const list = signOutCookies();
    for (const name of ['__Host-gr_session', 'gr_session', 'gr_state', 'gk_session']) {
      expect(named(list, name), name).toMatch(/Max-Age=0/);
    }
  });

  it('the account delete wiring hands the route the same clears as signOutCookies()', () => {
    const deps = accountDeleteWiring(
      {
        findOwner: async () => null,
        listPlayers: async () => [],
        eraseAccount: async () => true,
      },
      null,
      () => undefined,
    );
    expect(deps.clearCookies).toEqual(signOutCookies());
  });
});

describe('the skip log (C7-09a review fix 2)', () => {
  it('logs a skipped stop with its reason and no name or owner id', async () => {
    vi.mocked(requestBodyOp).mockResolvedValue({ ok: false, code: 'unavailable' } as never);
    const lines: string[] = [];
    const deps = depsWith(linkWithSlot(), {
      listPlayers: async () => [{ name: 'bad name!', status: 'live' }],
      log: (line) => lines.push(line),
    });
    expect(await deleteAccountData(deps, IDENT, OWNER)).toBe('deleted');
    expect(lines).toEqual(['account delete skipped body stop reason=login-name']);
    expect(lines.join('\n')).not.toContain('bad name');
    expect(lines.join('\n')).not.toContain(OWNER);
  });
});

describe('the production mount (C7-09a review fix 2)', () => {
  it('the page action runs with the mounted deps, and the delete route is in the mounted list', async () => {
    const erased: string[] = [];
    const store = {
      findOwner: async () => ({ banned: false }),
      listPlayers: async () => [],
      movedInPlayers: async () => [],
      eraseAccount: async () => {
        erased.push('erase');
        return true;
      },
    };
    const body = { link: null, routes: [] as readonly ApiRoute[] };
    const { accountDelete, api } = mountAccountDelete(
      store,
      body,
      { name: 'api' },
      () => undefined,
    );
    const { res, seen } = fakeRes();
    await runAccountDelete(
      res,
      accountDelete,
      { csrf: 'csrf-value', identityHash: IDENT, ownerId: OWNER },
      new URLSearchParams({ phrase: DELETE_PHRASE }),
      () => undefined,
    );
    expect(seen.status).toBe(302);
    expect(erased).toEqual(['erase']);
    expect(seen.headers['set-cookie']).toEqual(signOutCookies());
    expect(api.name).toBe('api');
    expect(api.routes.some((r) => r.method === 'POST' && r.pattern.test('/account/delete'))).toBe(
      true,
    );
  });
});
