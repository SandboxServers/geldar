import type { Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { loadConfig, type RegisterConfig } from '../src/config.ts';
import type { Identity } from '../src/identity.ts';
import { challengeOf } from '../src/pkce.ts';
import { discordProvider, githubProvider, snowflakeTimeMs } from '../src/providers.ts';
import { createRegisterServer } from '../src/server.ts';
import type { Store } from '../src/store.ts';

export const DAY = 86_400_000;
export const NOW = Date.parse('2026-11-11T00:00:00Z');
export const RAW_ID = '424242424';
export const EMAIL = 'someone@example.invalid';
export const PROVIDER_TOKEN = 'tok-secret-abc';
export const HANDLE = 'handle-xyz';
const PEPPER = 'p'.repeat(40);

export function config(over: Partial<RegisterConfig> = {}): RegisterConfig {
  const base = loadConfig(
    {
      REGISTER_KILL_SWITCH: 'false',
      REGISTER_PUBLIC_URL: 'https://register.example.invalid',
      REGISTER_GITHUB_CLIENT_ID: 'gh-id',
      REGISTER_GITHUB_SECRET_FILE: 'gh',
      REGISTER_DISCORD_CLIENT_ID: 'dc-id',
      REGISTER_DISCORD_SECRET_FILE: 'dc',
      REGISTER_PEPPER_FILE: 'pepper',
      REGISTER_TOKEN_PEPPER_FILE: 'tokpepper',
      REGISTER_SHARD: 'test',
    },
    (p) => (p === 'pepper' ? PEPPER : p === 'tokpepper' ? 't'.repeat(40) : `secret-${p}`),
  );
  return { ...base, ...over };
}

export interface FakeIdp {
  verified: boolean;
  createdAtMs: number;
  /** Set to make the fake check PKCE against a different challenge than the one it was sent. */
  tamperChallenge: boolean;
  challenge: string | null;
  tokenCalls: number;
  /** The GitHub user id the fake returns. */
  userId: string;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
}

/** A fake provider endpoint set for both providers; it checks PKCE like a real one. */
export function fakeIdp(): FakeIdp {
  const idp: FakeIdp = {
    verified: true,
    createdAtMs: NOW - 400 * DAY,
    tamperChallenge: false,
    challenge: null,
    tokenCalls: 0,
    userId: RAW_ID,
    async fetch(url, init) {
      const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
      if (url.endsWith('/access_token') || url.endsWith('/oauth2/token')) {
        idp.tokenCalls += 1;
        const raw = String(init?.body ?? '');
        const verifier = raw.startsWith('{')
          ? JSON.parse(raw).code_verifier
          : new URLSearchParams(raw).get('code_verifier');
        const expected = idp.tamperChallenge ? 'other' : idp.challenge;
        if (challengeOf(String(verifier)) !== expected) return new Response('{}', { status: 400 });
        return ok({ access_token: PROVIDER_TOKEN });
      }
      if (url === 'https://api.github.com/user') {
        return ok({
          id: Number(idp.userId),
          login: HANDLE,
          created_at: new Date(idp.createdAtMs).toISOString(),
        });
      }
      if (url === 'https://api.github.com/user/emails')
        return ok([{ email: EMAIL, verified: idp.verified }]);
      if (url.endsWith('/users/@me')) {
        // A snowflake whose time part equals createdAtMs.
        const id = ((BigInt(idp.createdAtMs) - 1420070400000n) << 22n).toString();
        return ok({ id, username: HANDLE, email: EMAIL, verified: idp.verified });
      }
      return new Response('{}', { status: 404 });
    },
  };
  return idp;
}

export interface Harness {
  base: string;
  idp: FakeIdp;
  clock: { at: number };
  logs: string[];
  signedIn: Identity[];
  server: Server;
  /** Runs /login/<p> and returns what the callback needs. */
  begin(provider: 'github' | 'discord'): Promise<{ state: string; cookie: string }>;
  callback(provider: string, state: string, cookie: string, code?: string): Promise<Response>;
  close(): Promise<void>;
}

export async function harness(over: Partial<RegisterConfig> = {}, store?: Store): Promise<Harness> {
  const cfg = config(over);
  const idp = fakeIdp();
  const clock = { at: NOW };
  const logs: string[] = [];
  const signedIn: Identity[] = [];
  const server = createRegisterServer({
    config: cfg,
    providers: { github: githubProvider(cfg.github), discord: discordProvider(cfg.discord) },
    fetch: idp.fetch,
    now: () => clock.at,
    log: (l) => logs.push(l),
    ...(store
      ? { store }
      : {
          onSignedIn: (id: Identity, res: ServerResponse) => {
            signedIn.push(id);
            res.writeHead(200, { 'content-type': 'text/plain' });
            res.end('ok');
          },
        }),
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    idp,
    clock,
    logs,
    signedIn,
    server,
    async begin(provider) {
      const res = await fetch(`${base}/login/${provider}`, { redirect: 'manual' });
      const loc = new URL(res.headers.get('location') ?? '');
      idp.challenge = loc.searchParams.get('code_challenge');
      const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
      return { state: loc.searchParams.get('state') ?? '', cookie };
    },
    callback(provider, state, cookie, code = 'the-code') {
      return fetch(`${base}/callback/${provider}?code=${code}&state=${state}`, {
        headers: { cookie },
      });
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

export { snowflakeTimeMs };
