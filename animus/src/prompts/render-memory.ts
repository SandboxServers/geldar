import type { GoalRow, JournalEntry, MemoryRow, RelationshipRow } from '../ports/index.ts';
import { jsonString, type WorldTextLine } from './world-text.ts';

/** How many people get their impression shown; the rest are named only. */
export const PEOPLE_WITH_IMPRESSION = 6;

/** The most people listed at all (shown and name-only together). */
export const MAX_PEOPLE = 20;

/** The working window of recent thoughts. */
export const MAX_RECENT_THOUGHTS = 20;

const NONE = '(none)';

/**
 * Stored text came from the agent's own earlier thoughts and reflections, which may repeat what it
 * heard. Every item is a JSON string on its own line, so it cannot open a heading or a list entry.
 */
function lines(items: string[]): string {
  return items.length === 0 ? NONE : items.join('\n');
}

/** The goal stack, rank order. */
export function renderGoals(goals: readonly GoalRow[]): string {
  const sorted = [...goals].sort((a, b) => a.rank - b.rank);
  return lines(
    sorted.map((g, i) => `${i + 1}. ${jsonString(g.goal)} because ${jsonString(g.why)}`),
  );
}

/** Commitments due or open. */
export function renderCommitments(rows: readonly MemoryRow[]): string {
  return lines(
    rows.map(
      (m) => `- ${m.dueTick === null ? 'open' : `due tick ${m.dueTick}`}: ${jsonString(m.text)}`,
    ),
  );
}

/** Beliefs with their kind. */
export function renderBeliefs(rows: readonly MemoryRow[]): string {
  return lines(rows.map((m) => `- (${m.provenance}) ${jsonString(m.text)}`));
}

/** Episodic memories, in the order given (nearest first). */
export function renderEpisodic(rows: readonly MemoryRow[]): string {
  return lines(rows.map((m) => `- (day ${m.createdDay}) ${jsonString(m.text)}`));
}

/** One journal entry as a short line: when, why woken, and what the thought said. */
function journalLine(entry: JournalEntry): string {
  const head = `- day ${entry.worldDay} tick ${entry.worldTick}, woken by ${entry.wakeReason.replace(/[^a-z_]/g, '?')}`;
  const t = entry.parsed;
  if (t === null) return `${head}: (the answer was rejected)`;
  const parts: string[] = [`reasoning ${jsonString(t.reasoning, 240)}`];
  if (t.intent !== undefined)
    parts.push(`intent ${jsonString(`${t.intent.goal} (${String(t.intent.program)})`, 120)}`);
  if (t.actions !== undefined) {
    parts.push(
      `actions ${(t.actions as ReadonlyArray<{ do?: unknown }>).map((a) => String(a.do)).join(', ')}`,
    );
  }
  if (typeof t.say === 'string') parts.push(`said ${jsonString(t.say, 256)}`);
  return `${head}: ${parts.join('; ')}`;
}

/** The latest thoughts (the last {@link MAX_RECENT_THOUGHTS}), oldest first. */
export function renderJournal(entries: readonly JournalEntry[]): string {
  return lines(entries.slice(-MAX_RECENT_THOUGHTS).map(journalLine));
}

/**
 * Relationships as quoted lines: the people with the strongest feelings (trust far from neutral,
 * then most recently seen) with their impression, the rest by name only.
 */
export function relationshipLines(
  rows: readonly RelationshipRow[],
  kind: 'person' | 'relationship',
  withImpression: number = PEOPLE_WITH_IMPRESSION,
): WorldTextLine[] {
  const sorted = [...rows].sort(
    (a, b) =>
      Math.abs(b.trust - 50) - Math.abs(a.trust - 50) ||
      (b.lastSeenDay ?? -1) - (a.lastSeenDay ?? -1) ||
      (a.otherId < b.otherId ? -1 : a.otherId > b.otherId ? 1 : 0),
  );
  return sorted.slice(0, MAX_PEOPLE).map((r, i) =>
    i < withImpression
      ? {
          kind,
          fields: { impression: r.impression, name: r.otherId, trust: r.trust },
        }
      : { kind, fields: { name: r.otherId } },
  );
}
