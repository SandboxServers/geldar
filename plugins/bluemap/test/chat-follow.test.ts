import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The chat panel's name click (decision 0310, BM-11): a click or Enter or Space on a speaker's name follows the agent
// with BlueMap's own follow. The fake bluemap has the methods BlueMap 5.29 has (followPlayerMarker,
// stopFollowingPlayerMarker, getPlayerMarker, switchMap) and nothing else. Every name and text here is made up.

interface FakeEl {
  tagName?: string;
  data?: string;
  textContent: string;
  className: string;
  childNodes: FakeEl[];
  style: { color?: string };
  attrs: Record<string, string>;
  speakerId?: string;
  speakerEl?: FakeEl;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  classList: { toggle(name: string, force?: boolean): boolean; contains(name: string): boolean };
  setAttribute(name: string, value: string): void;
  addEventListener(type: string, fn: (ev?: unknown) => void): void;
  fire(type: string, ev?: unknown): void;
  appendChild(c: FakeEl): FakeEl;
  removeChild(c: FakeEl): FakeEl;
}
interface FakeDoc {
  markupWrites: string[];
  head: FakeEl;
  body: FakeEl;
  createElement(tag: string): FakeEl;
  createTextNode(data: string): FakeEl;
  querySelector(selector: string): FakeEl | null;
}
interface FeedState {
  mapOf: Map<string, string>;
  names: Map<string, string>;
}
interface Deps {
  bluemap: unknown;
  mapOf: Map<string, string>;
  note(text: string): void;
  sleep?(ms: number): Promise<void>;
}
type FetchFn = (url: string, opts: unknown) => Promise<{ ok: boolean; text(): Promise<string> }>;
interface Chat {
  followAgent(uuid: string, deps: Deps): Promise<string>;
  syncHighlight(list: FakeEl, bm: unknown): void;
  parsePlayers(text: string, home?: string[]): Array<{ uuid: string; name: string }> | null;
  appendRow(
    doc: FakeDoc,
    list: FakeEl,
    line: unknown,
    name: string,
    onFollow: (id: string) => void,
  ): FakeEl;
  createFeedState(doc: FakeDoc, list: FakeEl, onFollow: (uuid: string) => void): FeedState;
  pollOnce(state: FeedState, fetchFn: FetchFn): Promise<boolean>;
  buildPanel(doc: FakeDoc): { root: FakeEl; list: FakeEl; note(text: string): void };
  start(
    doc: FakeDoc,
    fetchFn: FetchFn,
    schedule: (fn: () => void, ms: number) => void,
    tick: (fn: () => void, ms: number) => void,
  ): void;
}

const SRC = readFileSync(join(import.meta.dirname, '..', 'web', 'geldar-chat.js'), 'utf8');
const mod = { exports: {} as Record<string, unknown> };
new Function('module', SRC)(mod);
const chat = mod.exports as unknown as Chat;

function fakeEl(tag: string, markupWrites: string[]): FakeEl {
  const classes = new Set<string>();
  const listeners: Record<string, Array<(ev?: unknown) => void>> = {};
  const el: FakeEl = {
    tagName: tag,
    textContent: '',
    className: '',
    childNodes: [],
    style: {},
    attrs: {},
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
    setAttribute(name, value) {
      el.attrs[name] = value;
    },
    addEventListener(type, fn) {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(fn);
    },
    fire(type, ev) {
      for (const fn of listeners[type] ?? []) fn(ev);
    },
    appendChild(c) {
      el.childNodes.push(c);
      return c;
    },
    removeChild(c) {
      el.childNodes.splice(el.childNodes.indexOf(c), 1);
      return c;
    },
  };
  Object.defineProperty(el, 'innerHTML', {
    set(v: string) {
      markupWrites.push(v);
    },
  });
  return el;
}

function fakeDoc(): FakeDoc {
  const markupWrites: string[] = [];
  return {
    markupWrites,
    head: fakeEl('head', markupWrites),
    body: fakeEl('body', markupWrites),
    createElement: (tag) => fakeEl(tag, markupWrites),
    createTextNode: (data) => ({ data, textContent: data }) as unknown as FakeEl,
    querySelector: () => null,
  };
}

/** A fetch stub. Routes map a URL to a body; a missing URL is a 404. */
function stubFetch(routes: Record<string, string>): FetchFn {
  return async (url) => {
    const body = routes[url];
    if (body === undefined) return { ok: false, text: async () => '' };
    return { ok: true, text: async () => body };
  };
}

const FEED = '/geldar-chat.json';
const OVERWORLD = '/maps/overworld/live/players.json';
const NETHER = '/maps/nether/live/players.json';
const feedOf = (lines: unknown[]) => JSON.stringify({ v: 1, lines });
const playersOf = (players: unknown[]) => JSON.stringify({ players });
const ASH_LINE = { t: 1_700_000_000_000, id: 'u1', text: 'hello' };
const ASH_ON_OVERWORLD = playersOf([{ uuid: 'u1', name: 'Ash', foreign: false, position: {} }]);

// The page's BlueMap: which map is shown, which agents are on which map, and the controls' followingPlayer.
function fakeBlueMap(agentMaps: Record<string, string>, onMap = 'overworld') {
  const calls: string[] = [];
  const controls = {
    data: { followingPlayer: null as { id: string } | null },
    followPlayerMarker(m: { id: string }) {
      calls.push('follow:' + m.id);
      controls.data.followingPlayer = m;
    },
    stopFollowingPlayerMarker() {
      calls.push('stop');
      controls.data.followingPlayer = null;
    },
  };
  const bm = {
    mapViewer: { map: { data: { id: onMap } }, controlsManager: { controls } },
    playerMarkerManager: {
      getPlayerMarker(uuid: string) {
        return agentMaps[uuid] === bm.mapViewer.map.data.id ? { id: 'bm-player-' + uuid } : null;
      },
    },
    async switchMap(id: string) {
      calls.push('switch:' + id);
      bm.mapViewer.map.data.id = id;
    },
  };
  return { bm, calls, controls };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const instant = async () => {};

// Mounts the real panel with one speaker (Ash, uuid u1, on the overworld) and a page bluemap in window.
async function mountPanel(bm: unknown) {
  (globalThis as { window?: unknown }).window = { bluemap: bm };
  const doc = fakeDoc();
  const ticks: Array<() => void> = [];
  chat.start(
    doc,
    stubFetch({ [FEED]: feedOf([ASH_LINE]), [OVERWORLD]: ASH_ON_OVERWORLD }),
    () => {},
    (fn) => ticks.push(fn),
  );
  await flush();
  const root = doc.body.childNodes[doc.body.childNodes.length - 1] as FakeEl;
  const list = root.childNodes[1] as FakeEl;
  const name = (list.childNodes[0] as FakeEl).childNodes[2] as FakeEl;
  return { doc, root, list, name, ticks };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  vi.useRealTimers();
});

describe('chat follow: a name click', () => {
  it('a click calls followPlayerMarker with the marker for that uuid', async () => {
    const f = fakeBlueMap({ u1: 'overworld' });
    const panel = await mountPanel(f.bm);
    panel.name.fire('click');
    await flush();
    expect(f.calls).toEqual(['follow:bm-player-u1']);
  });

  it('a second click on the followed name stops the follow', async () => {
    const f = fakeBlueMap({ u1: 'overworld' });
    const panel = await mountPanel(f.bm);
    panel.name.fire('click');
    await flush();
    panel.name.fire('click');
    await flush();
    expect(f.calls).toEqual(['follow:bm-player-u1', 'stop']);
    expect(f.controls.data.followingPlayer).toBeNull();
  });

  it('Enter and Space activate the name, other keys do nothing', async () => {
    const f = fakeBlueMap({ u1: 'overworld' });
    const panel = await mountPanel(f.bm);
    const preventDefault = vi.fn();
    panel.name.fire('keydown', { key: 'a', preventDefault });
    await flush();
    expect(f.calls).toEqual([]);
    panel.name.fire('keydown', { key: 'Enter', preventDefault });
    await flush();
    panel.name.fire('keydown', { key: ' ', preventDefault });
    await flush();
    expect(f.calls).toEqual(['follow:bm-player-u1', 'stop']);
    expect(preventDefault).toHaveBeenCalledTimes(2);
  });

  it('the name is a keyboard button with a Follow title, set by attribute only', async () => {
    const f = fakeBlueMap({ u1: 'overworld' });
    const panel = await mountPanel(f.bm);
    expect(panel.name.attrs).toMatchObject({ role: 'button', tabindex: '0', title: 'Follow' });
    expect(panel.name.textContent).toBe('Ash');
    expect(panel.doc.markupWrites).toEqual([]);
  });

  it('follows an agent on another map after switching to that map first', async () => {
    const f = fakeBlueMap({ u1: 'nether' }, 'overworld');
    const note = vi.fn();
    const result = await chat.followAgent('u1', {
      bluemap: f.bm,
      mapOf: new Map([['u1', 'nether']]),
      note,
      sleep: instant,
    });
    expect(result).toBe('followed');
    expect(f.calls).toEqual(['switch:nether', 'follow:bm-player-u1']);
  });

  it('an agent not on the map gives no follow, the note, and waits at most 3 s in 200 ms steps', async () => {
    const f = fakeBlueMap({});
    const note = vi.fn();
    const sleep = vi.fn(instant);
    const result = await chat.followAgent('u1', {
      bluemap: f.bm,
      mapOf: new Map([['u1', 'overworld']]),
      note,
      sleep,
    });
    expect(result).toBe('missing');
    expect(f.calls).toEqual([]);
    expect(note).toHaveBeenCalledWith('Not on the map');
    expect(sleep).toHaveBeenCalledTimes(15);
    expect(sleep).toHaveBeenCalledWith(200);
  });

  it('a missing window.bluemap does not throw; it gives the note', async () => {
    const note = vi.fn();
    const result = await chat.followAgent('u1', {
      bluemap: undefined,
      mapOf: new Map(),
      note,
      sleep: instant,
    });
    expect(result).toBe('missing');
    expect(note).toHaveBeenCalledWith('Not on the map');
  });

  it('a renamed BlueMap method that throws gives the note, not an exception', async () => {
    const f = fakeBlueMap({ u1: 'overworld' });
    f.controls.followPlayerMarker = () => {
      throw new Error('renamed');
    };
    const note = vi.fn();
    const result = await chat.followAgent('u1', {
      bluemap: f.bm,
      mapOf: new Map([['u1', 'overworld']]),
      note,
      sleep: instant,
    });
    expect(result).toBe('missing');
    expect(note).toHaveBeenCalledWith('Not on the map');
  });

  it('the note shows in the panel header and clears after 3 s', () => {
    vi.useFakeTimers();
    const panel = chat.buildPanel(fakeDoc());
    const title = panel.root.childNodes[0]?.childNodes[0] as FakeEl;
    const note = title.childNodes.find((c) => c.className === 'gc-note') as FakeEl;
    panel.note('Not on the map');
    expect(note.textContent).toBe('Not on the map');
    vi.advanceTimersByTime(3000);
    expect(note.textContent).toBe('');
  });
});

describe('chat follow: the highlight', () => {
  it('is set while the map follows the speaker and cleared when following becomes null', async () => {
    const f = fakeBlueMap({ u1: 'overworld' });
    const panel = await mountPanel(f.bm);
    panel.name.fire('click');
    await flush();
    panel.ticks[0]?.();
    expect(panel.name.classList.contains('gc-following')).toBe(true);
    f.controls.data.followingPlayer = null;
    panel.ticks[0]?.();
    expect(panel.name.classList.contains('gc-following')).toBe(false);
  });

  it('marks only the speaker the map follows', () => {
    const doc = fakeDoc();
    const list = doc.createElement('div');
    const first = doc.createElement('span');
    const second = doc.createElement('span');
    list.childNodes.push(
      { ...doc.createElement('div'), speakerId: 'u1', speakerEl: first } as FakeEl,
      { ...doc.createElement('div'), speakerId: 'u2', speakerEl: second } as FakeEl,
    );
    chat.syncHighlight(list, {
      mapViewer: {
        controlsManager: { controls: { data: { followingPlayer: { id: 'bm-player-u2' } } } },
      },
    });
    expect(first.classList.contains('gc-following')).toBe(false);
    expect(second.classList.contains('gc-following')).toBe(true);
  });

  it('a missing bluemap clears nothing and throws nothing', () => {
    const doc = fakeDoc();
    const list = doc.createElement('div');
    expect(() => chat.syncHighlight(list, undefined)).not.toThrow();
  });
});

describe('chat follow: the map each agent is on', () => {
  it('homeUuids lists the uuids whose entry is not foreign', () => {
    const text = playersOf([
      { uuid: 'u1', name: 'Ash', foreign: false },
      { uuid: 'u2', name: 'Bee', foreign: true },
    ]);
    const home: string[] = [];
    expect(chat.parsePlayers(text, home)?.map((p) => p.uuid)).toEqual(['u1', 'u2']);
    expect(home).toEqual(['u1']);
    expect(chat.parsePlayers('{"people":[]}', [])).toBeNull();
  });

  it('a poll records the map where each agent is, from the players.json it appears in with foreign false', async () => {
    const doc = fakeDoc();
    const state = chat.createFeedState(doc, doc.createElement('div'), () => {});
    const stub = stubFetch({
      [FEED]: feedOf([ASH_LINE]),
      [OVERWORLD]: ASH_ON_OVERWORLD,
      [NETHER]: playersOf([{ uuid: 'u2', name: 'Bee', foreign: false }]),
    });
    await chat.pollOnce(state, stub);
    await flush();
    expect(state.mapOf.get('u1')).toBe('overworld');
    expect(state.mapOf.get('u2')).toBe('nether');
  });
});
