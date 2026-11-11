import type { ProviderCredentials } from './config.ts';
import type { ProviderName } from './identity.ts';
import { challengeOf } from './pkce.ts';

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/** What a provider says about an account, before the verification rules run. */
export interface Profile {
  readonly id: string;
  readonly handle: string;
  readonly verified: boolean;
  readonly createdAtMs: number;
}

export interface Provider {
  readonly name: ProviderName;
  authorizeUrl(redirectUri: string, state: string, verifier: string): string;
  /** Exchanges the code, reads the profile, and drops the access token before returning. */
  fetchProfile(
    code: string,
    redirectUri: string,
    verifier: string,
    fetchFn: FetchFn,
  ): Promise<Profile>;
}

const DISCORD_EPOCH = 1420070400000n;

/** The creation time encoded in a Discord snowflake id. */
export function snowflakeTimeMs(id: string): number {
  return Number((BigInt(id) >> 22n) + DISCORD_EPOCH);
}

async function json(res: Response): Promise<unknown> {
  if (!res.ok) throw new Error(`provider status ${res.status}`);
  return res.json();
}

function obj(v: unknown): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v))
    throw new Error('unexpected provider reply');
  return v as Record<string, unknown>;
}

function tokenOf(v: unknown): string {
  const t = obj(v).access_token;
  if (typeof t !== 'string' || t === '') throw new Error('no access token');
  return t;
}

export function githubProvider(creds: ProviderCredentials): Provider {
  const auth = (t: string): RequestInit => ({
    headers: {
      authorization: `Bearer ${t}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'geldar-register',
    },
  });
  return {
    name: 'github',
    authorizeUrl(redirectUri, state, verifier) {
      const q = new URLSearchParams({
        client_id: creds.clientId,
        redirect_uri: redirectUri,
        scope: 'user:email',
        state,
        code_challenge: challengeOf(verifier),
        code_challenge_method: 'S256',
      });
      return `https://github.com/login/oauth/authorize?${q}`;
    },
    async fetchProfile(code, redirectUri, verifier, fetchFn) {
      const token = tokenOf(
        await json(
          await fetchFn('https://github.com/login/oauth/access_token', {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({
              client_id: creds.clientId,
              client_secret: creds.clientSecret,
              code,
              redirect_uri: redirectUri,
              code_verifier: verifier,
            }),
          }),
        ),
      );
      const user = obj(await json(await fetchFn('https://api.github.com/user', auth(token))));
      const emails = await json(await fetchFn('https://api.github.com/user/emails', auth(token)));
      const verified = Array.isArray(emails) && emails.some((e) => obj(e).verified === true);
      return {
        id: idOf(user.id),
        handle: String(user.login),
        verified,
        createdAtMs: Date.parse(String(user.created_at)),
      };
    },
  };
}

/** A provider user id must be a number or a non-empty string; a reply without one must not become the id "undefined". */
export function idOf(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value !== '') return value;
  throw new Error('provider reply has no user id');
}

export function discordProvider(creds: ProviderCredentials): Provider {
  return {
    name: 'discord',
    authorizeUrl(redirectUri, state, verifier) {
      const q = new URLSearchParams({
        response_type: 'code',
        client_id: creds.clientId,
        redirect_uri: redirectUri,
        scope: 'identify email',
        state,
        code_challenge: challengeOf(verifier),
        code_challenge_method: 'S256',
      });
      return `https://discord.com/oauth2/authorize?${q}`;
    },
    async fetchProfile(code, redirectUri, verifier, fetchFn) {
      const token = tokenOf(
        await json(
          await fetchFn('https://discord.com/api/oauth2/token', {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              grant_type: 'authorization_code',
              client_id: creds.clientId,
              client_secret: creds.clientSecret,
              code,
              redirect_uri: redirectUri,
              code_verifier: verifier,
            }).toString(),
          }),
        ),
      );
      const me = obj(
        await json(
          await fetchFn('https://discord.com/api/users/@me', {
            headers: { authorization: `Bearer ${token}` },
          }),
        ),
      );
      const id = idOf(me.id);
      return {
        id,
        handle: String(me.username),
        verified: me.verified === true,
        createdAtMs: snowflakeTimeMs(id),
      };
    },
  };
}

/** The 0135 rules: a verified flag, and an account at least `minAgeDays` old. */
export function meetsRules(p: Profile, nowMs: number, minAgeDays: number): boolean {
  if (!p.verified || !Number.isFinite(p.createdAtMs)) return false;
  return nowMs - p.createdAtMs >= minAgeDays * 86_400_000;
}
