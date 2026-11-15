import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The time-of-day dial (BM-15, geldar-sky.js) and its stylesheet rules. The script is loaded the way the browser loads
// it: a plain script, read as text. The document is a small fake; the clock, the feed and the map are made up.

const SRC = readFileSync(join(import.meta.dirname, '..', 'web', 'geldar-sky.js'), 'utf8');
const CSS = readFileSync(join(import.meta.dirname, '..', 'web', 'geldar.css'), 'utf8');
const mod = { exports: {} as Record<string, unknown> };
new Function('module', SRC)(mod);

type Clock = { time: number; at: number };
type Fetch = (url: string, opts?: unknown) => Promise<{ ok: boolean; text(): Promise<string> }>;
type Timer = { fn: () => void; ms: number };
interface Sky {
  parseClock(c: unknown): Clock | null;
  feedClock(text: string): Clock | null | undefined;
  clockNow(clock: Clock, receivedAtMs: number, nowMs: number): number;
  phaseOf(time: number): { body: 'sun' | 'moon'; p: number };
  arcPoint(p: number): { x: number; y: number };
  hhmm(time: number): string;
  labelOf(time: number): string;
  pollOnce(state: unknown, fetchFn: Fetch): Promise<boolean>;
  start(
    doc: unknown,
    fetchFn: Fetch,
    schedule: (fn: () => void, ms: number) => void,
    now: () => number,
    bmOf: () => unknown,
  ): object | null;
  POLL_MS: number;
  TICK_MS: number;
  CLOCK_MAX_MS: number;
}
const sky = mod.exports as unknown as Sky;

// A fake element: a tag, an id and class (set as properties by the script), attributes set by setAttribute, the hidden
// flag and the text. Each write is counted, so a test can see whether a repaint wrote anything.
class El {
  id = '';
  className = '';
  children: El[] = [];
  attrs: Record<string, string> = {};
  writes = 0;
  private hid = false;
  private text = '';
  constructor(readonly tag: string) {}
  get hidden(): boolean {
    return this.hid;
  }
  set hidden(v: boolean) {
    this.writes++;
    this.hid = v;
  }
  get textContent(): string {
    return this.text;
  }
  set textContent(v: string) {
    this.writes++;
    this.text = v;
  }
  setAttribute(k: string, v: string) {
    this.writes++;
    this.attrs[k] = v;
  }
  appendChild(c: El): El {
    this.children.push(c);
    return c;
  }
}

function find(n: El, id: string): El | null {
  if (n.id === id) return n;
  for (const c of n.children) {
    const hit = find(c, id);
    if (hit) return hit;
  }
  return null;
}

function countId(n: El, id: string): number {
  return (n.id === id ? 1 : 0) + n.children.reduce((sum, c) => sum + countId(c, id), 0);
}

function writesIn(n: El): number {
  return n.writes + n.children.reduce((sum, c) => sum + writesIn(c), 0);
}

class Doc {
  head = new El('head');
  body = new El('body');
  readyState = 'complete';
  createElement(tag: string): El {
    return new El(tag);
  }
  createElementNS(_ns: string, tag: string): El {
    return new El(tag);
  }
  querySelector(sel: string): El | null {
    return sel.startsWith('#') ? find(this.body, sel.slice(1)) : null;
  }
  addEventListener() {}
}

const settle = () => new Promise((resolve) => setImmediate(resolve));
const T0 = 100000;
const OW = { mapViewer: { map: { data: { id: 'overworld' } } } };
const onMap = (id: string) => ({ mapViewer: { map: { data: { id } } } });
const feedBody = (clock?: unknown) => JSON.stringify({ v: 1, lines: [], clock });

// Mounts the dial on a fresh document. The feed body and the map are read at each use, so a test can change them.
async function mount(clock: unknown, bm: unknown = OW, t = T0) {
  const feed = { body: feedBody(clock) as string | null };
  const r = {
    doc: new Doc(),
    now: { t },
    timers: [] as Timer[],
    feed,
    bm: { v: bm as unknown },
    fetchFn: (async () => ({
      ok: feed.body !== null,
      text: async () => feed.body ?? '',
    })) as Fetch,
    dial: null as El | null,
  };
  sky.start(
    r.doc,
    r.fetchFn,
    (fn, ms) => r.timers.push({ fn, ms }),
    () => r.now.t,
    () => r.bm.v,
  );
  r.dial = find(r.doc.body, 'geldar-sky');
  await settle();
  return r;
}
type Rig = Awaited<ReturnType<typeof mount>>;

const timerFor = (r: Rig, ms: number) => {
  const t = r.timers.find((x) => x.ms === ms);
  if (!t) throw new Error('no timer at ' + ms);
  return t.fn;
};
async function poll(r: Rig) {
  timerFor(r, sky.POLL_MS)();
  await settle();
}
const tick = (r: Rig) => timerFor(r, sky.TICK_MS)();
const dialOf = (r: Rig) => r.dial as El;
const svgOf = (r: Rig) => dialOf(r).children[0];
const iconOf = (r: Rig, cls: string) =>
  svgOf(r).children.find((c) => (c.attrs.class ?? '').split(' ').includes(cls)) as El;
const ariaOf = (r: Rig) => dialOf(r).attrs['aria-label'];

describe('phase: which body is up and where it sits', () => {
  it.each([
    [0, 'sun', 0],
    [3000, 'sun', 0.25],
    [6000, 'sun', 0.5],
    [12000, 'sun', 1],
    [15000, 'moon', 0.25],
    [18000, 'moon', 0.5],
    [23999, 'moon', 11999 / 12000],
  ])('tick %i is the %s at p %d', (time, body, p) => {
    const ph = sky.phaseOf(time);
    expect(ph.body).toBe(body);
    expect(ph.p).toBeCloseTo(p, 10);
  });

  it('puts the arc points on the horizon at the ends and at the top in the middle', () => {
    expect(sky.arcPoint(0)).toEqual({ x: 8, y: 32 });
    expect(sky.arcPoint(0.25)).toEqual({ x: 16.2, y: 12.2 });
    expect(sky.arcPoint(0.5)).toEqual({ x: 36, y: 4 });
    expect(sky.arcPoint(1)).toEqual({ x: 64, y: 32 });
  });

  it('wraps a tick outside one day into the day', () => {
    expect(sky.phaseOf(24000)).toEqual({ body: 'sun', p: 0 });
    expect(sky.phaseOf(-1).body).toBe('moon');
  });
});

describe('the clock: validation, the tick now and the label', () => {
  it('accepts an integer tick 0..23999 with a finite at', () => {
    expect(sky.parseClock({ time: 0, at: 5 })).toEqual({ time: 0, at: 5 });
    expect(sky.parseClock({ time: 23999, at: 5 })).toEqual({ time: 23999, at: 5 });
  });

  it.each([
    ['tick 24000', { time: 24000, at: 5 }],
    ['negative tick', { time: -1, at: 5 }],
    ['fractional tick', { time: 1.5, at: 5 }],
    ['string tick', { time: '100', at: 5 }],
    ['string at', { time: 100, at: 'x' }],
    ['infinite at', { time: 100, at: Infinity }],
    ['no clock', null],
  ])('refuses %s', (_name, c) => {
    expect(sky.parseClock(c)).toBeNull();
  });

  it('reads a clock from a feed, and treats a body that is not a v1 feed as a failed read', () => {
    expect(sky.feedClock(feedBody({ time: 3000, at: 7 }))).toEqual({ time: 3000, at: 7 });
    expect(sky.feedClock(feedBody())).toBeNull();
    expect(sky.feedClock('not json')).toBeUndefined();
    expect(sky.feedClock(JSON.stringify({ v: 2, clock: { time: 1, at: 1 } }))).toBeUndefined();
  });

  it('ticks on from the anchor at 20 a second and wraps at a day', () => {
    expect(sky.clockNow({ time: 1000, at: 0 }, 0, 1000)).toBe(1020);
    expect(sky.clockNow({ time: 23990, at: 0 }, 0, 1000)).toBe(10);
    expect(sky.clockNow({ time: 5, at: 0 }, 1000, 0)).toBe(5);
  });

  it.each([
    [0, '06:00'],
    [3000, '09:00'],
    [6000, '12:00'],
    [8334, '14:20'],
    [12000, '18:00'],
    [18000, '00:00'],
    [23999, '05:59'],
  ])('tick %i reads %s', (time, hhmm) => {
    expect(sky.hhmm(time)).toBe(hhmm);
  });

  it('labels the sun as Day and the moon as Night', () => {
    expect(sky.labelOf(8334)).toBe('World time 14:20, Day');
    expect(sky.labelOf(15000)).toBe('World time 21:00, Night');
  });

  it('floors the label minutes to a 5-minute step', () => {
    expect(sky.labelOf(3000)).toBe('World time 09:00, Day');
    expect(sky.labelOf(3083)).toBe('World time 09:00, Day');
    expect(sky.labelOf(3084)).toBe('World time 09:05, Day');
    expect(sky.labelOf(8400)).toBe('World time 14:20, Day');
    expect(sky.labelOf(8417)).toBe('World time 14:25, Day');
    expect(sky.labelOf(23999)).toBe('World time 05:55, Night');
    expect(sky.labelOf(0)).toBe('World time 06:00, Day');
  });

  it('keeps the exact minute for hhmm without a step', () => {
    expect(sky.hhmm(3084)).toBe('09:05');
    expect(sky.hhmm(8417)).toBe('14:25');
  });
});

describe('the dial on the page', () => {
  it('shows the sun on the arc at tick 3000, with the moon faded out', async () => {
    const r = await mount({ time: 3000, at: T0 });
    tick(r);
    expect(dialOf(r).hidden).toBe(false);
    expect(iconOf(r, 'gs-sun').attrs.class).toBe('gs-icon gs-sun gs-on');
    expect(iconOf(r, 'gs-sun').attrs.transform).toBe('translate(16.2 12.2)');
    expect(iconOf(r, 'gs-moon').attrs.class).toBe('gs-icon gs-moon gs-off');
    expect(iconOf(r, 'gs-moon').attrs.transform).toBeUndefined();
    expect(ariaOf(r)).toBe('World time 09:00, Day');
    expect(dialOf(r).attrs.title).toBeUndefined();
    expect(svgOf(r).children.some((c) => c.tag === 'title')).toBe(false);
  });

  it('shows the moon on the arc at tick 15000, with the sun faded out', async () => {
    const r = await mount({ time: 15000, at: T0 });
    tick(r);
    expect(iconOf(r, 'gs-moon').attrs.class).toBe('gs-icon gs-moon gs-on');
    expect(iconOf(r, 'gs-moon').attrs.transform).toBe('translate(16.2 12.2)');
    expect(iconOf(r, 'gs-sun').attrs.class).toBe('gs-icon gs-sun gs-off');
    expect(ariaOf(r)).toBe('World time 21:00, Night');
  });

  it('puts the sun on the east horizon at tick 0 and the west horizon at tick 12000', async () => {
    const dawn = await mount({ time: 0, at: T0 });
    tick(dawn);
    expect(iconOf(dawn, 'gs-sun').attrs.transform).toBe('translate(8 32)');
    const dusk = await mount({ time: 12000, at: T0 });
    tick(dusk);
    expect(iconOf(dusk, 'gs-sun').attrs.transform).toBe('translate(64 32)');
  });

  it('moves the body 20 ticks a second between polls, and the label with it', async () => {
    const r = await mount({ time: 1000, at: T0 });
    r.now.t = T0 + 1000;
    tick(r);
    expect(ariaOf(r)).toBe('World time 07:00, Day');
    expect(iconOf(r, 'gs-sun').attrs.transform).toBe(
      'translate(' + sky.arcPoint(1020 / 12000).x + ' ' + sky.arcPoint(1020 / 12000).y + ')',
    );
    r.now.t = T0 + 5000;
    tick(r);
    expect(ariaOf(r)).toBe('World time 07:05, Day');
  });

  it('is still live at exactly 60 s without a moved clock, and hidden one millisecond later', async () => {
    const r = await mount({ time: 3000, at: T0 });
    r.now.t = T0 + sky.CLOCK_MAX_MS;
    tick(r);
    expect(dialOf(r).hidden).toBe(false);
    r.now.t = T0 + sky.CLOCK_MAX_MS + 1;
    tick(r);
    expect(dialOf(r).hidden).toBe(true);
  });

  it('paints the moon on the left horizon at tick 12001, just after the sun sets', async () => {
    const r = await mount({ time: 12001, at: T0 });
    tick(r);
    expect(iconOf(r, 'gs-moon').attrs.class).toBe('gs-icon gs-moon gs-on');
    expect(iconOf(r, 'gs-moon').attrs.transform).toBe('translate(8 32)');
    expect(iconOf(r, 'gs-sun').attrs.class).toBe('gs-icon gs-sun gs-off');
  });

  it('wraps from tick 23999 to 0: the moon on the west horizon, then the sun on the east', async () => {
    const r = await mount({ time: 23999, at: T0 });
    tick(r);
    expect(iconOf(r, 'gs-moon').attrs.transform).toBe('translate(64 32)');
    expect(ariaOf(r)).toBe('World time 05:55, Night');
    r.now.t = T0 + 50;
    tick(r);
    expect(iconOf(r, 'gs-sun').attrs.class).toBe('gs-icon gs-sun gs-on');
    expect(iconOf(r, 'gs-sun').attrs.transform).toBe('translate(8 32)');
    expect(iconOf(r, 'gs-moon').attrs.class).toBe('gs-icon gs-moon gs-off');
    expect(ariaOf(r)).toBe('World time 06:00, Day');
  });

  it('writes no label on two repaints a second apart inside one 5-minute step', async () => {
    const r = await mount({ time: 3000, at: T0 });
    tick(r);
    const before = dialOf(r).writes;
    r.now.t = T0 + 1000;
    tick(r);
    r.now.t = T0 + 2000;
    tick(r);
    expect(ariaOf(r)).toBe('World time 09:00, Day');
    expect(dialOf(r).writes).toBe(before);
  });

  it('writes the label once, when the repaint crosses into the next 5-minute step', async () => {
    const r = await mount({ time: 3000, at: T0 });
    tick(r);
    const before = dialOf(r).writes;
    r.now.t = T0 + 84 * 50;
    tick(r);
    expect(ariaOf(r)).toBe('World time 09:05, Day');
    expect(dialOf(r).writes).toBe(before + 1);
  });

  it('is hidden with no clock in the feed', async () => {
    const r = await mount(undefined);
    tick(r);
    expect(dialOf(r).hidden).toBe(true);
  });

  it('is hidden on the nether and the end, and shown again on the overworld', async () => {
    const r = await mount({ time: 3000, at: T0 }, onMap('nether'));
    tick(r);
    expect(dialOf(r).hidden).toBe(true);
    r.bm.v = onMap('end');
    tick(r);
    expect(dialOf(r).hidden).toBe(true);
    r.bm.v = OW;
    tick(r);
    expect(dialOf(r).hidden).toBe(false);
  });

  it('is hidden, and throws nothing, when BlueMap is missing', async () => {
    const r = await mount({ time: 3000, at: T0 });
    r.bm.v = undefined;
    expect(() => tick(r)).not.toThrow();
    expect(dialOf(r).hidden).toBe(true);
  });

  it('hides once the clock has not moved for 60 s, and not a moment before', async () => {
    const r = await mount({ time: 3000, at: T0 });
    r.now.t = T0 + sky.CLOCK_MAX_MS - 1;
    tick(r);
    expect(dialOf(r).hidden).toBe(false);
    r.now.t = T0 + sky.CLOCK_MAX_MS + 1;
    tick(r);
    expect(dialOf(r).hidden).toBe(true);
  });

  it('keeps the clock anchored when an unchanged clock is polled again', async () => {
    const r = await mount({ time: 3000, at: T0 });
    r.now.t = T0 + 30000;
    await poll(r);
    r.now.t = T0 + sky.CLOCK_MAX_MS + 1;
    tick(r);
    expect(dialOf(r).hidden).toBe(true);
  });

  it('re-anchors when the clock changes, and shows again', async () => {
    const r = await mount({ time: 3000, at: T0 });
    r.now.t = T0 + 30000;
    r.feed.body = feedBody({ time: 3000, at: T0 + 30000 });
    await poll(r);
    r.now.t = T0 + sky.CLOCK_MAX_MS + 1;
    tick(r);
    expect(dialOf(r).hidden).toBe(false);
  });

  it('keeps the last clock through a failed read, until it goes stale', async () => {
    const r = await mount({ time: 3000, at: T0 });
    r.now.t = T0 + 30000;
    r.feed.body = null;
    await poll(r);
    r.now.t = T0 + 45000;
    tick(r);
    expect(dialOf(r).hidden).toBe(false);
  });

  it('writes nothing on a repaint that changes nothing', async () => {
    const r = await mount({ time: 3000, at: T0 });
    tick(r);
    const before = writesIn(dialOf(r));
    tick(r);
    expect(writesIn(dialOf(r))).toBe(before);
  });

  it('is one dial when the script runs twice on the page', async () => {
    const r = await mount({ time: 3000, at: T0 });
    const second = sky.start(
      r.doc,
      r.fetchFn,
      () => {},
      () => T0,
      () => OW,
    );
    expect(second).toBeNull();
    expect(countId(r.doc.body, 'geldar-sky')).toBe(1);
  });

  it('a poll that throws is a failed read, not an error', async () => {
    const state = { now: () => T0, clock: null, clockAt: null };
    const ok = await sky.pollOnce(state, async () => {
      throw new Error('down');
    });
    expect(ok).toBe(false);
  });
});

describe('the script source', () => {
  it('builds its nodes without innerHTML or any HTML string', () => {
    expect(SRC).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML/);
  });

  it('uses no wording about watching, cameras, viewers or spectating', () => {
    // mapViewer is BlueMap's own property name (the map id is read from it), not wording of the page.
    expect(SRC.replace(/mapViewer/g, '')).not.toMatch(/watch|camera|viewer|observ|spectat/i);
  });

  it('reads only the feed: no player lists and no other endpoint', () => {
    expect(SRC).toContain("'/geldar-chat.json'");
    expect(SRC).not.toContain('/maps/');
  });
});

describe('the stylesheet', () => {
  const section = CSS.slice(CSS.indexOf('/* The time-of-day dial')).replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );

  it('has the dial rule, fixed and click-through', () => {
    const rule = /#geldar-sky \{([^}]*)\}/.exec(section)?.[1] ?? '';
    expect(rule).toMatch(/position: fixed;/);
    expect(rule).toMatch(/pointer-events: none;/);
  });

  it('keeps the hidden attribute hiding the dial', () => {
    expect(section).toMatch(/#geldar-sky\[hidden\] \{\s*display: none;\s*\}/);
  });

  it('uses only gs- class names', () => {
    const names = [...section.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(0);
    for (const n of names) expect(n.startsWith('gs-')).toBe(true);
  });

  it('is 56 by 32 on screens up to 600px wide, in a media query', () => {
    const m = /@media \(max-width: 600px\) \{\s*#geldar-sky \{([^}]*)\}/.exec(section);
    expect(m).not.toBeNull();
    expect(m?.[1]).toMatch(/width: 56px;/);
    expect(m?.[1]).toMatch(/height: 32px;/);
  });

  it('turns the fade off for reduced motion', () => {
    expect(section).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*transition: none;/);
  });
});
