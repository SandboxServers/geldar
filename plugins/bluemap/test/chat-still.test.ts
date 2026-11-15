import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  chat,
  type FakeNode,
  FEED,
  feed,
  NE,
  OW,
  paint,
  player,
  players,
  poll,
  rig,
  rowText,
  SRC,
} from './chat-fresh-fakes';

// The chat panel's "still" label (decision 0310, geldar-chat.js): how long each speaker's home position has been
// unchanged, shown on their newest row, and the rows' markup. Names are made up.

describe('the still label', () => {
  it('starts at the first sighting, rounds to 0.1 and restarts when the position changes', async () => {
    const r = rig({ [FEED]: feed([]), [OW]: players([player('u1', 'Ash', 10.04, -3)]) }, 1000);
    await poll(r);
    expect(chat.stillFor(r.state, 'u1', 1000)).toBe('');
    r.routes[OW] = players([player('u1', 'Ash', 10.01, -3)]);
    r.now.t = 121000;
    await poll(r);
    expect(chat.stillFor(r.state, 'u1', 121000)).toBe('still 2m');
    r.routes[OW] = players([player('u1', 'Ash', 10.6, -3)]);
    r.now.t = 130000;
    await poll(r);
    expect(chat.stillFor(r.state, 'u1', 130000)).toBe('');
    expect(chat.stillFor(r.state, 'u1', 250000)).toBe('still 2m');
  });

  it('restarts the timer when only y changes', async () => {
    const r = rig({ [FEED]: feed([]), [OW]: players([player('u1', 'Ash', 0, 0)]) }, 1000);
    await poll(r);
    r.routes[OW] = players([
      { uuid: 'u1', name: 'Ash', foreign: false, position: { x: 0, y: 70, z: 0 } },
    ]);
    r.now.t = 121000;
    await poll(r);
    expect(chat.stillFor(r.state, 'u1', 121000)).toBe('');
    expect(chat.stillFor(r.state, 'u1', 241000)).toBe('still 2m');
  });

  it('ignores the foreign copies of a speaker on other maps', async () => {
    const r = rig(
      {
        [FEED]: feed([]),
        [OW]: players([player('u1', 'Ash', 0, 0)]),
        [NE]: players([player('u1', 'Ash', 50, 50, true)]),
      },
      1000,
    );
    await poll(r);
    r.routes[NE] = players([player('u1', 'Ash', 80, 80, true)]);
    r.now.t = 60000;
    await poll(r);
    expect(chat.stillFor(r.state, 'u1', 121000)).toBe('still 2m');
  });

  it('shows nothing for a speaker with only a foreign copy, or who has left players.json', async () => {
    const r = rig({ [FEED]: feed([]), [NE]: players([player('u2', 'Bee', 5, 5, true)]) }, 1000);
    await poll(r);
    expect(chat.stillFor(r.state, 'u2', 500000)).toBe('');
    r.routes[OW] = players([player('u1', 'Ash', 0, 0)]);
    await poll(r);
    r.routes[OW] = players([]);
    await poll(r);
    expect(chat.stillFor(r.state, 'u1', 500000)).toBe('');
  });

  it('keeps tracking through a failed players.json fetch', async () => {
    const r = rig({ [FEED]: feed([]), [OW]: players([player('u1', 'Ash', 0, 0)]) }, 1000);
    await poll(r);
    delete r.routes[OW];
    await poll(r);
    expect(chat.stillFor(r.state, 'u1', 200000)).toBe('still 3m');
  });
});

describe('the rows', () => {
  it('put the still label between the name and the text, its text led by one space, and hide it from assistive tech', async () => {
    const lines = [
      { t: 1000, id: 'u1', text: 'hi' },
      { t: 1000, id: 'u9', text: 'who' },
    ];
    const r = rig({ [FEED]: feed(lines), [OW]: players([player('u1', 'Ash', 0, 0)]) }, 1000);
    await poll(r);
    r.now.t = 121000;
    paint(r);
    const rows = r.panel.list.childNodes;
    expect(rows).toHaveLength(2);
    const [first, second] = rows as [FakeNode, FakeNode];
    expect(first.childNodes[3]).toBe(first.stillEl);
    expect(first.stillEl?.attrs['aria-hidden']).toBe('true');
    expect(first.stillEl?.textContent).toBe(' still 2m');
    expect(second.stillEl?.textContent).toBe('');
    expect(rowText(first)).toBe(`${chat.clock(1000)} Ash still 2m: hi`);
    expect(rowText(second)).toBe(`${chat.clock(1000)} Ranger: who`);
    const all = rows.map(rowText).join('\n');
    expect(all).not.toMatch(/idle|afk|watch/i);
  });

  it('reads "Name: text" with no space before the colon when there is no label, and "Name still 4m: text" when there is one', async () => {
    const lines = [
      { t: 1000, id: 'u1', text: 'hi' },
      { t: 1000, id: 'u9', text: 'who' },
    ];
    const r = rig({ [FEED]: feed(lines), [OW]: players([player('u1', 'Ash', 0, 0)]) }, 1000);
    await poll(r);
    r.now.t = 241000;
    paint(r);
    const [first, second] = r.panel.list.childNodes as [FakeNode, FakeNode];
    expect(rowText(first)).toBe(`${chat.clock(1000)} Ash still 4m: hi`);
    expect(rowText(second)).toBe(`${chat.clock(1000)} Ranger: who`);
    expect(rowText(second)).not.toMatch(/Ranger :/);
  });

  it("shows the still label on a speaker's newest row only, and clears it from their older rows", async () => {
    const r = rig(
      {
        [FEED]: feed([{ t: 1000, id: 'u1', text: 'first' }]),
        [OW]: players([player('u1', 'Ash', 0, 0)]),
      },
      1000,
    );
    await poll(r);
    r.now.t = 121000;
    paint(r);
    r.routes[FEED] = feed([
      { t: 1000, id: 'u1', text: 'first' },
      { t: 50000, id: 'u1', text: 'second' },
    ]);
    await poll(r);
    paint(r);
    const [older, newer] = r.panel.list.childNodes as [FakeNode, FakeNode];
    expect(older.stillEl?.textContent).toBe('');
    expect(newer.stillEl?.textContent).toBe(' still 2m');
  });

  it('the still span has no margin, so an empty one takes no room', () => {
    const css = readFileSync(join(import.meta.dirname, '..', 'web', 'geldar.css'), 'utf8');
    const rule = /#geldar-chat \.gc-still \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(/color/);
    expect(rule).not.toMatch(/margin/);
  });

  it('the script writes text only: no innerHTML, outerHTML or insertAdjacentHTML in code', () => {
    const code = SRC.split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    expect(code).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML/);
  });
});

describe('the repaint', () => {
  it('an unchanged repaint writes no text and no class', async () => {
    const r = rig(
      {
        [FEED]: feed([{ t: 1000, id: 'u1', text: 'hi' }]),
        [OW]: players([player('u1', 'Ash', 0, 0)]),
      },
      1000,
    );
    await poll(r);
    r.now.t = 121000;
    paint(r);
    const [row] = r.panel.list.childNodes as [FakeNode];
    const still = row?.stillEl as FakeNode;
    expect(still.textContent).toBe(' still 2m');
    const writes: string[] = [];
    const watch = (n: FakeNode, prop: 'textContent' | 'className') => {
      let value = n[prop];
      Object.defineProperty(n, prop, {
        configurable: true,
        get: () => value,
        set: (v: string) => {
          writes.push(prop);
          value = v;
        },
      });
    };
    watch(r.panel.live, 'textContent');
    watch(r.panel.live, 'className');
    watch(r.panel.foot, 'textContent');
    watch(still, 'textContent');
    paint(r);
    expect(writes).toEqual([]);
    r.now.t = 200000;
    paint(r);
    expect(writes.length).toBeGreaterThan(0);
  });
});
