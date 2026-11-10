import type { Restart } from './types.ts';

/** What the harness wrote on status.log for one run: its restarts, whether it aborted, whether it ended. */
export interface RunStatus {
  restarts: Restart[];
  aborted: boolean;
  ended: boolean;
}

/** The harness lines that are restarts: a planned stack restart, or a Body kill (tools/adam-run/src/sequence.ts). */
const RESTART_EVENTS = new Map<string, Restart['kind']>([
  ['restart_stack', 'planned'],
  ['body_kill', 'body'],
]);

/**
 * Reads the text of status.log (one JSON line per minute, written by tools/adam-run/src/status-log.ts).
 * Restarts come from the harness's own lines, with their `at` time. A line that does not parse is skipped.
 * Pure: the caller reads the file, and an empty text is a run with no lines (partial, not aborted).
 */
export function parseStatusLog(text: string): RunStatus {
  const status: RunStatus = { restarts: [], aborted: false, ended: false };
  for (const raw of text.split('\n')) {
    if (raw.trim() === '') continue;
    let line: { at?: unknown; event?: unknown };
    try {
      line = JSON.parse(raw);
    } catch {
      continue;
    }
    if (typeof line.event !== 'string') continue;
    if (line.event === 'abort') status.aborted = true;
    if (line.event === 'end' || line.event === 'ended') status.ended = true;
    const kind = RESTART_EVENTS.get(line.event);
    const atMs = typeof line.at === 'string' ? Date.parse(line.at) : Number.NaN;
    if (kind !== undefined && !Number.isNaN(atMs)) status.restarts.push({ atMs, kind });
  }
  return status;
}
