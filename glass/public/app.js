import { copier, renderDetail } from '/js/render-detail.ts';
import { createFilters } from '/js/render-filters.ts';
import { registerWorker, setUpInstall } from '/js/render-install.ts';
import {
  appendOlder,
  backoffMs,
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
import { createRoster } from '/js/render-roster.ts';
import { createStreamClient } from '/js/render-stream.ts';
import { createTabs } from '/js/render-tabs.ts';
import { renderNote, renderRow } from '/js/render-view.ts';

const PAGE_SIZE = 50;
/** An older page is the largest the API gives, so a search reaches back faster. */
const OLDER_PAGE_SIZE = 100;
const STATES = ['connecting', 'live', 'reconnecting', 'paused', 'closed'];
/** From this width the list shares the screen with the reader pane (reader.css has the same number). */
const WIDE = '(min-width: 700px)';

const byId = (id) => document.getElementById(id);
const glassView = byId('glass-view');
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
  firstFailed: false, // true when the first page could not be fetched and has not been asked for again
  firstTries: 0, // how many times a failed first page was asked for again on a timer
  asked: 0, // counts requests for the first page: a reply that is not for the latest one is dropped
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

function thoughtsPath(cursor) {
  const params = new URLSearchParams({
    limit: String(cursor === null ? PAGE_SIZE : OLDER_PAGE_SIZE),
  });
  filters.addTo(params);
  if (cursor !== null) params.set('cursor', cursor);
  return `/api/thoughts?${params.toString()}`;
}

function updateStatus() {
  const name = state.paused ? 'paused' : state.stream;
  els.pause.className = STATES.includes(name) ? `pill ${name}` : 'pill';
  els.pause.setAttribute('aria-pressed', state.paused ? 'true' : 'false');
  els.status.textContent = statusLabel(name, state.delay);
  els.pauseHint.textContent = state.paused ? '. Press to resume.' : '. Press to pause.';
  updateFresh();
}

/** Says that a request failed, unless the feed is down too: "Reconnecting..." is then the truer word. */
function sayFailed(message) {
  if (state.stream === 'connecting' || state.stream === 'reconnecting') return;
  els.status.textContent = message;
}

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

const copyEntry = copier(typeof navigator === 'object' ? navigator.clipboard : undefined, {
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
});

function entryOptions(view, keyword) {
  const agent = filters.agent(view.agentId);
  return {
    death: agent,
    mode: typeof agent?.mode === 'string' ? agent.mode : undefined,
    nowMs: Date.now(),
    keyword,
    onCopy: copyEntry,
    onSelect: (id) => {
      if (isWide()) reader.select(id);
    },
  };
}

function drawRow(view, keyword) {
  return renderRow(document, view, toggleDetail, entryOptions(view, keyword));
}

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
  isWide: () => isWide() && !glassView.hidden,
  rowOf: (id) => state.rows.get(id),
  shown: () => state.shown,
  options: (view) => entryOptions(view, state.drawnKeyword),
  loadFacts,
  timers: {
    setTimeout: (fn, ms) => window.setTimeout(fn, ms),
    clearTimeout: (id) => window.clearTimeout(id),
  },
});

const roster = createRoster({
  doc: document,
  count: byId('roster-count'),
  alive: byId('roster-alive'),
  dead: byId('roster-dead'),
  profile: byId('roster-profile'),
  isWide,
  openInGlass: (id) => tabs.openInGlass(id),
  loadLatest: getJson,
  now: Date.now,
});
const tabs = createTabs({
  links: { glass: byId('tab-glass'), roster: byId('tab-roster') },
  panes: { glass: glassView, roster: byId('roster-view') },
  win: window,
  onChange(view, restoreFilters) {
    if (view === 'glass') roster.clear();
    if (restoreFilters && filters.restore()) {
      render();
      reload();
    } else reader.draw();
  },
});

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

// Add a thought without redrawing open entries or moving the reader's place.
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

// Only the latest first-page request can replace the list.
async function reload() {
  clearFresh();
  state.asked += 1;
  const mine = state.asked;
  try {
    const page = await getJson(thoughtsPath(null));
    if (mine !== state.asked) return;
    state.list = page.thoughts.map(toView).slice(0, LIST_CAP);
    state.next = page.next;
    state.loaded = true;
    state.rows.clear();
    state.details.clear();
    render();
  } catch {
    if (mine !== state.asked) return;
    sayFailed('Could not load thoughts.');
    if (!state.loaded) retryFirstLater();
  }
}

const FIRST_TRIES = 5;

/** Asks again for a failed first page a few times, then only when the feed comes back: never for ever. */
function retryFirstLater() {
  state.firstFailed = true;
  if (state.firstTries >= FIRST_TRIES) return;
  window.setTimeout(retryFirst, backoffMs(state.firstTries));
  state.firstTries += 1;
}

function retryFirst() {
  if (!state.firstFailed) return;
  state.firstFailed = false;
  loadFirst();
}

let agentsReady;
async function loadFirst() {
  agentsReady ??= getJson('/api/agents')
    .then(({ agents }) => {
      filters.setAgents(agents);
      roster.setAgents(agents);
    })
    .catch(() => {
      agentsReady = undefined;
      sayFailed('Could not load the agents.');
      roster.unavailable();
    });
  await agentsReady;
  filters.restore();
  return reload();
}

async function loadOlder() {
  if (state.next === null) return;
  els.older.disabled = true;
  const mine = state.asked;
  try {
    const page = await getJson(thoughtsPath(state.next));
    // The filters changed while the older page was on its way: it belongs to a list that is gone.
    if (mine !== state.asked) return;
    state.list = appendOlder(state.list, page.thoughts.map(toView));
    state.next = page.next;
    render();
  } catch {
    sayFailed('Could not load older thoughts.');
    els.older.disabled = state.next === null;
  }
}

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

function onLayout() {
  if (isWide()) {
    for (const detail of state.details.values()) detail.remove();
    state.details.clear();
  } else roster.clear();
  reader.draw();
}

/** True when the top of the list is out of sight: scrolled under the header, or off the screen. */
function away() {
  if (glassView.hidden) return true;
  const top = els.list.getBoundingClientRect().top;
  return top < 0 || top < els.scroller.getBoundingClientRect().top - 1;
}

function toTop() {
  els.scroller.scrollTop = 0;
  els.pane.scrollTop = 0;
}

function updateFresh() {
  const count = state.paused
    ? filterThoughts(state.pending, filters.current()).length
    : state.fresh;
  els.fresh.textContent = freshLabel(count);
  els.fresh.hidden = count === 0;
}

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
  if (glassView.hidden || event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey)
    return;
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
  tabs.start();
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
      if (status === 'live') retryFirst();
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
