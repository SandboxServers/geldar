import { parseTime } from './time.ts';

export type Thought = { agent: string; at: number; text: string };

/** The /api/thoughts shape: thought_id, life_id, at, name, kind, text. Only journal entries are kept.
 * The agent is the life_id (the id Paper and the Body use); name (a first name such as Zack) is the fallback. */
export function parseThoughts(json: string): Thought[] {
  const data: unknown = JSON.parse(json);
  const list: unknown = Array.isArray(data)
    ? data
    : typeof data === 'object' && data !== null
      ? ((data as Record<string, unknown>).thoughts ?? (data as Record<string, unknown>).items)
      : null;
  if (!Array.isArray(list)) return [];
  const out: Thought[] = [];
  for (const t of list) {
    if (typeof t !== 'object' || t === null) continue;
    const r = t as Record<string, unknown>;
    const at = parseTime(r.at);
    const agent = typeof r.life_id === 'string' && r.life_id ? r.life_id : r.name;
    if (typeof agent !== 'string' || typeof r.text !== 'string' || at === null) continue;
    if (typeof r.kind !== 'string' || !r.kind.toLowerCase().includes('journal')) continue;
    out.push({ agent, at, text: r.text });
  }
  return out;
}

export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter);
}

export const DUP_WINDOW = 20;
export const DUP_JACCARD = 0.9;

export type JournalMetrics = { entries: number; nearDuplicates: number; asleep: number };

/**
 * Entries are compared in time order; one is a near-duplicate of any of the previous 20. The `before` entries
 * come from before the first one (the end of the previous window): they seed the look-back but are not counted.
 */
export function journalMetrics(entries: Thought[], before: Thought[] = []): JournalMetrics {
  const s = [...entries].sort((a, b) => a.at - b.at);
  const prev: { norm: string; words: Set<string> }[] = [];
  for (const e of [...before].sort((a, b) => a.at - b.at).slice(-DUP_WINDOW)) {
    const norm = normalise(e.text);
    prev.push({ norm, words: new Set(norm.split(' ').filter(Boolean)) });
  }
  let nearDuplicates = 0;
  let asleep = 0;
  for (const e of s) {
    const norm = normalise(e.text);
    const words = new Set(norm.split(' ').filter(Boolean));
    if (prev.some((p) => p.norm === norm || jaccard(p.words, words) >= DUP_JACCARD))
      nearDuplicates++;
    if (/\basleep\b/i.test(e.text)) asleep++;
    prev.push({ norm, words });
    if (prev.length > DUP_WINDOW) prev.shift();
  }
  return { entries: s.length, nearDuplicates, asleep };
}
