/**
 * The golem-side leakage scan for a published observation body (AN-28b, AN-50b), shared by the subscription
 * tests. A test-only helper: it is not imported by production code.
 */

/** A life id and a username that must never reach a published body when the actor is out of sight. */
export const HIDDEN_LIFE = 'ag_capc_03';
export const HIDDEN_NAME = 'Hidden_Walker';

/**
 * The leaks in one published observation. The payload's `key` carries the coordinates and the actor's
 * name by design, so the coordinate scan reads the payload without it. Every other scan reads the whole
 * body, the key included: the hidden-actor check is case-insensitive.
 */
export function leaksIn(body: string, allowedIds: string[]): string[] {
  const event = JSON.parse(body) as { payload: Record<string, unknown> };
  const shown = JSON.stringify({ ...event.payload, key: undefined });
  const lower = body.toLowerCase();
  const allowed = allowedIds.map((id) => id.toLowerCase());
  const leaks: string[] = [];
  if (/provenance/i.test(body)) leaks.push('provenance');
  if (/\b\d{2,}\b\D{1,3}\b\d{2,}\b\D{1,3}\b\d{2,}\b/.test(shown)) leaks.push('coordinates');
  for (const id of lower.match(/ag_[a-z0-9_]+/g) ?? []) {
    if (!allowed.includes(id)) leaks.push(`life id ${id}`);
  }
  if (lower.includes(HIDDEN_NAME.toLowerCase()) || lower.includes(HIDDEN_LIFE)) {
    leaks.push('hidden actor');
  }
  return leaks;
}
