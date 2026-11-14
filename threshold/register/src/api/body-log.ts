// The body log tail (C7-04c, 0170 point 4): the fixed text of each supervisor event and the tail filter.
// A line carries only the fixed text of its code. A model-supplied string or digit never reaches the owner.

/** The most lines one log read returns (0170: the smaller of 200 events or 7 days). */
export const LOG_MAX_LINES = 200;
/** Events older than this are not returned (0170: 7 days). */
export const LOG_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const FIXED_TEXT = new Map<string, string>([
  ['started', 'Body started.'],
  ['stopped', 'Body stopped.'],
  ['restarted', 'Body restarted.'],
  ['crashed', 'Body stopped unexpectedly.'],
  ['refused', 'Request refused.'],
]);
const OTHER_TEXT = 'Event.';

export interface LogLine {
  at: string;
  text: string;
}

/** One supervisor event: a time and a fixed-text code (the supervisor never sends free text). */
export interface SupervisorEvent {
  at: string;
  code: string;
}

/** The limit of a log read: 200 by default; null when the value is not an integer from 1 to 200. */
export function parseLogLimit(raw: string | null): number | null {
  if (raw === null) return LOG_MAX_LINES;
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= LOG_MAX_LINES ? n : null;
}

/** The fixed text for an event code. A code outside the table reads as `other`, never as the raw code. */
export function fixedText(code: string): string {
  return FIXED_TEXT.get(code) ?? OTHER_TEXT;
}

/** The newest `limit` events no older than 7 days, each as `{at, text}` with the fixed text. */
export function logTail(events: readonly SupervisorEvent[], now: number, limit: number): LogLine[] {
  const floor = now - LOG_MAX_AGE_MS;
  const kept: LogLine[] = [];
  for (const event of events) {
    const at = Date.parse(event.at);
    if (Number.isNaN(at) || at < floor) continue;
    kept.push({ at: new Date(at).toISOString(), text: fixedText(event.code) });
  }
  return kept.slice(-limit);
}
