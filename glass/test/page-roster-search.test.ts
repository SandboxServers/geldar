/** The roster search box and sort select: each asks the agents API and the count line takes its total. */
import type { HTMLInputElement, HTMLSelectElement, Window } from 'happy-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { DEBOUNCE_MS } from '../src/render-roster.ts';
import { boot, cleanUp, PAGES, type Pages, page, settle } from './page-boot.ts';

afterEach(async () => {
  await cleanUp();
});

const agents = [
  { agent_id: 'l1', name: 'Tess', life_seq: 2, mode: 'headless', born_day: 4 },
  { agent_id: 'l2', name: 'Ada', life_seq: 1, mode: 'headless', born_day: 0 },
];
const pages: Pages = { ...PAGES, agents };

const count = (win: Window): string[] =>
  Array.from(win.document.querySelectorAll('#roster-count')).map((el) => el.textContent ?? '');

describe('Roster search and sort', () => {
  it('sends the trimmed search to the agents API and counts the matches from its total', async () => {
    const win = await boot(pages, { search: '?view=roster' });
    const search = win.document.querySelector('#roster-search') as HTMLInputElement;
    search.value = ' ada ';
    search.dispatchEvent(new win.Event('input'));
    await wait(DEBOUNCE_MS + 100);
    await settle();
    expect(page.fetchUrls).toContain('/api/agents?sort=name&q=ada');
    expect(count(win)).toEqual(['2 matching: 2 alive and 0 dead on this page.']);
  });

  it('asks for the latest-activity sort when the sort select changes', async () => {
    const win = await boot(pages, { search: '?view=roster' });
    const sort = win.document.querySelector('#roster-sort') as HTMLSelectElement;
    sort.value = 'latest';
    sort.dispatchEvent(new win.Event('change'));
    await settle();
    expect(page.fetchUrls).toContain('/api/agents?sort=latest');
  });

  it('waits for the typing to stop: three input events inside DEBOUNCE_MS ask the API once, with the last value', async () => {
    const win = await boot(pages, { search: '?view=roster' });
    const search = win.document.querySelector('#roster-search') as HTMLInputElement;
    for (const value of ['a', 'ad', 'ada']) {
      search.value = value;
      search.dispatchEvent(new win.Event('input'));
    }
    await wait(DEBOUNCE_MS + 100);
    await settle();
    expect(page.fetchUrls.filter((url) => url.includes('q='))).toEqual([
      '/api/agents?sort=name&q=ada',
    ]);
  });

  it('says when a rate-limited search clears, with the Retry-After wait (not the generic failure)', async () => {
    const win = await boot(pages, {
      search: '?view=roster',
      fail: (url) => (url.includes('q=') ? { status: 429, retryAfter: '30' } : undefined),
    });
    const search = win.document.querySelector('#roster-search') as HTMLInputElement;
    search.value = 'ada';
    search.dispatchEvent(new win.Event('input'));
    await wait(DEBOUNCE_MS + 100);
    await settle();
    expect(count(win)[0]).toContain('Try again in 30 seconds');
    expect(count(win)[0]).not.toContain('Could not search the agents.');
  });
});

/** Real time for the debounce: the page's timer is the real one, not the fake the tests stub elsewhere. */
function wait(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}
