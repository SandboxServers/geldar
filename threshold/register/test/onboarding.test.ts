import { afterEach, describe, expect, it } from 'vitest';
import { hashToken } from '../../mcp/src/store/token-hash.ts';
import type { RegisterConfig } from '../src/config.ts';
import {
  HANDOFF_TTL_MS,
  mcpBaseFor,
  ONBOARDING_CSP,
  ONBOARDING_SCRIPT,
  OnboardingHandoff,
  onboardingPage,
} from '../src/onboarding-pages.ts';
import { tokenExpiresAt } from '../src/tokens-policy.ts';
import { FakeStore } from './fake-store.ts';
import { config, type Harness, harness, NOW, RAW_ID } from './fixture.ts';

let h: Harness;
let store: FakeStore;
afterEach(async () => {
  await h.close();
});

async function start(over: Partial<RegisterConfig> = {}): Promise<void> {
  const clock = { at: NOW };
  store = new FakeStore(() => clock.at);
  h = await harness(over, store);
  (store as { now: () => number }).now = () => h.clock.at;
}

interface Session {
  cookie: string;
  csrf: string;
}

/** Signs in as `userId` with the consent box ticked; returns the session cookie and the form token. */
async function signIn(userId = RAW_ID): Promise<Session> {
  h.idp.userId = userId;
  const { state, cookie } = await h.begin(undefined, true);
  const res = await fetch(`${h.base}/register/callback?code=c&state=${state}`, {
    headers: { cookie },
    redirect: 'manual',
  });
  const set = res.headers.getSetCookie().find((c) => c.startsWith('gr_session=')) ?? '';
  const sc = set.split(';')[0] ?? '';
  const page = await (
    await fetch(`${h.base}/register/account`, { headers: { cookie: sc } })
  ).text();
  return { cookie: sc, csrf: /name="csrf" value="([^"]+)"/.exec(page)?.[1] ?? '' };
}

function post(path: string, s: Session, fields: Record<string, string>): Promise<Response> {
  return fetch(`${h.base}${path}`, {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie: s.cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ csrf: s.csrf, ...fields }).toString(),
  });
}

const onboarding = (s: Session): Promise<Response> =>
  fetch(`${h.base}/register/onboarding`, { headers: { cookie: s.cookie } });
const tokenIn = (html: string): string => /gmcp-[0-9a-f]{64}/.exec(html)?.[0] ?? '';
const PLAYER = 'ag-one-01';
const newPlayer = { player_id: PLAYER, name: 'One', harness: 'claude-code' };

/** Signs in and creates one player; returns the session and the create response (the mint redirect). */
async function created(): Promise<{ s: Session; res: Response }> {
  await start();
  const s = await signIn();
  return { s, res: await post('/register/players', s, newPlayer) };
}

describe('onboarding after a token is made', () => {
  it('redirects to the onboarding page with no token in the redirect, and no-store', async () => {
    const { res } = await created();
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/register/onboarding');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(tokenIn(res.headers.get('location') ?? '')).toBe('');
    expect(tokenIn(await res.text())).toBe('');
  });

  it('sends a token made for an existing player through the same onboarding redirect', async () => {
    const { s } = await created();
    const res = await post(`/register/players/${PLAYER}/token`, s, {});
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/register/onboarding');
    expect(tokenIn(await (await onboarding(s)).text())).not.toBe('');
  });

  it('shows the token once: the second load of the page has none', async () => {
    const { s } = await created();
    const token = tokenIn(await (await onboarding(s)).text());
    expect(token).not.toBe('');
    expect(store.mints[0]?.tokenHash.equals(hashToken(config().tokenPepper, token))).toBe(true);
    const second = await onboarding(s);
    expect(second.status).toBe(200);
    expect(second.headers.get('cache-control')).toBe('no-store');
    const text = await second.text();
    expect(tokenIn(text)).toBe('');
    expect(text).toContain('No token to show');
  });

  it('keeps the token out of the request log and out of every write', async () => {
    const { s } = await created();
    const token = tokenIn(await (await onboarding(s)).text());
    expect(h.logs.join('\n')).not.toContain(token);
    expect(store.writes.join('\n')).not.toContain(token);
  });

  it('shows the real player id and the token in both snippets', async () => {
    const { s } = await created();
    const html = await (await onboarding(s)).text();
    const token = tokenIn(html);
    expect(html).toContain(`https://mcp.example.invalid/p/${PLAYER}`);
    expect(html).toContain('claude mcp add --transport http geldar');
    expect(html).toContain('mcpServers');
    // The token shows in the page, the command and the .mcp.json snippet.
    expect(html.split(token).length - 1).toBeGreaterThanOrEqual(3);
  });

  it('states the 90 day lifetime, shows no expiry date and no renewal promise, and says the old token is revoked at once', async () => {
    const { s } = await created();
    const html = await (await onboarding(s)).text();
    expect(html).not.toContain(tokenExpiresAt(new Date(NOW)).toISOString().slice(0, 10));
    expect(html).not.toContain('10 minutes');
    expect(html).toContain('A token stops working 90 days after it is made.');
    expect(html).toContain('revokes the old one immediately');
  });

  it('has no inline script, no inline style and no inline handler; the CSP allows its own script only', async () => {
    const { s } = await created();
    const res = await onboarding(s);
    const html = await res.text();
    expect(html).not.toMatch(/<script(?![^>]*\ssrc=)/);
    expect(html).not.toMatch(/<style/);
    expect(html).not.toMatch(/\sstyle=/);
    expect(html).not.toMatch(/\son[a-z]+=/);
    expect(html).toContain('<script src="/register/onboarding.js" defer></script>');
    expect(res.headers.get('content-security-policy')).toBe(ONBOARDING_CSP);
    expect(ONBOARDING_CSP).toContain("script-src 'self'");
    expect(ONBOARDING_CSP).not.toContain('unsafe-inline');
  });

  it('serves the copy script from the same origin', async () => {
    await start();
    const res = await fetch(`${h.base}/register/onboarding.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');
    expect(await res.text()).toBe(ONBOARDING_SCRIPT);
  });

  it('refuses the page without a session, and refuses a POST to it', async () => {
    await start();
    const anon = await fetch(`${h.base}/register/onboarding`, { redirect: 'manual' });
    expect(anon.status).toBe(302);
    const s = await signIn();
    expect((await post('/register/onboarding', s, {})).status).toBe(405);
  });

  it('shows the held token only to the session that made it', async () => {
    const { s } = await created();
    const other = await signIn();
    expect(tokenIn(await (await onboarding(other)).text())).toBe('');
    expect(tokenIn(await (await onboarding(s)).text())).not.toBe('');
  });

  it('shows the token one millisecond before the hold ends, and no token once it has ended', async () => {
    const early = await created();
    h.clock.at += HANDOFF_TTL_MS - 1;
    expect(tokenIn(await (await onboarding(early.s)).text())).not.toBe('');
    const late = await created();
    h.clock.at += HANDOFF_TTL_MS;
    const text = await (await onboarding(late.s)).text();
    expect(tokenIn(text)).toBe('');
    expect(text).toContain('No token to show');
  });
});

describe('OnboardingHandoff', () => {
  const shown = { playerId: PLAYER, token: `gmcp-${'a'.repeat(64)}`, expiresAt: new Date(NOW) };

  it('gives the held token once', () => {
    const box = new OnboardingHandoff();
    box.put('k', shown, NOW);
    expect(box.take('k', NOW)).toEqual(shown);
    expect(box.take('k', NOW)).toBeNull();
  });

  it('accepts a take a millisecond before the TTL and refuses one at the TTL', () => {
    const box = new OnboardingHandoff();
    box.put('k', shown, NOW);
    expect(box.take('k', NOW + HANDOFF_TTL_MS - 1)).toEqual(shown);
    box.put('k', shown, NOW);
    expect(box.take('k', NOW + HANDOFF_TTL_MS)).toBeNull();
  });

  it('a later put replaces the held token, and an unknown key takes nothing', () => {
    const box = new OnboardingHandoff();
    box.put('k', shown, NOW);
    const newer = { ...shown, token: `gmcp-${'b'.repeat(64)}` };
    box.put('k', newer, NOW);
    expect(box.take('k', NOW)).toEqual(newer);
    expect(box.take('other', NOW)).toBeNull();
  });
});

describe('mcpBaseFor', () => {
  it('puts mcp in front of the domain of the register host', () => {
    expect(mcpBaseFor('https://glass.geldar.example/register')).toBe('https://mcp.geldar.example');
  });

  it('the explicit REGISTER_MCP_PUBLIC_URL wins over the derived address', () => {
    expect(mcpBaseFor('https://glass.geldar.example', 'https://mcp.register.example')).toBe(
      'https://mcp.register.example',
    );
  });

  it('gives null, not a guess, for a public URL it cannot turn into an MCP address', () => {
    expect(mcpBaseFor('not a url')).toBeNull();
    expect(mcpBaseFor('https://nodot')).toBeNull();
    expect(mcpBaseFor('http://glass.example.invalid')).toBeNull();
    expect(mcpBaseFor('https://glass.example.invalid', '')).toBe('https://mcp.example.invalid');
  });

  it('gives null for a two-label host, since mcp.<domain> would be a guess (https://example.com)', () => {
    expect(mcpBaseFor('https://example.com')).toBeNull();
    expect(mcpBaseFor('https://example.com/register')).toBeNull();
  });

  it('derives only when the first label is register or glass (https://register.example.org is kept)', () => {
    expect(mcpBaseFor('https://register.example.org')).toBe('https://mcp.example.org');
    expect(mcpBaseFor('https://glass.geldar.example')).toBe('https://mcp.geldar.example');
  });

  it('gives null for a registrable apex with a country suffix (https://example.co.uk), not mcp.co.uk', () => {
    expect(mcpBaseFor('https://example.co.uk')).toBeNull();
  });

  it('gives null for an IP-literal-shaped name (https://192.0.2.1.nip.io), not mcp.2.3.4.nip.io', () => {
    expect(mcpBaseFor('https://192.0.2.1.nip.io')).toBeNull();
  });

  it('gives null for an empty label (https://a..b), not mcp..b', () => {
    expect(mcpBaseFor('https://a..b')).toBeNull();
  });

  it('gives null for another first label, even with three labels (https://www.example.org)', () => {
    expect(mcpBaseFor('https://www.example.org')).toBeNull();
  });

  it('gives null for an IP literal, v4 or v6 (https://203.0.113.9)', () => {
    expect(mcpBaseFor('https://203.0.113.9')).toBeNull();
    expect(mcpBaseFor('https://203.0.113.9:8443')).toBeNull();
    expect(mcpBaseFor('https://[2001:db8::1]')).toBeNull();
    expect(mcpBaseFor('https://[::ffff:203.0.113.9]')).toBeNull();
  });

  it('keeps a port-bearing three-label host and preserves the port', () => {
    expect(mcpBaseFor('https://glass.geldar.example:8443')).toBe('https://mcp.geldar.example:8443');
  });
});

describe('onboarding page with no MCP address', () => {
  const shown = { playerId: PLAYER, token: `gmcp-${'c'.repeat(64)}`, expiresAt: new Date(NOW) };

  it('shows the token but no connect command and no .mcp.json', () => {
    const html = onboardingPage(shown, null);
    expect(html).toContain(shown.token);
    expect(html).toContain('No connect command');
    expect(html).not.toContain('claude mcp add');
    expect(html).not.toContain('mcpServers');
    expect(html).not.toContain('/p/');
  });

  it('shows no command and says why when the public URL gives no MCP address (https://example.com)', () => {
    const html = onboardingPage(shown, mcpBaseFor('https://example.com'));
    expect(html).toContain(shown.token);
    expect(html).toContain('No connect command');
    expect(html).toContain('starts with register. or glass.');
    expect(html).not.toContain('claude mcp add');
    expect(html).not.toContain('mcp.com');
  });
});

describe('MCP address override over HTTP', () => {
  it('shows the explicit REGISTER_MCP_PUBLIC_URL in the snippets and not the derived one', async () => {
    await start({ mcpPublicUrl: 'https://mcp.register.example' });
    const s = await signIn();
    await post('/register/players', s, newPlayer);
    const html = await (await onboarding(s)).text();
    expect(html).toContain(`https://mcp.register.example/p/${PLAYER}`);
    expect(html).not.toContain('https://mcp.example.invalid');
  });
});
