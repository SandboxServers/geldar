/**
 * The reader pane of the wide layout: which entry it shows, the mark on that entry's row, and when the
 * entry's facts are fetched. It shows the selected entry, or the newest one on the page while nothing is
 * selected. Every page object, clock and fetch is passed in, so it is tested with fakes
 * (render-reader.test.ts). The nodes come from render-detail.ts; nothing here builds markup.
 *
 * This file is served to the browser after type stripping, so it stays erasable TypeScript.
 */
import { type DetailOptions, renderDetail, renderReaderHead } from './render-detail.ts';
import { type Row, readerEntry, type ThoughtView } from './render-model.ts';
import { type Doc, type El, renderNote } from './render-view.ts';

/**
 * How long the newest entry must stay the newest before its facts are fetched. While nothing is selected
 * the reader follows the feed, and a burst of entries would otherwise spend one request each from the
 * reader's rate limit (60 a minute by default). A selected entry is fetched at once.
 */
export const FOLLOW_MS = 800;

/** A row of the list, as the reader marks it. */
export interface ReaderRow {
  classList: { add(name: string): void; remove(name: string): void };
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

export interface ReaderFacts {
  view: ThoughtView;
  /** The receipts of the entry's action; null when the entry names no action. */
  receipts: Row[] | null;
  /** How many of the action's receipt requests failed. They are named in the detail, not hidden. */
  unloaded?: number;
}

export interface ReaderDeps {
  doc: Doc;
  pane: El & { scrollTop: number };
  /** True while the wide layout is showing. On a phone the pane is empty and nothing is fetched. */
  isWide(): boolean;
  /**
   * True while another view covers the page. The reader then does nothing and keeps what it has, so coming
   * back costs no request. Left out: never suspended.
   */
  suspended?: () => boolean;
  rowOf(id: string): ReaderRow | undefined;
  /** The entries on the page, newest first. */
  shown(): ThoughtView[];
  options(view: ThoughtView): DetailOptions;
  loadFacts(view: ThoughtView): Promise<ReaderFacts>;
  timers: { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(id: unknown): void };
}

export interface Reader {
  /** Selects an entry: the reader shows it until it leaves the page. */
  select(id: string): void;
  /** Brings the pane in line with the page. Called after every change to the list or the layout. */
  draw(): void;
}

type Swappable = El & { replaceWith(node: El): void };

export function createReader(deps: ReaderDeps): Reader {
  let selectedId = '';
  let current: ThoughtView | null = null;
  let keyword = '';
  let facts: ReaderFacts | null = null;
  let failed = false;
  let detail: Swappable | null = null;
  let marked: ReaderRow | null = null;
  let timer: unknown = null;
  /** Counts entries shown; an answer for an entry that is no longer in the pane is dropped. */
  let turn = 0;

  function mark(row: ReaderRow | null): void {
    if (marked === row) return;
    marked?.classList.remove('selected');
    marked?.removeAttribute('aria-current');
    row?.classList.add('selected');
    row?.setAttribute('aria-current', 'true');
    marked = row;
  }

  /** Builds the pane from what is known now: the entry, and its facts once they have arrived. */
  function paint(view: ThoughtView): void {
    const journal = view.kind === 'journal';
    const shown = facts?.view ?? view;
    const receipts = facts !== null ? facts.receipts : journal ? [] : null;
    const unloaded = facts?.unloaded;
    const options = { ...deps.options(shown), unloaded };
    const next = renderDetail(deps.doc, shown, receipts, options) as Swappable;
    if (failed) next.append(renderNote(deps.doc, 'Could not load this thought.'));
    detail = next;
    deps.pane.replaceChildren(...renderReaderHead(deps.doc, view, deps.options(view)), next);
  }

  function fetchFacts(view: ThoughtView, mine: number): void {
    timer = null;
    deps.loadFacts(view).then(
      (loaded) => {
        if (mine !== turn) return;
        facts = loaded;
        const next = renderDetail(deps.doc, loaded.view, loaded.receipts, {
          ...deps.options(loaded.view),
          unloaded: loaded.unloaded,
        }) as Swappable;
        detail?.replaceWith(next);
        detail = next;
      },
      () => {
        if (mine !== turn) return;
        failed = true;
        detail?.append(renderNote(deps.doc, 'Could not load this thought.'));
      },
    );
  }

  function clear(): void {
    if (timer !== null) deps.timers.clearTimeout(timer);
    timer = null;
    turn += 1;
    current = null;
    facts = null;
    failed = false;
    detail = null;
  }

  function draw(): void {
    if (deps.suspended?.() === true) return;
    if (!deps.isWide()) {
      if (current !== null) deps.pane.replaceChildren();
      mark(null);
      clear();
      return;
    }
    const view = readerEntry(deps.shown(), selectedId) ?? null;
    // The row may have been drawn again since the last call: mark the one on the page now.
    mark(view === null ? null : (deps.rowOf(view.id) ?? null));
    const word = view === null ? '' : (deps.options(view).keyword ?? '');
    if (view === current) {
      // The same entry under another search: only its marks change, and nothing is fetched again.
      if (view !== null && word !== keyword) {
        keyword = word;
        paint(view);
      }
      return;
    }
    clear();
    current = view;
    keyword = word;
    if (view === null) {
      deps.pane.replaceChildren();
      return;
    }
    paint(view);
    deps.pane.scrollTop = 0;
    if (view.kind === 'journal') return;
    const mine = turn;
    if (view.id === selectedId) fetchFacts(view, mine);
    else timer = deps.timers.setTimeout(() => fetchFacts(view, mine), FOLLOW_MS);
  }

  return {
    select(id: string): void {
      // A second press on the selected entry, or '' (Escape, the "new entries" press), follows the feed again.
      selectedId = id === '' || id === selectedId ? '' : id;
      draw();
    },
    draw,
  };
}
