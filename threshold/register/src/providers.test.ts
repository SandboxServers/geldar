import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { providersFor } from './providers.ts';

const CONSUMERS_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';
const creds = { clientId: 'cid', clientSecret: 'sec' };

/** An unsigned id token with the given claims: the provider reads the payload only (OIDC token-endpoint rule). */
function idToken(claims: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return ['eyJhbGciOiJSUzI1NiJ9', payload, 'sig'].join('.');
}

/** A token endpoint reply with an id token for subject sub-1 and an access token; no network. */
const tokenReply = vi.fn(
  async () =>
    new Response(
      JSON.stringify({
        id_token: idToken({ aud: 'cid', tid: CONSUMERS_TENANT, sub: 'sub-1' }),
        access_token: 'at-test',
      }),
      { status: 200 },
    ),
);

describe('providersFor: the gate flag reaches the Microsoft provider from one source', () => {
  it('flag on: scope adds XboxLive.signin and the callback Profile carries the access token', async () => {
    const microsoft = providersFor({ microsoft: creds, requireMcOwnership: true }).microsoft;
    const scope = new URL(microsoft.authorizeUrl('https://h/cb', 's', 'v')).searchParams.get(
      'scope',
    );
    expect(scope).toBe('openid XboxLive.signin');
    const profile = await microsoft.fetchProfile('code', 'https://h/cb', 'v', tokenReply);
    expect(profile).toStrictEqual({ id: 'sub-1', accessToken: 'at-test' });
  });

  it('flag off: scope is openid and the callback Profile is exactly the subject', async () => {
    const microsoft = providersFor({ microsoft: creds, requireMcOwnership: false }).microsoft;
    const scope = new URL(microsoft.authorizeUrl('https://h/cb', 's', 'v')).searchParams.get(
      'scope',
    );
    expect(scope).toBe('openid');
    const profile = await microsoft.fetchProfile('code', 'https://h/cb', 'v', tokenReply);
    expect(profile).toStrictEqual({ id: 'sub-1' });
  });

  it('main.ts builds its providers through providersFor(config), not a second provider call', () => {
    const main = readFileSync(new URL('./main.ts', import.meta.url), 'utf8');
    expect(main).toContain('providers: providersFor(config),');
    expect(main).not.toContain('microsoftProvider(');
  });
});
