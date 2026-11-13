/**
 * The page script, public/app.js, run in happy-dom with a fake fetch and a fake EventSource. The
 * module's /js/ imports are pointed at the render sources on disk, so the code under test is the
 * shipped script and the shipped markup. Covers the filters, the search count and marks, the detail
 * under an entry, "Copy", live entries added in place, pause with its 2000-row buffer, load older,
 * reconnect backoff and the banner.
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
    action_id: 'act-1',
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
async function boot(pages: Pages, navigator: object = {}, search = ''): Promise<Window> {
  const win = new Window({
    url: `http://127.0.0.1:8787/${search}`,
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
  // The browser's navigator. Without a clipboard on it, the page draws no "Copy" button.
  vi.stubGlobal('navigator', navigator);
  vi.stubGlobal('EventSource', FakeSource);
  vi.stubGlobal('window', {
    location: win.location,
    history: win.history,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
  } as unknown as Window);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      fetchUrls.push(url);
      const one = /^\/api\/thoughts\/([^?]+)/.exec(url);
      const body = url.startsWith('/api/agents')
        ? { agents: pages.agents }
        : one !== null
          ? { thought: pages.first.find((t) => t.thought_id === decodeURIComponent(one[1] ?? '')) }
          : url.startsWith('/api/receipts')
            ? { receipts: [{ kind: 'place', phase: 'settle', item: 'oak_planks', count: 4 }] }
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
  it('restores a bookmark before its single first fetch and replaces the URL on edits', async () => {
    const win = await boot(PAGES, {}, '?q=plan%203&agent=a1&range=day&outcome=parsed&template=v1');
    expect(fetchUrls.filter((u) => u.startsWith('/api/thoughts?'))).toHaveLength(1);
    expect(fetchUrls[1]).toContain('agent=a1');
    expect(fetchUrls[1]).toContain('outcome=parsed');
    expect(fetchUrls[1]).toContain('since=');
    expect(listRows(win)).toBe(0); // fixture entries are outside the last day
    expect(win.document.querySelector('details.more')?.hasAttribute('open')).toBe(true);
    const keyword = win.document.getElementById('f-keyword') as HTMLInputElement;
    expect(keyword.value).toBe('plan 3');
    keyword.value = 'pit';
    fire(win, keyword, 'input');
    expect(win.location.search).toContain('q=pit');
    expect(win.history.length).toBe(1);
  });

  it('ignores invalid URL choices and bounds text before assigning controls', async () => {
    const win = await boot(
      PAGES,
      {},
      '?agent=unknown&range=week&outcome=bad&q=' + 'x'.repeat(220) + '&template=' + 't'.repeat(80),
    );
    expect(fetchUrls[1]).toBe('/api/thoughts?limit=50');
    expect((win.document.getElementById('f-keyword') as HTMLInputElement).value).toHaveLength(200);
    expect((win.document.getElementById('f-template') as HTMLInputElement).value).toHaveLength(64);
  });

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
    // An older page is the largest the API gives; the first page stays small so the page opens fast.
    expect(fetchUrls.find((u) => u.includes('cursor=CUR1'))).toContain('limit=100');
    expect(listRows(win)).toBe(4);
    expect(older.disabled).toBe(true);
  });

  it('says how many entries are loaded, counts the matches of a search and marks them', async () => {
    const win = await boot(PAGES);
    const count = win.document.getElementById('count');
    expect(count?.textContent).toBe('Showing the 3 entries loaded so far.');
    const keyword = win.document.getElementById('f-keyword') as HTMLInputElement;
    keyword.value = 'PLAN 3';
    fire(win, keyword, 'input');
    expect(listRows(win)).toBe(1);
    expect(count?.textContent).toBe(
      '1 match in the 3 entries loaded so far. Load older to search further back.',
    );
    const marks = [...win.document.querySelectorAll('#thoughts mark')].map((m) => m.textContent);
    expect(marks).toEqual(['plan 3']);
    keyword.value = 'no-such-word';
    fire(win, keyword, 'input');
    expect(count?.textContent).toBe(
      'No matches in the 3 entries loaded so far. Load older to search further back.',
    );
    keyword.value = '';
    fire(win, keyword, 'input');
    expect(listRows(win)).toBe(3);
    expect(win.document.querySelectorAll('#thoughts mark').length).toBe(0);
  });

  it('opens the detail under its entry on the time button, and closes it on the second press', async () => {
    const win = await boot(PAGES);
    const first = win.document.querySelector('#thoughts > li');
    const time = first?.querySelector('button.when') as HTMLButtonElement;
    fire(win, time, 'click');
    await settle();
    expect(fetchUrls).toContain('/api/thoughts/t1');
    expect(fetchUrls).toContain('/api/receipts?action_id=act-1');
    const detail = first?.querySelector('.detail');
    expect(detail?.textContent).toContain('Template version');
    expect(detail?.textContent).toContain('place settle oak_planks 4');
    expect(win.document.querySelectorAll('.detail').length).toBe(1);
    // Nothing is drawn outside the list: the detail is under the entry, not at the foot of the page.
    expect(win.document.querySelector('main > .detail, #detail')).toBeNull();
    fire(win, time, 'click');
    await settle();
    expect(win.document.querySelectorAll('.detail').length).toBe(0);
  });

  it('adds a live entry at the top without redrawing the others, so an open detail stays open', async () => {
    const win = await boot(PAGES);
    sources[0]?.onopen?.();
    const before = [...win.document.querySelectorAll('#thoughts > li')];
    fire(win, before[0]?.querySelector('button.when') ?? null, 'click');
    await settle();
    sources[0]?.emit('thought', thought(50));
    const after = [...win.document.querySelectorAll('#thoughts > li')];
    expect(after.length).toBe(4);
    expect(after[0]?.textContent).toContain('plan 50');
    // The same nodes, in the same order: a reader's place, selection and open detail are kept.
    expect(after.slice(1).every((node, i) => node === before[i])).toBe(true);
    expect(after[1]?.querySelector('.detail')).not.toBeNull();
    expect(win.document.getElementById('count')?.textContent).toBe(
      'Showing the 4 entries loaded so far.',
    );
    // A live entry the search does not match is kept but not drawn.
    const keyword = win.document.getElementById('f-keyword') as HTMLInputElement;
    keyword.value = 'plan 1';
    fire(win, keyword, 'input');
    sources[0]?.emit('thought', thought(51));
    expect(listRows(win)).toBe(1);
    expect(win.document.getElementById('count')?.textContent).toContain('1 match in the 5 entries');
  });

  it('redraws a thought that arrives a second time, instead of keeping its old row', async () => {
    const win = await boot(PAGES);
    sources[0]?.emit('thought', { ...thought(1), parsed: { plan: 'a newer plan' } });
    expect(listRows(win)).toBe(3);
    expect(win.document.querySelector('#thoughts > li')?.textContent).toContain('a newer plan');
    expect(win.document.getElementById('thoughts')?.textContent).not.toContain('plan 1');
  });

  it('colours the status by the state of the feed, and "/" puts the cursor in the search field', async () => {
    const win = await boot(PAGES);
    const status = win.document.getElementById('status');
    expect(status?.className).toBe('status connecting');
    sources[0]?.onopen?.();
    expect(status?.className).toBe('status live');
    const keyword = win.document.getElementById('f-keyword');
    expect(win.document.activeElement).not.toBe(keyword);
    win.document.dispatchEvent(new win.KeyboardEvent('keydown', { key: '/', cancelable: true }));
    expect(win.document.activeElement).toBe(keyword);
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

  it('has no "Copy" button where the browser gives the page no clipboard', async () => {
    const win = await boot(PAGES);
    expect(listRows(win)).toBe(3);
    expect(win.document.querySelectorAll('button.copy').length).toBe(0);
  });

  it('copies an entry as plain text on a press of "Copy", says so, and puts the label back', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const written: string[] = [];
    const win = await boot(PAGES, {
      clipboard: { writeText: async (text: string) => void written.push(text) },
    });
    const copy = win.document.querySelector('#thoughts > li button.copy') as HTMLButtonElement;
    expect(win.document.querySelectorAll('button.copy').length).toBe(3);
    // Nothing is written until the reader presses the button.
    expect(written).toEqual([]);
    fire(win, copy, 'click');
    await settle();
    expect(written).toEqual(['Ada, 2026-11-10 00:00 UTC\nplan 1']);
    expect(copy.textContent).toBe('Copied');
    await vi.advanceTimersByTimeAsync(2000);
    expect(copy.textContent).toBe('Copy');
    // The hostile name goes to the clipboard as the same text the page shows.
    const second = win.document.querySelectorAll('#thoughts > li button.copy')[1];
    fire(win, second ?? null, 'click');
    await settle();
    expect(written[1]).toBe(
      '<script>globalThis.__glassCanary=1</script>, 2026-11-10 00:00 UTC\nplan 2',
    );
  });

  it('says so when the browser refuses the copy', async () => {
    const win = await boot(PAGES, {
      clipboard: { writeText: () => Promise.reject(new Error('denied')) },
    });
    const copy = win.document.querySelector('#thoughts > li button.copy') as HTMLButtonElement;
    fire(win, copy, 'click');
    await settle();
    expect(copy.textContent).toBe('Could not copy');
  });

  it('only ever writes plain text to the clipboard: no read, no markup, no legacy copy command', () => {
    const sources = [
      APP_JS,
      ...['render-model', 'render-view', 'render-stream'].map((name) =>
        readFileSync(new URL(`../src/${name}.ts`, import.meta.url), 'utf8'),
      ),
    ].join('\n');
    expect(sources).toMatch(/clipboard\s*\.writeText\(/);
    expect(sources).not.toMatch(
      /readText|clipboard\s*\.read\b|clipboard\s*\.write\(|ClipboardItem/,
    );
    expect(sources).not.toMatch(
      /execCommand|text\/html|addEventListener\(\s*['"](copy|cut|paste)['"]/,
    );
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
