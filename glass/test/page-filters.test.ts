/**
 * The agent chips of the page script, public/app.js, run in happy-dom (page-boot.ts): a press filters and
 * a second press clears, the pressed chip keeps the keyboard focus, the living come before the dead, and a
 * slow reply to an older press never overwrites the list of a newer one.
 */
import type { HTMLButtonElement } from 'happy-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { boot, cleanUp, fire, listRows, PAGES, page, settle, thought } from './page-boot.ts';

afterEach(cleanUp);

describe('the agent chips', () => {
  it('filters by agent on a press of its chip, keeps it in the URL, and clears it on a second press', async () => {
    const win = await boot(PAGES);
    const chip = (): HTMLButtonElement =>
      win.document.querySelectorAll('#chips button')[1] as HTMLButtonElement;
    fire(win, chip(), 'click');
    await settle();
    expect(page.fetchUrls.at(-1)).toBe('/api/thoughts?limit=50&agent=a1');
    expect(win.location.search).toBe('?agent=a1');
    expect([chip().className, chip().getAttribute('aria-pressed')]).toEqual(['chip on', 'true']);
    expect(win.document.querySelector('#chips button')?.getAttribute('aria-pressed')).toBe('false');
    // The chip that is on, pressed again, is "Everyone".
    fire(win, chip(), 'click');
    await settle();
    expect(page.fetchUrls.at(-1)).toBe('/api/thoughts?limit=50');
    expect(win.location.search).toBe('');
    expect(win.document.querySelector('#chips button.on')?.textContent).toBe('Everyone');
  });

  it('keeps the keyboard focus on the pressed chip, though the row is drawn again', async () => {
    const win = await boot(PAGES);
    const chip = (index: number): HTMLButtonElement =>
      win.document.querySelectorAll('#chips button')[index] as HTMLButtonElement;
    const before = chip(1);
    before.focus();
    fire(win, before, 'click');
    await settle();
    // The button is a new one, in the same place, and it has the focus.
    expect(chip(1)).not.toBe(before);
    expect(win.document.activeElement).toBe(chip(1));
    fire(win, chip(0), 'click');
    await settle();
    expect(win.document.activeElement).toBe(chip(0));
  });

  it('uses the reply to the latest filter change, whichever reply comes first', async () => {
    const win = await boot(PAGES);
    // From here every request waits until the test answers it.
    const waiting: { url: string; answer(thoughts: Record<string, unknown>[]): void }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (url: string) =>
          new Promise((resolve) => {
            waiting.push({
              url,
              answer: (thoughts) =>
                resolve({ ok: true, status: 200, json: async () => ({ thoughts, next: null }) }),
            });
          }),
      ),
    );
    const chips = (): HTMLButtonElement[] =>
      [...win.document.querySelectorAll('#chips button')] as HTMLButtonElement[];
    fire(win, chips()[1] ?? null, 'click');
    fire(win, chips()[2] ?? null, 'click');
    expect(waiting.map((request) => request.url)).toEqual([
      '/api/thoughts?limit=50&agent=a1',
      '/api/thoughts?limit=50&agent=a2',
    ]);
    // The second reply arrives first, then the slow first one.
    waiting[1]?.answer([{ ...thought(8), life_id: 'a2' }]);
    await settle();
    waiting[0]?.answer([
      { ...thought(5), life_id: 'a1' },
      { ...thought(6), life_id: 'a1' },
    ]);
    await settle();
    expect(listRows(win)).toBe(1);
    expect(win.document.querySelector('#thoughts > li')?.textContent).toContain('plan 8');
    expect(win.document.getElementById('count')?.textContent).toBe('Showing all 1 entry.');
  });

  it('drops an older page that arrives after the filters changed', async () => {
    const win = await boot(PAGES);
    const waiting: { url: string; answer(body: unknown): void }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (url: string) =>
          new Promise((resolve) => {
            waiting.push({
              url,
              answer: (body) => resolve({ ok: true, status: 200, json: async () => body }),
            });
          }),
      ),
    );
    fire(win, win.document.getElementById('older'), 'click');
    fire(win, win.document.querySelectorAll('#chips button')[1] ?? null, 'click');
    waiting[1]?.answer({ thoughts: [{ ...thought(8), life_id: 'a1' }], next: null });
    await settle();
    // The late page even holds an entry the new filter would show: it is still not this list's older page.
    waiting[0]?.answer({ thoughts: [{ ...thought(0), life_id: 'a1' }], next: 'CUR2' });
    await settle();
    expect(listRows(win)).toBe(1);
    expect(win.document.getElementById('thoughts')?.textContent).not.toContain('plan 0');
    // Nor does its cursor replace the new list's: there is no older page to load.
    expect((win.document.getElementById('older') as HTMLButtonElement).disabled).toBe(true);
  });

  it('lists the living agents before the dead ones in the filter row', async () => {
    const win = await boot({
      ...PAGES,
      agents: [
        { agent_id: 'a1', name: 'Mote', died_at: '2026-11-09' },
        { agent_id: 'a2', name: 'Ada' },
        { agent_id: 'a3', name: 'Bo' },
      ],
    });
    const names = [...win.document.querySelectorAll('#chips .chip-name')].map((n) => n.textContent);
    expect(names).toEqual(['Everyone', 'Ada', 'Bo', 'Mote']);
    // The position on the row still picks the right agent.
    fire(win, win.document.querySelectorAll('#chips button')[3] ?? null, 'click');
    await settle();
    expect(page.fetchUrls.at(-1)).toBe('/api/thoughts?limit=50&agent=a1');
  });
});
