import type { ProviderCredentials } from './config.ts';
import type { ProviderName } from './identity.ts';
import { challengeOf } from './pkce.ts';

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/** What the provider says about an account. Only the stable subject: no email, no name. */
export interface Profile {
  readonly id: string;
}

export interface Provider {
  readonly name: ProviderName;
  authorizeUrl(redirectUri: string, state: string, verifier: string): string;
  /** Exchanges the code and reads the subject from the id token. The access token is never kept. */
  fetchProfile(
    code: string,
    redirectUri: string,
    verifier: string,
    fetchFn: FetchFn,
  ): Promise<Profile>;
}

export const MS_AUTHORITY = 'https://login.microsoftonline.com/consumers/v2.0';
/** The fixed tenant id of Microsoft personal accounts; an id token of any other tenant is refused. */
const CONSUMERS_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';

/** The payload of an id token fetched straight from the token endpoint over TLS (the OpenID Connect Core token-endpoint rule: no signature check needed). */
function claimsOf(idToken: unknown): Record<string, unknown> {
  if (typeof idToken !== 'string') throw new Error('no id token');
  const part = idToken.split('.')[1];
  if (!part) throw new Error('bad id token');
  const v: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error('bad id token');
  return v as Record<string, unknown>;
}

export function microsoftProvider(creds: ProviderCredentials): Provider {
  return {
    name: 'microsoft',
    authorizeUrl(redirectUri, state, verifier) {
      const q = new URLSearchParams({
        response_type: 'code',
        client_id: creds.clientId,
        redirect_uri: redirectUri,
        scope: 'openid',
        response_mode: 'query',
        state,
        code_challenge: challengeOf(verifier),
        code_challenge_method: 'S256',
      });
      return `${MS_AUTHORITY}/authorize?${q}`;
    },
    async fetchProfile(code, redirectUri, verifier, fetchFn) {
      const res = await fetchFn(`${MS_AUTHORITY}/token`, {
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
      });
      if (!res.ok) throw new Error(`provider status ${res.status}`);
      const claims = claimsOf(((await res.json()) as Record<string, unknown>).id_token);
      if (claims.aud !== creds.clientId) throw new Error('id token audience');
      if (claims.tid !== CONSUMERS_TENANT) throw new Error('id token tenant');
      // The identity key is the subject, never the email.
      const sub = claims.sub;
      if (typeof sub !== 'string' || sub === '') throw new Error('id token has no subject');
      return { id: sub };
    },
  };
}
