/** The public agents list and its wide-screen profile. World text is rendered by make(). */
import { type Row, type ThoughtView, toView, whenLabel } from './render-model.ts';
import { makeSigil } from './render-sigil.ts';
import { action, type Doc, type El, make, renderNote } from './render-view.ts';

const LATEST_LIMIT = 6;
/** A press waits this long before the entries are fetched, so a run of presses fetches once (#919). */
export const DEBOUNCE_MS = 200;
/** How a death date is written: the day, the month as a short word, the year. */
export const DEATH_DATE = { day: 'numeric', month: 'short', year: 'numeric' } as const;
const dead = (agent: Row): boolean => agent.died_at != null;
const agentId = (agent: Row): string => String(agent.agent_id);
const agentName = (agent: Row): string => String(agent.name ?? '');

function lifeLine(agent: Row): string {
  const born = agent.born_day == null ? '' : ` · born day ${agent.born_day}`;
  return `life ${agent.life_seq ?? '—'} · ${agent.mode ?? '—'}${born}`;
}

function lifeNote(doc: Doc, tag: string, agent: Row): El {
  if (!dead(agent)) return make(doc, tag, 'roster-note alive', 'alive');
  const at = new Date(String(agent.died_at));
  // A date with the month as a word: 11/14 and 14/11 read differently in different places.
  const date = Number.isFinite(at.getTime())
    ? ` ${at.toLocaleDateString(undefined, DEATH_DATE)}`
    : '';
  const cause = agent.death_cause ? ` — ${agent.death_cause}` : '';
  return make(doc, tag, 'roster-note dead', `died${date}${cause}`);
}

function badge(doc: Doc, agent: Row, size: 'roster' | 'profile'): El {
  return makeSigil(doc, agentName(agent) || agentId(agent), size, dead(agent)) as unknown as El;
}

type RosterRow = El & { removeAttribute(name: string): void };

function agentRow(doc: Doc, agent: Row, press: () => void): RosterRow {
  const row = action(doc, 'roster-row', '', press) as RosterRow;
  const text = make(doc, 'span', 'roster-text', '');
  text.append(
    make(doc, 'span', 'roster-name', agentName(agent)),
    make(doc, 'span', 'roster-meta', lifeLine(agent)),
    lifeNote(doc, 'span', agent),
  );
  row.append(badge(doc, agent, 'roster'), text);
  return row;
}

function latestEntry(doc: Doc, entry: ThoughtView, now: number): El {
  const journal = entry.kind === 'journal';
  const unparsed = entry.outcome === 'unparsed';
  const kind = journal ? 'journal' : `woke: ${entry.wakeReason}`;
  const when = whenLabel(entry.atMs, now) || entry.at;
  const row = make(doc, 'li', 'roster-entry', '');
  row.append(
    make(doc, 'p', 'roster-entry-meta', `${when} · ${kind}`),
    make(
      doc,
      'p',
      journal
        ? 'roster-entry-text journal'
        : unparsed
          ? 'roster-entry-text bad'
          : 'roster-entry-text',
      unparsed ? 'Unparsed reply.' : entry.plan,
    ),
  );
  return row;
}

/** The message for a failed entries request. A 429 says when to try again; nothing retries by itself. */
function failureText(err: unknown): string {
  const failure = err as { httpStatus?: unknown; retryAfter?: unknown } | null;
  if (failure?.httpStatus !== 429) return 'Could not load the latest entries.';
  const seconds = Number(failure.retryAfter);
  return Number.isFinite(seconds) && seconds > 0
    ? `Too many requests. Try again in ${Math.ceil(seconds)} seconds.`
    : 'Too many requests. Try again in a moment.';
}

interface RosterDeps {
  doc: Doc;
  count: El;
  alive: El;
  dead: El;
  profile: El & { scrollTop: number };
  /** The search box and the sort select of the roster. */
  search: EventTarget & { value: string };
  sort: EventTarget & { value: string };
  /** Asks the agents API for one page: the reply is the agents shown and the total that match. */
  fetchAgents(path: string): Promise<{ agents: Row[]; total: number }>;
  isWide(): boolean;
  openInGlass(id: string): void;
  loadLatest(path: string): Promise<{ thoughts: Row[] }>;
  now(): number;
}

export function createRoster(deps: RosterDeps) {
  const { doc, profile } = deps;
  // A screen reader is told the short status only. The entries are outside it: read, not announced.
  const status = make(doc, 'p', 'note roster-status', '');
  status.setAttribute('aria-live', 'polite');
  const results = make(doc, 'div', 'roster-results', '');
  const say = (message: string): void => {
    status.textContent = message;
  };
  // The entries of each agent already loaded on this page: a press on it again makes no request.
  const cache = new Map<string, Row[]>();
  let selected: RosterRow | null = null;
  let failed = false;
  let turn = 0;
  let pending: ReturnType<typeof setTimeout> | undefined;

  function cancelPending(): void {
    if (pending === undefined) return;
    clearTimeout(pending);
    pending = undefined;
  }

  function clear(): void {
    cancelPending();
    if (selected === null) return;
    turn += 1;
    selected.removeAttribute('aria-current');
    selected = null;
    profile.replaceChildren(renderNote(doc, 'Select an agent to see their latest entries.'));
  }

  function showEntries(thoughts: Row[]): void {
    if (thoughts.length === 0) {
      say('No entries yet.');
      return;
    }
    const list = make(doc, 'ol', 'roster-entries', '');
    const now = deps.now();
    list.append(
      ...thoughts.slice(0, LATEST_LIMIT).map((entry) => latestEntry(doc, toView(entry), now)),
    );
    say('');
    results.replaceChildren(list);
  }

  async function load(id: string, mine: number): Promise<void> {
    try {
      const query = new URLSearchParams({ agent: id, limit: String(LATEST_LIMIT) });
      const { thoughts } = await deps.loadLatest(`/api/thoughts?${query}`);
      if (mine !== turn) return;
      cache.set(id, thoughts);
      showEntries(thoughts);
    } catch (err) {
      if (mine !== turn) return;
      // Another press can retry this selection after a failed request.
      failed = true;
      say(failureText(err));
    }
  }

  async function select(agent: Row, row: RosterRow): Promise<void> {
    const id = agentId(agent);
    if (!deps.isWide()) {
      deps.openInGlass(id);
      return;
    }
    if (row === selected && !failed) return;
    selected?.removeAttribute('aria-current');
    selected = row;
    failed = false;
    row.setAttribute('aria-current', 'true');
    const mine = ++turn;
    cancelPending();
    const heading = make(doc, 'div', 'roster-latest', '');
    heading.append(
      make(doc, 'h3', 'eyebrow', 'Latest entries'),
      action(doc, 'roster-open', 'Open in Glass', () => deps.openInGlass(id)),
    );
    say('Loading entries…');
    results.replaceChildren();
    profile.replaceChildren(
      badge(doc, agent, 'profile'),
      make(doc, 'h2', 'roster-profile-name', agentName(agent)),
      make(doc, 'p', 'roster-meta', lifeLine(agent)),
      lifeNote(doc, 'p', agent),
      heading,
      status,
      results,
    );
    profile.scrollTop = 0;

    const cached = cache.get(id);
    if (cached !== undefined) {
      showEntries(cached);
      return;
    }
    pending = setTimeout(() => {
      pending = undefined;
      void load(id, mine);
    }, DEBOUNCE_MS);
  }

  /** Draws the living and the dead lists; returns how many of each. */
  function draw(agents: Row[]): { living: number; deceased: number } {
    const living: El[] = [];
    const deceased: El[] = [];
    for (const agent of agents) {
      const row = agentRow(doc, agent, () => void select(agent, row));
      (dead(agent) ? deceased : living).push(row);
    }
    deps.alive.replaceChildren(...living);
    deps.dead.replaceChildren(...deceased);
    return { living: living.length, deceased: deceased.length };
  }

  // A search or a sort asks the API for the matching page. A reply to an older question is dropped.
  let asked = 0;
  async function search(): Promise<void> {
    const mine = ++asked;
    const q = deps.search.value.trim();
    const params = new URLSearchParams({ sort: deps.sort.value });
    if (q !== '') params.set('q', q);
    try {
      const reply = await deps.fetchAgents(`/api/agents?${params}`);
      if (mine !== asked) return;
      const { living, deceased } = draw(reply.agents);
      deps.count.textContent =
        reply.total === 0
          ? 'No agent matches.'
          : `${reply.total} matching: ${living} alive and ${deceased} dead on this page.`;
      clear();
    } catch {
      if (mine !== asked) return;
      deps.count.textContent = 'Could not search the agents.';
    }
  }
  deps.search.addEventListener('input', () => void search());
  deps.sort.addEventListener('change', () => void search());

  return {
    setAgents(agents: Row[]): void {
      const { living, deceased } = draw(agents);
      deps.count.textContent = `${living} alive, ${deceased} dead. One body per agent; a death ends the life.`;
      clear();
    },
    clear,
    unavailable(): void {
      deps.count.textContent = 'Could not load the agents.';
    },
  };
}
