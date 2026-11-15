import { describe, expect, it } from 'vitest';
import {
  chat,
  dot,
  FEED,
  fakeDoc,
  feed,
  fetchOf,
  find,
  OW,
  paint,
  player,
  players,
  poll,
  rig,
  settle,
} from './chat-fresh-fakes';

// The chat panel's freshness (decision 0310, geldar-chat.js): the header dot and the "last line" age. The clock is
// injected, so every time is an exact number of milliseconds. The still label is in chat-still.test.ts.

describe('the thresholds', () => {
  // biome-ignore format: a table of [input, want] rows, four to a line
  const FRESH: Array<[number, string]> = [
    [0, 'live'], [14999, 'live'], [15000, 'delayed'], [59999, 'delayed'], [60000, 'offline'],
  ];
  // biome-ignore format: a table of [input, want] rows, four to a line
  const AGE: Array<[number, string]> = [
    [-5000, 'last line 0s ago'], [40000, 'last line 40s ago'], [59999, 'last line 59s ago'],
    [60000, '1m ago'], [180000, '3m ago'], [3599999, '59m ago'], [3600000, '1h+ ago'],
  ];

  it.each(FRESH)('freshState(%i) is the state the spec gives', (ms, want) => {
    expect(chat.freshState(ms)).toBe(want);
  });
  it('freshState is offline before any good fetch', () => {
    expect(chat.freshState(Number.POSITIVE_INFINITY)).toBe('offline');
  });
  it.each(AGE)('ageLabel(%i) is %j', (ms, want) => {
    expect(chat.ageLabel(ms)).toBe(want);
  });
});

describe('the header dot', () => {
  it('is live under 15 s, delayed to 60 s and offline after, from the last good fetch', async () => {
    const r = rig({ [FEED]: feed([]), [OW]: players([player('u1', 'Ash', 0, 0)]) });
    await poll(r);
    r.now.t = 114999;
    paint(r);
    expect(dot(r)).toEqual(['Live', 'Live', 'gc-live gc-live-live']);
    r.now.t = 115000;
    paint(r);
    expect(dot(r)).toEqual(['Delayed', 'Delayed', 'gc-live gc-live-delayed']);
    r.now.t = 160000;
    paint(r);
    expect(dot(r)).toEqual(['Offline', 'Offline', 'gc-live gc-live-offline']);
  });

  it('a players.json fetch counts as a good fetch, even when the feed fails', async () => {
    const r = rig({ [OW]: players([player('u1', 'Ash', 0, 0)]) });
    expect(await poll(r)).toBe(false);
    paint(r);
    expect(dot(r)[0]).toBe('Live');
  });

  it('a feed fetch counts as a good fetch, even when all three players.json fail', async () => {
    const r = rig({ [FEED]: feed([]) });
    expect(await poll(r)).toBe(true);
    paint(r);
    expect(dot(r)[0]).toBe('Live');
  });

  it('a failed fetch does not reset the age', async () => {
    const r = rig({ [FEED]: feed([]) });
    await poll(r);
    r.now.t = 170000;
    delete r.routes[FEED];
    expect(await poll(r)).toBe(false);
    paint(r);
    expect(dot(r)[0]).toBe('Offline');
  });

  it('the 1 s tick repaints the dot: Live at 100 s, Offline at 175 s', async () => {
    const doc = fakeDoc();
    const now = { t: 100000 };
    const ticks: Array<() => void> = [];
    const routes = { [FEED]: feed([]), [OW]: players([player('u1', 'Ash', 0, 0)]) };
    const tick = (fn: () => void, ms: number) => {
      expect(ms).toBe(1000);
      ticks.push(fn);
    };
    chat.start(
      doc,
      fetchOf(routes),
      () => {},
      tick,
      () => now.t,
    );
    await settle();
    expect(ticks).toHaveLength(1);
    ticks[0]?.();
    expect(find(doc.body, 'gc-live')?.attrs['aria-label']).toBe('Live');
    now.t = 175000;
    ticks[0]?.();
    expect(find(doc.body, 'gc-live')?.attrs['aria-label']).toBe('Offline');
  });

  it('paints the dot once after the first poll, with no tick', async () => {
    const doc = fakeDoc();
    const routes = { [FEED]: feed([]) };
    chat.start(
      doc,
      fetchOf(routes),
      () => {},
      null,
      () => 100000,
    );
    await settle();
    expect(find(doc.body, 'gc-live')?.attrs['aria-label']).toBe('Live');
  });
});

describe('the last line age', () => {
  it('reads the newest line t against the clock', async () => {
    const r = rig({ [FEED]: feed([{ t: 60000, id: 'u1', text: 'a' }]) });
    await poll(r);
    paint(r);
    expect(r.panel.foot.textContent).toBe('last line 40s ago');
    expect(r.panel.foot.hidden).toBe(false);
  });

  it('shows the age of the newest line, whatever the feed order', async () => {
    const r = rig({
      [FEED]: feed([
        { t: 60000, id: 'u1', text: 'a' },
        { t: 20000, id: 'u2', text: 'b' },
        { t: 90000, id: 'u1', text: 'c' },
        { t: 30000, id: 'u2', text: 'd' },
      ]),
    });
    await poll(r);
    paint(r);
    expect(r.panel.foot.textContent).toBe('last line 10s ago');
  });

  it('is hidden when the feed is empty', async () => {
    const r = rig({ [FEED]: feed([]) });
    await poll(r);
    paint(r);
    expect(r.panel.foot.textContent).toBe('');
    expect(r.panel.foot.hidden).toBe(true);
  });

  it('clamps a line newer than the clock to 0 s', async () => {
    const r = rig({ [FEED]: feed([{ t: 105000, id: 'u1', text: 'a' }]) });
    await poll(r);
    paint(r);
    expect(r.panel.foot.textContent).toBe('last line 0s ago');
  });
});
