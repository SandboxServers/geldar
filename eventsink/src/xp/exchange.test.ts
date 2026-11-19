import type { WorldEvent } from '@geldar/contract';
import { describe, expect, it } from 'vitest';
import { awardsFor, type XpAward } from './awards.ts';
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

/** Overwrites payload fields of an event in place, for malformed-payload cases. */
function patched(event: WorldEvent, fields: Record<string, unknown>): WorldEvent {
  Object.assign(event.payload as Record<string, unknown>, fields);
  return event;
}

/** Opens an Ann and Ben window, then returns the awards the given reply gives. */
function replyAfterOpening(reply: WorldEvent): XpAward[] {
  const tracker = new ExchangeTracker();
  run(tracker, [
    own('ag_ann', 'Ann', 'hello', 100),
    heard('ag_ben', 'Ann', 'hello', 101),
    own('ag_ben', 'Ben', 'hi', 110),
  ]);
  return tracker.awardsFor(reply);
}

/** A full exchange where `from` is the in-game name Ann speaks under. */
function exchangeUnder(from: string): XpAward[] {
  return run(new ExchangeTracker(), [
    own('ag_ann', from, 'hello', 100),
    heard('ag_ben', from, 'hello', 101),
    own('ag_ben', 'Ben', 'hi', 110),
    heard('ag_ann', 'Ben', 'hi', 111),
  ]).flat();
}

/** Fills a tracker with `count` pairs that each open one window and nothing more. */
function fillPairs(tracker: ExchangeTracker, count: number): void {
  for (let i = 0; i < count; i += 1) {
    run(tracker, [own(`ag_f${i}a`, `F${i}a`, 'x', 102), heard(`ag_f${i}b`, `F${i}a`, 'x', 103)]);
  }
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

  it('a reply at the last tick of the window still qualifies', () => {
    const results = run(new ExchangeTracker(), [
      own('ag_ann', 'Ann', 'hello', 100),
      heard('ag_ben', 'Ann', 'hello', 101),
      own('ag_ben', 'Ben', 'hi', 102),
      heard('ag_ann', 'Ben', 'hi', 101 + W - 1),
    ]);
    expect(results.flat().map((a) => a.evidenceKey)).toEqual([
      'exch:ag_ann:ag_ben:0',
      'exch:ag_ann:ag_ben:0',
    ]);
  });

  it('the key window is the opener window, not the reply window', () => {
    const results = run(new ExchangeTracker(), [
      own('ag_ann', 'Ann', 'hello', 589),
      heard('ag_ben', 'Ann', 'hello', 590),
      own('ag_ben', 'Ben', 'hi', 600),
      heard('ag_ann', 'Ben', 'hi', 610),
    ]);
    expect(results.flat().map((a) => a.evidenceKey)).toEqual([
      'exch:ag_ann:ag_ben:0',
      'exch:ag_ann:ag_ben:0',
    ]);
  });

  it('a replayed event re-emits the same awards, so the ledger key drops it', () => {
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
    expect(replay).toEqual(first);
  });

  it('a rolled-back batch re-awards the same keys when redelivered', () => {
    const tracker = new ExchangeTracker();
    const events = [
      own('ag_ann', 'Ann', 'hello', 100),
      heard('ag_ben', 'Ann', 'hello', 101),
      own('ag_ben', 'Ben', 'hi', 110),
      heard('ag_ann', 'Ben', 'hi', 111),
    ];
    // The writer rolled this batch back, so its awards never landed; the events come again.
    run(tracker, events);
    const redelivered = run(tracker, events).flat();
    expect(redelivered.map((a) => a.lifeId)).toEqual(['ag_ann', 'ag_ben']);
    expect(redelivered.map((a) => a.evidenceKey)).toEqual([
      'exch:ag_ann:ag_ben:0',
      'exch:ag_ann:ag_ben:0',
    ]);
  });

  it('greeting spam still fails to qualify after a redelivery', () => {
    const tracker = new ExchangeTracker();
    const events = [
      own('ag_ann', 'Ann', 'hi', 100),
      heard('ag_ben', 'Ann', 'hi', 101),
      heard('ag_ben', 'Ann', 'hi', 800),
      own('ag_ben', 'Ben', 'hi', 805),
      heard('ag_ann', 'Ben', 'hi', 810),
    ];
    expect(run(tracker, events).flat()).toEqual([]);
    expect(run(tracker, events).flat()).toEqual([]);
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

  it('a give inside an open window keeps its give award and leaves the window open', () => {
    const tracker = new ExchangeTracker();
    run(tracker, [
      own('ag_ann', 'Ann', 'hello', 100),
      heard('ag_ben', 'Ann', 'hello', 101),
      own('ag_ben', 'Ben', 'hi', 110),
    ]);
    const give = XP_FIXTURES.give_completed;
    if (!give) throw new Error('give_completed fixture missing');
    const awards = tracker.awardsFor(give);
    expect(awards).toEqual(awardsFor(give));
    expect(awards).toHaveLength(1);
    expect(awards[0]?.evidenceKey.startsWith('give:')).toBe(true);
    expect(tracker.awardsFor(heard('ag_ann', 'Ben', 'hi', 111))).toHaveLength(2);
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

  it('the pair bound evicts the least recently heard pair, not the first inserted', () => {
    const tracker = new ExchangeTracker(2);
    const results = run(tracker, [
      own('ag_ann', 'Ann', 'hello', 100),
      heard('ag_ben', 'Ann', 'hello', 101),
      own('ag_cara', 'Cara', 'x', 102),
      heard('ag_dan', 'Cara', 'x', 103),
      heard('ag_ben', 'Ann', 'hello', 104),
      own('ag_eve', 'Eve', 'y', 105),
      heard('ag_fay', 'Eve', 'y', 106),
      own('ag_ben', 'Ben', 'hi', 110),
      heard('ag_ann', 'Ben', 'hi', 111),
    ]);
    expect(results.at(-1)).toHaveLength(2);
  });

  it('the name bound evicts an older name binding', () => {
    const tracker = new ExchangeTracker(1);
    const results = run(tracker, [
      own('ag_ann', 'Ann', 'hello', 100),
      own('ag_ben', 'Ben', 'hi', 101),
      heard('ag_cara', 'Ann', 'hello', 102),
      own('ag_cara', 'Cara', 'yo', 103),
      heard('ag_ann', 'Cara', 'yo', 104),
    ]);
    expect(results.flat()).toEqual([]);
  });

  it('the default bound keeps 512 pairs and forgets the 513th', () => {
    for (const [fillers, survives] of [
      [511, true],
      [512, false],
    ] as const) {
      const tracker = new ExchangeTracker();
      run(tracker, [own('ag_ann', 'Ann', 'hello', 100), heard('ag_ben', 'Ann', 'hello', 101)]);
      fillPairs(tracker, fillers);
      const last = run(tracker, [
        own('ag_ben', 'Ben', 'hi', 110),
        heard('ag_ann', 'Ben', 'hi', 111),
      ]).flat();
      expect(last).toHaveLength(survives ? 2 : 0);
    }
  });

  it('a pair forgets its last line after two idle windows', () => {
    const repliesAfterIdle = (idle: number) => {
      const tracker = new ExchangeTracker();
      run(tracker, [own('ag_ann', 'Ann', 'hi', 100), heard('ag_ben', 'Ann', 'hi', 101)]);
      const later = 101 + idle;
      return run(tracker, [
        heard('ag_ben', 'Ann', 'hi', later),
        own('ag_ben', 'Ben', 'yo', later + 10),
        heard('ag_ann', 'Ben', 'yo', later + 11),
      ]).flat();
    };
    expect(repliesAfterIdle(2 * W - 1)).toEqual([]);
    expect(repliesAfterIdle(2 * W)).toHaveLength(2);
  });

  it('a name heard from its own life awards nothing', () => {
    const tracker = new ExchangeTracker(1);
    const results = run(tracker, [
      own('ag_ann', 'Ann', 'hello', 100),
      heard('ag_ben', 'Ann', 'hello', 101),
      heard('ag_ann', 'Ann', 'hello', 102),
      own('ag_ben', 'Ben', 'hi', 110),
      heard('ag_ann', 'Ben', 'hi', 111),
    ]);
    expect(results.flat()).toHaveLength(2);
  });

  it('a heard line from a name never seen speaking changes nothing', () => {
    const tracker = new ExchangeTracker(1);
    const results = run(tracker, [
      own('ag_ann', 'Ann', 'hello', 100),
      heard('ag_ben', 'Ann', 'hello', 101),
      heard('ag_ben', 'Zed', 'q', 102),
      own('ag_ben', 'Ben', 'hi', 103),
      heard('ag_ann', 'Ben', 'hi', 104),
    ]);
    expect(results.flat()).toHaveLength(2);
  });

  it('the name binding ignores case, for own and heard lines', () => {
    const results = run(new ExchangeTracker(), [
      own('ag_ann', 'ANN', 'hello', 100),
      heard('ag_ben', 'Ann', 'hello', 101),
      own('ag_ben', 'Ben', 'hi', 110),
      heard('ag_ann', 'ben', 'hi', 111),
    ]);
    expect(results.flat().map((a) => a.evidenceKey)).toEqual([
      'exch:ag_ann:ag_ben:0',
      'exch:ag_ann:ag_ben:0',
    ]);
  });

  it('an own line with a non-boolean own flag does not qualify', () => {
    expect(replyAfterOpening(heard('ag_ann', 'Ben', 'hi', 111))).toHaveLength(2);
    const bad = patched(heard('ag_ann', 'Ben', 'hi', 111), { own: 0 });
    expect(replyAfterOpening(bad)).toEqual([]);
  });

  it('a text over 256 characters does not qualify', () => {
    const bad = patched(heard('ag_ann', 'Ben', 'hi', 111), { text: 'x'.repeat(257) });
    expect(replyAfterOpening(bad)).toEqual([]);
  });

  it('a bad name (empty, or 33 characters) is not bound, a 32-character name is', () => {
    expect(exchangeUnder('A'.repeat(32))).toHaveLength(2);
    expect(exchangeUnder('')).toEqual([]);
    expect(exchangeUnder('A'.repeat(33))).toEqual([]);
  });

  it('a distance that is negative or not a number does not qualify', () => {
    const negative = patched(heard('ag_ann', 'Ben', 'hi', 111), { distance: -1 });
    const text = patched(heard('ag_ann', 'Ben', 'hi', 111), { distance: '3' });
    expect(replyAfterOpening(negative)).toEqual([]);
    expect(replyAfterOpening(text)).toEqual([]);
  });

  it('a speech line without agent_id does not rebind a name', () => {
    const tracker = new ExchangeTracker();
    run(tracker, [
      own('ag_ann', 'Ann', 'hello', 100),
      heard('ag_ben', 'Ann', 'hello', 101),
      own('ag_ben', 'Ben', 'hi', 102),
    ]);
    const ghost: Record<string, unknown> = { ...own('ag_ben', 'Ben', 'bye', 103) };
    delete ghost.agent_id;
    expect(tracker.awardsFor(ghost as unknown as WorldEvent)).toEqual([]);
    expect(tracker.awardsFor(heard('ag_ann', 'Ben', 'hi', 111))).toHaveLength(2);
  });
});
