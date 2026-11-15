import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { Account, SESSION_COOKIE } from '../src/account.ts';
import { controlsBlock } from '../src/account-controls-page.ts';
import {
  ACCOUNT_CONTROLS_SCRIPT,
  ACCOUNT_CONTROLS_SCRIPT_PATH,
  ACCOUNT_PAGE_CSP,
  OWNER_API_PUBLIC_PREFIX,
} from '../src/account-controls-script.ts';
import type { Identity } from '../src/identity.ts';
import type { PlayerRow } from '../src/store.ts';
import { FakeSessionStore } from './fake-session-store.ts';
import { FakeStore } from './fake-store.ts';
import { config } from './fixture.ts';

const T0 = Date.parse('2026-11-11T00:00:00Z');
const identity: Identity = {
  provider: 'microsoft',
  identityHash: 'ab'.repeat(32),
  display: 'someone',
};

const player = (playerId: string, status = 'active', name = 'Scout'): PlayerRow => ({
  playerId,
  name,
  harness: 'claude-code',
  status,
  publicCamera: false,
  thoughtsDelayedPublic: false,
});

interface Captured {
  status: number;
  headers: Record<string, string | string[]>;
  body: string;
}

function stubRes(): { res: ServerResponse; out: Captured } {
  const out: Captured = { status: 0, headers: {}, body: '' };
  const res = {
    writeHead(code: number, headers: Record<string, string | string[]> = {}) {
      out.status = code;
      out.headers = { ...headers };
      return res;
    },
    end(body?: string) {
      out.body = body ?? '';
      return res;
    },
  } as unknown as ServerResponse;
  return { res, out };
}

function request(method: string, cookie: string): IncomingMessage {
  return Object.assign(Readable.from([]), {
    method,
    headers: { cookie },
  }) as unknown as IncomingMessage;
}

async function get(account: Account, path: string, cookie = ''): Promise<Captured> {
  const { res, out } = stubRes();
  await account.handle(
    request('GET', cookie),
    res,
    new URL(`https://glass.example.invalid${path}`),
  );
  return out;
}

async function signIn(account: Account): Promise<string> {
  const { res, out } = stubRes();
  await account.signedIn(identity, res, true);
  const set = (out.headers['set-cookie'] as string[]).find((c) =>
    c.startsWith(`${SESSION_COOKIE}=`),
  );
  return (set ?? '').split(';')[0] ?? '';
}

async function seedPlayer(store: FakeStore, playerId: string): Promise<void> {
  const owner = await store.findOwner(identity.identityHash);
  await store.createPlayer({
    identityHash: identity.identityHash,
    ownerId: owner?.ownerId ?? '',
    playerId,
    lifeId: `${playerId}-life`,
    name: 'Scout',
    harness: 'claude-code',
    tokenId: `${playerId}-token`,
    tokenHash: Buffer.alloc(32),
  });
}

function world(store?: FakeStore, bodyControls?: boolean) {
  const clock = { at: T0 };
  const account = new Account({
    config: config(),
    store: store ?? new FakeStore(() => clock.at),
    sessions: new FakeSessionStore(),
    now: () => clock.at,
    log: () => undefined,
    bodyControls,
  });
  return account;
}

describe('account page CSP (C7-06d)', () => {
  it('is exactly the page CSP: one same-origin script, no unsafe-inline', async () => {
    const account = world();
    const cookie = await signIn(account);
    const out = await get(account, '/account', cookie);
    expect(out.status).toBe(200);
    expect(out.headers['content-security-policy']).toBe(ACCOUNT_PAGE_CSP);
    expect(ACCOUNT_PAGE_CSP).toBe(
      "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self'; img-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    );
    expect(ACCOUNT_PAGE_CSP).not.toContain('unsafe');
  });

  it('keeps the other security headers on the account page', async () => {
    const account = world();
    const cookie = await signIn(account);
    const out = await get(account, '/account', cookie);
    expect(out.headers['x-content-type-options']).toBe('nosniff');
    expect(out.headers['cache-control']).toBe('no-store');
  });
});

describe('account page script route (C7-06d)', () => {
  it('serves the script as JavaScript with nosniff and a revalidating cache', async () => {
    const out = await get(world(), ACCOUNT_CONTROLS_SCRIPT_PATH);
    expect(out.status).toBe(200);
    expect(out.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(out.headers['x-content-type-options']).toBe('nosniff');
    expect(out.headers['cache-control']).toBe('no-cache');
    expect(out.body).toBe(ACCOUNT_CONTROLS_SCRIPT);
  });

  it('refuses any method but GET', async () => {
    const account = world();
    const { res, out } = stubRes();
    await account.handle(
      request('POST', ''),
      res,
      new URL(`https://glass.example.invalid${ACCOUNT_CONTROLS_SCRIPT_PATH}`),
    );
    expect(out.status).toBe(405);
    expect(out.body).not.toContain('use strict');
  });
});

describe('account page markup (C7-06d)', () => {
  it('links the same-origin script and has no inline script', async () => {
    const store = new FakeStore(() => T0);
    const account = world(store, true);
    const cookie = await signIn(account);
    await seedPlayer(store, 'ag-one-01');
    const page = (await get(account, '/account', cookie)).body;
    expect(page).toContain('<script src="/register/account-controls.js" defer></script>');
    // The page ships with a script only when the script is linked: a script tag always has a src attribute.
    expect(page).not.toMatch(/<script(?![^>]*\ssrc=)/);
  });

  it('links no script when the owner has no agent, since there is nothing to control', async () => {
    const account = world();
    const cookie = await signIn(account);
    const page = (await get(account, '/account', cookie)).body;
    expect(page).not.toContain('account-controls.js');
  });

  it('keeps the visibility forms as they were: POST with the CSRF token, outside any noscript', async () => {
    const store = new FakeStore(() => T0);
    const account = world(store);
    const cookie = await signIn(account);
    await seedPlayer(store, 'ag-one-01');
    const page = (await get(account, '/account', cookie)).body;
    expect(page).not.toContain('<noscript>');
    expect(page).toContain('action="/register/players/ag-one-01/public-camera"');
    expect(page).toContain('action="/register/players/ag-one-01/public-thoughts"');
    expect(page).toContain('Public camera on</button>');
    expect(page).not.toContain('(live)');
  });

  it('renders no body buttons when the body routes are not mounted', () => {
    expect(controlsBlock([player('ag-one')], 'tok', false)).toBe('');
  });

  it('shows the body buttons on the account page only when bodyControls is set (Account, not the block)', async () => {
    const onStore = new FakeStore(() => T0);
    const withBody = world(onStore, true);
    const cookie = await signIn(withBody);
    await seedPlayer(onStore, 'ag-one-01');
    const pageOn = (await get(withBody, '/account', cookie)).body;
    expect(pageOn).toContain('data-op="start"');
    expect(pageOn).toContain('data-op="restart"');

    const offStore = new FakeStore(() => T0);
    const without = world(offStore);
    const cookieOff = await signIn(without);
    await seedPlayer(offStore, 'ag-one-01');
    const pageOff = (await get(without, '/account', cookieOff)).body;
    expect(pageOff).not.toContain('data-op="start"');
    expect(pageOff).not.toContain('account-controls');
    expect(pageOff).toContain('/register/players/ag-one-01/public-camera');
  });

  it('keeps the script API on the public prefix the edge forwards: /register/api/v1', () => {
    expect(OWNER_API_PUBLIC_PREFIX).toBe('/register/api/v1');
    expect(ACCOUNT_CONTROLS_SCRIPT).toContain("var API = '/register/api/v1';");
  });

  it('renders start, stop and restart per agent when the body routes are mounted', () => {
    const block = controlsBlock([player('ag-one')], 'tok', true);
    for (const op of ['start', 'stop', 'restart']) {
      expect(block).toContain(`data-agent="ag-one" data-op="${op}"`);
    }
    expect(block).toContain('id="status-ag-one"');
  });

  it('lists only non-retired agents, so another owner or a retired agent gets no section', () => {
    const block = controlsBlock([player('ag-live'), player('ag-old', 'retired')], 'tok', true);
    expect(block).toContain('data-agent="ag-live"');
    expect(block).not.toContain('ag-old');
    expect(controlsBlock([player('ag-old', 'retired')], 'tok', true)).toBe('');
  });

  it('has no visibility toggle in the block: the visibility forms are the POST fallback', () => {
    const block = controlsBlock([player('ag-one')], 'tok', true);
    expect(block).not.toContain('data-flag');
    expect(block).not.toContain('publicCamera');
    expect(block).not.toContain('PATCH');
  });

  it('puts the CSRF token in data-csrf, escaped', () => {
    const block = controlsBlock([player('ag-one')], 'a"b<c', true);
    expect(block).toContain('data-csrf="a&#34;b&#60;c"');
    expect(block).not.toContain('a"b<c');
  });

  it('escapes the player id and name in the markup', () => {
    const block = controlsBlock([player('ag-one', 'active', '<img src=x>')], 'tok', true);
    expect(block).not.toContain('<img');
  });
});
