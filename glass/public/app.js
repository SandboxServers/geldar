/**
 * The Thought Stream page: the first page of thoughts, the live feed, the search and filters, pause
 * and resume, the detail under an entry, "copy" and "load older". On a wide screen the selected entry
 * is shown in the reader pane (render-reader.ts). Plain browser JavaScript. The render modules come from /js/
 * with their types stripped. Every value from the API reaches the page through the escaped view in
 * render-view.ts and render-detail.ts, and nothing here parses markup.
 */

import { COPY_LABEL, renderDetail } from '/js/render-detail.ts';
import { createFilters } from '/js/render-filters.ts';
import { registerWorker, setUpInstall } from '/js/render-install.ts';
import {
  appendOlder,
  countLabel,
  filterThoughts,
  freshLabel,
  LIST_CAP,
  pushThought,
  readDelay,
  statusLabel,
  toView,
} from '/js/render-model.ts';
import { createReader } from '/js/render-reader.ts';
import { createStreamClient } from '/js/render-stream.ts';
import { renderNote, renderRow } from '/js/render-view.ts';

const PAGE_SIZE = 50;
/** An older page is the largest the API gives, so a search reaches back faster. */
const OLDER_PAGE_SIZE = 100;
/** The stream states the status control has a colour for. Each is a class name on it. */
const STATES = ['connecting', 'live', 'reconnecting', 'paused', 'closed'];
/** From this width the list shares the screen with the reader pane (reader.css has the same number). */
const WIDE = '(min-width: 700px)';

const byId = (id) => document.getElementById(id);
const els = {
  fresh: byId('fresh'),
  status: byId('status'),
  pause: byId('pause'),
  pauseHint: byId('pause-hint'),
  chips: byId('chips'),
  outcome: byId('f-outcome'),
  template: byId('f-template'),
  range: byId('f-range'),
  keyword: byId('f-keyword'),
  more: document.querySelector('details.more'),
  count: byId('count'),
  scroller: byId('scroller'),
  pane: document.querySelector('.stream'),
  list: byId('thoughts'),
  empty: byId('empty'),
  older: byId('older'),
  reader: byId('reader'),
};

const state = {
  fresh: 0,
  list: [], // thoughts, newest first, at most LIST_CAP
  shown: [], // the thoughts of `list` that pass every filter, as drawn
  pending: [], // thoughts that arrived while paused, newest first, at most LIST_CAP
  paused: false,
  loaded: false, // true once the first page has arrived
  firstFailed: false, // true when the first page could not be fetched: it is asked for again once the feed is live
  next: null, // cursor for "load older", or null when there is no older page
  stream: 'connecting',
  delay: readDelay(els.pause.getAttribute('data-delay')),
  rows: new Map(), // thought id -> its drawn row, kept so a redraw leaves an open entry open
  details: new Map(), // thought id -> the detail open under its row
  loading: new Set(), // thought ids whose detail is being fetched
  drawnKeyword: '', // the keyword the kept rows were drawn with (they carry its marks)
  drawnDay: '', // the day the kept rows were drawn on (they show "today" times)
};

/** The layout is CSS; the script only asks which one is showing, to open an entry in place or in the reader. */
const wideQuery = typeof window.matchMedia === 'function' ? window.matchMedia(WIDE) : null;
const isWide = () => wideQuery?.matches === true;

/** The search, the agent chips, the filters under "More" and the URL that remembers them. */
const filters = createFilters({
  doc: document,
  keyword: els.keyword,
  template: els.template,
  outcome: els.outcome,
  range: els.range,
  more: els.more,
  chips: els.chips,
  location: window.location,
  history: window.history,
  now: () => Date.now(),
  onReload: () => {
    clearFresh();
    reload();
  },
  onNarrow: () => {
    clearFresh();
    render();
  },
});

async function getJson(path) {
  const res = await fetch(path, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** The first page, or the page after `cursor`, with the server-side filters applied. */
function thoughtsPath(cursor) {
  const params = new URLSearchParams({
    limit: String(cursor === null ? PAGE_SIZE : OLDER_PAGE_SIZE),
  });
  filters.addTo(params);
  if (cursor !== null) params.set('cursor', cursor);
  return `/api/thoughts?${params.toString()}`;
}

/** The one control for the feed: its dot and words say the state, and a press pauses or resumes. */
function updateStatus() {
  const name = state.paused ? 'paused' : state.stream;
  els.pause.className = STATES.includes(name) ? `pill ${name}` : 'pill';
  els.pause.setAttribute('aria-pressed', state.paused ? 'true' : 'false');
  els.status.textContent = statusLabel(name, state.delay);
  els.pauseHint.textContent = state.paused ? '. Press to resume.' : '. Press to pause.';
  updateFresh();
}

/** The line under the filters: how many entries are shown, and how far a search has reached. */
function updateCount(shown) {
  els.count.textContent = countLabel(
    shown,
    state.list.length,
    filters.narrowed(),
    state.next !== null,
  );
  els.empty.hidden = !state.loaded || shown > 0;
}

/** Forgets the kept rows when they would be stale: another keyword to mark, or another day. */
function refreshKept(keyword) {
  const day = new Date().toDateString();
  if (keyword === state.drawnKeyword && day === state.drawnDay) return;
  state.rows.clear();
  state.details.clear();
  state.drawnKeyword = keyword;
  state.drawnDay = day;
}

/**
 * True when this browser lets a page write to the clipboard (a secure context with the Clipboard API).
 * Without it no entry gets a "Copy entry" button.
 */
const CAN_COPY =
  typeof navigator === 'object' && typeof navigator.clipboard?.writeText === 'function';
const COPY_LABEL_MS = 1500;

/**
 * Puts one entry on the reader's clipboard as plain text, on their click. The page only ever writes
 * text, never markup, and never reads the clipboard. `say` sets the button's label.
 */
function copyEntry(text, say) {
  navigator.clipboard
    .writeText(text)
    .then(
      () => say('Copied'),
      () => say('Could not copy'),
    )
    .then(() => window.setTimeout(() => say(COPY_LABEL), COPY_LABEL_MS));
}

/** What a row, a detail and the reader need to know about an entry's agent, and the page's own callbacks. */
function entryOptions(view, keyword) {
  const agent = filters.agent(view.agentId);
  return {
    death: agent,
    mode: typeof agent?.mode === 'string' ? agent.mode : undefined,
    nowMs: Date.now(),
    keyword,
    onCopy: CAN_COPY ? copyEntry : undefined,
    onSelect: (id) => {
      if (isWide()) reader.select(id);
    },
  };
}

function drawRow(view, keyword) {
  return renderRow(document, view, toggleDetail, entryOptions(view, keyword));
}

/** The facts of one thought and the receipts of its action, fresh from the API. */
async function loadFacts(view) {
  // A journal line has no thought record to fetch: its facts are the row already loaded.
  if (view.kind === 'journal') return { view, receipts: [] };
  const { thought } = await getJson(`/api/thoughts/${encodeURIComponent(view.id)}`);
  const full = toView(thought);
  // Without an action the page cannot ask for receipts, and says nothing about them (null).
  const receipts =
    full.actionId === ''
      ? null
      : (await getJson(`/api/receipts?action_id=${encodeURIComponent(full.actionId)}`)).receipts;
  return { view: full, receipts };
}

const reader = createReader({
  doc: document,
  pane: els.reader,
  isWide,
  rowOf: (id) => state.rows.get(id),
  shown: () => state.shown,
  options: (view) => entryOptions(view, state.drawnKeyword),
  loadFacts,
  timers: {
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (id) => window.clearTimeout(id),
  },
});

/** Draws the list: the loaded thoughts that pass every filter, newest first. */
function render() {
  const filter = filters.current();
  const keyword = filter.keyword ?? '';
  refreshKept(keyword);
  const shown = filterThoughts(state.list, filter);
  const rows = new Map();
  for (const view of shown) rows.set(view.id, state.rows.get(view.id) ?? drawRow(view, keyword));
  state.rows = rows;
  state.shown = shown;
  for (const id of [...state.details.keys()]) if (!rows.has(id)) state.details.delete(id);
  els.list.replaceChildren(...rows.values());
  els.older.disabled = state.next === null;
  els.older.hidden = state.next === null;
  updateCount(shown.length);
  updateStatus();
  reader.draw();
}

/**
 * Adds one live thought at the top without redrawing the rest, so the reader's place, selection and
 * open entries stay put. False when the list needs the full redraw instead.
 */
function drawLive(view) {
  const filter = filters.current();
  const keyword = filter.keyword ?? '';
  const stale = keyword !== state.drawnKeyword || new Date().toDateString() !== state.drawnDay;
  if (stale || state.rows.has(view.id) || state.list.length >= LIST_CAP) return false;
  if (filterThoughts([view], filter).length === 1) {
    const row = drawRow(view, keyword);
    // The entry settles in from a blur (entries.css); a reader who asked for less motion sees it at once.
    row.classList.add('arrive');
    state.rows.set(view.id, row);
    state.shown = [view, ...state.shown];
    els.list.prepend(row);
  }
  updateCount(state.rows.size);
  updateStatus();
  reader.draw();
  return true;
}

/** Replaces the list with the first page, using the current server-side filters. */
async function reload() {
  clearFresh();
  try {
    const page = await getJson(thoughtsPath(null));
    state.list = page.thoughts.map(toView).slice(0, LIST_CAP);
    state.next = page.next;
    state.loaded = true;
    state.rows.clear();
    state.details.clear();
    render();
  } catch {
    if (!state.loaded) state.firstFailed = true;
    els.status.textContent = 'Could not load thoughts.';
  }
}

/** The agents, then the first page. A bookmark's filters are read from the URL in between. */
function loadFirst() {
  return getJson('/api/agents')
    .then(({ agents }) => filters.setAgents(agents))
    .catch(() => {
      els.status.textContent = 'Could not load the agents.';
    })
    .then(() => {
      // A bookmarked agent may sit far along the row: bring its chip into view.
      filters.restore().scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      return reload();
    });
}

/** Adds the next page after the cursor. The list stays capped; the oldest rows drop off. */
async function loadOlder() {
  if (state.next === null) return;
  els.older.disabled = true;
  try {
    const page = await getJson(thoughtsPath(state.next));
    state.list = appendOlder(state.list, page.thoughts.map(toView));
    state.next = page.next;
    render();
  } catch {
    els.status.textContent = 'Could not load older thoughts.';
    els.older.disabled = state.next === null;
  }
}

/** The detail of one thought: its facts and the receipts of its action, or a note when it fails. */
async function loadDetail(id) {
  const loaded = state.list.find((view) => view.id === id);
  if (loaded === undefined) return renderNote(document, 'Could not load this thought.');
  try {
    const { view, receipts } = await loadFacts(loaded);
    return renderDetail(document, view, receipts, entryOptions(view, state.drawnKeyword));
  } catch {
    return renderNote(document, 'Could not load this thought.');
  }
}

/** On a phone: opens the detail under its entry, or closes it when it is open. Wide screens use the reader. */
async function toggleDetail(id) {
  if (isWide()) return;
  const row = state.rows.get(id);
  if (row === undefined || state.loading.has(id)) return;
  const open = state.details.get(id);
  if (open !== undefined) {
    open.remove();
    state.details.delete(id);
    return;
  }
  state.loading.add(id);
  const detail = await loadDetail(id);
  state.loading.delete(id);
  // The row was redrawn while the detail loaded, or the screen was unfolded: the answer has no place.
  if (state.rows.get(id) !== row || isWide()) return;
  state.details.set(id, detail);
  row.append(detail);
}

/** Crossing the breakpoint (a fold or an unfold): details open in place give way to the reader, and back. */
function onLayout() {
  if (isWide()) {
    for (const detail of state.details.values()) detail.remove();
    state.details.clear();
  }
  reader.draw();
}

/** True when the top of the list is out of sight: scrolled under the header, or off the screen. */
function away() {
  const top = els.list.getBoundingClientRect().top;
  return top < 0 || top < els.scroller.getBoundingClientRect().top - 1;
}

function toTop() {
  els.scroller.scrollTop = 0;
  els.pane.scrollTop = 0;
}

/** The "new entries" control: what waits behind a pause, or what arrived above while the reader was away. */
function updateFresh() {
  const count = state.paused
    ? filterThoughts(state.pending, filters.current()).length
    : state.fresh;
  els.fresh.textContent = freshLabel(count);
  els.fresh.hidden = count === 0;
}

/** Only newly drawn, matching entries count while the list top is out of sight. */
function countFresh(view) {
  if (!away()) return clearFresh();
  if (state.list.some((entry) => entry.id === view.id)) return;
  if (filterThoughts([view], filters.current()).length === 0) return;
  state.fresh += 1;
  updateFresh();
}

function clearFresh() {
  state.fresh = 0;
  updateFresh();
}

/** A live thought: shown at once, or held (capped) while the feed is paused. */
function onThought(data) {
  if (typeof data !== 'object' || data === null) return;
  const view = toView(data);
  if (state.paused) {
    state.pending = pushThought(state.pending, view);
    updateFresh();
    return;
  }
  countFresh(view);
  state.list = pushThought(state.list, view);
  if (drawLive(view)) return;
  // A second copy of a thought replaces the first, so its kept row is stale.
  state.rows.delete(view.id);
  state.details.delete(view.id);
  render();
}

/** Pause holds new thoughts in a capped buffer; resume puts them in the list, oldest first. */
function togglePause() {
  state.paused = !state.paused;
  if (!state.paused) {
    for (const view of [...state.pending].reverse()) {
      state.list = pushThought(state.list, view);
      state.rows.delete(view.id);
      state.details.delete(view.id);
    }
    state.pending = [];
  }
  render();
}

/** "/" puts the cursor in the search field, unless the reader is already typing in a field. */
function onKey(event) {
  if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
  const tag = document.activeElement?.tagName ?? '';
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  event.preventDefault();
  els.keyword.focus();
}

/** The page's storage, or null where the browser refuses it (a private window). Only the install strip uses it. */
function storage() {
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

function start() {
  // Pressing "new entries" shows them: it resumes a paused feed, and goes to the top of the list.
  els.fresh.addEventListener('click', () => {
    if (state.paused) togglePause();
    toTop();
    clearFresh();
  });
  const onScroll = () => {
    if (!state.paused && !away()) clearFresh();
  };
  for (const target of [els.scroller, els.pane, window]) {
    target.addEventListener('scroll', onScroll, { passive: true });
  }
  wideQuery?.addEventListener?.('change', onLayout);

  const live = createStreamClient({
    url: '/api/stream',
    open: EventSource,
    timers: {
      setTimeout: (fn, ms) => window.setTimeout(fn, ms),
      clearTimeout: (id) => window.clearTimeout(id),
    },
    page: window,
    onThought,
    onStatus: (status) => {
      state.stream = status;
      updateStatus();
      // The page opened without a network (the installed app, offline): the feed is back, so the list is too.
      if (status === 'live' && state.firstFailed) {
        state.firstFailed = false;
        loadFirst();
      }
    },
  });

  els.pause.addEventListener('click', togglePause);
  els.older.addEventListener('click', loadOlder);
  document.addEventListener('keydown', onKey);

  setUpInstall({
    strip: byId('install'),
    yes: byId('install-yes'),
    no: byId('install-no'),
    win: window,
    store: storage(),
  });
  registerWorker(typeof navigator === 'object' ? navigator : undefined);

  live.start();
  loadFirst();
}

start();
