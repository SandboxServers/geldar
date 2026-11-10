/**
 * `status.log`: one JSON line per minute, appended and never rewritten. A line is the sample the sampler took, with
 * the harness events (a restart, a Body kill, an abort) written as lines of their own.
 */
import { type FileStore, type Observation, PROBES, type Probe } from './ports.ts';

export interface StatusLine {
  minute: number;
  at: string;
  alive: Record<Probe, boolean | null>;
  thoughts: number | null;
  last_thought_at: string | null;
  tps: number | null;
  errors_since_last: number | null;
  /** Set on the harness's own lines: `restart_stack`, `body_kill`, `abort`, `safe_stop`, `report_failed`, `end`. */
  event?: string;
  detail?: string;
}

export const MINUTE_MS = 60_000;

/** The whole minutes from the run start (`minute` on each line). */
export function minuteOf(atMs: number, runStartedAtMs: number): number {
  return Math.round((atMs - runStartedAtMs) / MINUTE_MS);
}

const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

export function statusLine(
  obs: Observation,
  minute: number,
  event?: string,
  detail?: string,
): StatusLine {
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

/** A harness line written before the first sample (the sampler failed, or `adam up` did): every measure is null. */
export function eventOnlyLine(
  atMs: number,
  minute: number,
  event: string,
  detail: string,
): StatusLine {
  const alive = Object.fromEntries(PROBES.map((p) => [p, null])) as Record<Probe, null>;
  return {
    minute,
    at: new Date(atMs).toISOString(),
    alive,
    thoughts: null,
    last_thought_at: null,
    tps: null,
    errors_since_last: null,
    event,
    detail,
  };
}

/** Appends one line. The store has no rewrite for this file, so an earlier line can never change. */
export function appendStatus(store: FileStore, path: string, line: StatusLine): void {
  store.append(path, `${JSON.stringify(line)}\n`);
}
