/**
 * The "More agents" list (#902): a search box over the agents API for the agents the chip row does not
 * show at a glance. A pick is a chip press (filters.pick). Every name is drawn as text with make() and
 * action(), the same path as the chips: nothing here sets markup from a string.
 *
 * This file is served to the browser after type stripping, so it stays erasable TypeScript.
 */
import type { Row } from './render-model.ts';
import { DEBOUNCE_MS, failureText } from './render-roster.ts';
import { makeSigil } from './render-sigil.ts';
import { action, type Doc, type El, make } from './render-view.ts';

/** The most agents one search asks for. The API caps any reply at its own limit; the list never asks for more. */
export const MORE_LIMIT = 50;
/** The longest search sent. The API cuts a longer one at the same length. */
const MAX_QUERY = 64;

const dead = (agent: Row): boolean => agent.died_at != null;

/** One agent of the list: its sigil and name as a chip shows them. A press picks the agent. */
export function moreItem(doc: Doc, agent: Row, pick: (id: string) => void): El {
  const name = String(agent.name ?? '');
  const row = action(doc, 'more-agent', '', () => pick(String(agent.agent_id)));
  row.append(makeSigil(doc, name, 'chip', dead(agent)) as unknown as El);
  row.append(make(doc, 'span', 'chip-name', name));
  if (dead(agent)) row.append(make(doc, 'span', 'died', '†'), make(doc, 'span', 'sr', ' died'));
  return row;
}

export interface MoreDeps {
  doc: Doc;
  /** The "More agents" button. It opens and closes the list, and gets the focus back when the list closes. */
  toggle: El & { focus(): void };
  /** The region that holds the search box, the count and the list. It is hidden while closed. */
  panel: {
    hidden: boolean;
    addEventListener(type: 'keydown', listener: (event: { key: string }) => void): void;
  };
  search: {
    value: string;
    focus(): void;
    addEventListener(type: 'input', listener: () => void): void;
  };
  count: El;
  list: El;
  /** Asks the agents API for one page: the agents shown and the total that match. */
  fetchAgents(path: string): Promise<{ agents: Row[]; total: number }>;
  /** Picks an agent as a chip press does. False when the chip row does not hold it. */
  pick(id: string): boolean;
}

export function createMore(deps: MoreDeps) {
  let open = false;
  /** Counts the questions asked: a reply to an older question, or to one asked while closed, is dropped. */
  let asked = 0;
  let pending: ReturnType<typeof setTimeout> | undefined;

  function cancelPending(): void {
    if (pending === undefined) return;
    clearTimeout(pending);
    pending = undefined;
  }

  function close(): void {
    cancelPending();
    asked += 1;
    if (!open) return;
    open = false;
    deps.panel.hidden = true;
    deps.toggle.setAttribute('aria-expanded', 'false');
    deps.toggle.focus();
  }

  function choose(id: string): void {
    if (deps.pick(id)) {
      close();
      return;
    }
    deps.count.textContent = 'That agent is not in the chip row. Reload the page.';
  }

  async function search(): Promise<void> {
    const mine = ++asked;
    const q = deps.search.value.trim().slice(0, MAX_QUERY);
    const params = new URLSearchParams({ limit: String(MORE_LIMIT) });
    if (q !== '') params.set('q', q);
    try {
      const reply = await deps.fetchAgents(`/api/agents?${params}`);
      if (mine !== asked || !open) return;
      const shown = reply.agents.slice(0, MORE_LIMIT);
      deps.list.replaceChildren(...shown.map((agent) => moreItem(deps.doc, agent, choose)));
      const more = reply.total > shown.length ? `; showing the first ${shown.length}` : '';
      deps.count.textContent =
        reply.total === 0 ? 'No agent matches.' : `${reply.total} matching${more}.`;
    } catch (err) {
      if (mine !== asked || !open) return;
      deps.list.replaceChildren();
      deps.count.textContent = failureText(err, 'Could not load the agents.');
    }
  }

  function show(): void {
    open = true;
    deps.panel.hidden = false;
    deps.toggle.setAttribute('aria-expanded', 'true');
    deps.search.focus();
    void search();
  }

  deps.toggle.addEventListener('click', () => (open ? close() : show()));
  // Escape closes the list from anywhere inside it; the focus goes back to the button that opened it.
  deps.panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });
  // A search waits DEBOUNCE_MS after the last key, so a run of keys asks once.
  deps.search.addEventListener('input', () => {
    cancelPending();
    pending = setTimeout(() => {
      pending = undefined;
      void search();
    }, DEBOUNCE_MS);
  });

  return { close, isOpen: () => open };
}
