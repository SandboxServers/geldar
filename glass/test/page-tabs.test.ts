/**
 * The page script when the reader moves between the Glass view and the Roster: the document title, the
 * fallback when the browser refuses a history entry, the "/" shortcut, and the reader pane keeping what it
 * has while the Roster covers it. Runs public/app.js in happy-dom (page-boot.ts). The tab bar's own tests,
 * and the Roster's, are in page-roster.test.ts.
 */
import type { Window } from 'happy-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { boot, cleanUp, page, PAGES as pages, settle } from './page-boot.ts';

afterEach(cleanUp);

const wideScreen = () => ({ matches: true, listeners: [] as (() => void)[] });

/** A plain press of the main button. */
function click(win: Window, selector: string): void {
  const el = win.document.querySelector(selector);
  expect(el, selector).not.toBeNull();
  el?.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
}

/** The id of the tab that is marked as the current view. */
function active(win: Window): string | undefined {
  return win.document.querySelector('.tabs [aria-current="page"]')?.id;
}

const text = (win: Window, selector: string) =>
  [...win.document.querySelectorAll(selector)].map((el) => el.textContent);

describe('the view the reader is on', () => {
  it('names the view in the document title, so a screen reader and the tab strip say which shows', async () => {
    const win = await boot(pages);
    win.document.title = 'Glass: Thought Stream';
    click(win, '#tab-roster');
    expect(win.document.title).toBe('Glass: Roster');
    click(win, '#tab-glass');
    expect(win.document.title).not.toBe('Glass: Roster');
  });

  it('follows the address when the browser refuses a history entry', async () => {
    const win = await boot(pages, { search: '?q=plan' });
    const assign = vi.fn();
    win.location.assign = assign;
    win.history.pushState = () => {
      throw new Error('SecurityError: too many calls');
    };
    click(win, '#tab-roster');
    // The link still works: a plain navigation to the same address, on this origin.
    expect(assign.mock.calls).toEqual([['/?q=plan&view=roster']]);
    expect(active(win)).toBe('tab-glass');
  });

  it('keeps "/" for the search field of the Glass view: it does nothing on the Roster', async () => {
    const win = await boot(pages, { search: '?view=roster' });
    const keyword = win.document.getElementById('f-keyword');
    const press = () => {
      const event = new win.KeyboardEvent('keydown', { key: '/', cancelable: true });
      win.document.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(press()).toBe(false);
    expect(win.document.activeElement).not.toBe(keyword);
    click(win, '#tab-glass');
    expect(press()).toBe(true);
    expect(win.document.activeElement).toBe(keyword);
  });

  it('keeps what the reader pane has while the Roster covers it: coming back asks for nothing', async () => {
    const win = await boot(pages, { wide: wideScreen() });
    const details = () => page.fetchUrls.filter((url) => url.startsWith('/api/thoughts/t'));
    click(win, '#thoughts > li:nth-child(3)');
    await settle();
    expect(details()).toEqual(['/api/thoughts/t3']);
    for (let trip = 0; trip < 3; trip += 1) {
      click(win, '#tab-roster');
      click(win, '#tab-glass');
      await settle();
    }
    expect(details()).toEqual(['/api/thoughts/t3']);
    expect(text(win, '#reader p.plan')).toEqual(['plan 3']);
  });
});
