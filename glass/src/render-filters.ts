/**
 * The filters of the Thought Stream page: the search field, the row of agent chips, the lesser filters
 * folded under "More", and the bookmark they keep in the page URL. The agent, the outcome and the time
 * range are applied by the server; the search and the template only narrow the loaded list. Every page
 * object is passed in, so this is tested with fakes and through the page script (page-script.test.ts).
 *
 * This file is served to the browser after type stripping, so it stays erasable TypeScript.
 */
import { filterQuery, type Row, readFilters, type ThoughtFilter } from './render-model.ts';
import { readView } from './render-tabs.ts';
import { type Doc, type El, renderChips } from './render-view.ts';

interface Field {
  value: string;
  addEventListener(type: 'input' | 'change', listener: () => void): void;
}

export interface FilterDeps {
  doc: Doc;
  keyword: Field;
  template: Field;
  outcome: Field;
  range: Field;
  /** The "More" disclosure. It takes the class `set` while a filter inside it is set. */
  more: { classList: { toggle(name: string, on: boolean): void } };
  /** The row the agent chips are drawn in. */
  chips: El;
  /** The page URL: read once for a bookmark, and rewritten (never navigated) on every change. */
  location: { search: string; pathname: string; hash: string };
  history: { replaceState(data: null, unused: string, url: string): void };
  now(): number;
  /** A filter the server applies changed: the first page must be asked for again. */
  onReload(): void;
  /** A filter the page applies changed: the loaded list must be narrowed again. */
  onNarrow(): void;
}

export interface Filters {
  /** Takes the agents list: who a row belongs to, and the chips of the filter (the living first). */
  setAgents(agents: Row[]): void;
  /** The agent with this id, when the agents list has it. */
  agent(id: string): Row | undefined;
  /** Restores the controls from the URL and reports whether any filter changed. */
  restore(): boolean;
  /** Every filter as the page has it now. */
  current(): ThoughtFilter;
  /** True while the search or the template narrows the loaded list. */
  narrowed(): boolean;
  /** Adds the filters the server applies to a query for /api/thoughts. */
  addTo(params: URLSearchParams): void;
}

export function createFilters(deps: FilterDeps): Filters {
  let agents = new Map<string, Row>();
  /** Position in /api/agents -> agent id. A bookmark names an agent by its id; the URL check wants this list. */
  let agentIds: string[] = [];
  /** Chip position -> position in /api/agents. */
  let order: number[] = [];
  let agentId = '';
  /** Gives the focus to the chip at a position of the row as it is drawn now. */
  let pressed: (position: number) => void = () => undefined;

  /** The start of the chosen time range in epoch ms, or undefined for all loaded thoughts. */
  function sinceMs(): number | undefined {
    const range = Number(deps.range.value);
    return range > 0 ? deps.now() - range : undefined;
  }

  /** "More" turns amber while a filter inside it is set, so a folded filter is never a hidden one. */
  function markMore(): void {
    const set =
      deps.range.value !== '0' || deps.outcome.value !== '' || deps.template.value.trim() !== '';
    deps.more.classList.toggle('set', set);
  }

  function bookmark(): string {
    return filterQuery({
      q: deps.keyword.value.trim(),
      agent: agentId,
      range: deps.range.value,
      outcome: deps.outcome.value,
      template: deps.template.value.trim(),
    });
  }

  function save(): void {
    markMore();
    let query = bookmark();
    if (readView(deps.location.search) === 'roster') {
      query += query === '' ? '?view=roster' : '&view=roster';
    }
    // A browser may refuse a burst of URL updates (Safari throws past 100 in 30 seconds). The filter
    // still applies; only the address bar lags.
    try {
      deps.history.replaceState(null, '', deps.location.pathname + query + deps.location.hash);
    } catch {
      // Nothing to do: the next change tries again.
    }
  }

  /**
   * Draws the agent filter. A press on the chip that is on turns the filter off. The row is drawn again on
   * every press, so the chip that was pressed is given the focus back: a keyboard reader stays on the row.
   */
  function drawChips(): El {
    const chips = order.map((index) => {
      const agent = agents.get(agentIds[index] ?? '');
      return { name: String(agent?.name ?? ''), dead: agent?.died_at != null };
    });
    const on = order.findIndex((index) => agentIds[index] === agentId);
    const drawn = renderChips(deps.doc, deps.chips, chips, on, (position) => {
      const picked = position < 0 ? '' : (agentIds[order[position] ?? -1] ?? '');
      agentId = picked === agentId ? '' : picked;
      drawChips();
      pressed(position);
      save();
      deps.onReload();
    });
    pressed = (position) => drawn.buttons[position + 1]?.focus?.();
    return drawn.on;
  }

  // Server-side filters reload the first page; the text filters only narrow the loaded list.
  for (const select of [deps.outcome, deps.range]) {
    select.addEventListener('change', () => {
      save();
      deps.onReload();
    });
  }
  for (const field of [deps.template, deps.keyword]) {
    field.addEventListener('input', () => {
      save();
      deps.onNarrow();
    });
  }

  return {
    setAgents(list: Row[]): void {
      agents = new Map(list.map((agent) => [String(agent.agent_id), agent]));
      agentIds = list.map((agent) => String(agent.agent_id));
      const positions = list.map((_agent, index) => index);
      const dead = (index: number): boolean => list[index]?.died_at != null;
      order = [...positions.filter((index) => !dead(index)), ...positions.filter(dead)];
    },
    agent: (id: string) => agents.get(id),
    restore(): boolean {
      const before = bookmark();
      // URL values are validated before they reach form controls.
      const filter = readFilters(deps.location.search, agentIds);
      deps.keyword.value = filter.q;
      deps.template.value = filter.template;
      deps.outcome.value = filter.outcome;
      deps.range.value = filter.range;
      agentId = filter.agent === '' ? '' : (agentIds[Number(filter.agent)] ?? '');
      markMore();
      // A bookmarked agent can be offscreen in the chip row.
      const chip = drawChips() as El & Partial<Pick<HTMLElement, 'scrollIntoView'>>;
      chip.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      return bookmark() !== before;
    },
    current(): ThoughtFilter {
      const filter: ThoughtFilter = {};
      const outcome = deps.outcome.value;
      const template = deps.template.value.trim();
      const keyword = deps.keyword.value.trim();
      const since = sinceMs();
      if (agentId !== '') filter.agentId = agentId;
      if (outcome === 'parsed' || outcome === 'unparsed') filter.outcome = outcome;
      if (template !== '') filter.templateVersion = template;
      if (since !== undefined) filter.sinceMs = since;
      if (keyword !== '') filter.keyword = keyword;
      return filter;
    },
    narrowed: () => deps.keyword.value.trim() !== '' || deps.template.value.trim() !== '',
    addTo(params: URLSearchParams): void {
      if (agentId !== '') params.set('agent', agentId);
      if (deps.outcome.value !== '') params.set('outcome', deps.outcome.value);
      const since = sinceMs();
      if (since !== undefined) params.set('since', new Date(since).toISOString());
    },
  };
}
