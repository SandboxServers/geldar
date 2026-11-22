import type { IncomingMessage, ServerResponse } from 'node:http';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type AccountDeleteDeps,
  accountDeleteRoutes,
  DELETE_PHRASE,
} from '../src/api/account-data-delete.ts';
import type { BodyRetireDeps } from '../src/api/body-retire.ts';
import { createBodySlot } from '../src/api/body-slot.ts';
import { handleApi } from '../src/api/index.ts';
import type { ApiContext, ApiDeps, ApiRoute } from '../src/api/route.ts';
import { requestBodyOp } from '../src/nats-ctl.ts';

vi.mock('../src/nats-ctl.ts', () => ({
  requestBodyOp: vi.fn(),
  BodyUnavailable: class BodyUnavailable extends Error {},
  MalformedReply: class MalformedReply extends Error {},
}));

const IDENT = 'ab'.repeat(32);
const CLEARS = ['__Host-gr_session=; Max-Age=0', 'gr_session=; Max-Age=0'];
const handler = (routes: readonly ApiRoute[]) =>
  routes[0]?.handler as (ctx: ApiContext) => Promise<void>;

interface Harness {
  calls: string[];
  status: () => number | undefined;
  setCookie: () => unknown;
  ctx: ApiContext;
}

function fakeCtx(body: unknown, identityHash: string | null = IDENT): Harness {
  const calls: string[] = [];
  let status: number | undefined;
  let headers: Record<string, unknown> = {};
  const res = {
    writeHead(code: number, h: Record<string, unknown>) {
      status = code;
      headers = h;
      return this;
    },
    end() {},
    setHeader() {},
  } as unknown as ServerResponse;
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const req = (async function* () {
    yield Buffer.from(text);
  })() as unknown as IncomingMessage;
  const ctx = {
    req,
    res,
    deps: {},
    params: [],
    ownerId: 'owner-1',
    identityHash,
    sessionKey: 'sess-1',
    admin: false,
    audit: async () => {},
  } as unknown as ApiContext;
  return { calls, status: () => status, setCookie: () => headers['set-cookie'], ctx };
}

/** A deps set whose calls are recorded in order, so a test can read the order the route used. */
function fakeDeps(
  calls: string[],
  over: Partial<AccountDeleteDeps> & { body?: BodyRetireDeps | null } = {},
): AccountDeleteDeps {
  return {
    findOwner: async () => ({ banned: false }),
    listPlayers: async () => {
      calls.push('list');
      return [
        { name: 'Alpha_1', status: 'live' },
        { name: 'Bravo_2', status: 'retired' },
        { name: 'Charlie_3', status: 'live' },
      ];
    },
    eraseAccount: async () => {
      calls.push('erase');
      return true;
    },
    clearCookies: CLEARS,
    body: null,
    movedInPlayers: async () => [],
    ...over,
  };
}

function bodyDeps(): BodyRetireDeps {
  return {
    conn: {} as never,
    shard: 'shard-1',
    timeoutMs: 1000,
    slot: createBodySlot(),
    retirePlayer: async () => true,
  } as unknown as BodyRetireDeps;
}

const OK_STOP = { ok: true, code: 'stopped' };

beforeEach(() => {
  vi.mocked(requestBodyOp).mockReset();
});

describe('POST /account/delete', () => {
  it('stops every live body before the erase, in order, then clears the cookies', async () => {
    const h = fakeCtx({ confirm: DELETE_PHRASE });
    const calls: string[] = [];
    vi.mocked(requestBodyOp).mockImplementation(async (_c, _op, _s, req) => {
      calls.push(`stop:${(req as { playerName: string }).playerName}`);
      return OK_STOP;
    });
    const deps = fakeDeps(calls, { body: bodyDeps() });
    await handler(accountDeleteRoutes(deps))(h.ctx);
    expect(calls).toEqual(['list', 'stop:Alpha_1', 'stop:Charlie_3', 'erase']);
    expect(h.status()).toBe(204);
    expect(h.setCookie()).toEqual(CLEARS);
  });

  it('a stop that is not ok answers 503 and the erase is never called', async () => {
    const h = fakeCtx({ confirm: DELETE_PHRASE });
    const calls: string[] = [];
    vi.mocked(requestBodyOp).mockResolvedValue({ ok: false, code: 'busy' });
    await handler(accountDeleteRoutes(fakeDeps(calls, { body: bodyDeps() })))(h.ctx);
    expect(h.status()).toBe(503);
    expect(calls).not.toContain('erase');
  });

  it('a stop answered error (a helper failure, incl. a failed life removal) answers 503 and nothing is erased', async () => {
    const h = fakeCtx({ confirm: DELETE_PHRASE });
    const calls: string[] = [];
    vi.mocked(requestBodyOp).mockResolvedValue({ ok: false, code: 'error' });
    await handler(accountDeleteRoutes(fakeDeps(calls, { body: bodyDeps() })))(h.ctx);
    expect(h.status()).toBe(503);
    expect(calls).not.toContain('erase');
  });

  it('a stop that throws (no responders) answers 503 and nothing is erased', async () => {
    const { BodyUnavailable } = await import('../src/nats-ctl.ts');
    const h = fakeCtx({ confirm: DELETE_PHRASE });
    const calls: string[] = [];
    vi.mocked(requestBodyOp).mockRejectedValue(new (BodyUnavailable as never)('down'));
    await handler(accountDeleteRoutes(fakeDeps(calls, { body: bodyDeps() })))(h.ctx);
    expect(h.status()).toBe(503);
    expect(calls).not.toContain('erase');
  });

  it('with NATS not configured the stop is a no-op and the erase still runs', async () => {
    const h = fakeCtx({ confirm: DELETE_PHRASE });
    const calls: string[] = [];
    await handler(accountDeleteRoutes(fakeDeps(calls, { body: null })))(h.ctx);
    expect(requestBodyOp).not.toHaveBeenCalled();
    expect(calls).toEqual(['erase']);
    expect(h.status()).toBe(204);
  });

  it('a second delete (the erase finds nothing) is a 204 no-op and clears the cookies again', async () => {
    const h = fakeCtx({ confirm: DELETE_PHRASE });
    const calls: string[] = [];
    const deps = fakeDeps(calls, {
      eraseAccount: async () => false,
      body: null,
    });
    await handler(accountDeleteRoutes(deps))(h.ctx);
    expect(h.status()).toBe(204);
    expect(h.setCookie()).toEqual(CLEARS);
  });

  it('a wrong or missing confirmation phrase is refused before any stop or erase', async () => {
    for (const body of [{ confirm: 'delete' }, { confirm: '' }, {}, 'not json']) {
      const h = fakeCtx(body);
      const calls: string[] = [];
      await handler(accountDeleteRoutes(fakeDeps(calls, { body: bodyDeps() })))(h.ctx);
      expect(h.status()).toBe(422);
      expect(calls).toEqual([]);
    }
    expect(requestBodyOp).not.toHaveBeenCalled();
  });

  it('a Bearer request (no identity) is 401 and nothing runs', async () => {
    const h = fakeCtx({ confirm: DELETE_PHRASE }, null);
    const calls: string[] = [];
    await handler(accountDeleteRoutes(fakeDeps(calls, { body: bodyDeps() })))(h.ctx);
    expect(h.status()).toBe(401);
    expect(calls).toEqual([]);
  });

  it('a gowner key through the router is refused at the cookie-only gate; the handler never runs', async () => {
    const calls: string[] = [];
    const key = `gowner-${'d1'.repeat(32)}`;
    const [route] = accountDeleteRoutes(fakeDeps(calls, { body: bodyDeps() }));
    const spied: ApiRoute = {
      ...(route as ApiRoute),
      handler: async () => {
        calls.push('handler');
      },
    };
    const deps = {
      ownerKeys: {
        store: {
          resolve: async () => ({ ownerId: 'owner-1', scopes: ['read', 'body', 'manage'] }),
        },
        hash: () => Buffer.alloc(32),
      },
      routes: [spied],
    } as unknown as ApiDeps;
    let status: number | undefined;
    const res = {
      writeHead(code: number) {
        status = code;
        return this;
      },
      end() {},
      setHeader() {},
      headersSent: false,
    } as unknown as ServerResponse;
    const req = {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    } as unknown as IncomingMessage;
    const handled = await handleApi(
      req,
      res,
      new URL('http://localhost/api/v1/account/delete'),
      deps,
    );
    expect(handled).toBe(true);
    expect(status).toBe(401);
    expect(calls).toEqual([]);
  });

  it('a banned owner is refused 401 before any stop or erase', async () => {
    const h = fakeCtx({ confirm: DELETE_PHRASE });
    const calls: string[] = [];
    await handler(
      accountDeleteRoutes(fakeDeps(calls, { findOwner: async () => ({ banned: true }) })),
    )(h.ctx);
    expect(h.status()).toBe(401);
    expect(calls).toEqual([]);
  });

  it('a database error propagates (the router answers 500) and the cookies are not cleared', async () => {
    const h = fakeCtx({ confirm: DELETE_PHRASE });
    const calls: string[] = [];
    const deps = fakeDeps(calls, {
      body: null,
      eraseAccount: async () => {
        throw new Error('db down');
      },
    });
    await expect(handler(accountDeleteRoutes(deps))(h.ctx)).rejects.toThrow('db down');
    expect(h.status()).toBeUndefined();
  });

  it('a body over the size limit is refused before it is parsed', async () => {
    const h = fakeCtx({ confirm: DELETE_PHRASE, pad: 'x'.repeat(2000) });
    const calls: string[] = [];
    await handler(accountDeleteRoutes(fakeDeps(calls, { body: null })))(h.ctx);
    expect(h.status()).toBe(422);
    expect(calls).toEqual([]);
  });
});
