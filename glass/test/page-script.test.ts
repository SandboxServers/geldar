/**
 * The page script, public/app.js, run in happy-dom with a fake fetch and a fake EventSource. The
 * module's /js/ imports are pointed at the render sources on disk, so the code under test is the
 * shipped script and the shipped markup. Covers the filters, pause with its 2000-row buffer, load
 * older, reconnect backoff and the banner.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  type Element,
  type HTMLButtonElement,
  type HTMLInputElement,
  type HTMLSelectElement,
  Window,
} from 'happy-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const PUBLIC = new URL('../public/', import.meta.url);
const APP_JS = readFileSync(new URL('app.js', PUBLIC), 'utf8');
const INDEX_HTML = readFileSync(new URL('index.html', PUBLIC), 'utf8');

/** A thought as the API sends it: text fields are plain strings, `parsed` is the reply object. */
function thought(i: number, name = 'Ada'): Record<string, unknown> {
  return {
    thought_id: `t${i}`,
    life_id: 'life-1',
    name,
    tier: 'local',
    at: '2026-11-10T00:00:00.000Z',
    world_day: 3,
    world_tick: i,
    wake_reason: `w${i}`,
    prompt_template_version: 'v1',
    latency_ms: 10,
    parsed: { plan: `plan ${i}` },
  };
}

class FakeSource {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  private listeners = new Map<string, (ev: { data: string }) => void>();
  url: string;
  constructor(url: string) {
    this.url = url;
    sources.push(this);
  }
  addEventListener(type: string, fn: (ev: { data: string }) => void): void {
    this.listeners.set(type, fn);
  }
  emit(type: string, data: unknown): void {
    this.listeners.get(type)?.({ data: JSON.stringify(data) });
  }
  close(): void {
    this.closed = true;
  }
}

let sources: FakeSource[] = [];
let fetchUrls: string[] = [];
let runs = 0;
const windows: Window[] = [];

interface Pages {
  agents: Record<string, unknown>[];
  first: Record<string, unknown>[];
  firstNext: string | null;
  older: Record<string, unknown>[];
}

/** Sets up the page and runs app.js once; returns the document and the window it lives in. */
async function boot(pages: Pages): Promise<Window> {
  const win = new Window({
    url: 'http://127.0.0.1:8787/',
    settings: {
      disableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
    },
  });
  windows.push(win);
  const parsed = new win.DOMParser().parseFromString(INDEX_HTML, 'text/html');
  win.document.body.innerHTML = parsed.body.innerHTML;
  fetchUrls = [];
  sources = [];
  vi.stubGlobal('document', win.document);
  vi.stubGlobal('EventSource', FakeSource);
  vi.stubGlobal('window', {
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
  } as unknown as Window);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      fetchUrls.push(url);
      const body = url.startsWith('/api/agents')
        ? { agents: pages.agents }
        : url.includes('cursor=')
          ? { thoughts: pages.older, next: null }
          : { thoughts: pages.first, next: pages.firstNext };
      return { ok: true, status: 200, json: async () => body };
    }),
  );
  const path = fileURLToPath(new URL('../src/render-model.ts', import.meta.url));
  void path;
  const rewritten = APP_JS.replace(
    /'\/js\/(render-[a-z]+)\.ts'/g,
    (_m, name: string) =>
      `'${pathToFileURL(fileURLToPath(new URL(`../src/${name}.ts`, import.meta.url))).href}'`,
  );
  // A fresh module per boot: the script runs at import, and the data URL includes a run counter.
  const source = `${rewritten}\n//run ${++runs}`;
  await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  await settle();
  return win;
}

/**
 * Lets the page's pending fetches and promise callbacks finish. Uses setImmediate, which the
 * reconnect test's fake timers (setTimeout only) leave alone; a faked setTimeout would never fire.
 */
function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function listRows(win: Window): number {
  return win.document.querySelectorAll('#thoughts > li').length;
}

function fire(win: Window, el: Element | null, type: string): void {
  el?.dispatchEvent(new win.Event(type));
}

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const win of windows.splice(0)) await win.close();
});

const PAGES: Pages = {
  agents: [
    { agent_id: 'a1', name: 'Ada' },
    { agent_id: 'a2', name: '<img src=x onerror="globalThis.__glassCanary=1">' },
  ],
  first: [thought(1), thought(2, '<script>globalThis.__glassCanary=1</script>'), thought(3)],
  firstNext: 'CUR1',
  older: [thought(0)],
};

describe('the page script', () => {
  it('loads the agents and the first page, and draws one row per thought with names as text only', async () => {
    const win = await boot(PAGES);
    expect(fetchUrls[0]).toBe('/api/agents');
    expect(fetchUrls[1]).toBe('/api/thoughts?limit=50');
    expect(listRows(win)).toBe(3);
    expect(win.document.querySelectorAll('#f-agent option').length).toBeGreaterThanOrEqual(2);
    const hostileOption = [...win.document.querySelectorAll('#f-agent option')].find((o) =>
      o.textContent.includes('onerror'),
    );
    expect(hostileOption?.children.length).toBe(0);
    expect(win.document.querySelectorAll('#thoughts img, #thoughts script').length).toBe(0);
    expect((globalThis as { __glassCanary?: unknown }).__glassCanary).toBeUndefined();
    expect(win.document.getElementById('status')?.textContent).toBe('Connecting...');
    sources[0]?.onopen?.();
    expect(win.document.getElementById('status')?.textContent).toBe('Live');
  });

  it('reloads with the outcome filter as a server parameter, and narrows the loaded rows by keyword only', async () => {
    const win = await boot(PAGES);
    const before = fetchUrls.length;
    const outcome = win.document.getElementById('f-outcome') as HTMLSelectElement;
    outcome.value = 'unparsed';
    fire(win, outcome, 'change');
    await settle();
    expect(fetchUrls.slice(before).some((u) => u.includes('outcome=unparsed'))).toBe(true);
    const afterReload = fetchUrls.length;
    const keyword = win.document.getElementById('f-keyword') as HTMLInputElement;
    keyword.value = 'no-such-word';
    fire(win, keyword, 'input');
    await settle();
    expect(listRows(win)).toBe(0);
    expect(fetchUrls.length).toBe(afterReload);
  });

  it('holds live thoughts while paused, caps the hold at 2000, and draws them oldest first on resume', async () => {
    const win = await boot(PAGES);
    sources[0]?.onopen?.();
    const pause = win.document.getElementById('pause') as HTMLButtonElement;
    fire(win, pause, 'click');
    for (let i = 100; i < 2105; i += 1) sources[0]?.emit('thought', thought(i));
    expect(listRows(win)).toBe(3);
    expect(win.document.getElementById('status')?.textContent).toContain('2000 waiting');
    fire(win, pause, 'click');
    await settle();
    expect(listRows(win)).toBe(2000);
    const first = win.document.querySelector('#thoughts > li');
    expect(first?.textContent).toContain('w2104');
    expect(win.document.getElementById('status')?.textContent).not.toContain('waiting');
  });

  it('load older appends the page after the cursor, and disables the button at the end', async () => {
    const win = await boot(PAGES);
    const older = win.document.getElementById('older') as HTMLButtonElement;
    expect(older.disabled).toBe(false);
    fire(win, older, 'click');
    await settle();
    expect(fetchUrls.some((u) => u.includes('cursor=CUR1'))).toBe(true);
    expect(listRows(win)).toBe(4);
    expect(older.disabled).toBe(true);
  });

  it('reconnects with the backoff: 500 ms, then 1000 ms, and says Reconnecting in the meantime', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const win = await boot(PAGES);
    sources[0]?.onopen?.();
    sources[0]?.onerror?.();
    expect(win.document.getElementById('status')?.textContent).toBe('Reconnecting...');
    expect(sources.length).toBe(1);
    await vi.advanceTimersByTimeAsync(499);
    expect(sources.length).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sources.length).toBe(2);
    sources[1]?.onerror?.();
    await vi.advanceTimersByTimeAsync(999);
    expect(sources.length).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(sources.length).toBe(3);
    // The failed connection is closed before its retry, so only one stream is ever open.
    expect(sources[1]?.closed).toBe(true);
    expect(sources[2]?.closed).toBe(false);
  });

  it('is read-only: no request uses a method other than GET, and the banner says it is for humans', async () => {
    const win = await boot(PAGES);
    expect(APP_JS).not.toMatch(/method\s*:|sendBeacon|XMLHttpRequest|\bPOST\b|\bPUT\b|\bDELETE\b/);
    const text = win.document.body.textContent;
    expect(text).toContain('Read-only. For human observers only.');
    expect(text).not.toMatch(
      /you are being (watched|observed)|agents? (are|is) (being )?(watched|observed|told)|the audience/i,
    );
    for (const url of fetchUrls) expect(url.startsWith('/api/')).toBe(true);
  });
});
