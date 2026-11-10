/**
 * `status.log`: one JSON line per minute, appended and never rewritten. A line is the sample the sampler took, with
 * the harness events (a restart, a Body kill, an abort) written as lines of their own.
 */
import { PROBES, type FileStore, type Observation, type Probe } from './ports.ts';

export interface StatusLine {
  minute: number;
  at: string;
  alive: Record<Probe, boolean>;
  thoughts: number;
  last_thought_at: string | null;
  tps: number | null;
  errors_since_last: number;
  /** Set on the harness's own lines: `restart-stack`, `body-kill`, `body-start`, `abort`, `end`. */
  event?: string;
  detail?: string;
}

const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

export function statusLine(obs: Observation, minute: number, event?: string, detail?: string): StatusLine {
  const alive = Object.fromEntries(PROBES.map((p) => [p, obs.alive[p]])) as Record<Probe, boolean>;
  const line: StatusLine = {
    minute,
    at: new Date(obs.atMs).toISOString(),
    alive,
    thoughts: obs.thoughts,
    last_thought_at: iso(obs.lastThoughtAtMs),
    tps: obs.tps,
    errors_since_last: obs.errorsSinceLast,
  };
  if (event !== undefined) line.event = event;
  if (detail !== undefined) line.detail = detail;
  return line;
}

/** Appends one line. The store has no rewrite for this file, so an earlier line can never change. */
export function appendStatus(store: FileStore, path: string, line: StatusLine): void {
  store.append(path, `${JSON.stringify(line)}\n`);
}
