import { afterEach, describe, expect, it } from 'vitest';
import {
  chat,
  type FakeNode,
  FEED,
  fakeDoc,
  fetchOf,
  find,
  node,
  SRC,
  settle,
} from './chat-fresh-fakes';

// The page follows the world's time of day (geldar-chat.js): the sun curve, the clock's tick, the clock in the feed,
// and the sunlight uniform BlueMap draws with. Every name and number here is made up.

interface Clock {
  time: number;
  at: number;
}
interface SunChat {
  parseFeed(text: string): { lines: unknown[]; clock: Clock | null } | null;
  sunFor(time: number): number;
  clockNow(clock: Clock, receivedAtMs: number, nowMs: number): number;
}
const sun = chat as unknown as SunChat;

type Ev = { target?: { closest(sel: string): unknown } };
interface Hooked extends FakeNode {
  fire(type: string, ev?: Ev): void;
}
// A fake node that keeps its listeners, so a test can fire a click on it.
function hooked(): Hooked {
  const n = node() as Hooked;
  const handlers: Record<string, Array<(ev?: unknown) => void>> = {};
  n.addEventListener = (type, fn) => {
    handlers[type] = [...(handlers[type] ?? []), fn];
  };
  n.fire = (type, ev) => {
    for (const fn of handlers[type] ?? []) fn(ev);
  };
  return n;
}

// A uniform that counts its writes, so a test can see whether the page wrote it.
function counted(value: number) {
  const u = {
    writes: 0,
    v: value,
    get value() {
      return u.v;
    },
    set value(x: number) {
      u.v = x;
      u.writes++;
    },
  };
  return u;
}

const bmWith = (mapId: string | undefined, uniforms: unknown) => ({
  mapViewer: { map: { data: { id: mapId } }, data: { uniforms } },
});

const T0 = 100000;
const onSwitch = {
  target: { closest: (sel: string) => (sel === '.day-night-switch' ? {} : null) },
};
const elsewhere = { target: { closest: () => null } };

// Mounts the real panel with a page bluemap in window, the feed carrying clock (or none), and the clock at T0. The
// tick is the one that runs each second; the document's listeners are kept so a test can click the page.
async function mount(bm: unknown, clock?: Clock) {
  (globalThis as { window?: unknown }).window = { bluemap: bm };
  const listeners: Array<{ type: string; fn: (ev: Ev) => void }> = [];
  const base = fakeDoc();
  const doc = {
    ...base,
    createElement: () => hooked(),
    addEventListener: (type: string, fn: (ev: Ev) => void) => {
      listeners.push({ type, fn });
    },
  };
  const now = { t: T0 };
  const ticks: Array<() => void> = [];
  const routes = { [FEED]: JSON.stringify({ v: 1, lines: [], clock }) };
  chat.start(
    doc,
    fetchOf(routes),
    () => {},
    (fn) => ticks.push(fn),
    () => now.t,
  );
  await settle();
  const root = doc.body.childNodes[doc.body.childNodes.length - 1];
  const tick = () => {
    for (const fn of ticks) fn();
  };
  const click = (ev: Ev) => {
    for (const l of listeners) if (l.type === 'click') l.fn(ev);
  };
  return { root, now, tick, click };
}

const allText = (n: FakeNode): string => [n.textContent, ...n.childNodes.map(allText)].join(' ');

// The window is set per mount; a test that leaves it behind would leak into the next.
afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('sunFor: the sunlight strength by tick of day', () => {
  it('is full sun from tick 0 to 11800', () => {
    expect(sun.sunFor(0)).toBe(1);
    expect(sun.sunFor(11800)).toBe(1);
  });
  it('fades linearly from 11800 and is 0.625 at 12500', () => {
    expect(sun.sunFor(11801)).toBeLessThan(1);
    expect(sun.sunFor(12500)).toBeCloseTo(0.625, 6);
  });
  it('is the night level 0.25 at 13200 and holds it to 22800', () => {
    expect(sun.sunFor(13200)).toBe(0.25);
    expect(sun.sunFor(18000)).toBe(0.25);
    expect(sun.sunFor(22800)).toBe(0.25);
  });
  it('rises linearly from 22800 and is 0.625 at 23400', () => {
    expect(sun.sunFor(23400)).toBeCloseTo(0.625, 6);
    expect(sun.sunFor(23999)).toBeGreaterThan(0.999);
  });
  it('is continuous at the 24000 wrap', () => {
    expect(Math.abs(sun.sunFor(23999) - sun.sunFor(0))).toBeLessThan(0.001);
    expect(sun.sunFor(24000)).toBe(1);
  });
});

describe('clockNow: the tick of day from the feed, advanced at 20 ticks a second', () => {
  it('advances 20 ticks per real second', () => {
    expect(sun.clockNow({ time: 1000, at: 0 }, 5000, 6000)).toBe(1020);
  });
  it('counts only whole ticks', () => {
    expect(sun.clockNow({ time: 1000, at: 0 }, 5000, 5049)).toBe(1000);
    expect(sun.clockNow({ time: 1000, at: 0 }, 5000, 5050)).toBe(1001);
  });
  it('wraps at a day', () => {
    expect(sun.clockNow({ time: 23990, at: 0 }, 0, 1000)).toBe(10);
  });
  it('clamps a negative elapsed time to 0', () => {
    expect(sun.clockNow({ time: 500, at: 0 }, 5000, 4000)).toBe(500);
  });
});

describe('parseFeed: the clock in geldar-chat.json', () => {
  const line = { t: 1, id: 'a1', text: 'hi' };
  it('returns a valid clock with the lines', () => {
    const r = sun.parseFeed(
      JSON.stringify({ v: 1, lines: [line], clock: { time: 6000, at: 1700000000000 } }),
    );
    expect(r?.clock).toEqual({ time: 6000, at: 1700000000000 });
    expect(r?.lines).toEqual([line]);
  });
  it('gives a null clock, and still the lines, when the key is absent', () => {
    const r = sun.parseFeed(JSON.stringify({ v: 1, lines: [line] }));
    expect(r?.clock).toBeNull();
    expect(r?.lines).toHaveLength(1);
  });
  it.each([
    ['time 24000', { time: 24000, at: 1 }],
    ['time -1', { time: -1, at: 1 }],
    ['time 1.5', { time: 1.5, at: 1 }],
    ['time as a string', { time: '6000', at: 1 }],
    ['no at', { time: 6000 }],
  ])('gives a null clock for %s and keeps the lines', (_name, clock) => {
    const r = sun.parseFeed(JSON.stringify({ v: 1, lines: [line], clock }));
    expect(r?.clock).toBeNull();
    expect(r?.lines).toHaveLength(1);
  });
  it('still rejects a body that is not a feed', () => {
    expect(sun.parseFeed('{"lines":[]}')).toBeNull();
  });
});

describe('the sun on the page: applied on the tick, overworld only', () => {
  it('sets the sunlight uniform from the clock on the overworld', async () => {
    const u = counted(1);
    const m = await mount(bmWith('overworld', { sunlightStrength: u }), { time: 12000, at: 0 });
    m.tick();
    expect(u.value).toBeCloseTo(0.89286, 4);
  });

  it('follows the clock between polls, 20 ticks a second', async () => {
    const u = counted(1);
    const m = await mount(bmWith('overworld', { sunlightStrength: u }), { time: 12000, at: 0 });
    m.now.t = T0 + 10000;
    m.tick();
    expect(u.value).toBeCloseTo(0.78571, 4);
  });

  it('skips a change of 0.01 or less', async () => {
    const u = counted(0.89);
    const m = await mount(bmWith('overworld', { sunlightStrength: u }), { time: 12000, at: 0 });
    m.tick();
    expect(u.writes).toBe(0);
    expect(u.value).toBe(0.89);
  });

  it('still follows at exactly 60 s old', async () => {
    const u = counted(1);
    const m = await mount(bmWith('overworld', { sunlightStrength: u }), { time: 12000, at: 0 });
    m.now.t = T0 + 60000;
    m.tick();
    expect(u.writes).toBe(1);
  });

  it('does nothing when the clock is older than 60 s', async () => {
    const u = counted(1);
    const m = await mount(bmWith('overworld', { sunlightStrength: u }), { time: 12000, at: 0 });
    m.now.t = T0 + 60001;
    m.tick();
    expect(u.writes).toBe(0);
    expect(u.value).toBe(1);
  });

  it('does nothing and throws nothing when the feed has no clock', async () => {
    const u = counted(1);
    const m = await mount(bmWith('overworld', { sunlightStrength: u }));
    expect(() => m.tick()).not.toThrow();
    expect(u.writes).toBe(0);
  });

  it('throws nothing when the uniforms or the bluemap are missing', async () => {
    const m1 = await mount(bmWith('overworld', undefined), { time: 12000, at: 0 });
    expect(() => m1.tick()).not.toThrow();
    const m2 = await mount({}, { time: 12000, at: 0 });
    expect(() => m2.tick()).not.toThrow();
  });

  it('sets 1 once on the nether, so the nether is not left dim', async () => {
    const u = counted(0.25);
    const m = await mount(bmWith('nether', { sunlightStrength: u }), { time: 12000, at: 0 });
    m.tick();
    expect(u.value).toBe(1);
    m.tick();
    expect(u.writes).toBe(1);
  });

  it('stops writing when the viewer clicks the day-night button, and shows the resume control', async () => {
    const u = counted(1);
    const m = await mount(bmWith('overworld', { sunlightStrength: u }), { time: 12000, at: 0 });
    const resume = find(m.root, 'gc-resume');
    expect(resume?.hidden).toBe(true);
    m.tick();
    expect(u.writes).toBe(1);
    m.click(onSwitch);
    expect(resume?.hidden).toBe(false);
    m.now.t = T0 + 10000;
    m.tick();
    expect(u.writes).toBe(1);
  });

  it('a click that is not on the day-night button does not stop following', async () => {
    const u = counted(1);
    const m = await mount(bmWith('overworld', { sunlightStrength: u }), { time: 12000, at: 0 });
    m.click(elsewhere);
    m.tick();
    expect(u.writes).toBe(1);
  });

  it('the resume control turns following on again, and the next tick writes', async () => {
    const u = counted(1);
    const m = await mount(bmWith('overworld', { sunlightStrength: u }), { time: 12000, at: 0 });
    m.click(onSwitch);
    const resume = find(m.root, 'gc-resume');
    (resume as Hooked).fire('click');
    expect(resume?.hidden).toBe(true);
    m.tick();
    expect(u.writes).toBe(1);
  });

  it('the panel says "Follow world time" and nothing about watching or viewers', async () => {
    const m = await mount(bmWith('overworld', {}), { time: 12000, at: 0 });
    expect(allText(m.root)).toContain('Follow world time');
    expect(allText(m.root)).not.toMatch(/watch|viewer|camera/i);
  });

  it('adds no innerHTML write to the script', () => {
    expect(SRC).not.toMatch(/innerHTML\s*=/);
  });
});
