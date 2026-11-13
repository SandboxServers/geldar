import type { BodyEvent } from './body.ts';

export type FailureCombo = { verb: string; reason: string; message: string; count: number };

/** How many failures one action_failed line stands for: itself plus the duplicates in `repeats`. */
export const failureCount = (e: BodyEvent): number => 1 + (e.failure?.repeats ?? 0);

/** Failed actions grouped by `do/reason`, each weighted by failureCount. */
export function failureTally(events: BodyEvent[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of events) {
    if (e.kind !== 'action_failed' || !e.failure) continue;
    const key = `${e.failure.verb}/${e.reason}`;
    m.set(key, (m.get(key) ?? 0) + failureCount(e));
  }
  return m;
}

/**
 * The `limit` most frequent (do, reason, message) combinations among action_failed events, most
 * frequent first. Ties sort by do, reason, then message.
 */
export function topFailures(events: BodyEvent[], limit = 5): FailureCombo[] {
  const combos = new Map<string, FailureCombo>();
  for (const e of events) {
    if (e.kind !== 'action_failed' || !e.failure) continue;
    const { verb, message } = e.failure;
    const key = `${verb}\u0000${e.reason}\u0000${message}`;
    const cur = combos.get(key) ?? { verb, reason: e.reason, message, count: 0 };
    cur.count += failureCount(e);
    combos.set(key, cur);
  }
  return [...combos.values()]
    .sort(
      (a, b) =>
        b.count - a.count ||
        a.verb.localeCompare(b.verb) ||
        a.reason.localeCompare(b.reason) ||
        a.message.localeCompare(b.message),
    )
    .slice(0, limit);
}

/** A markdown table of the combinations, or nothing when there are none. Newlines in a message become spaces. */
export function renderTopFailures(combos: FailureCombo[]): string {
  if (combos.length === 0) return '';
  const lines = [
    '',
    '### Top action failures (do, reason, message)',
    '',
    '| count | do | reason | message |',
    '| --- | --- | --- | --- |',
  ];
  for (const c of combos) {
    const message = c.message.replace(/\s+/g, ' ').replaceAll('|', '\\|');
    lines.push(`| ${c.count} | ${c.verb} | ${c.reason} | ${message} |`);
  }
  return `${lines.join('\n')}\n`;
}
