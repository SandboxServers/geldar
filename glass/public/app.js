/**
 * The Thought Stream page: the first page of thoughts, the live feed, the filters, pause and
 * resume, the per-agent view and "load older". Plain browser JavaScript. The render modules come
 * from /js/ with their types stripped. Every value from the API reaches the page through the
 * escaped view in render-view.ts, and nothing here parses markup.
 */
import { appendOlder, filterThoughts, LIST_CAP, pushThought, toView } from '/js/render-model.ts';
import { createStreamClient } from '/js/render-stream.ts';
import { fillAgentOptions, renderDetail, renderNote, renderRow } from '/js/render-view.ts';

const PAGE_SIZE = 50;
const STATUS_TEXT = {
  connecting: 'Connecting...',
  live: 'Live',
  reconnecting: 'Reconnecting...',
  paused: 'Paused',
  closed: 'Closed',
};

const els = {
  status: document.getElementById('status'),
  agent: document.getElementById('f-agent'),
  outcome: document.getElementById('f-outcome'),
  template: document.getElementById('f-template'),
  range: document.getElementById('f-range'),
  keyword: document.getElementById('f-keyword'),
  pause: document.getElementById('pause'),
  list: document.getElementById('thoughts'),
  older: document.getElementById('older'),
  detail: document.getElementById('detail'),
};

const state = {
  list: [], // thoughts, newest first, at most LIST_CAP
  pending: [], // thoughts that arrived while paused, newest first, at most LIST_CAP
  paused: false,
  next: null, // cursor for "load older", or null when there is no older page
  agentIds: [], // option position -> agent id, filled from /api/agents
  streamText: STATUS_TEXT.connecting,
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

async function getJson(path) {
  const res = await fetch(path, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** The first page, or the page after `cursor`, with the server-side filters applied. */
function thoughtsPath(cursor) {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  const agent = selectedAgent();
  if (agent !== '') params.set('agent', agent);
  if (els.outcome.value !== '') params.set('outcome', els.outcome.value);
  const since = sinceMs();
  if (since !== undefined) params.set('since', new Date(since).toISOString());
  if (cursor !== null) params.set('cursor', cursor);
  return `/api/thoughts?${params.toString()}`;
}

function updateStatus() {
  const waiting = state.paused ? `, ${state.pending.length} waiting` : '';
  els.status.textContent = `${state.streamText}${waiting}`;
}

/** Draws the list: the loaded thoughts that pass every filter, newest first. */
function render() {
  const filter = {
    agentId: selectedAgent() || undefined,
    outcome: els.outcome.value || undefined,
    templateVersion: els.template.value.trim() || undefined,
    sinceMs: sinceMs(),
    keyword: els.keyword.value.trim() || undefined,
  };
  const shown = filterThoughts(state.list, filter);
  const rows = shown.map((view) => renderRow(document, view, openThought));
  els.list.replaceChildren(...rows);
  els.older.disabled = state.next === null;
  updateStatus();
}

/** Replaces the list with the first page, using the current server-side filters. */
async function reload() {
  try {
    const page = await getJson(thoughtsPath(null));
    state.list = page.thoughts.map(toView).slice(0, LIST_CAP);
    state.next = page.next;
    render();
  } catch {
    els.status.textContent = 'Could not load thoughts.';
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
    els.status.textContent = 'Could not load older thoughts.';
    els.older.disabled = state.next === null;
  }
}

/** Opens one thought in the detail panel. */
async function openThought(id) {
  try {
    const { thought } = await getJson(`/api/thoughts/${encodeURIComponent(id)}`);
    const modelInput = thought.model_input ?? { json: '', bytes: 0, truncated: false };
    const receipts =
      typeof thought.action_id === 'string'
        ? (await getJson(`/api/receipts?action_id=${encodeURIComponent(thought.action_id)}`))
            .receipts
        : [];
    const notes = [];
    if (modelInput.truncated) {
      const size = `${modelInput.bytes} bytes`;
      notes.push(
        renderNote(document, `The model input is ${size}; only the first 64 KiB is shown.`),
      );
    }
    const detail = renderDetail(document, toView(thought), modelInput.json ?? '', receipts);
    els.detail.replaceChildren(...notes, detail);
  } catch {
    els.detail.replaceChildren(renderNote(document, 'Could not load this thought.'));
  }
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
  state.list = pushThought(state.list, view);
  render();
}

/** Pause holds new thoughts in a capped buffer; resume puts them in the list, oldest first. */
function togglePause() {
  state.paused = !state.paused;
  if (!state.paused) {
    for (const view of [...state.pending].reverse()) {
      state.list = pushThought(state.list, view);
    }
    state.pending = [];
  }
  els.pause.textContent = state.paused ? 'Resume live feed' : 'Pause live feed';
  render();
}

/** Fills the agent filter from the agents list. */
async function loadAgents() {
  const { agents } = await getJson('/api/agents');
  state.agentIds = agents.map((agent) => String(agent.agent_id));
  fillAgentOptions(
    document,
    els.agent,
    agents.map((agent) => String(agent.name ?? '')),
  );
}

function start() {
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
      state.streamText = STATUS_TEXT[status] ?? status;
      updateStatus();
    },
  });

  // Server-side filters reload the first page; the text filters only narrow the loaded list.
  els.agent.addEventListener('change', reload);
  els.outcome.addEventListener('change', reload);
  els.range.addEventListener('change', reload);
  els.template.addEventListener('input', render);
  els.keyword.addEventListener('input', render);
  els.pause.addEventListener('click', togglePause);
  els.older.addEventListener('click', loadOlder);

  live.start();
  loadAgents()
    .catch(() => {
      els.status.textContent = 'Could not load the agents.';
    })
    .then(reload);
}

start();
