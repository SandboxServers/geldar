/**
 * The agents list page: a search, a sort and a page, all in code over the rows listAgents already
 * left to this viewer. The search matches the name the page shows (the alias when one is mapped),
 * never the stored name: the rows carry only the shown name, so the stored name is never compared.
 * Hidden agents are not in the rows, so they are neither found nor counted.
 */
import type { Row } from './query.ts';

/** The longest search the page takes; a longer one is cut. */
export const MAX_QUERY = 64;
/** The most agents one reply holds, and the default page: the list size listAgents already caps at. */
export const MAX_LIMIT = 500;
/** The furthest offset a page may ask for. */
const MAX_OFFSET = 100_000;

export type AgentSort = 'name' | 'latest';

export interface AgentPage {
  /** Lower-case search text; empty matches every agent. */
  q: string;
  sort: AgentSort;
  limit: number;
  offset: number;
}

/** A whole non-negative number from a query value, or the fallback when it is not one. */
function whole(value: string | null, fallback: number, max: number): number {
  if (value === null || !/^\d{1,9}$/.test(value)) return fallback;
  return Math.min(Number(value), max);
}

/** The page a query asks for. Unknown or bad values fall back to the defaults; nothing is an error. */
export function agentPageOf(params: URLSearchParams): AgentPage {
  return {
    q: (params.get('q') ?? '').trim().slice(0, MAX_QUERY).toLowerCase(),
    sort: params.get('sort') === 'latest' ? 'latest' : 'name',
    limit: Math.max(1, whole(params.get('limit'), MAX_LIMIT, MAX_LIMIT)),
    offset: whole(params.get('offset'), 0, MAX_OFFSET),
  };
}

const shownName = (row: Row): string => String(row.name ?? '').toLowerCase();

/** Newest activity first; an agent with no visible thought goes last. */
function latestOf(row: Row): number {
  const at = row.last_active;
  if (at === null || at === undefined) return Number.NEGATIVE_INFINITY;
  return new Date(at as string | Date).getTime();
}

function byName(a: Row, b: Row): number {
  const byText = shownName(a) < shownName(b) ? -1 : shownName(a) > shownName(b) ? 1 : 0;
  return byText || (String(a.agent_id) < String(b.agent_id) ? -1 : 1);
}

function byLatest(a: Row, b: Row): number {
  const diff = latestOf(b) - latestOf(a);
  if (Number.isNaN(diff) || diff === 0) return byName(a, b);
  return diff;
}

/** The row without the activity time: that time is for the sort only, never sent. */
function sent(row: Row): Row {
  const { last_active: _activity, ...rest } = row;
  return rest;
}

/** The matching agents in the page's order, cut to the page. `total` counts every match, not the page. */
export function pageAgents(rows: Row[], page: AgentPage): { agents: Row[]; total: number } {
  const matching = rows.filter((row) => page.q === '' || shownName(row).includes(page.q));
  const ordered = [...matching].sort(page.sort === 'latest' ? byLatest : byName);
  return {
    agents: ordered.slice(page.offset, page.offset + page.limit).map(sent),
    total: matching.length,
  };
}
