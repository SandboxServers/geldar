import type { WorldEvent } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import { awardsFor } from './awards.ts';
import { EXCHANGE_WINDOW_TICKS, ExchangeTracker } from './exchange.ts';
import { XP_FIXTURES } from './fixtures.ts';

let counter = 0;

/** A speech WorldEvent as the Body publishes it: `own` lines have a null distance. */
function line(agent: string, from: string, text: string, own: boolean, tick: number): WorldEvent {
  counter += 1;
  return {
    source_event_id: `ev_TEST${String(counter).padStart(20, '0')}`,
    at: '2026-11-09T12:00:00.000Z',
    shard: 'phase0',
    world_day: 2,
    world_tick: tick,
    type: 'speech',
    agent_id: agent,
    payload: { from, text, distance: own ? null : 2, own },
  } as WorldEvent;
}

const own = (agent: string, from: string, text: string, tick: number) =>
  line(agent, from, text, true, tick);
const heard = (agent: string, from: string, text: string, tick: number) =>
  line(agent, from, text, false, tick);

function run(tracker: ExchangeTracker, events: WorldEvent[]) {
  return events.map((event) => tracker.awardsFor(event));
}

const W = EXCHANGE_WINDOW_TICKS;

describe('bilateral exchange', () => {
  it('awards both lives at the second speaker first line, one key', () => {
    const results = run(new ExchangeTracker(), [
      own('ag_ann', 'Ann', 'hello', 100),
      heard('ag_ben', 'Ann', 'hello', 101),
      own('ag_ben', 'Ben', 'hi', 110),
      heard('ag_ann', 'Ben', 'hi', 111),
    ]);
    expect(results.slice(0, 3)).toEqual([[], [], []]);
    const last = results[3] ?? [];
    expect(last.map((a) => a.lifeId)).toEqual(['ag_ann', 'ag_ben']);
    expect(last.map((a) => a.evidenceKey)).toEqual([
      'exch:ag_ann:ag_ben:0',
      'exch:ag_ann:ag_ben:0',
    ]);
    expect(last.every((a) => a.domain === 'social' && a.worldTick === 111)).toBe(true);
  });

  it('a monologue is not an exchange', () => {
    const results = run(new ExchangeTracker(), [
      own('ag_ann', 'Ann', 'hello', 100),
      heard('ag_ben', 'Ann', 'hello', 101),
      own('ag_ann', 'Ann', 'anyone there?', 200),
      heard('ag_ben', 'Ann', 'anyone there?', 201),
    ]);
    expect(results.flat()).toEqual([]);
  });

  it('one-way overheard speech is not an exchange', () => {
    const results = run(new ExchangeTracker(), [
      own('ag_ben', 'Ben', 'hi', 100),
      heard('ag_ann', 'Ben', 'hi', 101),
      heard('ag_cara', 'Ben', 'hi', 102),
    ]);
    expect(results.flat()).toEqual([]);
  });

  it('the same speaker lines do not make an exchange', () => {
    const results = run(new ExchangeTracker(), [
      own('ag_ann', 'Ann', 'a', 100),
      heard('ag_ben', 'Ann', 'a', 101),
      own('ag_ann', 'Ann', 'b', 110),
      heard('ag_ben', 'Ann', 'b', 111),
      own('ag_ann', 'Ann', 'c', 120),
      heard('ag_ben', 'Ann', 'c', 121),
    ]);
    expect(results.flat()).toEqual([]);
  });

  it('greeting spam: a repeated greeting does not open a window', () => {
    const results = run(new ExchangeTracker(), [
      own('ag_ann', 'Ann', 'hi', 100),
      heard('ag_ben', 'Ann', 'hi', 101),
      heard('ag_ben', 'Ann', 'hi', 800),
      own('ag_ben', 'Ben', 'hi', 805),
      heard('ag_ann', 'Ben', 'hi', 810),
    ]);
    expect(results.flat()).toEqual([]);
  });

  it('a wrong recipient does not complete someone else exchange', () => {
    const results = run(new ExchangeTracker(), [
      own('ag_ann', 'Ann', 'hey ben', 100),
      heard('ag_ben', 'Ann', 'hey ben', 101),
      own('ag_cara', 'Cara', 'hi', 105),
      heard('ag_ann', 'Cara', 'hi', 106),
    ]);
    expect(results.flat()).toEqual([]);
  });

  it('overlapping lines inside one window give one key', () => {
    const results = run(new ExchangeTracker(), [
      own('ag_ann', 'Ann', 'hello', 100),
      heard('ag_ben', 'Ann', 'hello', 101),
      own('ag_ben', 'Ben', 'hi', 110),
      heard('ag_ann', 'Ben', 'hi', 111),
      own('ag_ann', 'Ann', 'again', 150),
      heard('ag_ben', 'Ann', 'again', 150),
      own('ag_ben', 'Ben', 'more', 200),
      heard('ag_ann', 'Ben', 'more', 200),
    ]);
    const keys = new Set(results.flat().map((a) => a.evidenceKey));
    expect(results.flat()).toHaveLength(2);
    expect([...keys]).toEqual(['exch:ag_ann:ag_ben:0']);
  });

  it('two windows, two awards with different keys', () => {
    const results = run(new ExchangeTracker(), [
      own('ag_ann', 'Ann', 'hello', 100),
      heard('ag_ben', 'Ann', 'hello', 101),
      own('ag_ben', 'Ben', 'hi', 110),
      heard('ag_ann', 'Ben', 'hi', 111),
      own('ag_ann', 'Ann', 'later', 700),
      heard('ag_ben', 'Ann', 'later', 701),
      own('ag_ben', 'Ben', 'yes', 710),
      heard('ag_ann', 'Ben', 'yes', 711),
    ]);
    const keys = results.flat().map((a) => a.evidenceKey);
    expect(keys).toEqual([
      'exch:ag_ann:ag_ben:0',
      'exch:ag_ann:ag_ben:0',
      'exch:ag_ann:ag_ben:1',
      'exch:ag_ann:ag_ben:1',
    ]);
  });

  it('a reply after the window is not an exchange', () => {
    const results = run(new ExchangeTracker(), [
      own('ag_ann', 'Ann', 'hello', 100),
      heard('ag_ben', 'Ann', 'hello', 101),
      own('ag_ben', 'Ben', 'late', 101 + W),
      heard('ag_ann', 'Ben', 'late', 101 + W + 1),
    ]);
    expect(results.flat()).toEqual([]);
  });

  it('a replayed event does not award twice', () => {
    const tracker = new ExchangeTracker();
    const events = [
      own('ag_ann', 'Ann', 'hello', 100),
      heard('ag_ben', 'Ann', 'hello', 101),
      own('ag_ben', 'Ben', 'hi', 110),
      heard('ag_ann', 'Ben', 'hi', 111),
    ];
    const first = run(tracker, events).flat();
    expect(first).toHaveLength(2);
    const replay = run(tracker, events).flat();
    expect(replay).toEqual([]);
  });

  it('a sink restart loses an open window', () => {
    const before = run(new ExchangeTracker(), [
      own('ag_ann', 'Ann', 'hello', 100),
      heard('ag_ben', 'Ann', 'hello', 101),
      own('ag_ben', 'Ben', 'hi', 110),
    ]);
    expect(before.flat()).toEqual([]);
    const after = new ExchangeTracker();
    expect(after.awardsFor(heard('ag_ann', 'Ben', 'hi', 111))).toEqual([]);
  });

  it('a give inside a window keeps its own give key', () => {
    const tracker = new ExchangeTracker();
    run(tracker, [own('ag_ann', 'Ann', 'hello', 100), heard('ag_ben', 'Ann', 'hello', 101)]);
    const give = XP_FIXTURES.give_completed;
    if (!give) throw new Error('give_completed fixture missing');
    const awards = tracker.awardsFor(give);
    expect(awards).toEqual(awardsFor(give));
    expect(awards).toHaveLength(1);
    expect(awards[0]?.evidenceKey.startsWith('give:')).toBe(true);
  });

  it('the LRU bound forgets the oldest pair', () => {
    const tracker = new ExchangeTracker(2);
    const results = run(tracker, [
      own('ag_ann', 'Ann', 'hello', 100),
      heard('ag_ben', 'Ann', 'hello', 101),
      own('ag_cara', 'Cara', 'x', 102),
      heard('ag_dan', 'Cara', 'x', 103),
      own('ag_eve', 'Eve', 'y', 104),
      heard('ag_fay', 'Eve', 'y', 105),
      own('ag_ben', 'Ben', 'hi', 110),
      heard('ag_ann', 'Ben', 'hi', 111),
    ]);
    expect(results.flat()).toEqual([]);
  });

  it('a malformed speech payload awards nothing', () => {
    const bad = line('ag_ann', 'Ann', 'hello', true, 100);
    (bad.payload as Record<string, unknown>).own = 'yes';
    expect(new ExchangeTracker().awardsFor(bad)).toEqual([]);
  });
});
