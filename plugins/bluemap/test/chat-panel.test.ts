import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// The live chat panel (decision 0310). The script is loaded in a function with no DOM, and its exported pure
// functions run against a fake document that records every element made and every innerHTML write.
// Every name and text here is made up.

interface Line {
  t: number;
  id: string;
  text: string;
}
interface FakeNode {
  tagName?: string;
  data?: string;
  textContent: string;
  className: string;
  childNodes: FakeNode[];
  style: { color?: string };
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  classList: { toggle(name: string, force?: boolean): boolean; contains(name: string): boolean };
  attrs: Record<string, string>;
  setAttribute(name: string, value: string): void;
  addEventListener(type: string, fn: () => void): void;
  // Runs the listeners of an event, as the browser does for a click or a scroll.
  fire(type: string): void;
  appendChild(c: FakeNode): FakeNode;
  removeChild(c: FakeNode): FakeNode;
}
interface FakeDoc {
  created: string[];
  markupWrites: string[];
  head: FakeNode;
  body: FakeNode;
  createElement(tag: string): FakeNode;
  createTextNode(data: string): FakeNode;
  querySelector(selector: string): FakeNode | null;
}
interface ChatModule {
  parseFeed(text: string): Line[] | null;
  parsePlayers(text: string): Array<{ uuid: string; name: string }> | null;
  remember(names: Map<string, string>, players: Array<{ uuid: string; name: string }>): void;
  nameFor(names: Map<string, string>, id: string): string;
  colourFor(id: string): string;
  clock(t: number): string;
  nextDelay(ok: boolean): number;
  createFeedState(
    doc: FakeDoc,
    list: FakeNode,
  ): { shown: string[]; names: Map<string, string>; unnamed: unknown[]; pinned: boolean };
  buildPanel(doc: FakeDoc, onExpand?: () => void): { root: FakeNode; list: FakeNode };
  pollOnce(state: unknown, fetchFn: FetchFn): Promise<boolean>;
  runLoop(state: unknown, fetchFn: FetchFn, schedule: (fn: () => void, ms: number) => void): void;
  ensureStyles(doc: FakeDoc): boolean;
  start(doc: FakeDoc, fetchFn: FetchFn, schedule: (fn: () => void, ms: number) => void): void;
  NEUTRAL: string;
  MAX_ROWS: number;
  FETCH_TIMEOUT_MS: number;
}
type FetchFn = (url: string, opts: unknown) => Promise<{ ok: boolean; text(): Promise<string> }>;

const SRC = readFileSync(join(import.meta.dirname, '..', 'web', 'geldar-chat.js'), 'utf8');

function load(): ChatModule {
  const mod = { exports: {} as Record<string, unknown> };
  new Function('module', SRC)(mod);
  return mod.exports as unknown as ChatModule;
}
const chat = load();

function fakeNode(doc: { markupWrites: string[] }, tag: string): FakeNode {
  const classes = new Set<string>();
  const listeners: Record<string, Array<() => void>> = {};
  const node: FakeNode = {
    tagName: tag,
    textContent: '',
    className: '',
    childNodes: [],
    style: {},
    scrollTop: 0,
    scrollHeight: 0,
    clientHeight: 0,
    classList: {
      toggle(name, force) {
        const on = force ?? !classes.has(name);
        if (on) classes.add(name);
        else classes.delete(name);
        return on;
      },
      contains: (name) => classes.has(name),
    },
    attrs: {},
    setAttribute(name, value) {
      node.attrs[name] = value;
    },
    addEventListener(type, fn) {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(fn);
    },
    fire(type) {
      for (const fn of listeners[type] ?? []) fn();
    },
    appendChild(c) {
      node.childNodes.push(c);
      return c;
    },
    removeChild(c) {
      node.childNodes.splice(node.childNodes.indexOf(c), 1);
      return c;
    },
  };
  Object.defineProperty(node, 'innerHTML', {
    set(v: string) {
      doc.markupWrites.push(v);
    },
  });
  return node;
}

// The first <link> under node whose href contains href, searched depth first. Text nodes have no children.
function findLink(node: FakeNode, href: string): FakeNode | null {
  for (const c of node.childNodes ?? []) {
    if (c.tagName === 'link' && (c.attrs.href ?? '').includes(href)) return c;
    const hit = findLink(c, href);
    if (hit) return hit;
  }
  return null;
}

function fakeDoc(): FakeDoc {
  const doc: FakeDoc = {
    created: [],
    markupWrites: [],
    head: undefined as unknown as FakeNode,
    body: undefined as unknown as FakeNode,
    createElement(tag) {
      doc.created.push(tag);
      return fakeNode(doc, tag);
    },
    createTextNode(data) {
      return { data, textContent: data, textContentOwner: true } as unknown as FakeNode;
    },
    querySelector(selector) {
      // Only the form the script uses: link[href*="..."].
      const want = /^link\[href\*="([^"]+)"\]$/.exec(selector)?.[1];
      if (want === undefined) throw new Error(`unsupported selector ${selector}`);
      return (doc.head && findLink(doc.head, want)) || findLink(doc.body, want);
    },
  };
  doc.head = fakeNode(doc, 'head');
  doc.body = fakeNode(doc, 'body');
  return doc;
}

const line = (n: number, id: string, text = `line ${n}`): Line => ({
  t: 1_700_000_000_000 + n * 1000,
  id,
  text,
});
const feedText = (lines: Line[]) => JSON.stringify({ v: 1, lines });
const playersText = (players: Array<{ uuid: string; name: string }>) => JSON.stringify({ players });
const FEED = '/geldar-chat.json';
const PLAYERS = '/maps/overworld/live/players.json';

/** A fetch stub. Routes map a URL to a body; a missing URL is a 404, an Error value throws. */
function stubFetch(routes: Record<string, string | Error>) {
  const calls: Array<{ url: string; opts: unknown }> = [];
  const fn: FetchFn = async (url, opts) => {
    calls.push({ url, opts });
    const body = routes[url];
    if (body instanceof Error) throw body;
    if (body === undefined) return { ok: false, text: async () => '' };
    return { ok: true, text: async () => body };
  };
  return { fn, calls };
}

const rowName = (row: FakeNode) => row.childNodes[2]?.textContent;
const rowText = (row: FakeNode) => row.childNodes[3]?.data;

describe('chat panel: parsing', () => {
  it('reads the feed and rejects a body that is not {"v":1,"lines":[...]}', () => {
    expect(chat.parseFeed(feedText([line(1, 'u1')]))).toEqual([line(1, 'u1')]);
    expect(chat.parseFeed('{"v":2,"lines":[]}')).toBeNull();
    expect(chat.parseFeed('{"v":1}')).toBeNull();
    expect(chat.parseFeed('not json')).toBeNull();
    expect(chat.parseFeed('null')).toBeNull();
  });

  it('skips a malformed line and keeps the last 100 of the feed', () => {
    const many = Array.from({ length: 150 }, (_, i) => line(i + 1, `u${i}`));
    const parsed = chat.parseFeed(
      JSON.stringify({ v: 1, lines: [{ t: 'bad', id: 'x', text: 'x' }, ...many] }),
    );
    expect(parsed).toHaveLength(100);
    expect(parsed?.[0]?.id).toBe('u50');
    expect(parsed?.[99]?.id).toBe('u149');
  });

  it('reads uuid and name pairs from players.json and rejects other shapes', () => {
    expect(chat.parsePlayers(playersText([{ uuid: 'u1', name: 'Ash' }]))).toEqual([
      { uuid: 'u1', name: 'Ash' },
    ]);
    expect(chat.parsePlayers('{"people":[]}')).toBeNull();
  });
});

describe('chat panel: names and colour', () => {
  it('shows the neutral label for an id never seen', () => {
    expect(chat.nameFor(new Map(), 'ag_unknown_01')).toBe('Ranger');
    expect(chat.NEUTRAL).toBe('Ranger');
  });

  it('keeps the cached name when the speaker has left the player list', () => {
    const names = new Map<string, string>();
    chat.remember(names, [{ uuid: 'u1', name: 'Ash' }]);
    chat.remember(names, []);
    expect(chat.nameFor(names, 'u1')).toBe('Ash');
  });

  it('gives a speaker the same colour every time, from the id alone', () => {
    expect(chat.colourFor('u1')).toBe(chat.colourFor('u1'));
    expect(chat.colourFor('u1')).toMatch(/^hsl\(\d+ 70% 72%\)$/);
  });

  it('shows the time as HH:MM:SS', () => {
    const t = new Date(2026, 10, 14, 9, 5, 7).getTime();
    expect(chat.clock(t)).toBe('09:05:07');
  });
});

describe('chat panel: the feed shown as text', () => {
  it('renders markup and a closing script tag as literal text, creating no element for them', async () => {
    const doc = fakeDoc();
    const list = doc.createElement('div');
    const evil = '<img src=x onerror=alert(1)></script>';
    const stub = stubFetch({
      [FEED]: feedText([line(1, 'u1', evil)]),
      [PLAYERS]: playersText([{ uuid: 'u1', name: 'Ash' }]),
    });
    await chat.pollOnce(chat.createFeedState(doc, list), stub.fn);
    expect(doc.created).not.toContain('img');
    expect(doc.created).not.toContain('script');
    expect(doc.created.every((t) => t === 'div' || t === 'span')).toBe(true);
    expect(doc.markupWrites).toEqual([]);
    expect(list.childNodes).toHaveLength(1);
    expect(rowText(list.childNodes[0] as FakeNode)).toBe(`: ${evil}`);
  });

  it('shows an unknown speaker as Ranger', async () => {
    const doc = fakeDoc();
    const list = doc.createElement('div');
    const stub = stubFetch({ [FEED]: feedText([line(1, 'u9')]), [PLAYERS]: playersText([]) });
    await chat.pollOnce(chat.createFeedState(doc, list), stub.fn);
    expect(rowName(list.childNodes[0] as FakeNode)).toBe('Ranger');
  });

  it('shows a departed speaker under the name cached while they were listed', async () => {
    const doc = fakeDoc();
    const list = doc.createElement('div');
    const state = chat.createFeedState(doc, list);
    const routes: Record<string, string> = {
      [FEED]: feedText([line(1, 'u1', 'hello')]),
      [PLAYERS]: playersText([{ uuid: 'u1', name: 'Ash' }]),
    };
    await chat.pollOnce(state, stubFetch(routes).fn);
    routes[FEED] = feedText([line(1, 'u1', 'hello'), line(2, 'u1', 'bye')]);
    routes[PLAYERS] = playersText([]);
    await chat.pollOnce(state, stubFetch(routes).fn);
    expect(list.childNodes).toHaveLength(2);
    expect(rowName(list.childNodes[1] as FakeNode)).toBe('Ash');
  });

  it('adds no duplicate rows on a repeat poll', async () => {
    const doc = fakeDoc();
    const list = doc.createElement('div');
    const state = chat.createFeedState(doc, list);
    const stub = stubFetch({
      [FEED]: feedText([line(1, 'u1'), line(2, 'u2')]),
      [PLAYERS]: playersText([{ uuid: 'u1', name: 'Ash' }]),
    });
    await chat.pollOnce(state, stub.fn);
    await chat.pollOnce(state, stub.fn);
    await chat.pollOnce(state, stub.fn);
    expect(list.childNodes).toHaveLength(2);
  });

  it('keeps at most 100 rows and drops the oldest', async () => {
    const doc = fakeDoc();
    const list = doc.createElement('div');
    const state = chat.createFeedState(doc, list);
    const routes: Record<string, string> = {
      [FEED]: feedText(Array.from({ length: 100 }, (_, i) => line(i + 1, `a${i}`))),
    };
    await chat.pollOnce(state, stubFetch(routes).fn);
    routes[FEED] = feedText(Array.from({ length: 100 }, (_, i) => line(i + 101, `b${i}`)));
    await chat.pollOnce(state, stubFetch(routes).fn);
    expect(list.childNodes).toHaveLength(chat.MAX_ROWS);
    expect(list.childNodes[0]?.childNodes[0]?.textContent).toBe(chat.clock(line(101, '').t));
  });

  it('keeps the rows shown and backs off to 10 s when the feed fails', async () => {
    const doc = fakeDoc();
    const list = doc.createElement('div');
    const state = chat.createFeedState(doc, list);
    const routes: Record<string, string | Error> = { [FEED]: feedText([line(1, 'u1')]) };
    expect(await chat.pollOnce(state, stubFetch(routes).fn)).toBe(true);
    routes[FEED] = new Error('network down');
    expect(await chat.pollOnce(state, stubFetch(routes).fn)).toBe(false);
    expect(list.childNodes).toHaveLength(1);
    expect(chat.nextDelay(false)).toBe(10000);
    expect(chat.nextDelay(true)).toBe(3000);
  });

  it('fetches with cache no-store and an 8 s timeout signal', async () => {
    const doc = fakeDoc();
    const spy = vi.spyOn(AbortSignal, 'timeout');
    const stub = stubFetch({ [FEED]: feedText([]) });
    await chat.pollOnce(chat.createFeedState(doc, doc.createElement('div')), stub.fn);
    expect(chat.FETCH_TIMEOUT_MS).toBe(8000);
    expect(spy).toHaveBeenCalledWith(8000);
    spy.mockRestore();
    expect(stub.calls[0]?.url).toBe(FEED);
    expect(stub.calls[0]?.opts).toMatchObject({ cache: 'no-store' });
    const opts = stub.calls[0]?.opts as { signal?: unknown } | undefined;
    expect(opts?.signal).toBeInstanceOf(AbortSignal);
  });
});

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('chat panel: which lines are shown', () => {
  it('shows new lines after the clock steps back', async () => {
    const doc = fakeDoc();
    const list = doc.createElement('div');
    const state = chat.createFeedState(doc, list);
    const routes: Record<string, string> = { [FEED]: feedText([line(5, 'u1', 'five')]) };
    await chat.pollOnce(state, stubFetch(routes).fn);
    routes[FEED] = feedText([line(5, 'u1', 'five'), line(1, 'u1', 'back')]);
    await chat.pollOnce(state, stubFetch(routes).fn);
    expect(list.childNodes).toHaveLength(2);
    expect(rowText(list.childNodes[1] as FakeNode)).toBe(': back');
  });

  it('shows a late older line after the newer ones, in feed order', async () => {
    const doc = fakeDoc();
    const list = doc.createElement('div');
    const state = chat.createFeedState(doc, list);
    const routes: Record<string, string> = {
      [FEED]: feedText([line(1, 'u1', 'one'), line(3, 'u2', 'three')]),
    };
    await chat.pollOnce(state, stubFetch(routes).fn);
    routes[FEED] = feedText([line(1, 'u1', 'one'), line(2, 'u3', 'late'), line(3, 'u2', 'three')]);
    await chat.pollOnce(state, stubFetch(routes).fn);
    expect(list.childNodes).toHaveLength(3);
    expect(rowText(list.childNodes[2] as FakeNode)).toBe(': late');
  });

  it('renders two speakers who share a time, one row each', async () => {
    const doc = fakeDoc();
    const list = doc.createElement('div');
    const stub = stubFetch({ [FEED]: feedText([line(1, 'u1', 'a'), line(1, 'u2', 'b')]) });
    await chat.pollOnce(chat.createFeedState(doc, list), stub.fn);
    expect(list.childNodes).toHaveLength(2);
    expect(rowText(list.childNodes[0] as FakeNode)).toBe(': a');
    expect(rowText(list.childNodes[1] as FakeNode)).toBe(': b');
  });

  it('renders the feed while a player list is still pending or has failed', async () => {
    const doc = fakeDoc();
    const list = doc.createElement('div');
    const state = chat.createFeedState(doc, list);
    const pending: FetchFn = (url) =>
      url === FEED
        ? Promise.resolve({ ok: true, text: async () => feedText([line(1, 'u1', 'hi')]) })
        : new Promise(() => {});
    expect(await chat.pollOnce(state, pending)).toBe(true);
    expect(list.childNodes).toHaveLength(1);
    expect(rowName(list.childNodes[0] as FakeNode)).toBe('Ranger');
  });

  it('writes a name into a Ranger row once the player list arrives', async () => {
    const doc = fakeDoc();
    const list = doc.createElement('div');
    const state = chat.createFeedState(doc, list);
    const routes: Record<string, string | Error> = {
      [FEED]: feedText([line(1, 'u1', 'hi')]),
      [PLAYERS]: new Error('player list down'),
    };
    await chat.pollOnce(state, stubFetch(routes).fn);
    await settle();
    expect(rowName(list.childNodes[0] as FakeNode)).toBe('Ranger');
    routes[PLAYERS] = playersText([{ uuid: 'u1', name: 'Ash' }]);
    await chat.pollOnce(state, stubFetch(routes).fn);
    await settle();
    expect(list.childNodes).toHaveLength(1);
    expect(rowName(list.childNodes[0] as FakeNode)).toBe('Ash');
  });
});

describe('chat panel: the poll loop', () => {
  // Runs the loop with a fake scheduler: the delays are recorded, and tick() runs the scheduled poll.
  function fakeLoop(state: unknown, fetchFn: FetchFn) {
    const delays: number[] = [];
    let next: (() => void) | null = null;
    chat.runLoop(state, fetchFn, (fn, ms) => {
      delays.push(ms);
      next = fn;
    });
    return {
      delays,
      tick: () => {
        const run = next;
        next = null;
        run?.();
      },
    };
  }

  it('backs off to 10 s after a failed poll, and returns to 3 s after a good one', async () => {
    const doc = fakeDoc();
    const state = chat.createFeedState(doc, doc.createElement('div'));
    const routes: Record<string, string | Error> = { [FEED]: new Error('network down') };
    const loop = fakeLoop(state, stubFetch(routes).fn);
    await settle();
    expect(loop.delays).toEqual([10000]);
    routes[FEED] = feedText([]);
    loop.tick();
    await settle();
    expect(loop.delays).toEqual([10000, 3000]);
  });

  it('keeps polling when a poll throws, treating it as a failed poll', async () => {
    const doc = fakeDoc();
    const list = doc.createElement('div');
    const state = chat.createFeedState(doc, list);
    const routes: Record<string, string> = { [FEED]: feedText([line(1, 'u1', 'hi')]) };
    const realCreate = doc.createElement;
    doc.createElement = () => {
      throw new Error('render failed');
    };
    const loop = fakeLoop(state, stubFetch(routes).fn);
    await settle();
    expect(loop.delays).toEqual([10000]);
    doc.createElement = realCreate;
    loop.tick();
    await settle();
    expect(loop.delays).toEqual([10000, 3000]);
    expect(list.childNodes).toHaveLength(1);
  });
});

describe('chat panel: the newest line stays in view', () => {
  // A promise a test opens later: the player lists wait on it, so the feed renders first.
  function gate() {
    let open: () => void = () => {};
    const wait = new Promise<void>((resolve) => {
      open = resolve;
    });
    return { wait, open };
  }

  it('pins the newest line to the bottom after the first render', async () => {
    const doc = fakeDoc();
    const list = doc.createElement('div');
    list.clientHeight = 100;
    list.scrollHeight = 300;
    const stub = stubFetch({ [FEED]: feedText([line(1, 'u1', 'hi')]) });
    await chat.pollOnce(chat.createFeedState(doc, list), stub.fn);
    expect(list.scrollTop).toBe(300);
  });

  it('re-pins after a name arrives and grows its row', async () => {
    const doc = fakeDoc();
    const list = doc.createElement('div');
    list.clientHeight = 100;
    list.scrollHeight = 300;
    const state = chat.createFeedState(doc, list);
    const names = gate();
    const inner = stubFetch({
      [FEED]: feedText([line(1, 'u1', 'hi')]),
      [PLAYERS]: playersText([{ uuid: 'u1', name: 'Ash' }]),
    }).fn;
    const fetchFn: FetchFn = async (url, opts) => {
      if (url === PLAYERS) {
        await names.wait;
        list.scrollHeight = 340;
      }
      return inner(url, opts);
    };
    await chat.pollOnce(state, fetchFn);
    expect(list.scrollTop).toBe(300);
    names.open();
    await settle();
    expect(rowName(list.childNodes[0] as FakeNode)).toBe('Ash');
    expect(list.scrollTop).toBe(340);
  });

  it('does not pull a viewer who scrolled up back down, for new lines or names', async () => {
    const doc = fakeDoc();
    const list = doc.createElement('div');
    list.clientHeight = 100;
    list.scrollHeight = 300;
    const state = chat.createFeedState(doc, list);
    const names = gate();
    let height = 300;
    let body = feedText([line(1, 'u1', 'one')]);
    const fetchFn: FetchFn = async (url) => {
      if (url === FEED) {
        list.scrollHeight = height;
        return { ok: true, text: async () => body };
      }
      await names.wait;
      list.scrollHeight = height + 40;
      return { ok: true, text: async () => playersText([{ uuid: 'u1', name: 'Ash' }]) };
    };
    await chat.pollOnce(state, fetchFn);
    expect(list.scrollTop).toBe(300);
    list.scrollTop = 50;
    list.fire('scroll');
    expect(state.pinned).toBe(false);
    height = 360;
    body = feedText([line(1, 'u1', 'one'), line(2, 'u2', 'two')]);
    await chat.pollOnce(state, fetchFn);
    expect(list.childNodes).toHaveLength(2);
    expect(list.scrollTop).toBe(50);
    names.open();
    await settle();
    expect(rowName(list.childNodes[0] as FakeNode)).toBe('Ash');
    expect(list.scrollTop).toBe(50);
  });

  it('counts a viewer within 8 px of the bottom as pinned, and one 9 px short as not', () => {
    const doc = fakeDoc();
    const list = doc.createElement('div');
    list.clientHeight = 100;
    list.scrollHeight = 300;
    const state = chat.createFeedState(doc, list);
    list.scrollTop = 192;
    list.fire('scroll');
    expect(state.pinned).toBe(true);
    list.scrollTop = 191;
    list.fire('scroll');
    expect(state.pinned).toBe(false);
  });

  it('calls onExpand when the panel opens, and not when it closes', () => {
    const doc = fakeDoc();
    let expanded = 0;
    const panel = chat.buildPanel(doc, () => {
      expanded++;
    });
    const toggle = panel.root.childNodes[0]?.childNodes[1] as FakeNode;
    toggle.fire('click');
    expect(panel.root.classList.contains('gc-collapsed')).toBe(true);
    expect(expanded).toBe(0);
    toggle.fire('click');
    expect(panel.root.classList.contains('gc-collapsed')).toBe(false);
    expect(expanded).toBe(1);
  });
});

describe('chat panel: its own stylesheet', () => {
  it('injects the link once when absent', () => {
    const doc = fakeDoc();
    expect(chat.ensureStyles(doc)).toBe(true);
    expect(chat.ensureStyles(doc)).toBe(false);
    const links = doc.head.childNodes.filter((c) => c.tagName === 'link');
    expect(links).toHaveLength(1);
  });

  it('does not inject when a geldar.css link is already present', () => {
    const doc = fakeDoc();
    const existing = doc.createElement('link');
    existing.setAttribute('rel', 'stylesheet');
    existing.setAttribute('href', 'assets/geldar.css');
    doc.head.appendChild(existing);
    expect(chat.ensureStyles(doc)).toBe(false);
    expect(doc.head.childNodes).toHaveLength(1);
  });

  it('the injected link is rel=stylesheet with href assets/geldar.css', () => {
    const doc = fakeDoc();
    chat.ensureStyles(doc);
    const link = findLink(doc.head, 'geldar.css');
    expect(link?.tagName).toBe('link');
    expect(link?.attrs.rel).toBe('stylesheet');
    expect(link?.attrs.href).toBe('assets/geldar.css');
  });

  it('falls back to the body when the page has no head', () => {
    const doc = fakeDoc();
    (doc as { head: unknown }).head = null;
    expect(chat.ensureStyles(doc)).toBe(true);
    expect(findLink(doc.body, 'geldar.css')).not.toBeNull();
  });

  it('start() calls it, so the panel has its stylesheet', () => {
    const doc = fakeDoc();
    const { fn } = stubFetch({});
    chat.start(doc, fn, () => {});
    expect(findLink(doc.head, 'geldar.css')?.attrs.href).toBe('assets/geldar.css');
  });
});

describe('chat panel: wiring', () => {
  const read = (rel: string) =>
    readFileSync(join(import.meta.dirname, '..', '..', '..', rel), 'utf8');

  it('compose mounts the script into the bluemap-web Caddy root', () => {
    expect(read('compose/colo.yml')).toContain(
      '../plugins/bluemap/web/geldar-chat.js:/etc/caddy/geldar-chat.js:ro',
    );
  });

  it('Caddy serves the script at /assets/geldar-chat.js as JavaScript', () => {
    const caddy = read('compose/bluemap-web/Caddyfile');
    const block = /handle \/assets\/geldar-chat\.js \{([\s\S]*?)\n\t\}/.exec(caddy)?.[1] ?? '';
    expect(block).toContain('rewrite * /geldar-chat.js');
    expect(block).toContain('text/javascript');
  });

  it('Caddy sends no-store for the chat feed', () => {
    const caddy = read('compose/bluemap-web/Caddyfile');
    const block = /handle @chat \{([\s\S]*?)\n\t\}/.exec(caddy)?.[1] ?? '';
    expect(caddy).toContain('@chat path /geldar-chat.json');
    expect(block).toContain('header Cache-Control no-store');
  });

  it('the README loads the script through settings.json scripts', () => {
    expect(read('plugins/bluemap/README.md')).toContain('"scripts": ["assets/geldar-chat.js"]');
  });
});
