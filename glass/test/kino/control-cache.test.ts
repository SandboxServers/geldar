import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { controlledFeed } from '../../src/kino/control.ts';
import type { FeedSource } from '../../src/kino/relay.ts';
import { UPDATES_PER_SECTION_CAP } from '../../src/kino/section-cache.ts';

const AGENT = 'kestrel_01';
const hello = JSON.stringify({
  type: 'hello',
  feed_version: 1,
  world: 'overworld',
  target_agent_id: AGENT,
  view_radius: 2,
});
const moved = JSON.stringify({
  type: 'target_moved',
  target_agent_id: AGENT,
  x: 10.5,
  y: 64,
  z: -3,
});
const entities = JSON.stringify({ type: 'entity_positions', entities: [] });
const snap = (cx: number, name: string): string =>
  JSON.stringify({
    type: 'chunk_section',
    chunk_x: cx,
    chunk_z: 0,
    section_y: 4,
    palette: [`minecraft:${name}`],
    bits: 0,
    data: '',
  });
const upd = (x: number, name: string): string =>
  JSON.stringify({ type: 'block_update', pos: { x, y: 70, z: 0 }, state: `minecraft:${name}` });

let sent: Array<{ type: string; target_agent_id: string }>;
let on: boolean;
let listeners: Set<(json: string) => void>;
let innerSubs: number;
let f: ReturnType<typeof controlledFeed>;

/** One fake feed per agent: `emit` plays the plugin's messages to every live subscription. */
const inner: FeedSource = {
  subscribe(_agent, onMessage) {
    innerSubs++;
    listeners.add(onMessage);
    return () => {
      innerSubs--;
      listeners.delete(onMessage);
    };
  },
};
const emit = (json: string): void => {
  for (const l of [...listeners]) l(json);
};
const types = (): string[] => sent.map((m) => m.type);
/** A pane: what it was sent, in order. */
const pane = () => {
  const got: string[] = [];
  const unsubscribe = f.subscribe(AGENT, (json) => got.push(json));
  return { got, unsubscribe };
};

beforeEach(() => {
  vi.useFakeTimers();
  sent = [];
  on = true;
  listeners = new Set();
  innerSubs = 0;
  f = controlledFeed(inner, {
    resyncMs: 0,
    sink: { publish: (j) => sent.push(JSON.parse(j)) },
    enabled: () => on,
    graceMs: 1000,
    refreshMs: 5000,
  });
});
afterEach(() => {
  f.dispose();
  vi.useRealTimers();
});

describe('Kino section cache: joining panes', () => {
  it('serves a joining pane from the cache: hello, then sections, then updates, and no resync', () => {
    const a = pane();
    emit(hello);
    emit(snap(0, 'a'));
    emit(upd(1, 'x'));
    emit(snap(1, 'b'));
    emit(upd(17, 'y'));
    const b = pane();
    expect(types()).toEqual(['start']);
    expect(b.got).toEqual([hello, snap(0, 'a'), upd(1, 'x'), snap(1, 'b'), upd(17, 'y')]);
    // The live feed still reaches both panes after the join.
    emit(upd(2, 'z'));
    expect(types()).toEqual(['start']);
    expect(a.got.at(-1)).toBe(upd(2, 'z'));
    expect(b.got.at(-1)).toBe(upd(2, 'z'));
  });

  it('the first pane sends start and nothing else', () => {
    pane();
    expect(types()).toEqual(['start']);
  });

  it('a joining pane with an empty cache keeps today’s behaviour: a resync', () => {
    pane();
    const b = pane();
    expect(types()).toEqual(['start', 'resync']);
    expect(b.got).toEqual([]);
  });

  it('an update log overflow drops the cache, and the joining pane gets a resync', () => {
    pane();
    emit(hello);
    emit(snap(0, 'a'));
    for (let i = 0; i < UPDATES_PER_SECTION_CAP; i++) emit(upd(i % 16, 'x'));
    pane();
    expect(types()).toEqual(['start']); // the cap itself is still served
    emit(upd(1, 'y')); // one more is over the cap
    const c = pane();
    expect(types()).toEqual(['start', 'resync']);
    expect(c.got).toEqual([hello]);
  });

  it('entity positions are not replayed: a joining pane gets only the live ones', () => {
    const a = pane();
    emit(hello);
    emit(snap(0, 'a'));
    emit(entities);
    expect(a.got).toEqual([hello, snap(0, 'a'), entities]);
    const b = pane();
    expect(b.got).toEqual([hello, snap(0, 'a')]);
  });

  it('a target_moved drops the cache: the next pane resyncs instead of seeing a stale window', () => {
    pane();
    emit(hello);
    emit(snap(0, 'a'));
    emit(moved);
    const b = pane();
    expect(types()).toEqual(['start', 'resync']);
    expect(b.got).toEqual([hello, moved]);
  });

  it('a resync starts the cache over, and the next pane is served from the new window', () => {
    pane();
    emit(hello);
    emit(snap(0, 'a'));
    emit(moved);
    pane(); // resync, the plugin answers with the window again
    emit(hello);
    emit(snap(0, 'b'));
    const c = pane();
    // Only the resync that the pane before it caused: the pane after it is served from the new window.
    expect(types()).toEqual(['start', 'resync']);
    expect(c.got).toEqual([hello, moved, snap(0, 'b')]);
  });
});

describe('Kino section cache: eviction', () => {
  it('a stop evicts the cache: a fresh read starts with no cached messages', () => {
    const a = pane();
    emit(hello);
    emit(snap(0, 'a'));
    a.unsubscribe();
    vi.advanceTimersByTime(1000);
    expect(types()).toEqual(['start', 'stop']);
    expect(innerSubs).toBe(0);
    const b = pane();
    expect(types()).toEqual(['start', 'stop', 'start']);
    expect(b.got).toEqual([]);
  });

  it('the last pane leaving drops the cache: a pane back inside the grace resyncs', () => {
    const a = pane();
    emit(hello);
    emit(snap(0, 'a'));
    a.unsubscribe();
    vi.advanceTimersByTime(500);
    const b = pane();
    expect(types()).toEqual(['start', 'resync']);
    expect(b.got).toEqual([hello]);
  });

  it('with the kill switch off no cache is served', () => {
    pane();
    emit(hello);
    emit(snap(0, 'a'));
    on = false;
    const b = pane();
    expect(b.got).toEqual([hello]);
    expect(types()).toEqual(['start']);
  });
});
