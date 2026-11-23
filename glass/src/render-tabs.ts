/** Root-page navigation for Glass and Roster. Map is an ordinary external link. */
const VIEWS = ['glass', 'roster'] as const;
type View = (typeof VIEWS)[number];

export function readView(search: string): View {
  return new URLSearchParams(search).get('view') === 'roster' ? 'roster' : 'glass';
}

interface TabDeps {
  links: Record<View, HTMLAnchorElement>;
  panes: Record<View, HTMLElement>;
  win: Pick<Window, 'location' | 'history' | 'addEventListener'>;
  /** The document, whose title names the view: a screen reader and the tab strip both read it. */
  doc: { title: string };
  onChange(view: View, restoreFilters: boolean): void;
}

/** The title while the Roster shows. The Glass view keeps the title the page came with. */
export const ROSTER_TITLE = 'Glass: Roster';

export function createTabs({ links, panes, win, doc, onChange }: TabDeps) {
  let view = readView(win.location.search);
  const glassTitle = doc.title;

  function draw(restoreFilters: boolean): void {
    view = readView(win.location.search);
    for (const name of VIEWS) {
      panes[name].hidden = name !== view;
      if (name === view) links[name].setAttribute('aria-current', 'page');
      else links[name].removeAttribute('aria-current');
    }
    doc.title = view === 'roster' ? ROSTER_TITLE : glassTitle;
    onChange(view, restoreFilters);
  }

  function go(next: View, agent?: string): void {
    const params = new URLSearchParams(win.location.search);
    if (next === 'roster') params.set('view', next);
    else params.delete('view');
    if (agent !== undefined) {
      params.set('agent', agent);
      params.delete('q');
    }
    const query = params.toString();
    const url = `/${query === '' ? '' : `?${query}`}${win.location.hash}`;
    try {
      win.history.pushState(null, '', url);
    } catch {
      // If the browser refuses a burst of history writes, follow the address normally.
      win.location.assign(url);
      return;
    }
    draw(agent !== undefined);
  }

  for (const name of VIEWS) {
    links[name].addEventListener('click', (event) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey
      )
        return;
      event.preventDefault();
      if (name !== view) go(name);
    });
  }
  // Back and Forward change the view without a click: the keyboard user lands on the view's heading.
  function focusHeading(): void {
    const heading = panes[view].querySelector<HTMLElement>('h1');
    if (heading === null) return;
    heading.tabIndex = -1;
    heading.focus();
  }

  win.addEventListener('popstate', () => {
    draw(true);
    focusHeading();
  });

  return {
    start: () => draw(false),
    openInGlass(agent: string): void {
      go('glass', agent);
      panes.glass.querySelector<HTMLElement>('h1')?.focus();
    },
  };
}
