import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_CONTROLS_SCRIPT } from '../src/account-controls-script.ts';

/** A minimal element: attributes, textContent, disabled, and click listeners. Enough for the script, no more. */
class FakeEl {
  readonly attrs: Record<string, string>;
  textContent = '';
  disabled = false;
  innerHTMLSet = false;
  readonly listeners: Array<(event: unknown) => void> = [];
  /** The element a click bubbles to, as in the browser (the script listens on the root, not on each button). */
  parent: FakeEl | null = null;
  constructor(attrs: Record<string, string> = {}) {
    this.attrs = { ...attrs };
  }
  getAttribute(name: string): string | null {
    return name in this.attrs ? (this.attrs[name] ?? null) : null;
  }
  addEventListener(type: string, fn: (event: unknown) => void): void {
    if (type === 'click') this.listeners.push(fn);
  }
  set innerHTML(_value: string) {
    this.innerHTMLSet = true;
  }
  get innerHTML(): string {
    return '';
  }
  click(): void {
    for (let el: FakeEl | null = this; el; el = el.parent) {
      for (const fn of el.listeners) fn({ target: this, preventDefault() {} });
    }
  }
}

interface Call {
  url: string;
  init: { method: string; credentials: string; headers: Record<string, string>; body?: string };
}

type Responder = (call: Call) => Promise<unknown>;

const reply = (status: number, body: unknown = undefined) =>
  Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Loads the served script into a fresh realm over a fake page and a fake fetch. */
function load(respond: Responder, csrf = 'tok-1', withRoot = true) {
  const root = new FakeEl({ 'data-csrf': csrf });
  const message = new FakeEl();
  const statusLine = new FakeEl();
  const buttons: FakeEl[] = [];
  for (const attrs of [
    { 'data-agent': 'ag-one', 'data-op': 'start' },
    { 'data-agent': 'ag-one', 'data-op': 'stop' },
    { 'data-agent': 'ag-one', 'data-op': 'restart' },
    { 'data-agent': 'ag-one', 'data-op': 'status' },
  ]) {
    const button = new FakeEl({ type: 'button', ...attrs });
    button.parent = root;
    buttons.push(button);
  }
  root.querySelectorAll = () => buttons;
  const byId = new Map<string, FakeEl>([
    ['account-controls', root],
    ['controls-message', message],
    ['status-ag-one', statusLine],
  ]);
  const calls: Call[] = [];
  const document = { getElementById: (id: string) => (withRoot ? (byId.get(id) ?? null) : null) };
  const fetch = (url: string, init: Call['init']) => {
    const call = { url, init };
    calls.push(call);
    return respond(call);
  };
  runInNewContext(ACCOUNT_CONTROLS_SCRIPT, { document, fetch });
  const button = (op: string, flag = '') =>
    buttons.find(
      (b) => b.getAttribute('data-op') === op && b.getAttribute('data-flag') === (flag || null),
    ) ??
    buttons.find((b) => b.getAttribute('data-op') === op) ??
    new FakeEl();
  return { root, message, statusLine, buttons, calls, button };
}

const ok = () => Promise.resolve(reply(200, {}));

describe('account controls script: CSRF and routes (C7-06d)', () => {
  it('posts a body start to the owner API with the page token and the session cookie', async () => {
    const page = load(() => reply(200, {}));
    page.button('start').click();
    await tick();
    const [first] = page.calls;
    expect(first?.url).toBe('/register/api/v1/agents/ag-one/body/start');
    expect(first?.init.method).toBe('POST');
    expect(first?.init.credentials).toBe('same-origin');
    expect(first?.init.headers['x-csrf-token']).toBe('tok-1');
  });

  it('sends the CSRF header on every mutating call, and takes the token from the page', async () => {
    const page = load(() => reply(200, {}), 'page-token-9');
    page.button('stop').click();
    await tick();
    page.button('restart').click();
    await tick();
    const writes = page.calls.filter((c) => c.init.method !== 'GET');
    expect(writes.map((c) => c.init.method)).toEqual(['POST', 'POST']);
    for (const call of writes) expect(call.init.headers['x-csrf-token']).toBe('page-token-9');
  });

  it('sends the start, stop and restart routes, and only those', async () => {
    const page = load(ok);
    page.button('stop').click();
    await tick();
    page.button('restart').click();
    await tick();
    // A successful body call refreshes the status line, so each write is followed by one status read.
    expect(page.calls.map((c) => c.url)).toEqual([
      '/register/api/v1/agents/ag-one/body/stop',
      '/register/api/v1/agents/ag-one/body/status',
      '/register/api/v1/agents/ag-one/body/restart',
      '/register/api/v1/agents/ag-one/body/status',
    ]);
  });
});

describe('account controls script: no visibility toggle (C7-06d, deviation)', () => {
  it('has no PATCH and no flag button: Caddy refuses PATCH on /register, so the toggles are the POST forms', () => {
    expect(ACCOUNT_CONTROLS_SCRIPT).not.toContain('PATCH');
    expect(ACCOUNT_CONTROLS_SCRIPT).not.toContain('data-flag');
    expect(ACCOUNT_CONTROLS_SCRIPT).not.toContain('publicCamera');
  });

  it('sends nothing for an op it does not know, even one set on a button', async () => {
    const page = load(ok);
    const rogue = page.buttons[0];
    if (rogue) rogue.attrs['data-op'] = 'flag';
    rogue?.click();
    await tick();
    expect(page.calls).toHaveLength(0);
  });
});

describe('account controls script: path and session text (C7-06d)', () => {
  it('encodes the agent id in the path', async () => {
    const page = load(ok);
    const first = page.buttons[0];
    if (first) first.attrs['data-agent'] = 'a/b?c';
    first?.click();
    await tick();
    expect(page.calls[0]?.url).toBe('/register/api/v1/agents/a%2Fb%3Fc/body/start');
  });

  it('says the session ended on a 401, with a fixed text and no response body', async () => {
    const page = load(() => reply(401, { detail: 'owner secret' }));
    page.button('start').click();
    await tick();
    expect(page.message.textContent).toBe('Your session ended: sign in again.');
    expect(page.message.textContent).not.toContain('secret');
  });
});

/**
 * The owner API routes the script may call, copied from the real route table (C7-04c body.ts, C7-04e agents.ts). A
 * path or verb the script uses that is not listed here fails the test, so drift between script and routes is caught.
 */
const REAL_OWNER_ROUTES: ReadonlyArray<{ method: string; pattern: RegExp }> = [
  { method: 'POST', pattern: /^\/agents\/([^/]+)\/body\/start$/ },
  { method: 'POST', pattern: /^\/agents\/([^/]+)\/body\/stop$/ },
  { method: 'POST', pattern: /^\/agents\/([^/]+)\/body\/restart$/ },
  { method: 'GET', pattern: /^\/agents\/([^/]+)\/body\/status$/ },
];

describe('account controls script: routes match the owner API (C7-06d)', () => {
  it('calls only real owner routes, with the real verb, for every control', async () => {
    const page = load(() => reply(200, { state: 'running' }));
    for (const [op, flag] of [
      ['start', ''],
      ['stop', ''],
      ['restart', ''],
      ['status', ''],
    ] as const) {
      page.button(op, flag).click();
      await tick();
      await tick();
    }
    expect(page.calls.length).toBeGreaterThan(0);
    for (const call of page.calls) {
      expect(call.url.startsWith('/register/api/v1/')).toBe(true);
      const path = call.url.slice('/register/api/v1'.length);
      const matches = REAL_OWNER_ROUTES.some(
        (route) => route.method === call.init.method && route.pattern.test(path),
      );
      expect(matches, `${call.init.method} ${call.url}`).toBe(true);
    }
  });
});

describe('account controls script: flight, errors and text (C7-06d)', () => {
  it('disables every button while a request is in flight and enables them after it settles', async () => {
    // The start is held open; the status read that follows a successful start answers at once.
    let finish: (value: unknown) => void = () => undefined;
    let held = false;
    const page = load(() => {
      if (held) return reply(200, { state: 'running' });
      held = true;
      return new Promise((resolve) => (finish = resolve));
    });
    page.button('start').click();
    expect(page.buttons.every((b) => b.disabled)).toBe(true);
    finish(reply(200, {}));
    await tick();
    expect(page.buttons.some((b) => b.disabled)).toBe(false);
  });

  it('keeps the buttons disabled until the last of two overlapping requests settles', async () => {
    const pending: Array<(value: unknown) => void> = [];
    const page = load(() => new Promise((resolve) => pending.push(resolve)));
    // Two status reads: two calls in flight and no follow-up, so the buttons stay disabled until both settle.
    page.button('status').click();
    page.button('status').click();
    expect(page.buttons.every((b) => b.disabled)).toBe(true);
    pending[0]?.(reply(200, {}));
    await tick();
    expect(page.buttons.every((b) => b.disabled)).toBe(true);
    pending[1]?.(reply(200, {}));
    await tick();
    expect(page.buttons.some((b) => b.disabled)).toBe(false);
  });

  it('re-enables the buttons and shows a fixed text after a network failure', async () => {
    const page = load(() => Promise.reject(new Error('socket hang up')));
    page.button('start').click();
    await tick();
    expect(page.buttons.some((b) => b.disabled)).toBe(false);
    expect(page.message.textContent).toBe('The request failed. Nothing was changed.');
    expect(page.message.textContent).not.toContain('socket');
  });

  it('shows the body-unavailable text for a 503', async () => {
    const page = load(() => reply(503, { error: 'body_unavailable' }));
    page.button('start').click();
    await tick();
    expect(page.message.textContent).toBe('Body control is not available yet');
  });

  it('shows the busy text for a 429', async () => {
    const page = load(() => reply(429, {}));
    page.button('start').click();
    await tick();
    expect(page.message.textContent).toBe('Too many requests. Try again shortly.');
  });

  it('never echoes a response body: a hostile body gives the fixed text only', async () => {
    const page = load(() => reply(500, { error: '<img src=x onerror=alert(1)>' }));
    page.button('stop').click();
    await tick();
    expect(page.message.textContent).toBe('The request failed. Nothing was changed.');
    expect(page.message.innerHTMLSet).toBe(false);
  });

  it('says Done and refreshes the status line after a body start', async () => {
    const page = load((call) =>
      call.url.endsWith('/status') ? reply(200, { state: 'running' }) : reply(200, {}),
    );
    page.button('start').click();
    await tick();
    await tick();
    expect(page.message.textContent).toBe('Done.');
    expect(page.statusLine.textContent).toBe('Body: running');
  });

  it('shows Body: unknown for a state it does not know', async () => {
    const page = load(() => reply(200, { state: 'exploding' }));
    page.button('status').click();
    await tick();
    await tick();
    expect(page.statusLine.textContent).toBe('Body: unknown');
  });

  it('does nothing and throws nothing when the page has no control root', () => {
    expect(() => load(ok, 'tok-1', false)).not.toThrow();
  });
});

describe('account controls script: source (C7-06d)', () => {
  it('uses no innerHTML, no eval, no document.write and no inline handler text', () => {
    for (const banned of [
      'innerHTML',
      'outerHTML',
      'insertAdjacentHTML',
      'eval(',
      'document.write',
      'Function(',
      'onclick',
    ]) {
      expect(ACCOUNT_CONTROLS_SCRIPT).not.toContain(banned);
    }
  });

  it('reads the CSRF token from the page attribute, never from a cookie', () => {
    expect(ACCOUNT_CONTROLS_SCRIPT).toContain("getAttribute('data-csrf')");
    expect(ACCOUNT_CONTROLS_SCRIPT).not.toContain('document.cookie');
  });
});
