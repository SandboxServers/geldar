import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import { plainRow } from './render-fixtures.ts';
import { type ThoughtView, toView } from './render-model.ts';
import { createReader, FOLLOW_MS, type ReaderDeps, type ReaderFacts } from './render-reader.ts';
import type { Doc } from './render-view.ts';

/** A view with its own text, so a test can tell which entry the pane shows. */
function entry(index: number, extra: Record<string, unknown> = {}): ThoughtView {
  return toView({ ...plainRow(index), parsed: { plan: `plan ${index}` }, ...extra });
}

/** The reader over a real DOM pane, with a fake clock and a fetch the test answers by hand. */
function setUp(shown: ThoughtView[]) {
  const doc = new Window().document;
  const pane = doc.createElement('article');
  const rows = new Map<string, ReturnType<typeof doc.createElement>>();
  const state = { wide: true, shown, keyword: '' };
  const timers: { fn: () => void; ms: number; id: number; cleared: boolean }[] = [];
  const asked: { view: ThoughtView; answer(facts: ReaderFacts): void; fail(): void }[] = [];
  const deps: ReaderDeps = {
    doc: doc as unknown as Doc,
    pane: pane as unknown as ReaderDeps['pane'],
    isWide: () => state.wide,
    rowOf: (id) => {
      const row = rows.get(id) ?? doc.createElement('li');
      rows.set(id, row);
      return row;
    },
    shown: () => state.shown,
    options: () => ({ keyword: state.keyword }),
    loadFacts: (view) =>
      new Promise((resolve, reject) => {
        asked.push({ view, answer: resolve, fail: () => reject(new Error('HTTP 429')) });
      }),
    timers: {
      setTimeout: (fn, ms) => {
        const timer = { fn, ms, id: timers.length, cleared: false };
        timers.push(timer);
        return timer.id;
      },
      clearTimeout: (id) => {
        const timer = timers[id as number];
        if (timer !== undefined) timer.cleared = true;
      },
    },
  };
  const reader = createReader(deps);
  /** Fires every timer that is still set. */
  const tick = (): void => {
    for (const timer of timers.splice(0)) if (!timer.cleared) timer.fn();
  };
  const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
  const text = (): string | null => pane.querySelector('p.plan')?.textContent ?? null;
  const marked = (): string[] =>
    [...rows].filter(([, row]) => row.className === 'selected').map(([id]) => id);
  return { reader, pane, rows, state, timers, asked, tick, flush, text, marked };
}

describe('the reader pane', () => {
  it('follows the newest entry again after a second press on the selected one, or select("")', () => {
    const page = setUp([entry(1), entry(2)]);
    page.reader.draw();
    page.reader.select('t-2');
    expect(page.text()).toBe('plan 2');
    page.reader.select('t-2');
    expect(page.text()).toBe('plan 1');
    expect(page.marked()).toEqual(['t-1']);
    page.reader.select('t-2');
    page.reader.select('');
    expect(page.text()).toBe('plan 1');
  });

  it('shows the newest entry while nothing is selected, and marks its row', () => {
    const page = setUp([entry(1), entry(2)]);
    page.reader.draw();
    expect(page.text()).toBe('plan 1');
    expect(page.marked()).toEqual(['t-1']);
    expect(page.rows.get('t-1')?.getAttribute('aria-current')).toBe('true');
    expect(page.pane.querySelector('h2.reader-name')?.textContent).toBe('plain');
    expect(page.pane.querySelectorAll('section.detail').length).toBe(1);
  });

  it('shows the selected entry, and moves the mark to its row', () => {
    const page = setUp([entry(1), entry(2), entry(3)]);
    page.reader.draw();
    page.reader.select('t-3');
    expect(page.text()).toBe('plan 3');
    expect(page.marked()).toEqual(['t-3']);
    expect(page.rows.get('t-1')?.hasAttribute('aria-current')).toBe(false);
    // New entries arrive above: the selection holds.
    page.state.shown = [entry(9), ...page.state.shown];
    page.reader.draw();
    expect(page.text()).toBe('plan 3');
  });

  it('falls back to the newest entry when the selected one leaves the page, and returns when it is back', () => {
    const all = [entry(1), entry(2), entry(3)];
    const page = setUp(all);
    page.reader.select('t-2');
    page.state.shown = [all[0] as ThoughtView, all[2] as ThoughtView];
    page.reader.draw();
    expect(page.text()).toBe('plan 1');
    expect(page.marked()).toEqual(['t-1']);
    page.state.shown = all;
    page.reader.draw();
    expect(page.text()).toBe('plan 2');
  });

  it('fetches the facts of a selected entry at once', async () => {
    const page = setUp([entry(1), entry(2)]);
    page.reader.select('t-2');
    expect(page.asked.map((ask) => ask.view.id)).toEqual(['t-2']);
    expect(page.timers).toHaveLength(0);
    // Until they arrive the pane says nothing about receipts.
    expect(page.pane.querySelector('.receipts, .none')).toBeNull();
    page.asked[0]?.answer({
      view: entry(2, { prompt_template_version: 'mind-v9' }),
      receipts: [{ kind: 'eat', item: 'bread', count: 1, phase: 'committed', credits: 1 }],
    });
    await page.flush();
    expect(page.pane.querySelector('dl.facts')?.textContent).toContain('mind-v9');
    expect(page.pane.querySelector('.receipts')?.textContent).toBe('eat breadcommitted1 cr');
    expect(page.pane.querySelectorAll('section.detail').length).toBe(1);
  });

  it('waits before fetching the facts of an entry it only follows, and a newer entry restarts the wait', () => {
    const page = setUp([entry(1)]);
    page.reader.draw();
    expect(page.asked).toHaveLength(0);
    expect(page.timers.map((timer) => timer.ms)).toEqual([FOLLOW_MS]);
    expect(FOLLOW_MS).toBe(800);
    // Two more arrive before the wait is over: the first two waits are dropped.
    page.state.shown = [entry(2), ...page.state.shown];
    page.reader.draw();
    page.state.shown = [entry(3), ...page.state.shown];
    page.reader.draw();
    expect(page.timers.map((timer) => timer.cleared)).toEqual([true, true, false]);
    page.tick();
    expect(page.asked.map((ask) => ask.view.id)).toEqual(['t-3']);
  });

  it('drops an answer for an entry that is no longer in the pane', async () => {
    const page = setUp([entry(1), entry(2)]);
    page.reader.select('t-1');
    page.reader.select('t-2');
    page.asked[0]?.answer({
      view: entry(1, { prompt_template_version: 'mind-old' }),
      receipts: [],
    });
    await page.flush();
    expect(page.text()).toBe('plan 2');
    expect(page.pane.textContent).not.toContain('mind-old');
    expect(page.pane.querySelector('.none')).toBeNull();
  });

  it('says so when the facts cannot be loaded, and keeps what the row already knew', async () => {
    const page = setUp([entry(1)]);
    page.reader.select('t-1');
    page.asked[0]?.fail();
    await page.flush();
    expect(page.pane.querySelector('.note')?.textContent).toBe('Could not load this thought.');
    expect(page.text()).toBe('plan 1');
    expect(page.pane.querySelector('dl.facts')?.textContent).toContain('world day3');
  });

  it('fetches nothing for a journal line, and says it has no receipts', () => {
    const journal = toView({ thought_id: 'j', name: 'Vesper', kind: 'journal', text: 'a note' });
    const page = setUp([journal]);
    page.reader.select('j');
    expect(page.asked).toHaveLength(0);
    expect(page.timers).toHaveLength(0);
    expect(page.pane.querySelector('.none')?.textContent).toBe(
      'No receipts: nothing was done with this entry.',
    );
  });

  it('redraws the marks of a new search without fetching again, and keeps the facts it has', async () => {
    const page = setUp([entry(1)]);
    page.reader.select('t-1');
    page.asked[0]?.answer({ view: entry(1, { prompt_template_version: 'mind-v9' }), receipts: [] });
    await page.flush();
    page.state.keyword = 'plan';
    page.reader.draw();
    expect([...page.pane.querySelectorAll('mark')].map((m) => m.textContent)).toEqual(['plan']);
    expect(page.asked).toHaveLength(1);
    expect(page.pane.querySelector('dl.facts')?.textContent).toContain('mind-v9');
    expect(page.pane.querySelector('.none')).not.toBeNull();
    // The same search again changes nothing.
    const before = page.pane.firstElementChild;
    page.reader.draw();
    expect(page.pane.firstElementChild).toBe(before);
  });

  it('follows the row when the list is drawn again: the mark is on the row now on the page', () => {
    const page = setUp([entry(1)]);
    page.reader.draw();
    const old = page.rows.get('t-1');
    page.rows.delete('t-1');
    page.reader.draw();
    expect(old?.className).toBe('');
    expect(page.rows.get('t-1')?.className).toBe('selected');
  });

  it('is empty on a phone: no entry, no mark, no fetch, and a pending wait is dropped', () => {
    const page = setUp([entry(1)]);
    page.reader.draw();
    page.state.wide = false;
    page.reader.draw();
    expect(page.pane.children.length).toBe(0);
    expect(page.marked()).toEqual([]);
    expect(page.timers.map((timer) => timer.cleared)).toEqual([true]);
    page.reader.select('t-1');
    expect(page.pane.children.length).toBe(0);
    expect(page.asked).toHaveLength(0);
    // Unfolded again, the selection made on the phone is shown.
    page.state.wide = true;
    page.reader.draw();
    expect(page.text()).toBe('plan 1');
  });

  it('empties the pane when no entry is left on the page', () => {
    const page = setUp([entry(1)]);
    page.reader.draw();
    page.state.shown = [];
    page.reader.draw();
    expect(page.pane.children.length).toBe(0);
    expect(page.marked()).toEqual([]);
  });
});
