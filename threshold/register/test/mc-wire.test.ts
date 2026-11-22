import type { ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { Identity } from '../src/identity.ts';
import type { OwnershipCheck } from '../src/mc-signup-gate.ts';
import { microsoftProvider } from '../src/providers.ts';
import { createRegisterServer } from '../src/server.ts';
import { config, fakeIdp, PROVIDER_TOKEN } from './fixture.ts';

// The server-level wiring of REGISTER_REQUIRE_MC_OWNERSHIP: the provider's access token must reach the Xbox
// check through the callback closure, and only when the gate is on. Every network call is mocked.
const XBOX_USER_AUTH = 'https://user.auth.xboxlive.com/user/authenticate';
const MS_TOKEN = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';

const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });

interface Wire {
  readonly base: string;
  readonly xboxBodies: string[];
  readonly verifies: (OwnershipCheck | undefined)[];
  readonly logs: string[];
  readonly replies: string[];
  close(): Promise<void>;
  callback(): Promise<Response>;
}

async function wire(requireMcOwnership: boolean): Promise<Wire> {
  const idp = fakeIdp();
  const xboxBodies: string[] = [];
  const verifies: (OwnershipCheck | undefined)[] = [];
  const logs: string[] = [];
  const replies: string[] = [];
  const cfg = config({ requireMcOwnership });
  const fetchFn = async (url: string, init?: RequestInit): Promise<Response> => {
    if (url === MS_TOKEN) return idp.fetch(url, init);
    if (url === XBOX_USER_AUTH) {
      xboxBodies.push(String(init?.body ?? ''));
      return json({ Token: 'xbl', DisplayClaims: { xui: [{ uhs: '1' }] } });
    }
    if (url.startsWith('https://xsts.auth.xboxlive.com/'))
      return json({ Token: 'xsts', DisplayClaims: { xui: [{ uhs: '1' }] } });
    if (url.startsWith('https://api.minecraftservices.com/authentication/'))
      return json({ access_token: 'mc' });
    if (url.startsWith('https://api.minecraftservices.com/entitlements/'))
      return json({ items: [] });
    return new Response('{}', { status: 404 });
  };
  const server = createRegisterServer({
    config: cfg,
    providers: { microsoft: microsoftProvider(cfg.microsoft, { requireMcOwnership }) },
    fetch: fetchFn,
    now: () => Date.parse('2026-11-11T00:00:00Z'),
    log: (l) => logs.push(l),
    onSignedIn: async (_id: Identity, res: ServerResponse, _consent, verify) => {
      verifies.push(verify);
      const result = verify ? await verify() : { status: 'none' };
      const body = JSON.stringify(result);
      replies.push(body);
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(body);
    },
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const login = await fetch(`${base}/register/login?consent=yes`, { redirect: 'manual' });
  const loc = new URL(login.headers.get('location') ?? '');
  idp.challenge = loc.searchParams.get('code_challenge');
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  const state = loc.searchParams.get('state') ?? '';
  return {
    base,
    xboxBodies,
    verifies,
    logs,
    replies,
    close: () => new Promise<void>((r) => server.close(() => r())),
    callback: () =>
      fetch(`${base}/register/callback?code=the-code&state=${state}`, {
        redirect: 'manual',
        headers: { cookie },
      }),
  };
}

let open: Wire | undefined;
afterEach(async () => {
  await open?.close();
  open = undefined;
});

describe('REGISTER_REQUIRE_MC_OWNERSHIP wiring through the callback', () => {
  it('hands the Microsoft access token to the Xbox check when the gate is on', async () => {
    open = await wire(true);
    expect((await open.callback()).status).toBe(200);
    expect(open.verifies[0]).toBeTypeOf('function');
    // The Xbox user-authenticate body carries the real token (RpsTicket d=<token>), not an empty string.
    expect(open.xboxBodies).toHaveLength(1);
    expect(open.xboxBodies[0]).toContain(`d=${PROVIDER_TOKEN}`);
    expect(open.xboxBodies[0]).not.toContain('d=""');
  });

  it('keeps the access token out of every log line and every reply', async () => {
    open = await wire(true);
    await open.callback();
    expect(open.xboxBodies[0]).toContain(PROVIDER_TOKEN);
    for (const line of [...open.logs, ...open.replies]) {
      expect(line).not.toContain(PROVIDER_TOKEN);
    }
  });

  it('runs no check and hands no token when the gate is off', async () => {
    open = await wire(false);
    expect((await open.callback()).status).toBe(200);
    expect(open.verifies).toEqual([undefined]);
    expect(open.xboxBodies).toEqual([]);
  });
});
