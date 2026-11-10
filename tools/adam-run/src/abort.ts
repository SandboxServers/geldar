/**
 * The abort rules of an Adam run (W6-13, decision 0061). Pure: the status loop feeds the samples in, and a clock
 * (the `now` argument) decides the time windows. A rule fires only when the condition has held for its whole window;
 * a single bad sample is not an abort, except where the card says so (GPU absent, a death when deaths fail the run).
 */

/** One status sample, taken once a minute by the status loop. Missing measures are null, never zero. */
export interface Sample {
  atMs: number;
  /** Ticks per second over the last minute, or null when the Golem has not reported. */
  tps: number | null;
  /** Thought latency p95 over the last 30 minutes, in ms, or null when there is no thought yet. */
  latencyP95Ms: number | null;
  ollamaUp: boolean;
  postgresUp: boolean;
  natsUp: boolean;
  /** Whether the Body process is connected to the server. */
  bodyConnected: boolean;
  /** The GPU that Ollama runs on is visible to the host. */
  gpuPresent: boolean;
  /** Deaths recorded for the life since the run started. */
  deaths: number;
  /** Free disk on the volume that holds the run and the world, in GB. */
  diskFreeGb: number;
  /** The time of the last thought, in ms, or null when none has been made. */
  lastThoughtAtMs: number | null;
}

/** The thresholds, read from `abort-criteria.json`. Every number that stops a run is here, not in the code. */
export interface AbortCriteria {
  tpsMin: number;
  tpsWindowMs: number;
  latencyP95MaxMs: number;
  latencyWindowMs: number;
  serviceDownMs: number;
  bodyDisconnectedMs: number;
  noThoughtMs: number;
  diskMinGb: number;
  deathFailsRun: boolean;
}

export interface AbortReason {
  rule: string;
  reason: string;
}

/**
 * True when `holds` has been true on every sample from the newest back to at least `windowMs` before `now`.
 * The samples must be in time order; the newest is the last one.
 */
export function sustained(
  history: Sample[],
  now: number,
  windowMs: number,
  holds: (s: Sample) => boolean,
): boolean {
  let oldest: Sample | null = null;
  for (let i = history.length - 1; i >= 0; i--) {
    const s = history[i];
    if (s === undefined || !holds(s)) break;
    oldest = s;
  }
  return oldest !== null && now - oldest.atMs >= windowMs;
}

/** The first rule that fires, in the card's order, or null. The status loop stops the run on any non-null result. */
export function evaluateAbort(
  history: Sample[],
  now: number,
  c: AbortCriteria,
): AbortReason | null {
  const last = history[history.length - 1];
  if (last === undefined) return null;
  if (!last.gpuPresent) return { rule: 'gpu', reason: 'the GPU is not visible to the host' };
  if (c.deathFailsRun && last.deaths > (history[0]?.deaths ?? 0)) {
    return { rule: 'death', reason: 'a death happened in the run, and deaths fail it' };
  }
  if (
    sustained(history, now, c.tpsWindowMs, (s) => s.tps !== null && s.tps < c.tpsMin)
  ) {
    return { rule: 'tps', reason: `TPS under ${c.tpsMin} for ${c.tpsWindowMs / 60_000} minutes` };
  }
  if (
    sustained(
      history,
      now,
      c.latencyWindowMs,
      (s) => s.latencyP95Ms !== null && s.latencyP95Ms > c.latencyP95MaxMs,
    )
  ) {
    return {
      rule: 'latency',
      reason: `thought latency p95 over ${c.latencyP95MaxMs} ms for ${c.latencyWindowMs / 60_000} minutes`,
    };
  }
  for (const [name, up] of [
    ['ollama', (s: Sample) => s.ollamaUp],
    ['postgres', (s: Sample) => s.postgresUp],
    ['nats', (s: Sample) => s.natsUp],
  ] as const) {
    if (sustained(history, now, c.serviceDownMs, (s) => !up(s))) {
      return { rule: name, reason: `${name} is down for ${c.serviceDownMs / 60_000} minutes` };
    }
  }
  if (sustained(history, now, c.bodyDisconnectedMs, (s) => !s.bodyConnected)) {
    return { rule: 'body', reason: 'the Body is not connected' };
  }
  if (last.diskFreeGb < c.diskMinGb) {
    return { rule: 'disk', reason: `free disk is ${last.diskFreeGb} GB, under ${c.diskMinGb} GB` };
  }
  const lastThought = last.lastThoughtAtMs;
  if (lastThought === null ? now - (history[0]?.atMs ?? now) >= c.noThoughtMs : now - lastThought >= c.noThoughtMs) {
    return { rule: 'no-thought', reason: `no thought for ${c.noThoughtMs / 60_000} minutes` };
  }
  return null;
}
