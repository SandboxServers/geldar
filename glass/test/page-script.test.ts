/**
 * The page script, public/app.js, run in happy-dom (page-boot.ts). Covers the filters and the agent chips,
 * the search count and marks, the detail under an entry, "Copy entry", live entries added in place, the
 * one pause control with its 2000-row buffer, load older, reconnect backoff and the banner. The wide
 * layout, the install strip and the worker's registration are in page-wide.test.ts.
 */
import { readFileSync } from 'node:fs';
import type {
  HTMLButtonElement,
  HTMLElement,
  HTMLInputElement,
  HTMLSelectElement,
} from 'happy-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RENDER_MODULES } from '../src/static-files.ts';
import {
  APP_JS,
  boot,
  cleanUp,
  fire,
  INDEX_HTML,
  listRows,
  PAGES,
  page,
  settle,
  thought,
} from './page-boot.ts';

afterEach(cleanUp);

describe('the page script', () => {
  it('counts matching new entries only while away, and resets on click or manual scroll', async () => {
    const win = await boot(PAGES);
    const list = win.document.getElementById('thoughts');
    const fresh = win.document.getElementById('fresh') as HTMLButtonElement;
    let top = 20;
    if (list) list.getBoundingClientRect = () => new win.DOMRect(0, top, 300, 1000);
    page.sources[0]?.emit('thought', thought(40));
    expect(fresh.hidden).toBe(true);
    top = -100;
    page.sources[0]?.emit('thought', thought(41));
    expect(fresh.hidden).toBe(false);
    expect(fresh.textContent).toBe('1 new entry');
    page.sources[0]?.emit('thought', thought(42));
    page.sources[0]?.emit('thought', thought(42));
    expect(fresh.textContent).toBe('2 new entries');
    const scroller = win.document.getElementById('scroller') as HTMLElement;
    scroller.scrollTop = 400;
    fire(win, fresh, 'click');
    expect(fresh.hidden).toBe(true);
    // The list scrolls inside its own pane now: the press goes to the top of that, and the feed stays live.
    expect(scroller.scrollTop).toBe(0);
    expect(win.document.getElementById('pause')?.getAttribute('aria-pressed')).toBe('false');
    page.sources[0]?.emit('thought', thought(43));
    expect(fresh.textContent).toBe('1 new entry');
    top = 0;
    fire(win, scroller, 'scroll');
    expect(fresh.hidden).toBe(true);
    const keyword = win.document.getElementById('f-keyword') as HTMLInputElement;
    keyword.value = 'plan 1';
    fire(win, keyword, 'input');
    top = -100;
    page.sources[0]?.emit('thought', thought(44));
    expect(fresh.hidden).toBe(true);
    page.sources[0]?.emit('thought', thought(100));
    expect(fresh.textContent).toBe('1 new entry');
    keyword.value = 'no-match';
    fire(win, keyword, 'input');
    expect(fresh.hidden).toBe(true);
  });

  it('marks a dead agent in its chip, rows and detail without changing copy text', async () => {
    const written: string[] = [];
    const win = await boot(
      {
        ...PAGES,
        agents: [
          { agent_id: 'life-1', name: 'Ada', died_at: '2026-11-11', death_cause: '<img>\u202E' },
        ],
      },
      { navigator: { clipboard: { writeText: async (text: string) => void written.push(text) } } },
    );
    expect(win.document.querySelectorAll('#chips button')[1]?.textContent).toBe('Ada\u2020 died');
    expect(win.document.querySelector('.meta .agent + .died')?.textContent).toBe('\u2020 died');
    expect(win.document.querySelector('#thoughts canvas')?.className).toBe('sigil sigil-row dead');
    fire(win, win.document.querySelector('button.when'), 'click');
    await settle();
    const detail = win.document.querySelector('.detail');
    expect(detail?.textContent).toContain('died2026-11-11cause<img>[U+202E]');
    expect(detail?.querySelector('img')).toBeNull();
    fire(win, win.document.querySelector('button.copy'), 'click');
    await settle();
    expect(written[0]).toBe('Ada, 2026-11-10 00:00 UTC\nplan 1');
  });

  it('restores a bookmark before its single first fetch and replaces the URL on edits', async () => {
    const win = await boot(PAGES, {
      search: '?q=plan%203&agent=a1&range=day&outcome=parsed&template=v1',
    });
    expect(page.fetchUrls.filter((u) => u.startsWith('/api/thoughts?'))).toHaveLength(1);
    expect(page.fetchUrls[1]).toContain('agent=a1');
    expect(page.fetchUrls[1]).toContain('outcome=parsed');
    expect(page.fetchUrls[1]).toContain('since=');
    expect(listRows(win)).toBe(0); // fixture entries are outside the last day
    // The filters folded under "More" are set: it says so by its colour, and stays folded.
    expect(win.document.querySelector('details.more')?.className).toBe('more set');
    expect(win.document.querySelector('details.more')?.hasAttribute('open')).toBe(false);
    expect(win.document.querySelector('#chips button.on')?.textContent).toBe('Ada');
    const keyword = win.document.getElementById('f-keyword') as HTMLInputElement;
    expect(keyword.value).toBe('plan 3');
    keyword.value = 'pit';
    fire(win, keyword, 'input');
    expect(win.location.search).toContain('q=pit');
    expect(win.history.length).toBe(1);
  });

  it('keeps searching when the browser refuses a URL update', async () => {
    const win = await boot(PAGES);
    win.history.replaceState = () => {
      throw new Error('SecurityError: too many calls');
    };
    const keyword = win.document.getElementById('f-keyword') as HTMLInputElement;
    keyword.value = 'plan 3';
    fire(win, keyword, 'input');
    expect(listRows(win)).toBe(1);
    expect(win.document.getElementById('count')?.textContent).toContain('1 match');
  });

  it('ignores invalid URL choices and bounds text before assigning controls', async () => {
    const win = await boot(PAGES, {
      search: `?agent=unknown&range=week&outcome=bad&q=${'x'.repeat(220)}&template=${'t'.repeat(80)}`,
    });
    expect(page.fetchUrls[1]).toBe('/api/thoughts?limit=50');
    expect((win.document.getElementById('f-keyword') as HTMLInputElement).value).toHaveLength(200);
    expect((win.document.getElementById('f-template') as HTMLInputElement).value).toHaveLength(64);
  });

  it('loads the agents and the first page, and draws one row per thought with names as text only', async () => {
    const win = await boot(PAGES);
    expect(page.fetchUrls[0]).toBe('/api/agents');
    expect(page.fetchUrls[1]).toBe('/api/thoughts?limit=50');
    expect(listRows(win)).toBe(3);
    const chips = [...win.document.querySelectorAll('#chips button')];
    expect(chips.map((chip) => chip.textContent)).toEqual([
      'Everyone',
      'Ada',
      '<img src=x onerror="globalThis.__glassCanary=1">',
    ]);
    expect(chips.map((chip) => chip.getAttribute('aria-pressed'))).toEqual([
      'true',
      'false',
      'false',
    ]);
    expect(
      win.document.querySelectorAll('#chips img, #thoughts img, #thoughts script').length,
    ).toBe(0);
    // The word beside the name is how the agent's mind is run, from the agents list; a row whose agent is not listed shows its tier.
    expect(win.document.querySelector('#thoughts .mode')?.textContent).toBe('local');
    expect((globalThis as { __glassCanary?: unknown }).__glassCanary).toBeUndefined();
    expect(win.document.getElementById('status')?.textContent).toBe('Connecting...');
    page.sources[0]?.onopen?.();
    expect(win.document.getElementById('status')?.textContent).toBe('Live');
  });

  it('reloads with the outcome filter as a server parameter, and narrows the loaded rows by keyword only', async () => {
    const win = await boot(PAGES);
    const before = page.fetchUrls.length;
    const outcome = win.document.getElementById('f-outcome') as HTMLSelectElement;
    outcome.value = 'unparsed';
    fire(win, outcome, 'change');
    await settle();
    expect(page.fetchUrls.slice(before).some((u) => u.includes('outcome=unparsed'))).toBe(true);
    const afterReload = page.fetchUrls.length;
    const keyword = win.document.getElementById('f-keyword') as HTMLInputElement;
    keyword.value = 'no-such-word';
    fire(win, keyword, 'input');
    await settle();
    expect(listRows(win)).toBe(0);
    expect(page.fetchUrls.length).toBe(afterReload);
  });

  it('holds live thoughts while paused, caps the hold at 2000, and draws them oldest first on resume', async () => {
    const win = await boot(PAGES);
    page.sources[0]?.onopen?.();
    const pause = win.document.getElementById('pause') as HTMLButtonElement;
    const status = win.document.getElementById('status');
    const fresh = win.document.getElementById('fresh') as HTMLButtonElement;
    expect([pause.className, pause.getAttribute('aria-pressed')]).toEqual(['pill live', 'false']);
    fire(win, pause, 'click');
    // One control: the same button says the feed is paused, and what waits is counted beside the list.
    expect([pause.className, pause.getAttribute('aria-pressed')]).toEqual(['pill paused', 'true']);
    expect(status?.textContent).toBe('Paused');
    expect(pause.textContent).toContain('Press to resume');
    expect(fresh.hidden).toBe(true);
    for (let i = 100; i < 2105; i += 1) page.sources[0]?.emit('thought', thought(i));
    expect(listRows(win)).toBe(3);
    expect([fresh.hidden, fresh.textContent]).toEqual([false, '2000 new entries']);
    fire(win, pause, 'click');
    await settle();
    expect(listRows(win)).toBe(2000);
    const first = win.document.querySelector('#thoughts > li');
    expect(first?.textContent).toContain('w2104');
    expect(status?.textContent).toBe('Live');
    expect(fresh.hidden).toBe(true);
  });

  it('counts only the waiting entries the filters would show, and shows them on a press of the count', async () => {
    const win = await boot(PAGES);
    const pause = win.document.getElementById('pause') as HTMLButtonElement;
    const fresh = win.document.getElementById('fresh') as HTMLButtonElement;
    const keyword = win.document.getElementById('f-keyword') as HTMLInputElement;
    keyword.value = 'plan 4';
    fire(win, keyword, 'input');
    fire(win, pause, 'click');
    page.sources[0]?.emit('thought', thought(40));
    page.sources[0]?.emit('thought', thought(50));
    expect(fresh.textContent).toBe('1 new entry');
    fire(win, fresh, 'click');
    expect(pause.getAttribute('aria-pressed')).toBe('false');
    expect(fresh.hidden).toBe(true);
    expect(listRows(win)).toBe(1);
    expect(win.document.querySelector('#thoughts > li')?.textContent).toContain('plan 40');
  });

  it('load older appends the page after the cursor, and disables the button at the end', async () => {
    const win = await boot(PAGES);
    const older = win.document.getElementById('older') as HTMLButtonElement;
    expect(older.disabled).toBe(false);
    fire(win, older, 'click');
    await settle();
    expect(page.fetchUrls.some((u) => u.includes('cursor=CUR1'))).toBe(true);
    // An older page is the largest the API gives; the first page stays small so the page opens fast.
    expect(page.fetchUrls.find((u) => u.includes('cursor=CUR1'))).toContain('limit=100');
    expect(listRows(win)).toBe(4);
    expect(older.disabled).toBe(true);
    expect(older.hidden).toBe(true);
  });

  it('says how many entries are loaded, counts the matches of a search and marks them', async () => {
    const win = await boot(PAGES);
    const count = win.document.getElementById('count');
    expect(count?.textContent).toBe('Showing the 3 entries loaded so far.');
    const keyword = win.document.getElementById('f-keyword') as HTMLInputElement;
    keyword.value = 'PLAN 3';
    fire(win, keyword, 'input');
    expect(listRows(win)).toBe(1);
    expect(count?.textContent).toBe(
      '1 match in the 3 entries loaded so far. Load older to search further back.',
    );
    const marks = [...win.document.querySelectorAll('#thoughts mark')].map((m) => m.textContent);
    expect(marks).toEqual(['plan 3']);
    keyword.value = 'no-such-word';
    fire(win, keyword, 'input');
    expect(count?.textContent).toBe(
      'No matches in the 3 entries loaded so far. Load older to search further back.',
    );
    const empty = win.document.getElementById('empty') as HTMLElement;
    expect([empty.hidden, empty.textContent]).toEqual([
      false,
      'Nothing behind the glass matches that.',
    ]);
    keyword.value = '';
    fire(win, keyword, 'input');
    expect(listRows(win)).toBe(3);
    expect(empty.hidden).toBe(true);
    expect(win.document.querySelectorAll('#thoughts mark').length).toBe(0);
  });

  it('opens the detail under its entry on the time button, and closes it on the second press', async () => {
    const win = await boot(PAGES);
    const first = win.document.querySelector('#thoughts > li');
    const time = first?.querySelector('button.when') as HTMLButtonElement;
    fire(win, time, 'click');
    await settle();
    expect(page.fetchUrls).toContain('/api/thoughts/t1');
    expect(page.fetchUrls).toContain('/api/receipts?action_id=act-1');
    const detail = first?.querySelector('.detail');
    expect(detail?.querySelector('dl.facts')?.textContent).toContain('templatev1');
    expect(
      [...(detail?.querySelectorAll('.receipts > span') ?? [])].map((cell) => cell.textContent),
    ).toEqual(['place oak_planks \u00d74', 'committed', '']);
    expect(win.document.querySelectorAll('.detail').length).toBe(1);
    // Nothing is drawn outside the list: the detail is under the entry, not at the foot of the page.
    expect(win.document.querySelector('main > .detail, #detail')).toBeNull();
    fire(win, time, 'click');
    await settle();
    expect(win.document.querySelectorAll('.detail').length).toBe(0);
  });

  it('adds a live entry at the top without redrawing the others, so an open detail stays open', async () => {
    const win = await boot(PAGES);
    page.sources[0]?.onopen?.();
    const before = [...win.document.querySelectorAll('#thoughts > li')];
    fire(win, before[0]?.querySelector('button.when') ?? null, 'click');
    await settle();
    page.sources[0]?.emit('thought', thought(50));
    const after = [...win.document.querySelectorAll('#thoughts > li')];
    expect(after.length).toBe(4);
    expect(after[0]?.textContent).toContain('plan 50');
    // Only the entry that just arrived settles in; the rows already on the page do not move.
    expect(after.map((node) => node.className)).toEqual([
      'entry arrive',
      'entry',
      'entry',
      'entry',
    ]);
    // The same nodes, in the same order: a reader's place, selection and open detail are kept.
    expect(after.slice(1).every((node, i) => node === before[i])).toBe(true);
    expect(after[1]?.querySelector('.detail')).not.toBeNull();
    expect(win.document.getElementById('count')?.textContent).toBe(
      'Showing the 4 entries loaded so far.',
    );
    // A live entry the search does not match is kept but not drawn.
    const keyword = win.document.getElementById('f-keyword') as HTMLInputElement;
    keyword.value = 'plan 1';
    fire(win, keyword, 'input');
    page.sources[0]?.emit('thought', thought(51));
    expect(listRows(win)).toBe(1);
    expect(win.document.getElementById('count')?.textContent).toContain('1 match in the 5 entries');
  });

  it('redraws a thought that arrives a second time, instead of keeping its old row', async () => {
    const win = await boot(PAGES);
    page.sources[0]?.emit('thought', { ...thought(1), parsed: { plan: 'a newer plan' } });
    expect(listRows(win)).toBe(3);
    expect(win.document.querySelector('#thoughts > li')?.textContent).toContain('a newer plan');
    expect(win.document.getElementById('thoughts')?.textContent).not.toContain('plan 1');
  });

  it('colours the status by the state of the feed, and "/" puts the cursor in the search field', async () => {
    const win = await boot(PAGES);
    const control = win.document.getElementById('pause');
    expect(control?.className).toBe('pill connecting');
    page.sources[0]?.onopen?.();
    expect(control?.className).toBe('pill live');
    const keyword = win.document.getElementById('f-keyword');
    expect(win.document.activeElement).not.toBe(keyword);
    win.document.dispatchEvent(new win.KeyboardEvent('keydown', { key: '/', cancelable: true }));
    expect(win.document.activeElement).toBe(keyword);
  });

  it('reconnects with the backoff: 500 ms, then 1000 ms, and says Reconnecting in the meantime', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const win = await boot(PAGES);
    page.sources[0]?.onopen?.();
    page.sources[0]?.onerror?.();
    expect(win.document.getElementById('status')?.textContent).toBe('Reconnecting...');
    expect(win.document.getElementById('pause')?.className).toBe('pill reconnecting');
    expect(page.sources.length).toBe(1);
    await vi.advanceTimersByTimeAsync(499);
    expect(page.sources.length).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(page.sources.length).toBe(2);
    page.sources[1]?.onerror?.();
    await vi.advanceTimersByTimeAsync(999);
    expect(page.sources.length).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(page.sources.length).toBe(3);
    // The failed connection is closed before its retry, so only one stream is ever open.
    expect(page.sources[1]?.closed).toBe(true);
    expect(page.sources[2]?.closed).toBe(false);
  });

  /** Opens the detail of the entry at a position, where "Copy entry" is. */
  async function openDetail(win: Awaited<ReturnType<typeof boot>>, index: number) {
    fire(win, win.document.querySelectorAll('#thoughts > li button.when')[index] ?? null, 'click');
    await settle();
    return win.document.querySelectorAll('#thoughts > li')[index]?.querySelector('.detail');
  }

  it('has no "Copy entry" button where the browser gives the page no clipboard', async () => {
    const win = await boot(PAGES);
    expect(listRows(win)).toBe(3);
    expect(await openDetail(win, 0)).not.toBeNull();
    expect(win.document.querySelectorAll('button.copy').length).toBe(0);
  });

  it('copies an entry as plain text on a press of "Copy entry", says so, and puts the label back', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const written: string[] = [];
    const win = await boot(PAGES, {
      navigator: { clipboard: { writeText: async (text: string) => void written.push(text) } },
    });
    // The rows carry no copy control: it is in the detail, one press on the time away.
    expect(win.document.querySelectorAll('button.copy').length).toBe(0);
    const copy = (await openDetail(win, 0))?.querySelector('button.copy') as HTMLButtonElement;
    expect(copy.textContent).toBe('Copy entry');
    // Nothing is written until the reader presses the button.
    expect(written).toEqual([]);
    fire(win, copy, 'click');
    await settle();
    expect(written).toEqual(['Ada, 2026-11-10 00:00 UTC\nplan 1']);
    expect(copy.textContent).toBe('Copied');
    await vi.advanceTimersByTimeAsync(1499);
    expect(copy.textContent).toBe('Copied');
    await vi.advanceTimersByTimeAsync(1);
    expect(copy.textContent).toBe('Copy entry');
    // The hostile name goes to the clipboard as the same text the page shows.
    const second = (await openDetail(win, 1))?.querySelector('button.copy');
    fire(win, second ?? null, 'click');
    await settle();
    expect(written[1]).toBe(
      '<script>globalThis.__glassCanary=1</script>, 2026-11-10 00:00 UTC\nplan 2',
    );
  });

  it('says so when the browser refuses the copy', async () => {
    const win = await boot(PAGES, {
      navigator: { clipboard: { writeText: () => Promise.reject(new Error('denied')) } },
    });
    const copy = (await openDetail(win, 0))?.querySelector('button.copy') as HTMLButtonElement;
    fire(win, copy, 'click');
    await settle();
    expect(copy.textContent).toBe('Could not copy');
  });

  it('only ever writes plain text to the clipboard: no read, no markup, no legacy copy command', () => {
    const sources = [
      APP_JS,
      readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'),
      ...RENDER_MODULES.map((name) =>
        readFileSync(new URL(`../src/${name}.ts`, import.meta.url), 'utf8'),
      ),
    ].join('\n');
    expect(sources).toMatch(/clipboard\s*\.writeText\(/);
    expect(sources).not.toMatch(
      /readText|clipboard\s*\.read\b|clipboard\s*\.write\(|ClipboardItem/,
    );
    expect(sources).not.toMatch(
      /execCommand|text\/html|addEventListener\(\s*['"](copy|cut|paste)['"]/,
    );
  });

  it('is read-only: no request uses a method other than GET, and the banner says it is for humans', async () => {
    const win = await boot(PAGES);
    expect(APP_JS).not.toMatch(/method\s*:|sendBeacon|XMLHttpRequest|\bPOST\b|\bPUT\b|\bDELETE\b/);
    const text = win.document.body.textContent;
    expect(text).toContain('One-way glass. You can read; nothing you do here reaches the agents.');
    expect(text).not.toMatch(
      /you are being (watched|observed)|agents? (are|is) (being )?(watched|observed|told)|the audience/i,
    );
    for (const url of page.fetchUrls) expect(url.startsWith('/api/')).toBe(true);
  });

  it('says how old the newest shown thought is, from the delay the server wrote into the page', async () => {
    expect(INDEX_HTML).toContain('data-delay="0"');
    const win = await boot(PAGES, {
      html: INDEX_HTML.replace('data-delay="0"', 'data-delay="60"'),
    });
    const status = win.document.getElementById('status');
    page.sources[0]?.onopen?.();
    expect(status?.textContent).toBe('Live \u221260s');
    // The control names its action for a screen reader, after the state.
    expect(win.document.getElementById('pause')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Live \u221260s . Press to pause.',
    );
    // Anything but digits in the slot is no delay at all.
    const odd = await boot(PAGES, {
      html: INDEX_HTML.replace('data-delay="0"', 'data-delay="60<b>"'),
    });
    page.sources[0]?.onopen?.();
    expect(odd.document.getElementById('status')?.textContent).toBe('Live');
  });

  it('never draws more than 2000 rows: a live entry past the cap pushes the oldest off the page', async () => {
    const win = await boot(PAGES);
    for (let i = 100; i < 2097; i += 1) page.sources[0]?.emit('thought', thought(i));
    expect(listRows(win)).toBe(2000);
    expect(win.document.querySelector('#thoughts > li:last-child')?.textContent).toContain(
      'plan 3',
    );
    page.sources[0]?.emit('thought', thought(5000));
    expect(listRows(win)).toBe(2000);
    expect(win.document.querySelector('#thoughts > li')?.textContent).toContain('plan 5000');
    expect(win.document.querySelector('#thoughts > li:last-child')?.textContent).toContain(
      'plan 2',
    );
  });
});
