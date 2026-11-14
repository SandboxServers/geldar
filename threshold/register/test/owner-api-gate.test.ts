import { createHash } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { ApiDeps } from '../src/api/route.ts';
import type { RegisterConfig } from '../src/config.ts';
import { microsoftProvider } from '../src/providers.ts';
import { createRegisterServer, type RegisterDeps } from '../src/server.ts';
import { config } from './fixture.ts';

// The gate in front of the owner API: the kill switch and the source limit run before any key is resolved.
const NOW = Date.parse('2026-11-11T00:00:00Z');
const KEY = `gowner-${'d1'.repeat(32)}`;
const BEARER = { authorization: `Bearer ${KEY}` };

interface Started {
  base: string;
  resolves: () => number;
  close: () => Promise<void>;
}

async function start(
  over: Partial<RegisterConfig>,
  opts: { owner?: { ownerId: string; scopes: string[] }; agents?: ApiDeps['agents'] } = {},
): Promise<Started> {
  const cfg = config(over);
  let resolves = 0;
  const deps: RegisterDeps = {
    config: cfg,
    providers: { microsoft: microsoftProvider(cfg.microsoft) },
    fetch: globalThis.fetch,
    now: () => NOW,
    log: () => undefined,
    api: {
      ownerKeys: {
        hash: (v) => createHash('sha256').update(v).digest(),
        store: {
          resolve: async () => {
            resolves += 1;
            return opts.owner ?? null;
          },
          mint: async () => null,
          revoke: async () => null,
          list: async () => null,
        },
      },
      ...(opts.agents ? { agents: opts.agents } : {}),
    },
  };
  const server: Server = createRegisterServer(deps);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return {
    base: `http://127.0.0.1:${port}/register/api/v1`,
    resolves: () => resolves,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

const open: Array<Started> = [];
afterEach(async () => {
  while (open.length > 0) await open.pop()?.close();
});

async function launch(
  over: Partial<RegisterConfig>,
  opts?: Parameters<typeof start>[1],
): Promise<Started> {
  const h = await start(over, opts);
  open.push(h);
  return h;
}

describe('owner API kill switch (C7-04a)', () => {
  it('answers a problem+json 503 and never resolves a key while the kill switch is on', async () => {
    const h = await launch({ killSwitch: true });
    const res = await fetch(`${h.base}/agents/p1`, { headers: BEARER });
    expect(res.status).toBe(503);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    expect(await res.json()).toMatchObject({ code: 'unavailable', status: 503 });
    expect(h.resolves()).toBe(0);
  });
});

describe('owner API source limit (C7-04a)', () => {
  it('trips before any key is resolved: the last allowed request resolves, the first past the cap does not', async () => {
    const h = await launch({ killSwitch: false, perMinute: 3 });
    const statuses: number[] = [];
    let last: Response | undefined;
    for (let i = 0; i < 4; i += 1) {
      last = await fetch(`${h.base}/agents/p1`, { headers: BEARER });
      statuses.push(last.status);
      await last.text();
    }
    // Requests 1 to 3 are within the cap and reach the resolver (401: the resolve refuses the key).
    expect(statuses).toEqual([401, 401, 401, 429]);
    expect(h.resolves()).toBe(3);
    expect(last?.headers.get('content-type')).toBe('application/problem+json');
    expect(last?.headers.get('retry-after')).not.toBeNull();
  });

  it('returns a problem+json rate_limited body with the code from the enum', async () => {
    const h = await launch({ killSwitch: false, perMinute: 1 });
    await (await fetch(`${h.base}/agents/p1`, { headers: BEARER })).text();
    const res = await fetch(`${h.base}/agents/p1`, { headers: BEARER });
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ code: 'rate_limited', status: 429 });
    expect(h.resolves()).toBe(1);
  });
});

describe('owner API internal errors (C7-04a)', () => {
  it('answers a problem+json 500 internal when a route throws after the key resolved', async () => {
    const h = await launch(
      { killSwitch: false, perMinute: 30 },
      {
        owner: { ownerId: 'alice', scopes: ['read'] },
        agents: async () => {
          throw new Error('store down');
        },
      },
    );
    const res = await fetch(`${h.base}/agents/p1`, { headers: BEARER });
    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    expect(await res.json()).toMatchObject({ code: 'internal', status: 500 });
    expect(h.resolves()).toBe(1);
  });
});
