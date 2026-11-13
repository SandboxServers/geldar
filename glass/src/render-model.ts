/**
 * The pure part of the Thought Stream page: the view model, the filters, the bounded list and the
 * text display rules. No DOM here. render-view.ts builds nodes from these values with textContent.
 *
 * This file is served to the browser after Node strips its types, so it stays erasable TypeScript
 * (no enums, no parameter properties, no namespaces). Every string here came from the world.
 */

/** The most thoughts the page keeps in memory. The oldest is dropped past this. */
export const LIST_CAP = 2000;

/** The most characters of one field the page shows. A longer field is clipped with a note. */
export const TEXT_CAP = 4000;

export type Row = Record<string, unknown>;

export interface ThoughtView {
  id: string;
  agentId: string;
  agentName: string;
  tier: string;
  at: string;
  atMs: number;
  templateVersion: string;
  latencyMs: number | null;
  /** A Mind thought is parsed or not; a journal line has no outcome ('none'). */
  outcome: 'parsed' | 'unparsed' | 'none';
  /** 'thought' (a Mind thought) or 'journal' (a line a sovereign player wrote). */
  kind: 'thought' | 'journal';
  wakeReason: string;
  plan: string;
}

export interface ThoughtFilter {
  agentId?: string;
  outcome?: 'parsed' | 'unparsed';
  templateVersion?: string;
  sinceMs?: number;
  keyword?: string;
}

/** A value from the API as text. Null and absent become empty; objects become their JSON. */
function text(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value) ?? '';
}

/** The plan is the `plan` field of the parsed reply, when the reply has one. */
function planOf(parsed: unknown): string {
  if (typeof parsed === 'object' && parsed !== null && 'plan' in parsed) {
    return text(parsed.plan);
  }
  return '';
}

/** Maps one API row (a list row, a stream frame or a detail row) to the view the page keeps. */
export function toView(row: Row): ThoughtView {
  const at = text(row.at);
  const parsed = row.parsed ?? null;
  const journal = row.kind === 'journal';
  return {
    id: text(row.thought_id),
    agentId: text(row.life_id),
    agentName: text(row.name),
    tier: text(row.tier),
    at,
    atMs: Date.parse(at),
    templateVersion: text(row.prompt_template_version),
    latencyMs: typeof row.latency_ms === 'number' ? row.latency_ms : null,
    outcome: journal ? 'none' : parsed === null ? 'unparsed' : 'parsed',
    kind: journal ? 'journal' : 'thought',
    wakeReason: text(row.wake_reason),
    plan: journal ? text(row.text) : planOf(parsed),
  };
}

/** How many characters of a journal line the collapsed row shows. */
export const JOURNAL_PREVIEW = 600;

/** The text a journal row shows: the first 600 characters with an ellipsis when collapsed, all of it when open. */
export function journalShown(
  value: string,
  expanded: boolean,
): { shown: string; expandable: boolean } {
  const expandable = value.length > JOURNAL_PREVIEW;
  if (!expandable || expanded) return { shown: value, expandable };
  return { shown: `${value.slice(0, JOURNAL_PREVIEW)}...`, expandable };
}

/**
 * When an entry was written, in the reader's own time zone and locale: the clock time for today, with the
 * date in front for any other day and the year too for another year. Empty when the time did not parse.
 */
export function whenLabel(atMs: number, nowMs: number): string {
  if (!Number.isFinite(atMs)) return '';
  const at = new Date(atMs);
  const now = new Date(nowMs);
  const time = at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const sameYear = at.getFullYear() === now.getFullYear();
  if (sameYear && at.getMonth() === now.getMonth() && at.getDate() === now.getDate()) return time;
  const date = at.toLocaleDateString(
    undefined,
    sameYear
      ? { day: 'numeric', month: 'short' }
      : { day: 'numeric', month: 'short', year: 'numeric' },
  );
  return `${date}, ${time}`;
}

export interface TextPiece {
  text: string;
  /** True for a run that matches the search keyword. */
  hit: boolean;
}

/**
 * Splits a shown text at each literal, case-insensitive match of the keyword, so the page can mark the
 * matches. The keyword is escaped: it is never read as a pattern. The pieces join back to the text.
 */
export function splitMatches(value: string, keyword: string): TextPiece[] {
  if (keyword === '' || value === '') return [{ text: value, hit: false }];
  let pattern: RegExp;
  try {
    pattern = new RegExp(`(${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'giu');
  } catch {
    return [{ text: value, hit: false }];
  }
  return value
    .split(pattern)
    .map((text, index) => ({ text, hit: index % 2 === 1 }))
    .filter((piece) => piece.text !== '');
}

function entries(count: number): string {
  return count === 1 ? '1 entry' : `${count} entries`;
}

/**
 * The line under the filters: how many entries are on the page, and, when the keyword or template filter
 * narrows them, how many match and that older entries are searched only once they are loaded.
 */
export function countLabel(
  shown: number,
  loaded: number,
  narrowed: boolean,
  hasOlder: boolean,
): string {
  if (loaded === 0) return 'No entries.';
  if (!narrowed) {
    return hasOlder
      ? `Showing the ${entries(loaded)} loaded so far.`
      : `Showing all ${entries(loaded)}.`;
  }
  const scope = hasOlder ? `the ${entries(loaded)} loaded so far` : `all ${entries(loaded)}`;
  const further = hasOlder ? ' Load older to search further back.' : '';
  if (shown === 0) return `No matches in ${scope}.${further}`;
  return `${shown === 1 ? '1 match' : `${shown} matches`} in ${scope}.${further}`;
}

/**
 * Every character a reader cannot see: controls, format characters (bidi overrides, zero-width
 * characters, the invisible "tag" letters, soft hyphens), line and paragraph separators and the other
 * default-ignorable code points. Tab, line feed and carriage return are kept, and so is U+FE0F, which
 * only picks the emoji form of the character before it.
 */
const INVISIBLE = /(?![\t\n\r]|\uFE0F)[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/gu;

/**
 * Shows each invisible character as a visible marker, so the text on the page, and the text a reader
 * selects or copies from it, holds nothing they cannot see.
 */
export function visible(value: string): string {
  return value.replace(
    INVISIBLE,
    (ch) => `[U+${ch.codePointAt(0)?.toString(16).toUpperCase().padStart(4, '0')}]`,
  );
}

/** Clips a field to `cap` characters and says how many were dropped. */
export function clip(value: string, cap: number = TEXT_CAP): string {
  if (value.length <= cap) return value;
  return `${value.slice(0, cap)}... [clipped, ${value.length - cap} more characters]`;
}

/** The text a field shows on the page: clipped first, so a huge run stays bounded. */
export function display(value: string): string {
  return visible(clip(value));
}

/**
 * The plain text the "Copy" button puts on the clipboard for one entry: who and when (UTC) on the first
 * line, then the text. It is the text the page shows, through display(), so it carries no invisible
 * character; the first line is kept to one line, and every line end is a line feed.
 */
export function copyText(view: ThoughtView): string {
  const when = Number.isFinite(view.atMs)
    ? `${new Date(view.atMs).toISOString().slice(0, 16).replace('T', ' ')} UTC`
    : view.at;
  const head = [view.agentName, when]
    .map((part) => display(part).replace(/\s+/g, ' ').trim())
    .filter((part) => part !== '')
    .join(', ');
  const body = display(view.plan).replace(/\r\n?/g, '\n');
  return [head, body].filter((part) => part !== '').join('\n');
}

/** Keeps the thoughts that pass every set filter. The keyword is a literal, case-insensitive match. */
export function filterThoughts(list: ThoughtView[], filter: ThoughtFilter): ThoughtView[] {
  const keyword = filter.keyword?.toLowerCase() ?? '';
  return list.filter((view) => {
    if (filter.agentId && view.agentId !== filter.agentId) return false;
    if (filter.outcome && view.outcome !== filter.outcome) return false;
    if (filter.templateVersion && view.templateVersion !== filter.templateVersion) return false;
    if (filter.sinceMs !== undefined && !(view.atMs >= filter.sinceMs)) return false;
    if (keyword !== '') {
      const haystack = `${view.agentName} ${view.plan} ${view.wakeReason}`.toLowerCase();
      if (!haystack.includes(keyword)) return false;
    }
    return true;
  });
}

/** Adds a thought at the front (newest first), replacing any copy with the same id. Capped. */
export function pushThought(list: ThoughtView[], view: ThoughtView): ThoughtView[] {
  return [view, ...list.filter((v) => v.id !== view.id)].slice(0, LIST_CAP);
}

/** Adds older thoughts at the back. The list stays capped, so the oldest rows are dropped. */
export function appendOlder(list: ThoughtView[], older: ThoughtView[]): ThoughtView[] {
  const ids = new Set(list.map((v) => v.id));
  const fresh = older.filter((v) => !ids.has(v.id));
  return [...list, ...fresh].slice(0, LIST_CAP);
}

/** The reconnect delay after `attempt` failures: 500 ms, doubling, at most 30 s. */
export function backoffMs(attempt: number): number {
  const n = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
  return Math.min(30_000, 500 * 2 ** Math.min(n, 16));
}

/** A bookmark's filters, validated before assigning any control value. */
export function readFilters(search: string, agentIds: string[]) {
  const params = new URLSearchParams(search);
  const agent = agentIds.indexOf(params.get('agent') ?? '');
  const range = params.get('range');
  const outcome = params.get('outcome');
  return {
    q: (params.get('q') ?? '').slice(0, 200),
    template: (params.get('template') ?? '').slice(0, 64),
    agent: agent < 0 ? '' : String(agent),
    range: range === 'hour' ? '3600000' : range === 'day' ? '86400000' : '0',
    outcome: outcome === 'parsed' || outcome === 'unparsed' ? outcome : '',
  };
}

/** Defaults are omitted; this query is used only by history.replaceState. */
export function filterQuery(filter: {
  q: string;
  agent: string;
  range: string;
  outcome: string;
  template: string;
}): string {
  const params = new URLSearchParams();
  if (filter.q) params.set('q', filter.q.slice(0, 200));
  if (filter.agent) params.set('agent', filter.agent);
  if (filter.range === '3600000') params.set('range', 'hour');
  if (filter.range === '86400000') params.set('range', 'day');
  if (filter.outcome === 'parsed' || filter.outcome === 'unparsed')
    params.set('outcome', filter.outcome);
  if (filter.template) params.set('template', filter.template.slice(0, 64));
  // Not params.size: older Safari has no such property, and the query would always come out empty.
  const query = params.toString();
  return query === '' ? '' : `?${query}`;
}
