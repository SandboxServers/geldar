/** The roster search box and sort select: each asks the agents API and the count line takes its total. */
import type { HTMLInputElement, HTMLSelectElement, Window } from 'happy-dom';
import { afterEach, describe, expect, it } from 'vitest';
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
});
