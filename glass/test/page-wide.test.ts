/**
 * The page script on a wide screen (an unfolded foldable): the reader pane beside the list, selection, and
 * what happens at a fold or an unfold. Also the two parts of the installable app the script wires up: the
 * install strip and the service worker's registration. Runs public/app.js in happy-dom (page-boot.ts).
 */
import type { HTMLElement } from 'happy-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { boot, cleanUp, fire, listRows, PAGES, page, settle, thought } from './page-boot.ts';

afterEach(cleanUp);

const wideScreen = () => ({ matches: true, listeners: [] as (() => void)[] });

/** The rows that carry the reader's mark. */
function selected(win: Awaited<ReturnType<typeof boot>>): string[] {
  return [...win.document.querySelectorAll('#thoughts > li.selected')].map(
    (row) => row.querySelector('.plan')?.textContent ?? '',
  );
}

describe('the page script on a wide screen', () => {
  it('shows the newest entry in the reader while nothing is selected, and marks its row', async () => {
    const win = await boot(PAGES, { wide: wideScreen() });
    const reader = win.document.getElementById('reader');
    expect(reader?.querySelector('h2.reader-name')?.textContent).toBe('Ada');
    expect(reader?.querySelector('p.plan')?.textContent).toBe('plan 1');
    expect(reader?.querySelector('.wake')?.textContent).toBe('woke: w1');
    expect(reader?.querySelector('dl.facts')?.textContent).toContain('templatev1');
    expect(selected(win)).toEqual(['plan 1']);
    expect(win.document.querySelector('#thoughts > li')?.getAttribute('aria-current')).toBe('true');
  });

  it('leaves the reader empty on a phone, and fetches nothing for it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const win = await boot(PAGES, { wide: { matches: false, listeners: [] } });
    await vi.advanceTimersByTimeAsync(5000);
    expect(win.document.getElementById('reader')?.children.length).toBe(0);
    expect(selected(win)).toEqual([]);
    expect(page.fetchUrls).toEqual(['/api/agents', '/api/thoughts?limit=50']);
  });

  it('waits before fetching the facts of an entry the reader only follows, so a burst costs one request', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const win = await boot(PAGES, { wide: wideScreen() });
    const detailFetches = () => page.fetchUrls.filter((url) => url.startsWith('/api/thoughts/'));
    await vi.advanceTimersByTimeAsync(799);
    expect(detailFetches()).toEqual([]);
    // Three entries arrive before the wait is over: the reader follows each, and asks for none of them.
    const three = [thought(7), thought(8), thought(9)];
    PAGES.first.push(...three);
    try {
      for (const row of three) page.sources[0]?.emit('thought', row);
      expect(win.document.querySelector('#reader p.plan')?.textContent).toBe('plan 9');
      expect(selected(win)).toEqual(['plan 9']);
      await vi.advanceTimersByTimeAsync(799);
      expect(detailFetches()).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      await settle();
      expect(detailFetches()).toEqual(['/api/thoughts/t9']);
      expect(page.fetchUrls).toContain('/api/receipts?action_id=act-1');
      expect(
        [...win.document.querySelectorAll('#reader .receipts > span')].map((n) => n.textContent),
      ).toEqual(['place oak_planks ×4', 'committed', '']);
    } finally {
      PAGES.first.splice(-3);
    }
  });

  it('selects an entry on a press anywhere in its row, fetches its facts at once, and opens nothing in place', async () => {
    const win = await boot(PAGES, { wide: wideScreen() });
    const rows = [...win.document.querySelectorAll('#thoughts > li')];
    fire(win, rows[2]?.querySelector('.plan') ?? null, 'click');
    await settle();
    expect(win.document.querySelector('#reader p.plan')?.textContent).toBe('plan 3');
    expect(selected(win)).toEqual(['plan 3']);
    expect(rows[0]?.hasAttribute('aria-current')).toBe(false);
    expect(page.fetchUrls).toContain('/api/thoughts/t3');
    expect(win.document.querySelector('#reader .receipts')).not.toBeNull();
    // The time selects too: a row never opens its detail in place here.
    fire(win, rows[1]?.querySelector('button.when') ?? null, 'click');
    await settle();
    expect(win.document.querySelector('#reader p.plan')?.textContent).toBe('plan 2');
    expect(win.document.querySelectorAll('#thoughts .detail').length).toBe(0);
    expect(win.document.querySelectorAll('#reader .detail').length).toBe(1);
    // And its facts are asked for once, by the reader: no second request for a detail that has no place.
    expect(page.fetchUrls.filter((url) => url === '/api/thoughts/t2')).toHaveLength(1);
  });

  it('keeps the selected entry while new ones arrive, and goes back to the newest when a filter hides it', async () => {
    const win = await boot(PAGES, { wide: wideScreen() });
    fire(win, win.document.querySelectorAll('#thoughts > li')[2] ?? null, 'click');
    await settle();
    page.sources[0]?.emit('thought', thought(50));
    expect(listRows(win)).toBe(4);
    expect(win.document.querySelector('#reader p.plan')?.textContent).toBe('plan 3');
    expect(selected(win)).toEqual(['plan 3']);
    const keyword = win.document.getElementById('f-keyword') as unknown as HTMLElement & {
      value: string;
    };
    keyword.value = 'plan 1';
    fire(win, keyword, 'input');
    expect(win.document.querySelector('#reader p.plan')?.textContent).toBe('plan 1');
    expect(selected(win)).toEqual(['plan 1']);
    // The reader marks the search too.
    expect([...win.document.querySelectorAll('#reader mark')].map((m) => m.textContent)).toEqual([
      'plan 1',
    ]);
    keyword.value = 'no-such-word';
    fire(win, keyword, 'input');
    expect(win.document.getElementById('reader')?.children.length).toBe(0);
  });

  it('follows the feed again on Escape and on the "new entries" press, after a row was selected', async () => {
    const win = await boot(PAGES, { wide: wideScreen() });
    const rows = () => [...win.document.querySelectorAll('#thoughts > li')];
    fire(win, rows()[2]?.querySelector('.plan') ?? null, 'click');
    await settle();
    expect(selected(win)).toEqual(['plan 3']);
    // Escape lets go of the entry: the reader shows the newest one again.
    win.document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape' }));
    expect(win.document.querySelector('#reader p.plan')?.textContent).toBe('plan 1');
    expect(selected(win)).toEqual(['plan 1']);
    // A thought arrives while paused and a row is selected; the "new entries" press resumes and follows the feed.
    fire(win, win.document.getElementById('pause'), 'click');
    page.sources[0]?.emit('thought', thought(50));
    fire(win, rows()[1]?.querySelector('.plan') ?? null, 'click');
    await settle();
    expect(selected(win)).toEqual(['plan 2']);
    fire(win, win.document.getElementById('fresh'), 'click');
    expect(win.document.querySelector('#reader p.plan')?.textContent).toBe('plan 50');
    expect(selected(win)).toEqual(['plan 50']);
  });

  it('copies the reader entry from its "Copy entry" button', async () => {
    const written: string[] = [];
    const win = await boot(PAGES, {
      wide: wideScreen(),
      navigator: { clipboard: { writeText: async (text: string) => void written.push(text) } },
    });
    fire(win, win.document.querySelector('#reader button.copy'), 'click');
    await settle();
    expect(written).toEqual(['Ada, 2026-11-10 00:00 UTC\nplan 1']);
    expect(win.document.querySelector('#thoughts button.copy')).toBeNull();
  });

  it('closes a detail open in place when the screen unfolds, and empties the reader when it folds', async () => {
    const screen = { matches: false, listeners: [] as (() => void)[] };
    const win = await boot(PAGES, { wide: screen });
    fire(win, win.document.querySelector('#thoughts > li button.when'), 'click');
    await settle();
    expect(win.document.querySelectorAll('#thoughts .detail').length).toBe(1);
    expect(screen.listeners).toHaveLength(1);
    screen.matches = true;
    for (const listener of screen.listeners) listener();
    expect(win.document.querySelectorAll('#thoughts .detail').length).toBe(0);
    expect(win.document.querySelector('#reader p.plan')?.textContent).toBe('plan 1');
    expect(selected(win)).toEqual(['plan 1']);
    screen.matches = false;
    for (const listener of screen.listeners) listener();
    expect(win.document.getElementById('reader')?.children.length).toBe(0);
    expect(selected(win)).toEqual([]);
    // Folded again, the time opens the detail in place as before.
    fire(win, win.document.querySelector('#thoughts > li button.when'), 'click');
    await settle();
    expect(win.document.querySelectorAll('#thoughts .detail').length).toBe(1);
  });
});

describe('the installable app', () => {
  it('keeps the install strip hidden until the browser offers an install, and opens the browser prompt on "Install"', async () => {
    const win = await boot(PAGES);
    const strip = win.document.getElementById('install') as HTMLElement;
    expect(strip.hidden).toBe(true);
    const offer = Object.assign(new win.Event('beforeinstallprompt', { cancelable: true }), {
      prompt: vi.fn(),
    });
    win.dispatchEvent(offer);
    expect(strip.hidden).toBe(false);
    expect(offer.defaultPrevented).toBe(true);
    expect(strip.textContent).toContain(
      'Install Glass to open it full screen, without the address bar.',
    );
    fire(win, win.document.getElementById('install-yes'), 'click');
    expect(offer.prompt).toHaveBeenCalledTimes(1);
    expect(strip.hidden).toBe(true);
  });

  it('remembers "Not now" in the page storage and does not offer again', async () => {
    const kept = new Map<string, string>();
    const store = {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => void kept.set(key, value),
    };
    const win = await boot(PAGES, { localStorage: store });
    const offer = () =>
      win.dispatchEvent(Object.assign(new win.Event('beforeinstallprompt'), { prompt: vi.fn() }));
    const strip = win.document.getElementById('install') as HTMLElement;
    offer();
    expect(strip.hidden).toBe(false);
    fire(win, win.document.getElementById('install-no'), 'click');
    expect(strip.hidden).toBe(true);
    expect([...kept]).toEqual([['glass.install.dismissed', '1']]);
    offer();
    expect(strip.hidden).toBe(true);
  });

  it('opens as an empty shell without a network, and fills in once the feed is back', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const network = { down: true };
    const win = await boot(PAGES, { network });
    const older = win.document.getElementById('older') as HTMLElement;
    const empty = win.document.getElementById('empty') as HTMLElement;
    expect(listRows(win)).toBe(0);
    // Nothing is claimed about a list that never arrived: no "Load older", no "nothing matches".
    expect([older.hidden, empty.hidden]).toEqual([true, true]);
    page.sources[0]?.onerror?.();
    const status = win.document.getElementById('status');
    expect(status?.textContent).toBe('Reconnecting...');
    // The first page is asked for again and fails again: the control still says the feed is reconnecting.
    await vi.advanceTimersByTimeAsync(500);
    await settle();
    expect(page.fetchUrls.filter((url) => url === '/api/thoughts?limit=50')).toHaveLength(2);
    expect(status?.textContent).toBe('Reconnecting...');
    // The network returns: the feed reconnects after its backoff, and the page asks for its first page again.
    network.down = false;
    page.sources[1]?.onopen?.();
    await settle();
    expect(listRows(win)).toBe(3);
    expect(older.hidden).toBe(false);
    expect(win.document.querySelectorAll('#chips button').length).toBe(3);
    // Once loaded, a later reconnect does not ask for the first page again.
    const fetched = page.fetchUrls.length;
    page.sources[1]?.onopen?.();
    await settle();
    expect(page.fetchUrls.length).toBe(fetched);
  });

  it('asks again for a first page that failed five times with a growing wait, then only when the feed comes back', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const network = { down: true };
    const win = await boot(PAGES, { network });
    const asked = (): number =>
      page.fetchUrls.filter((url) => url === '/api/thoughts?limit=50').length;
    expect(asked()).toBe(1);
    // The waits are 0.5, 1, 2, 4 and 8 seconds: one request at the end of each, and none before.
    let total = 1;
    for (const wait of [500, 1000, 2000, 4000, 8000]) {
      await vi.advanceTimersByTimeAsync(wait - 1);
      await settle();
      expect(asked(), `before ${wait} ms`).toBe(total);
      await vi.advanceTimersByTimeAsync(1);
      await settle();
      total += 1;
      expect(asked(), `after ${wait} ms`).toBe(total);
    }
    expect(total).toBe(6);
    // Past the fifth, nothing more on a timer: a page that cannot load does not ask for ever.
    await vi.advanceTimersByTimeAsync(120_000);
    await settle();
    expect(asked()).toBe(6);
    expect(win.document.getElementById('status')?.textContent).not.toBe('Live');
    // The feed coming back is the one thing that asks again.
    network.down = false;
    const latest = page.sources.at(-1);
    latest?.onopen?.();
    await settle();
    expect(asked()).toBe(7);
    expect(listRows(win)).toBe(3);
  });

  it('asks again by itself when the first page failed though the feed is live', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const network = { down: true };
    const win = await boot(PAGES, { network });
    // The feed is up and stays up; only the first page fails (a refusal, a server error).
    page.sources[0]?.onopen?.();
    await settle();
    // The feed coming up asks once more at once; that fails too, and with the feed live the control says what failed.
    const status = win.document.getElementById('status');
    expect(page.fetchUrls.filter((url) => url === '/api/thoughts?limit=50')).toHaveLength(2);
    expect(status?.textContent).toBe('Could not load thoughts.');
    expect(listRows(win)).toBe(0);
    network.down = false;
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(listRows(win)).toBe(3);
    expect(status?.textContent).toBe('Live');
  });

  it('registers the service worker for the whole origin, and works the same where there is none', async () => {
    const register = vi.fn(async () => undefined);
    await boot(PAGES, { navigator: { serviceWorker: { register } } });
    expect(register.mock.calls).toEqual([['/js/sw.js', { scope: '/' }]]);
    const refused = vi.fn(() => Promise.reject(new Error('not allowed')));
    const win = await boot(PAGES, { navigator: { serviceWorker: { register: refused } } });
    expect(refused).toHaveBeenCalledTimes(1);
    expect(listRows(win)).toBe(3);
  });
});
