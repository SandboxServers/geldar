/**
 * The Thought Stream page: the first page of thoughts, the live feed, the search and filters, pause
 * and resume, the detail under an entry, "copy" and "load older". Plain browser JavaScript. The render
 * modules come from /js/ with their types stripped. Every value from the API reaches the page
 * through the escaped view in render-view.ts, and nothing here parses markup.
 */
import {
  appendOlder,
  countLabel,
  filterQuery,
  filterThoughts,
  LIST_CAP,
  pushThought,
  readFilters,
  toView,
} from '/js/render-model.ts';
import { createStreamClient } from '/js/render-stream.ts';
import { fillAgentOptions, renderDetail, renderNote, renderRow } from '/js/render-view.ts';

const PAGE_SIZE = 50;
/** An older page is the largest the API gives, so a search reaches back faster. */
const OLDER_PAGE_SIZE = 100;
const STATUS_TEXT = {
  connecting: 'Connecting...',
  live: 'Live',
  reconnecting: 'Reconnecting...',
  paused: 'Paused',
  closed: 'Closed',
};

const els = {
  fresh: document.getElementById('fresh'),
  say: document.getElementById('say'),
  status: document.getElementById('status'),
  agent: document.getElementById('f-agent'),
  outcome: document.getElementById('f-outcome'),
  template: document.getElementById('f-template'),
  range: document.getElementById('f-range'),
  keyword: document.getElementById('f-keyword'),
  pause: document.getElementById('pause'),
  count: document.getElementById('count'),
  list: document.getElementById('thoughts'),
  older: document.getElementById('older'),
};

const state = {
  fresh: 0,
  list: [], // thoughts, newest first, at most LIST_CAP
  pending: [], // thoughts that arrived while paused, newest first, at most LIST_CAP
  paused: false,
  next: null, // cursor for "load older", or null when there is no older page
  agents: new Map(),
  agentIds: [], // option position -> agent id, filled from /api/agents
  streamText: STATUS_TEXT.connecting,
  rows: new Map(), // thought id -> its drawn row, kept so a redraw leaves an open entry open
  details: new Map(), // thought id -> the detail open under its row
  loading: new Set(), // thought ids whose detail is being fetched
  drawnKeyword: '', // the keyword the kept rows were drawn with (they carry its marks)
  drawnDay: '', // the day the kept rows were drawn on (they show "today" times)
};

/** The agent filter's selected agent id, or '' for every agent. */
function selectedAgent() {
  if (els.agent.value === '') return '';
  return state.agentIds[Number(els.agent.value)] ?? '';
}

/** The start of the chosen time range in epoch ms, or undefined for all loaded thoughts. */
function sinceMs() {
  const range = Number(els.range.value);
  return range > 0 ? Date.now() - range : undefined;
}

/** Every filter as the page has it now. */
function currentFilter() {
  return {
    agentId: selectedAgent() || undefined,
    outcome: els.outcome.value || undefined,
    templateVersion: els.template.value.trim() || undefined,
    sinceMs: sinceMs(),
    keyword: els.keyword.value.trim() || undefined,
  };
}

/** URL values are validated before they reach form controls. */
function restoreFilters() {
  const filter = readFilters(window.location.search, state.agentIds);
  els.keyword.value = filter.q;
  els.template.value = filter.template;
  els.outcome.value = filter.outcome;
  els.range.value = filter.range;
  els.agent.value = filter.agent;
  if (filter.outcome || filter.template) document.querySelector('details.more').open = true;
}

function saveFilters() {
  clearFresh();
  const query = filterQuery({
    q: els.keyword.value.trim(),
    agent: selectedAgent(),
    range: els.range.value,
    outcome: els.outcome.value,
    template: els.template.value.trim(),
  });
  // A browser may refuse a burst of URL updates (Safari throws past 100 in 30 seconds). The filter
  // still applies; only the address bar lags.
  try {
    window.history.replaceState(null, '', window.location.pathname + query + window.location.hash);
  } catch {
    // Nothing to do: the next change tries again.
  }
}

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
  const agent = selectedAgent();
  if (agent !== '') params.set('agent', agent);
  if (els.outcome.value !== '') params.set('outcome', els.outcome.value);
  const since = sinceMs();
  if (since !== undefined) params.set('since', new Date(since).toISOString());
  if (cursor !== null) params.set('cursor', cursor);
  return `/api/thoughts?${params.toString()}`;
}

/**
 * Tells a screen reader a short change, through the polite live region in index.html. Only changes a
 * reader would want to hear go here: never one per live entry.
 */
function say(text) {
  els.say.textContent = text;
}

/** A failure the reader should know about: shown in the status line, and said. */
function showError(text) {
  els.status.textContent = text;
  say(text);
}

function updateStatus() {
  const waiting = state.paused ? `, ${state.pending.length} waiting` : '';
  els.status.textContent = `${state.streamText}${waiting}`;
}

/** The line under the filters: how many entries are shown, and how far a search has reached. */
function updateCount(shown) {
  const narrowed = els.keyword.value.trim() !== '' || els.template.value.trim() !== '';
  els.count.textContent = countLabel(shown, state.list.length, narrowed, state.next !== null);
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
 * Without it no entry gets a "Copy" button.
 */
const CAN_COPY =
  typeof navigator === 'object' && typeof navigator.clipboard?.writeText === 'function';
const COPY_LABEL_MS = 2000;

/** True when the browser supports hidden="until-found", so find-in-page reaches a folded journal line. */
const FINDABLE = typeof HTMLElement === 'function' && 'onbeforematch' in HTMLElement.prototype;

/**
 * Puts one entry on the reader's clipboard as plain text, on their click. The page only ever writes
 * text, never markup, and never reads the clipboard. `setLabel` sets the button's label; the result is
 * said too, since a screen reader may not read out a label that changes under focus.
 */
function copyEntry(text, setLabel) {
  const tell = (label) => {
    setLabel(label);
    say(label);
    window.setTimeout(() => {
      setLabel('Copy');
      // Emptied, so the next copy is said again even though its words are the same.
      if (els.say.textContent === label) say('');
    }, COPY_LABEL_MS);
  };
  navigator.clipboard.writeText(text).then(
    () => tell('Copied'),
    () => tell('Could not copy'),
  );
}

function drawRow(view, keyword) {
  return renderRow(document, view, toggleDetail, {
    death: state.agents.get(view.agentId),
    nowMs: Date.now(),
    keyword,
    onCopy: CAN_COPY ? copyEntry : undefined,
    findable: FINDABLE,
  });
}

/** Draws the list: the loaded thoughts that pass every filter, newest first. */
function render() {
  const filter = currentFilter();
  const keyword = filter.keyword ?? '';
  refreshKept(keyword);
  const shown = filterThoughts(state.list, filter);
  const rows = new Map();
  for (const view of shown) rows.set(view.id, state.rows.get(view.id) ?? drawRow(view, keyword));
  state.rows = rows;
  for (const id of [...state.details.keys()]) if (!rows.has(id)) state.details.delete(id);
  els.list.replaceChildren(...rows.values());
  els.older.disabled = state.next === null;
  updateCount(shown.length);
  updateStatus();
}

/**
 * Adds one live thought at the top without redrawing the rest, so the reader's place, selection and
 * open entries stay put. False when the list needs the full redraw instead.
 */
function drawLive(view) {
  const filter = currentFilter();
  const keyword = filter.keyword ?? '';
  const stale = keyword !== state.drawnKeyword || new Date().toDateString() !== state.drawnDay;
  if (stale || state.rows.has(view.id) || state.list.length >= LIST_CAP) return false;
  if (filterThoughts([view], filter).length === 1) {
    const row = drawRow(view, keyword);
    state.rows.set(view.id, row);
    els.list.prepend(row);
  }
  updateCount(state.rows.size);
  updateStatus();
  return true;
}

/** Replaces the list with the first page, using the current server-side filters. */
async function reload() {
  clearFresh();
  try {
    const page = await getJson(thoughtsPath(null));
    state.list = page.thoughts.map(toView).slice(0, LIST_CAP);
    state.next = page.next;
    state.rows.clear();
    state.details.clear();
    render();
  } catch {
    showError('Could not load thoughts.');
  }
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
    showError('Could not load older thoughts.');
    els.older.disabled = state.next === null;
  }
}

/** The detail of one thought: its facts and the receipts of its action, or a note when it fails. */
async function loadDetail(id) {
  // A journal line has no thought record to fetch: its detail is the row already loaded.
  const loaded = state.list.find((view) => view.id === id);
  if (loaded !== undefined && loaded.kind === 'journal')
    return renderDetail(document, loaded, [], state.agents.get(loaded.agentId));
  try {
    const { thought } = await getJson(`/api/thoughts/${encodeURIComponent(id)}`);
    const receipts =
      typeof thought.action_id === 'string'
        ? (await getJson(`/api/receipts?action_id=${encodeURIComponent(thought.action_id)}`))
            .receipts
        : [];
    const view = toView(thought);
    return renderDetail(document, view, receipts, state.agents.get(view.agentId));
  } catch {
    return renderNote(document, 'Could not load this thought.');
  }
}

/** Opens the detail under its entry, or closes it when it is open. */
async function toggleDetail(id) {
  const row = state.rows.get(id);
  if (row === undefined || state.loading.has(id)) return;
  const open = state.details.get(id);
  const toggle = row.querySelector('button.when');
  if (open !== undefined) {
    open.remove();
    state.details.delete(id);
    toggle?.setAttribute('aria-expanded', 'false');
    return;
  }
  state.loading.add(id);
  const detail = await loadDetail(id);
  state.loading.delete(id);
  // The row was redrawn while the detail loaded: the answer belongs to a row that is gone.
  if (state.rows.get(id) !== row) return;
  state.details.set(id, detail);
  row.append(detail);
  toggle?.setAttribute('aria-expanded', 'true');
}

/** Only newly drawn, matching entries count while the list top is above the viewport. */
function countFresh(view) {
  if (els.list.getBoundingClientRect().top >= 0) return clearFresh();
  if (state.list.some((entry) => entry.id === view.id)) return;
  if (filterThoughts([view], currentFilter()).length === 0) return;
  state.fresh += 1;
  els.fresh.textContent = state.fresh === 1 ? '1 new entry' : `${state.fresh} new entries`;
  els.fresh.hidden = false;
  // Said once when the button appears, not again for every entry that raises its count.
  if (state.fresh === 1) say('New entries at the top of the list.');
}

function clearFresh() {
  state.fresh = 0;
  els.fresh.hidden = true;
}

/** A live thought: shown at once, or held (capped) while the feed is paused. */
function onThought(data) {
  if (typeof data !== 'object' || data === null) return;
  const view = toView(data);
  if (state.paused) {
    state.pending = pushThought(state.pending, view);
    updateStatus();
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
      countFresh(view);
      state.list = pushThought(state.list, view);
      state.rows.delete(view.id);
      state.details.delete(view.id);
    }
    state.pending = [];
  }
  els.pause.textContent = state.paused ? 'Resume' : 'Pause';
  render();
}

/** Fills the agent filter from the agents list. */
async function loadAgents() {
  const { agents } = await getJson('/api/agents');
  state.agents = new Map(agents.map((agent) => [String(agent.agent_id), agent]));
  state.agentIds = agents.map((agent) => String(agent.agent_id));
  fillAgentOptions(
    document,
    els.agent,
    agents.map((agent) => String(agent.name ?? '')),
    agents.map((agent) => agent.died_at != null),
  );
}

/** "/" puts the cursor in the search field, unless the reader is already typing in a field. */
function onKey(event) {
  if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
  const tag = document.activeElement?.tagName ?? '';
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  event.preventDefault();
  els.keyword.focus();
}

function start() {
  els.fresh.addEventListener('click', () => {
    window.scrollTo(0, 0);
    clearFresh();
  });
  window.addEventListener(
    'scroll',
    () => {
      if (els.list.getBoundingClientRect().top >= 0) clearFresh();
    },
    { passive: true },
  );

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
      const text = STATUS_TEXT[status] ?? status;
      // The status line is not a live region, so its waiting count is not read out per entry.
      if (text !== state.streamText) say(text);
      state.streamText = text;
      // The class colours the dot beside the text. It is one of the fixed names above.
      els.status.className = status in STATUS_TEXT ? `status ${status}` : 'status';
      updateStatus();
    },
  });

  // Server-side filters reload the first page; the text filters only narrow the loaded list.
  els.agent.addEventListener('change', () => {
    saveFilters();
    reload();
  });
  els.outcome.addEventListener('change', () => {
    saveFilters();
    reload();
  });
  els.range.addEventListener('change', () => {
    saveFilters();
    reload();
  });
  els.template.addEventListener('input', () => {
    saveFilters();
    render();
  });
  els.keyword.addEventListener('input', () => {
    saveFilters();
    render();
  });
  els.pause.addEventListener('click', togglePause);
  els.older.addEventListener('click', loadOlder);
  document.addEventListener('keydown', onKey);

  live.start();
  loadAgents()
    .catch(() => {
      showError('Could not load the agents.');
    })
    .then(() => {
      restoreFilters();
      return reload();
    });
}

start();
