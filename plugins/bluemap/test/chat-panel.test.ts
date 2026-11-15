import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

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
  appendChild(c: FakeNode): FakeNode;
  removeChild(c: FakeNode): FakeNode;
}
interface FakeDoc {
  created: string[];
  markupWrites: string[];
  createElement(tag: string): FakeNode;
  createTextNode(data: string): FakeNode;
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
  ): { seen: Set<string>; last: Line | null; names: Map<string, string> };
  pollOnce(state: unknown, fetchFn: FetchFn): Promise<boolean>;
  NEUTRAL: string;
  MAX_ROWS: number;
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
  const node: FakeNode = {
    tagName: tag,
    textContent: '',
    className: '',
    childNodes: [],
    style: {},
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

function fakeDoc(): FakeDoc {
  const doc: FakeDoc = {
    created: [],
    markupWrites: [],
    createElement(tag) {
      doc.created.push(tag);
      return fakeNode(doc, tag);
    },
    createTextNode(data) {
      return { data, textContent: data, textContentOwner: true } as unknown as FakeNode;
    },
  };
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

  it('fetches with cache no-store', async () => {
    const doc = fakeDoc();
    const stub = stubFetch({ [FEED]: feedText([]) });
    await chat.pollOnce(chat.createFeedState(doc, doc.createElement('div')), stub.fn);
    expect(stub.calls[0]).toEqual({ url: FEED, opts: { cache: 'no-store' } });
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
