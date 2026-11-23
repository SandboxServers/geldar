import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import { createTabs } from './render-tabs.ts';

/** The two views of the page, each with its heading, in a real DOM at the given address. */
function setUp(address: string) {
  const win = new Window({ url: `http://127.0.0.1${address}` });
  const doc = win.document;
  const make = (name: string) => {
    const pane = doc.createElement('main');
    const heading = doc.createElement('h1');
    heading.textContent = name;
    pane.appendChild(heading);
    doc.body.appendChild(pane);
    return pane;
  };
  const link = () => doc.createElement('a') as unknown as HTMLAnchorElement;
  const panes = { glass: make('Glass'), roster: make('Roster') };
  const links = { glass: link(), roster: link() };
  const changes: string[] = [];
  const tabs = createTabs({
    links,
    panes: panes as unknown as Record<'glass' | 'roster', HTMLElement>,
    win: win as unknown as Pick<Window, 'location' | 'history' | 'addEventListener'>,
    doc: doc as unknown as { title: string },
    onChange: (view) => changes.push(view),
  });
  return { win, doc, panes, tabs, changes };
}

describe('focus after Back and Forward', () => {
  it('moves focus to the heading of the view that the history entry shows', () => {
    const page = setUp('/?view=roster');
    page.tabs.start();
    // The Back button: the address changes to the Glass view and the browser fires popstate.
    page.win.history.replaceState(null, '', '/');
    page.win.dispatchEvent(new page.win.Event('popstate'));
    expect(page.changes).toEqual(['roster', 'glass']);
    expect(page.doc.activeElement?.textContent).toBe('Glass');
    // Forward again: the Roster heading takes the focus.
    page.win.history.replaceState(null, '', '/?view=roster');
    page.win.dispatchEvent(new page.win.Event('popstate'));
    expect(page.doc.activeElement?.textContent).toBe('Roster');
  });

  it('leaves the focus where it is when the view has no heading', () => {
    const page = setUp('/');
    page.tabs.start();
    page.panes.roster.querySelector('h1')?.remove();
    const before = page.doc.activeElement;
    page.win.history.replaceState(null, '', '/?view=roster');
    page.win.dispatchEvent(new page.win.Event('popstate'));
    expect(page.doc.activeElement).toBe(before);
  });
});
