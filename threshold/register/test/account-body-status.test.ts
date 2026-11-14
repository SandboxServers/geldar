import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Account, SESSION_COOKIE } from '../src/account.ts';
import { accountPage, type BodyState, bodyStateOf } from '../src/account-pages.ts';
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

const player = (playerId: string, status = 'active'): PlayerRow => ({
  playerId,
  name: 'Scout',
  harness: 'claude-code',
  status,
  publicCamera: false,
  thoughtsDelayedPublic: false,
});

const ONE = [player('ag-one')];

/** The `<li>` of one agent, so an assertion cannot match another agent's line. */
function itemOf(page: string, playerId: string): string {
  const start = page.indexOf(`<li>${playerId} (`);
  const end = page.indexOf('</li>', start);
  return start < 0 ? '' : page.slice(start, end);
}

describe('bodyStateOf (C7-06c)', () => {
  it('maps a 404 from status to stopped', () => {
    expect(bodyStateOf(404, undefined)).toBe('stopped');
  });

  it('maps each known state of a 200 reply to that state', () => {
    for (const state of ['running', 'starting', 'waiting', 'stopped']) {
      expect(bodyStateOf(200, state)).toBe(state);
    }
  });

  it('shows nothing for an unknown state or another status', () => {
    expect(bodyStateOf(200, 'exploding')).toBeUndefined();
    expect(bodyStateOf(200, undefined)).toBeUndefined();
    expect(bodyStateOf(503, undefined)).toBeUndefined();
  });
});

describe('account page status line (C7-06c)', () => {
  it.each<BodyState>(['running', 'starting', 'waiting', 'stopped'])(
    'renders the %s body state on the agent line',
    (state) => {
      const page = accountPage(ONE, 'csrf', [], '', new Map([['ag-one', state]]));
      expect(itemOf(page, 'ag-one')).toContain(`<p class="status">Body: ${state}</p>`);
    },
  );

  it('says nothing about the body when no loader gave a state', () => {
    const page = accountPage(ONE, 'csrf', []);
    expect(itemOf(page, 'ag-one')).not.toContain('Body:');
    expect(page).not.toContain('not shown');
  });

  it('shows no body line for a retired agent, even when a state was given', () => {
    const page = accountPage(
      [player('ag-old', 'retired')],
      'csrf',
      [],
      '',
      new Map([['ag-old', 'running']]),
    );
    expect(itemOf(page, 'ag-old')).not.toContain('Body:');
  });

  it('no longer repeats the stored status as a separate line', () => {
    const page = accountPage(ONE, 'csrf', []);
    expect(page).not.toContain('<p class="status">Status: active</p>');
    expect(itemOf(page, 'ag-one')).toContain(', active)');
  });

  it('renders no credit, token expiry or last-used text: no loader provides them', () => {
    const page = accountPage(ONE, 'csrf', [], '', new Map([['ag-one', 'running']]));
    expect(page).not.toMatch(/credit|expir|last used/i);
  });

  it('escapes a state that is not a known word (a loader is not typed at run time)', () => {
    const hostile = '<img src=x onerror=1>' as BodyState;
    const page = accountPage(ONE, 'csrf', [], '', new Map([['ag-one', hostile]]));
    expect(itemOf(page, 'ag-one')).toContain('Body: &#60;img src=x onerror=1&#62;');
    expect(page).not.toContain('<img');
  });
});

/** A response that records what the handler wrote. */
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

async function call(account: Account, path: string, cookie: string): Promise<Captured> {
  const { res, out } = stubRes();
  await account.handle(
    request('GET', cookie),
    res,
    new URL(`https://glass.example.invalid${path}`),
  );
  return out;
}

/** Signs in with the stub identity and returns the __Host-gr_session cookie. */
async function signIn(account: Account): Promise<string> {
  const { res, out } = stubRes();
  await account.signedIn(identity, res, true);
  const set = (out.headers['set-cookie'] as string[]).find((c) =>
    c.startsWith(`${SESSION_COOKIE}=`),
  );
  return (set ?? '').split(';')[0] ?? '';
}

type Loader = (playerId: string) => Promise<BodyState | undefined>;

/** One account process with a fake store, and the body loader under test. */
function world(bodyState?: Loader) {
  const clock = { at: T0 };
  const store = new FakeStore(() => clock.at);
  const logs: string[] = [];
  const account = new Account({
    config: config(),
    store,
    sessions: new FakeSessionStore(),
    now: () => clock.at,
    log: (line) => logs.push(line),
    bodyState,
  });
  return { store, account, logs };
}

/** A loader that answers from a table; an agent missing from the table has no state. */
const table =
  (states: Record<string, BodyState>): Loader =>
  async (playerId) =>
    states[playerId];

describe('account page status line through the account routes (C7-06c)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the loader state on the agent line of the page', async () => {
    const w = world(table({ 'ag-one': 'running' }));
    w.store.listPlayers = async () => ONE;
    const cookie = await signIn(w.account);
    const page = await call(w.account, '/account', cookie);
    expect(page.status).toBe(200);
    expect(itemOf(page.body, 'ag-one')).toContain('<p class="status">Body: running</p>');
  });

  it('gives no line and logs the fixed text when a loader throws or rejects', async () => {
    const w = world((playerId) => {
      if (playerId === 'ag-one') throw new Error('boom');
      return Promise.reject(new Error('down'));
    });
    w.store.listPlayers = async () => [player('ag-one'), player('ag-two')];
    const cookie = await signIn(w.account);
    const page = await call(w.account, '/account', cookie);
    expect(page.status).toBe(200);
    expect(itemOf(page.body, 'ag-one')).not.toContain('Body:');
    expect(itemOf(page.body, 'ag-two')).not.toContain('Body:');
    expect(w.logs).toEqual(['body status unavailable', 'body status unavailable']);
    expect(w.logs.join('\n')).not.toMatch(/boom|down/);
  });

  it('does not call the loader for a retired agent', async () => {
    const calls: string[] = [];
    const w = world(async (playerId) => {
      calls.push(playerId);
      return 'running';
    });
    w.store.listPlayers = async () => [player('ag-old', 'retired')];
    const cookie = await signIn(w.account);
    const page = await call(w.account, '/account', cookie);
    expect(page.status).toBe(200);
    expect(calls).toEqual([]);
    expect(itemOf(page.body, 'ag-old')).not.toContain('Body:');
  });

  it('gives each agent its own state when two agents differ', async () => {
    const w = world(table({ 'ag-a': 'running', 'ag-b': 'stopped' }));
    w.store.listPlayers = async () => [player('ag-a'), player('ag-b')];
    const cookie = await signIn(w.account);
    const page = (await call(w.account, '/account', cookie)).body;
    expect(itemOf(page, 'ag-a')).toContain('Body: running');
    expect(itemOf(page, 'ag-a')).not.toContain('Body: stopped');
    expect(itemOf(page, 'ag-b')).toContain('Body: stopped');
    expect(itemOf(page, 'ag-b')).not.toContain('Body: running');
  });

  it('answers within 2 s when two loaders never settle, and logs the fixed text for each', async () => {
    const w = world(() => new Promise<BodyState | undefined>(() => undefined));
    w.store.listPlayers = async () => [player('ag-a'), player('ag-b')];
    const cookie = await signIn(w.account);
    vi.useFakeTimers();
    const pending = call(w.account, '/account', cookie);
    await vi.advanceTimersByTimeAsync(2000);
    const page = await pending;
    expect(page.status).toBe(200);
    expect(page.body).not.toContain('Body:');
    expect(w.logs).toEqual(['body status unavailable', 'body status unavailable']);
  });

  it('clears its 2 s timer once the loader answers in time', async () => {
    const w = world(async () => 'running');
    w.store.listPlayers = async () => ONE;
    const cookie = await signIn(w.account);
    vi.useFakeTimers();
    const page = await call(w.account, '/account', cookie);
    expect(itemOf(page.body, 'ag-one')).toContain('Body: running');
    expect(vi.getTimerCount()).toBe(0);
  });
});
