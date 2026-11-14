import { createHash } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { RegisterConfig } from '../src/config.ts';
import { microsoftProvider } from '../src/providers.ts';
import { createRegisterServer, type RegisterDeps } from '../src/server.ts';
import { config } from './fixture.ts';

// A player token (gmcp-...) is not an owner credential. Presented as a Bearer at the owner API it is
// refused 401 unauthenticated before any key store is reached, even though this store would accept
// any hash and the agent would exist for the owner (decision 0173, the owner API takes owner keys only).
const NOW = Date.parse('2026-11-13T00:00:00Z');
const PLAYER_TOKEN = `gmcp-${'9c'.repeat(32)}`;

interface Probe {
  base: string;
  resolves: () => number;
  close: () => Promise<void>;
}

async function probe(): Promise<Probe> {
  const cfg: RegisterConfig = config({ killSwitch: false, perMinute: 30 });
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
            return { ownerId: 'alice', scopes: ['read', 'body', 'manage'] };
          },
          mint: async () => null,
          revoke: async () => null,
          list: async () => null,
        },
      },
      agents: async (owner: string, player: string) =>
        owner === 'alice' && player === 'p1' ? { ownerId: 'alice', playerId: 'p1' } : null,
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

const open: Probe[] = [];
afterEach(async () => {
  while (open.length > 0) await open.pop()?.close();
});

async function launch(): Promise<Probe> {
  const h = await probe();
  open.push(h);
  return h;
}

describe('owner API refuses a player token (C7-04b-5)', () => {
  it('answers 401 unauthenticated to a gmcp- Bearer on a read and never reaches the key store', async () => {
    const h = await launch();
    const res = await fetch(`${h.base}/agents/p1`, {
      headers: { authorization: `Bearer ${PLAYER_TOKEN}` },
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toBe('application/problem+json');
    expect(await res.json()).toMatchObject({ code: 'unauthenticated', status: 401 });
    expect(h.resolves()).toBe(0);
  });

  it('answers 401 unauthenticated to a gmcp- Bearer on a write (token rotate) and never reaches the key store', async () => {
    const h = await launch();
    const res = await fetch(`${h.base}/agents/p1/tokens`, {
      method: 'POST',
      headers: { authorization: `Bearer ${PLAYER_TOKEN}` },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ code: 'unauthenticated', status: 401 });
    expect(h.resolves()).toBe(0);
  });
});
