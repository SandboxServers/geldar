/**
 * Runs the page script, public/app.js, in happy-dom with a fake fetch and a fake EventSource. The module's
 * /js/ imports are pointed at the render sources on disk, so the code under test is the shipped script and
 * the shipped markup. Shared by the page tests; the browser never loads this file.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { type Element, Window } from 'happy-dom';
import { vi } from 'vitest';

const PUBLIC = new URL('../public/', import.meta.url);
export const APP_JS = readFileSync(new URL('app.js', PUBLIC), 'utf8');
export const INDEX_HTML = readFileSync(new URL('index.html', PUBLIC), 'utf8');

/** A thought as the API sends it: text fields are plain strings, `parsed` is the reply object. */
export function thought(i: number, name = 'Ada'): Record<string, unknown> {
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
    action_id: 'act-1',
    parsed: { plan: `plan ${i}` },
  };
}

export class FakeSource {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  private listeners = new Map<string, (ev: { data: string }) => void>();
  url: string;
  constructor(url: string) {
    this.url = url;
    page.sources.push(this);
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

/** What the last boot recorded: the streams the page opened and every URL it fetched. */
export const page: { sources: FakeSource[]; fetchUrls: string[] } = { sources: [], fetchUrls: [] };

let runs = 0;
const windows: Window[] = [];

export interface Pages {
  agents: Record<string, unknown>[];
  first: Record<string, unknown>[];
  firstNext: string | null;
  older: Record<string, unknown>[];
}

export interface BootOptions {
  /** The browser's navigator. Without a clipboard on it, the page draws no "Copy entry" button. */
  navigator?: object;
  /** The query string of the page URL, with its "?". */
  search?: string;
  /** The page markup, when a test needs it changed (the delay the server writes in). */
  html?: string;
  /** The layout the browser reports: true is the wide one. Left out: the browser has no matchMedia. */
  wide?: { matches: boolean; listeners: (() => void)[] };
  /** While `down` is true every fetch fails, as it does with no network. */
  network?: { down: boolean };
  /** Overrides specific API replies, including ones held pending by a test. */
  reply?: (url: string) => Promise<unknown> | undefined;
  /** The page's storage. Left out: the browser gives none. */
  localStorage?: { getItem(key: string): string | null; setItem(key: string, value: string): void };
}

/** Sets up the page and runs app.js once; returns the window the document lives in. */
export async function boot(pages: Pages, options: BootOptions = {}): Promise<Window> {
  const win = new Window({
    url: `http://127.0.0.1:8787/${options.search ?? ''}`,
    settings: {
      disableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
    },
  });
  windows.push(win);
  const parsed = new win.DOMParser().parseFromString(options.html ?? INDEX_HTML, 'text/html');
  win.document.body.innerHTML = parsed.body.innerHTML;
  page.fetchUrls = [];
  page.sources = [];
  vi.stubGlobal('document', win.document);
  vi.stubGlobal('navigator', options.navigator ?? {});
  vi.stubGlobal('EventSource', FakeSource);
  const { wide } = options;
  vi.stubGlobal('window', {
    location: win.location,
    history: win.history,
    addEventListener: win.addEventListener.bind(win),
    removeEventListener: () => undefined,
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    localStorage: options.localStorage,
    matchMedia:
      wide === undefined
        ? undefined
        : (query: string) => ({
            get matches() {
              return query === '(min-width: 700px)' && wide.matches;
            },
            addEventListener: (_type: string, fn: () => void) => wide.listeners.push(fn),
          }),
  } as unknown as Window);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      page.fetchUrls.push(url);
      if (options.network?.down === true) throw new TypeError('Failed to fetch');
      const override = options.reply?.(url);
      if (override !== undefined) return { ok: true, status: 200, json: () => override };
      const one = /^\/api\/thoughts\/([^?]+)/.exec(url);
      const body = url.startsWith('/api/agents')
        ? { agents: pages.agents, total: pages.agents.length }
        : one !== null
          ? { thought: pages.first.find((t) => t.thought_id === decodeURIComponent(one[1] ?? '')) }
          : url.startsWith('/api/receipts')
            ? { receipts: [{ kind: 'place', phase: 'committed', item: 'oak_planks', count: 4 }] }
            : url.includes('cursor=')
              ? { thoughts: pages.older, next: null }
              : { thoughts: pages.first, next: pages.firstNext };
      return { ok: true, status: 200, json: async () => body };
    }),
  );
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
 * Lets the page's pending fetches and promise callbacks finish. Uses setImmediate, which the tests' fake
 * timers (setTimeout only) leave alone; a faked setTimeout would never fire.
 */
export function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export function listRows(win: Window): number {
  return win.document.querySelectorAll('#thoughts > li').length;
}

export function fire(win: Window, el: Element | null, type: string): void {
  el?.dispatchEvent(new win.Event(type, { bubbles: true }));
}

/** Undoes a test's boots: real timers, the real globals, and every window closed. */
export async function cleanUp(): Promise<void> {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  for (const win of windows.splice(0)) await win.close();
}

export const PAGES: Pages = {
  agents: [
    { agent_id: 'a1', name: 'Ada', mode: 'headless' },
    { agent_id: 'a2', name: '<img src=x onerror="globalThis.__glassCanary=1">' },
  ],
  first: [thought(1), thought(2, '<script>globalThis.__glassCanary=1</script>'), thought(3)],
  firstNext: 'CUR1',
  older: [thought(0)],
};
