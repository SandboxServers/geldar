/** The public agents list and its wide-screen profile. World text is rendered by make(). */
import { type Row, type ThoughtView, toView, whenLabel } from './render-model.ts';
import { makeSigil } from './render-sigil.ts';
import { action, type Doc, type El, make, renderNote } from './render-view.ts';

const LATEST_LIMIT = 6;
/** How a death date is written: the day, the month as a short word, the year. */
export const DEATH_DATE = { day: 'numeric', month: 'short', year: 'numeric' } as const;
const dead = (agent: Row): boolean => agent.died_at != null;
const agentId = (agent: Row): string => String(agent.agent_id);
const agentName = (agent: Row): string => String(agent.name ?? '');

function lifeLine(agent: Row): string {
  return `life ${agent.life_seq ?? '—'} · ${agent.mode ?? '—'} · born day ${agent.born_day ?? '—'}`;
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

interface RosterDeps {
  doc: Doc;
  count: El;
  alive: El;
  dead: El;
  profile: El & { scrollTop: number };
  isWide(): boolean;
  openInGlass(id: string): void;
  loadLatest(path: string): Promise<{ thoughts: Row[] }>;
  now(): number;
}

export function createRoster(deps: RosterDeps) {
  const { doc, profile } = deps;
  const results = make(doc, 'div', 'roster-results', '');
  results.setAttribute('aria-live', 'polite');
  let selected: RosterRow | null = null;
  let failed = false;
  let turn = 0;

  function clear(): void {
    if (selected === null) return;
    turn += 1;
    selected.removeAttribute('aria-current');
    selected = null;
    profile.replaceChildren(renderNote(doc, 'Select an agent to see their latest entries.'));
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
    const heading = make(doc, 'div', 'roster-latest', '');
    heading.append(
      make(doc, 'h3', 'eyebrow', 'Latest entries'),
      action(doc, 'roster-open', 'Open in Glass', () => deps.openInGlass(id)),
    );
    results.replaceChildren(renderNote(doc, 'Loading entries…'));
    profile.replaceChildren(
      badge(doc, agent, 'profile'),
      make(doc, 'h2', 'roster-profile-name', agentName(agent)),
      make(doc, 'p', 'roster-meta', lifeLine(agent)),
      lifeNote(doc, 'p', agent),
      heading,
      results,
    );
    profile.scrollTop = 0;

    try {
      const query = new URLSearchParams({ agent: id, limit: String(LATEST_LIMIT) });
      const { thoughts } = await deps.loadLatest(`/api/thoughts?${query}`);
      if (mine !== turn) return;
      if (thoughts.length === 0) {
        results.replaceChildren(renderNote(doc, 'No entries yet.'));
        return;
      }
      const list = make(doc, 'ol', 'roster-entries', '');
      const now = deps.now();
      list.append(
        ...thoughts.slice(0, LATEST_LIMIT).map((entry) => latestEntry(doc, toView(entry), now)),
      );
      results.replaceChildren(list);
    } catch {
      if (mine !== turn) return;
      // Another press can retry this selection after a failed request.
      failed = true;
      results.replaceChildren(renderNote(doc, 'Could not load the latest entries.'));
    }
  }

  return {
    setAgents(agents: Row[]): void {
      const living: El[] = [];
      const deceased: El[] = [];
      for (const agent of agents) {
        const row = agentRow(doc, agent, () => void select(agent, row));
        (dead(agent) ? deceased : living).push(row);
      }
      deps.count.textContent = `${living.length} alive, ${deceased.length} dead. One body per agent; a death ends the life.`;
      deps.alive.replaceChildren(...living);
      deps.dead.replaceChildren(...deceased);
      clear();
    },
    clear,
    unavailable(): void {
      deps.count.textContent = 'Could not load the agents.';
    },
  };
}
