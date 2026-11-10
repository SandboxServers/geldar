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
  outcome: 'parsed' | 'unparsed';
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
  return {
    id: text(row.thought_id),
    agentId: text(row.life_id),
    agentName: text(row.name),
    tier: text(row.tier),
    at,
    atMs: Date.parse(at),
    templateVersion: text(row.prompt_template_version),
    latencyMs: typeof row.latency_ms === 'number' ? row.latency_ms : null,
    outcome: parsed === null ? 'unparsed' : 'parsed',
    wakeReason: text(row.wake_reason),
    plan: planOf(parsed),
  };
}

/** Shows a bidi override, a zero-width or a control character as a visible marker. */
const INVISIBLE =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩﻿]/gu;

export function visible(value: string): string {
  return value.replace(INVISIBLE, (ch) => `[U+${ch.codePointAt(0)?.toString(16).toUpperCase().padStart(4, '0')}]`);
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
