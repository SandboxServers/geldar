import type { Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { loadConfig, type RegisterConfig } from '../src/config.ts';
import type { Identity } from '../src/identity.ts';
import { challengeOf } from '../src/pkce.ts';
import { microsoftProvider } from '../src/providers.ts';
import { createRegisterServer } from '../src/server.ts';
import type { Store } from '../src/store.ts';

export const DAY = 86_400_000;
export const NOW = Date.parse('2026-11-11T00:00:00Z');
export const RAW_ID = '424242424';
export const EMAIL = 'someone@example.invalid';
export const PROVIDER_TOKEN = 'tok-secret-abc';
export const HANDLE = 'handle-xyz';
const PEPPER = 'p'.repeat(40);
export const SESSION_KEY = 'k'.repeat(40);

export function config(over: Partial<RegisterConfig> = {}): RegisterConfig {
  const base = loadConfig(
    {
      REGISTER_KILL_SWITCH: 'false',
      REGISTER_PUBLIC_URL: 'https://glass.example.invalid',
      REGISTER_MS_CLIENT_ID: 'ms-id',
      REGISTER_MS_CLIENT_SECRET_FILE: 'ms',
      REGISTER_SESSION_KEY_FILE: 'sessionkey',
      REGISTER_PEPPER_FILE: 'pepper',
      REGISTER_TOKEN_PEPPER_FILE: 'tokpepper',
      REGISTER_SHARD: 'test',
    },
    (p) =>
      p === 'pepper'
        ? PEPPER
        : p === 'tokpepper'
          ? 't'.repeat(40)
          : p === 'sessionkey'
            ? SESSION_KEY
            : `secret-${p}`,
  );
  return { ...base, ...over };
}

export interface FakeIdp {
  aud: string;
  tid: string;
  /** Set to make the fake check PKCE against a different challenge than the one it was sent. */
  tamperChallenge: boolean;
  challenge: string | null;
  tokenCalls: number;
  /** The Microsoft subject the fake returns. */
  userId: string;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
}

/** A fake provider endpoint set for both providers; it checks PKCE like a real one. */
export function fakeIdp(): FakeIdp {
  const idp: FakeIdp = {
    aud: 'ms-id',
    tid: '9188040d-6c67-4c5b-b112-36a304b66dad',
    tamperChallenge: false,
    challenge: null,
    tokenCalls: 0,
    userId: RAW_ID,
    async fetch(url, init) {
      const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
      if (url === `https://login.microsoftonline.com/consumers/v2.0/token`) {
        idp.tokenCalls += 1;
        const verifier = new URLSearchParams(String(init?.body ?? '')).get('code_verifier');
        const expected = idp.tamperChallenge ? 'other' : idp.challenge;
        if (challengeOf(String(verifier)) !== expected) return new Response('{}', { status: 400 });
        const claims = {
          aud: idp.aud,
          tid: idp.tid,
          sub: idp.userId,
          email: EMAIL,
        };
        const idToken = `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`;
        return ok({ access_token: PROVIDER_TOKEN, id_token: idToken });
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
  begin(provider?: string): Promise<{ state: string; cookie: string }>;
  callback(
    provider: string | undefined,
    state: string,
    cookie: string,
    code?: string,
  ): Promise<Response>;
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
    providers: { microsoft: microsoftProvider(cfg.microsoft) },
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
    async begin(_provider) {
      const res = await fetch(`${base}/register/login`, { redirect: 'manual' });
      const loc = new URL(res.headers.get('location') ?? '');
      idp.challenge = loc.searchParams.get('code_challenge');
      const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
      return { state: loc.searchParams.get('state') ?? '', cookie };
    },
    callback(_provider, state, cookie, code = 'the-code') {
      return fetch(`${base}/register/callback?code=${code}&state=${state}`, {
        headers: { cookie },
      });
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
