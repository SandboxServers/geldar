/** The shipped page with the public agents reply and wide-screen profile requests. */
import type { HTMLInputElement, HTMLSelectElement, Window } from 'happy-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HOSTILE } from '../src/render-fixtures.ts';
import { display, whenLabel } from '../src/render-model.ts';
import { auditTree } from './audit.ts';
import { CORPUS } from './corpus.ts';
import { boot, cleanUp, fire, PAGES, type Pages, page, settle, thought } from './page-boot.ts';

afterEach(cleanUp);

const DIED = '2026-11-15T12:00:00.000Z';
const agents = [
  {
    agent_id: 'l1',
    name: 'Tess',
    life_seq: 2,
    mode: 'sovereign',
    born_day: 4,
    died_at: DIED,
    death_cause: 'fall',
  },
  { agent_id: 'l2', name: 'Zed', life_seq: 1, mode: 'headless', born_day: 0 },
  { agent_id: 'l3', name: 'Ada', life_seq: 3, mode: 'headless', born_day: 5 },
  { agent_id: 'l4', name: 'Wren', life_seq: 1, mode: 'headless', born_day: 1, died_at: DIED },
];
const pages: Pages = { ...PAGES, agents };
const wideScreen = () => ({ matches: true, listeners: [] as (() => void)[] });
const latest = (id: string) => `/api/thoughts?agent=${id}&limit=6`;
const profileRequests = () => page.fetchUrls.filter((url) => url.includes('limit=6'));
const profile = '#roster-profile';

function click(win: Window, selector: string, modifiers: { ctrlKey?: boolean } = {}): boolean {
  const event = new win.MouseEvent('click', { bubbles: true, cancelable: true, ...modifiers });
  const el = win.document.querySelector(selector);
  expect(el, selector).not.toBeNull();
  el?.dispatchEvent(event);
  return event.defaultPrevented;
}

function active(win: Window): string | undefined {
  const selected = win.document.querySelectorAll('.tabs [aria-current="page"]');
  expect(selected).toHaveLength(1);
  const id = selected[0]?.id;
  expect(win.document.querySelector('#glass-view')?.hasAttribute('hidden')).toBe(
    id !== 'tab-glass',
  );
  expect(win.document.querySelector('#roster-view')?.hasAttribute('hidden')).toBe(
    id !== 'tab-roster',
  );
  return id;
}

const text = (win: Window, selector: string) =>
  [...win.document.querySelectorAll(selector)].map((el) => el.textContent);

describe('the bottom navigation', () => {
  it.each([
    ['', 'tab-glass'],
    ['?view=glass', 'tab-glass'],
    ['?view=invalid', 'tab-glass'],
    ['?view=roster', 'tab-roster'],
  ])('reads the fixed view from the URL %s', async (search, tab) => {
    const win = await boot(pages, { search });
    expect(active(win)).toBe(tab);
  });

  it('switches in place, keeps filters and restores tab state with Back and Forward', async () => {
    const win = await boot(pages, { search: '?q=plan&agent=l2#bookmark' });
    expect(click(win, '#tab-roster')).toBe(true);
    expect(win.location.search).toBe('?q=plan&agent=l2&view=roster');
    expect(win.location.hash).toBe('#bookmark');
    expect(active(win)).toBe('tab-roster');
    expect(click(win, '#tab-roster')).toBe(true);
    expect(click(win, '#tab-glass')).toBe(true);
    expect(active(win)).toBe('tab-glass');
    expect(win.location.search).toBe('?q=plan&agent=l2');
    win.history.back();
    await settle();
    expect(active(win)).toBe('tab-roster');
    win.history.back();
    await settle();
    expect(active(win)).toBe('tab-glass');
    win.history.forward();
    await settle();
    expect(active(win)).toBe('tab-roster');
    expect(page.fetchUrls).toEqual(['/api/agents', '/api/thoughts?limit=50&agent=l2']);
  });

  it('leaves modified clicks to the browser and keeps the Map link out of view history', async () => {
    const win = await boot(pages);
    const passThrough: boolean[] = [];
    win.document.querySelector('.tabs')?.addEventListener('click', (event) => {
      passThrough.push(!event.defaultPrevented);
      event.preventDefault(); // These links would otherwise navigate the fake browser.
    });
    click(win, '#tab-roster', { ctrlKey: true });
    click(win, '.tabs a:nth-child(2)');
    expect(passThrough).toEqual([true, true]);
    expect(active(win)).toBe('tab-glass');
    expect(win.location.search).toBe('');
  });

  it('keeps the view when the filters rewrite the query', async () => {
    const win = await boot(pages, { search: '?view=roster&q=old' });
    const field = win.document.querySelector<HTMLInputElement>('#f-keyword');
    if (!field) throw new Error('Missing keyword field');
    field.value = 'new';
    fire(win, field, 'input');
    expect(win.location.search).toBe('?q=new&view=roster');
    expect(active(win)).toBe('tab-roster');
  });

  it('keeps the live feed running while Roster shows and displays fresh entries on return', async () => {
    const win = await boot(pages, { search: '?view=roster', wide: wideScreen() });
    expect(text(win, '#reader .plan')).toEqual([]);
    page.sources[0]?.emit('thought', thought(95));
    expect(text(win, '#reader .plan')).toEqual([]);
    expect(text(win, '#roster-profile h2')).toEqual([]);
    click(win, '#tab-glass');
    expect(text(win, '#thoughts > li:first-child .plan')).toEqual(['plan 95']);
    expect(text(win, '#fresh')).toEqual(['1 new entry']);
    expect(win.document.getElementById('fresh')?.hasAttribute('hidden')).toBe(false);
    expect(page.sources).toHaveLength(1);
  });
});

describe('Roster', () => {
  it('uses the existing agents reply and puts the living first in API order, with a count and three lines', async () => {
    const win = await boot(pages, { search: '?view=roster' });
    expect(text(win, '#roster-view h1, .roster-head .eyebrow')).toEqual([
      'Geldar · who lives here',
      'Roster',
    ]);
    expect(text(win, '.roster-group, .roster-row .roster-name')).toEqual([
      'Alive',
      'Zed',
      'Ada',
      'Dead',
      'Tess',
      'Wren',
    ]);
    expect(text(win, '#roster-count')).toEqual([
      '2 alive, 2 dead. One body per agent; a death ends the life.',
    ]);
    expect(text(win, '#roster-alive button:first-child .roster-text > span')).toEqual([
      'Zed',
      'life 1 · headless · born day 0',
      'alive',
    ]);
    expect(text(win, '#roster-dead button:first-child .roster-text > span')).toEqual([
      'Tess',
      'life 2 · sovereign · born day 4',
      `died ${new Date(DIED).toLocaleDateString()} — fall`,
    ]);
    expect(text(win, '#roster-dead button:last-child .roster-note')).toEqual([
      `died ${new Date(DIED).toLocaleDateString()}`,
    ]);
    expect(
      win.document.querySelectorAll('#roster-alive canvas.sigil-roster:not(.dead)'),
    ).toHaveLength(2);
    expect(win.document.querySelectorAll('#roster-dead canvas.sigil-roster.dead')).toHaveLength(2);
    expect(page.fetchUrls).toEqual(['/api/agents', '/api/thoughts?limit=50']);
  });

  it('on a phone opens the filtered Glass feed, clears search and lets Back restore it', async () => {
    const win = await boot(pages, { search: '?view=roster&q=plan&outcome=parsed' });
    click(win, '#roster-alive button');
    await settle();
    expect(active(win)).toBe('tab-glass');
    expect(win.location.search).toBe('?outcome=parsed&agent=l2');
    expect(win.document.activeElement).toBe(win.document.querySelector('#glass-view h1'));
    expect(page.fetchUrls.at(-1)).toBe('/api/thoughts?limit=50&agent=l2&outcome=parsed');
    expect(profileRequests()).toEqual([]);
    win.history.back();
    await settle();
    expect(active(win)).toBe('tab-roster');
    expect(win.location.search).toBe('?view=roster&q=plan&outcome=parsed');
    expect(win.document.querySelector<HTMLInputElement>('#f-keyword')?.value).toBe('plan');
    expect(page.fetchUrls.at(-1)).toBe('/api/thoughts?limit=50&outcome=parsed');
  });

  it('on a wide screen requests up to six entries only on selection, marks the row, and opens it in Glass on request', async () => {
    const at = '2026-11-10T00:00:00.000Z';
    const items = [
      thought(1),
      { ...thought(2), parsed: null },
      { ...thought(3), kind: 'journal', text: 'My journal.' },
      ...[4, 5, 6, 7].map((n) => thought(n)),
    ];
    const win = await boot(pages, {
      search: '?view=roster&q=plan',
      wide: wideScreen(),
      reply: (url) => (url === latest('l1') ? Promise.resolve({ thoughts: items }) : undefined),
    });
    expect(profileRequests()).toEqual([]);
    expect(text(win, `${profile} .note`)).toEqual(['Select an agent to see their latest entries.']);
    click(win, '#roster-dead button');
    click(win, '#roster-dead button');
    await settle();
    expect(profileRequests()).toEqual([latest('l1')]);
    expect(win.location.search).toBe('?view=roster&q=plan');
    expect(win.document.querySelectorAll('#roster-dead button[aria-current="true"]')).toHaveLength(
      1,
    );
    expect(win.document.querySelector(`${profile} .sigil-profile.dead`)).not.toBeNull();
    expect(
      text(win, `${profile} h2, ${profile} .roster-meta, ${profile} .roster-note, ${profile} h3`),
    ).toEqual([
      'Tess',
      'life 2 · sovereign · born day 4',
      `died ${new Date(DIED).toLocaleDateString()} — fall`,
      'Latest entries',
    ]);
    expect(text(win, '.roster-entry-text')).toEqual([
      'plan 1',
      'Unparsed reply.',
      'My journal.',
      'plan 4',
      'plan 5',
      'plan 6',
    ]);
    expect(text(win, '.roster-entry-text.bad, .roster-entry-text.journal')).toEqual([
      'Unparsed reply.',
      'My journal.',
    ]);
    const when = whenLabel(Date.parse(at), Date.now());
    expect(text(win, '.roster-entry-meta').slice(0, 3)).toEqual([
      `${when} · woke: w1`,
      `${when} · woke: w2`,
      `${when} · journal`,
    ]);
    click(win, '.roster-open');
    await settle();
    expect(active(win)).toBe('tab-glass');
    expect(win.location.search).toBe('?agent=l1');
    expect(page.fetchUrls).toContain('/api/thoughts?limit=50&agent=l1');
    expect(win.document.querySelector('#roster-dead button[aria-current]')).toBeNull();
  });

  it.each(['success', 'failure'])(
    'drops a stale %s and clears the profile on fold',
    async (result) => {
      const wide = wideScreen();
      let finish = () => {};
      const slow = new Promise((resolve, reject) => {
        finish = () => {
          if (result === 'success') resolve({ thoughts: [thought(21)] });
          else reject(new Error('unavailable'));
        };
      });
      const win = await boot(pages, {
        search: '?view=roster',
        wide,
        reply: (url) => {
          if (url === latest('l2')) return slow;
          if (url === latest('l3')) return Promise.resolve({ thoughts: [thought(11)] });
          return undefined;
        },
      });
      click(win, '#roster-alive button:first-child');
      expect(text(win, '.roster-results')).toEqual(['Loading entries…']);
      click(win, '#roster-alive button:last-child');
      await settle();
      finish();
      await settle();
      expect(text(win, `${profile} h2, .roster-entry-text`)).toEqual(['Ada', 'plan 11']);
      expect(text(win, '.roster-row[aria-current="true"] .roster-name')).toEqual(['Ada']);
      wide.matches = false;
      for (const listener of wide.listeners) listener();
      wide.matches = true;
      for (const listener of wide.listeners) listener();
      expect(text(win, `${profile} .note`)).toEqual([
        'Select an agent to see their latest entries.',
      ]);
      expect(text(win, '.roster-row[aria-current]')).toEqual([]);
      expect(profileRequests()).toEqual([latest('l2'), latest('l3')]);
    },
  );

  it('shows a profile failure and allows a press to retry, including an empty reply', async () => {
    let tries = 0;
    const win = await boot(pages, {
      search: '?view=roster',
      wide: wideScreen(),
      reply: (url) => {
        if (url !== latest('l2')) return undefined;
        tries += 1;
        return tries === 1
          ? Promise.reject(new Error('unavailable'))
          : Promise.resolve({ thoughts: [] });
      },
    });
    click(win, '#roster-alive button');
    await settle();
    expect(text(win, '.roster-results')).toEqual(['Could not load the latest entries.']);
    click(win, '#roster-alive button');
    await settle();
    expect(text(win, '.roster-results')).toEqual(['No entries yet.']);
    expect(profileRequests()).toEqual([latest('l2'), latest('l2')]);
  });

  it('reports an unavailable agents list without a misleading zero count', async () => {
    const win = await boot(pages, {
      search: '?view=roster',
      reply: (url) =>
        url === '/api/agents' ? Promise.reject(new Error('unavailable')) : undefined,
    });
    expect(text(win, '#roster-count')).toEqual(['Could not load the agents.']);
    expect(text(win, '.roster-name')).toEqual([]);
  });

  it('keeps a successful agents reply if the first thought page needs a retry', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let failed = false;
    const win = await boot(pages, {
      search: '?view=roster',
      reply: (url) => {
        if (failed || url !== '/api/thoughts?limit=50') return undefined;
        failed = true;
        return Promise.reject(new Error('unavailable'));
      },
    });
    await vi.advanceTimersByTimeAsync(500);
    await settle();
    expect(page.fetchUrls).toEqual([
      '/api/agents',
      '/api/thoughts?limit=50',
      '/api/thoughts?limit=50',
    ]);
    expect(text(win, '.roster-name')).toEqual(['Zed', 'Ada', 'Tess', 'Wren']);
  });

  it('reuses a pending agents request when a thought retry starts before it resolves', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let deliver: () => void = () => {};
    const pending = new Promise((resolve) => {
      deliver = () => resolve({ agents });
    });
    const win = await boot(pages, {
      search: '?view=roster',
      reply: (url) => {
        if (url === '/api/agents') return pending;
        if (url.includes('outcome=parsed')) return Promise.reject(new Error('unavailable'));
        return undefined;
      },
    });
    const outcome = win.document.querySelector<HTMLSelectElement>('#f-outcome');
    if (!outcome) throw new Error('Missing outcome field');
    outcome.value = 'parsed';
    fire(win, outcome, 'change');
    await settle();
    await vi.advanceTimersByTimeAsync(500);
    expect(page.fetchUrls.filter((url) => url === '/api/agents')).toHaveLength(1);
    deliver();
    await settle();
    expect(text(win, '.roster-name')).toEqual(['Zed', 'Ada', 'Tess', 'Wren']);
  });

  it('audits both builders against hostile names, modes, death causes, wake reasons and text', async () => {
    const values = [...HOSTILE, ...CORPUS.map(({ value }) => value)];
    const hostile = values.map((value, i) => ({
      ...agents[0],
      agent_id: `a${i}`,
      name: value,
      mode: value,
      death_cause: value,
    }));
    const win = await boot(
      { ...pages, agents: hostile },
      {
        search: '?view=roster',
        wide: wideScreen(),
        reply: (url) => {
          if (!url.includes('limit=6')) return undefined;
          const index = Number(new URLSearchParams(url.split('?')[1]).get('agent')?.slice(1));
          const value = values[index];
          return Promise.resolve({
            thoughts: [{ ...thought(index), wake_reason: value, parsed: { plan: value } }],
          });
        },
      },
    );
    const list = win.document.getElementById('roster-dead');
    const pane = win.document.getElementById('roster-profile');
    if (!list || !pane) throw new Error('Missing Roster panes');
    auditTree(list);
    expect(text(win, '#roster-dead .roster-name')).toEqual(values.map(display));
    const date = new Date(DIED).toLocaleDateString();
    for (const [i, value] of values.entries()) {
      const row = list.children[i];
      expect(row?.querySelector('.roster-meta')?.textContent).toBe(
        display(`life 2 · ${value} · born day 4`),
      );
      expect(row?.querySelector('.roster-note')?.textContent).toBe(
        display(`died ${date} — ${value}`),
      );
      fire(win, row ?? null, 'click');
      await settle();
      auditTree(pane);
      expect(
        text(
          win,
          `${profile} h2, ${profile} .roster-meta, ${profile} .roster-note, .roster-entry-text`,
        ),
      ).toEqual([
        display(value),
        display(`life 2 · ${value} · born day 4`),
        display(`died ${date} — ${value}`),
        display(value),
      ]);
      expect(pane.querySelector('.roster-entry-meta')?.textContent).toContain(
        display(value).slice(0, 40),
      );
    }
    expect(profileRequests()).toEqual(values.map((_value, i) => latest(`a${i}`)));
  });
});
