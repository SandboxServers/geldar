import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Fakes for the chat panel's freshness tests (geldar-chat.js): a small document, the fetch and the injected clock.
// Names are made up. The module is loaded the way the browser loads it: a plain script, read as text.

export interface FakeNode {
  textContent: string;
  className: string;
  childNodes: FakeNode[];
  style: Record<string, string>;
  attrs: Record<string, string>;
  data?: string;
  hidden?: boolean;
  stillEl?: FakeNode;
  speakerId?: string;
  setAttribute(name: string, value: string): void;
  appendChild(c: FakeNode): FakeNode;
  removeChild(c: FakeNode): FakeNode;
  classList: { toggle(name: string, force?: boolean): boolean; contains(name: string): boolean };
  addEventListener(type: string, fn: (ev?: unknown) => void): void;
}
export type Doc = ReturnType<typeof fakeDoc>;
export type State = object;
export interface Panel {
  root: FakeNode;
  list: FakeNode;
  live: FakeNode;
  foot: FakeNode;
}
export type FetchFn = (url: string) => Promise<{ ok: boolean; text(): Promise<string> }>;
export type Routes = Record<string, string | null>;
export interface Chat {
  freshState(ageMs: number): 'live' | 'delayed' | 'offline';
  stillLabel(ms: number): string;
  ageLabel(ms: number): string;
  clock(t: number): string;
  stillFor(state: State, uuid: string, now: number): string;
  paintStatus(state: State, ui: Panel, now: number): void;
  buildPanel(doc: Doc): Panel;
  createFeedState(doc: Doc, list: FakeNode, onFollow?: undefined, now?: () => number): State;
  pollOnce(state: State, fetchFn: FetchFn): Promise<boolean>;
  start(
    doc: Doc,
    fetchFn: FetchFn,
    schedule: (fn: () => void, ms: number) => void,
    tick: ((fn: () => void, ms: number) => void) | null,
    now?: () => number,
  ): void;
}

export const SRC = readFileSync(join(import.meta.dirname, '..', 'web', 'geldar-chat.js'), 'utf8');
const mod = { exports: {} as Record<string, unknown> };
new Function('module', SRC)(mod);
export const chat = mod.exports as unknown as Chat;

export function node(): FakeNode {
  const classes = new Set<string>();
  const n: FakeNode = {
    textContent: '',
    className: '',
    childNodes: [],
    style: {},
    attrs: {},
    classList: {
      toggle(name, force) {
        const on = force ?? !classes.has(name);
        if (on) classes.add(name);
        else classes.delete(name);
        return on;
      },
      contains: (name) => classes.has(name),
    },
    setAttribute: (name, value) => {
      n.attrs[name] = value;
    },
    addEventListener() {},
    appendChild: (c) => {
      n.childNodes.push(c);
      return c;
    },
    removeChild: (c) => {
      n.childNodes.splice(n.childNodes.indexOf(c), 1);
      return c;
    },
  };
  return n;
}

export function fakeDoc() {
  return {
    head: node(),
    body: node(),
    createElement: () => node(),
    createTextNode: (data: string): FakeNode => ({ ...node(), data, textContent: data }),
    querySelector: (): FakeNode | null => null,
  };
}

// The first node under n with the class, searched depth first.
export function find(n: FakeNode, cls: string): FakeNode | undefined {
  if (n.className.split(' ').includes(cls)) return n;
  return n.childNodes.map((c) => find(c, cls)).find((hit) => hit !== undefined);
}

// A row's text: its text nodes and element texts in order, so "time name still: text".
export const rowText = (row: FakeNode) =>
  row.childNodes.map((c) => c.data ?? c.textContent).join('');

export function fetchOf(routes: Routes): FetchFn {
  return async (url) => {
    const body = routes[url];
    return { ok: body !== null && body !== undefined, text: async () => body ?? '' };
  };
}

export const OW = '/maps/overworld/live/players.json';
export const NE = '/maps/nether/live/players.json';
export const FEED = '/geldar-chat.json';
export const player = (uuid: string, name: string, x: number, z: number, foreign = false) => ({
  uuid,
  name,
  foreign,
  position: { x, y: 64, z },
});
export const players = (list: unknown[]) => JSON.stringify({ players: list });
export const feed = (lines: Array<{ t: number; id: string; text: string }>) =>
  JSON.stringify({ v: 1, lines });
export const settle = () => new Promise((resolve) => setImmediate(resolve));

export function rig(routes: Routes, t = 100000) {
  const doc = fakeDoc();
  const panel = chat.buildPanel(doc);
  const now = { t };
  const state = chat.createFeedState(doc, panel.list, undefined, () => now.t);
  return { panel, state, now, routes };
}
export type Rig = ReturnType<typeof rig>;
export async function poll(r: Rig): Promise<boolean> {
  const ok = await chat.pollOnce(r.state, fetchOf(r.routes));
  await settle();
  return ok;
}
export const paint = (r: Rig) => chat.paintStatus(r.state, r.panel, r.now.t);
export const dot = (r: Rig) => [
  r.panel.live.textContent,
  r.panel.live.attrs['aria-label'],
  r.panel.live.className,
];
