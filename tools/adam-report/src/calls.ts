import {
  type Measure,
  PENDING,
  type ReceiptRow,
  type ThoughtRow,
  type Value,
  type Verdict,
} from './types.ts';

const MINUTE_MS = 60_000;

/** The outcome of one row, derived from the columns (the thoughts table has no outcome column). */
export function outcomeOf(t: ThoughtRow): string {
  if (!t.called) return 'tired';
  if (t.errored) return 'error';
  if (t.parsedOk) return 'ok';
  return 'invalid';
}

/** Nearest-rank percentile of a sorted array; null for an empty array. */
export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] ?? null;
}

/** The real minutes (epoch-minute numbers) in which some model call was waited on. */
export function busyMinutes(thoughts: ThoughtRow[]): Set<number> {
  const busy = new Set<number>();
  for (const t of thoughts) {
    if (!t.called) continue;
    const start = Math.floor(t.atMs / MINUTE_MS);
    const end = Math.floor((t.atMs + (t.latencyMs ?? 0)) / MINUTE_MS);
    for (let m = start; m <= end; m++) busy.add(m);
  }
  return busy;
}

/**
 * Useful minutes: a real minute with at least one receipt for an action that belongs to an
 * intent, and no model call waited on during that minute. Non-economic actions have no receipt
 * and are not counted (a stated limit of this measure).
 */
export function usefulMinutes(
  thoughts: ThoughtRow[],
  receipts: ReceiptRow[],
  intentByAction: Map<string, string>,
): number {
  const busy = busyMinutes(thoughts);
  const useful = new Set<number>();
  for (const r of receipts) {
    if (!intentByAction.has(r.actionId)) continue;
    const minute = Math.floor(r.atMs / MINUTE_MS);
    if (!busy.has(minute)) useful.add(minute);
  }
  return useful.size;
}

export interface CallsInput {
  thoughts: ThoughtRow[];
  receipts: ReceiptRow[];
  intentByAction: Map<string, string>;
}

const ratio = (n: number, d: number): number => Math.round((n / d) * 1000) / 1000;

/** Calls per useful minute: thoughts and reflections separately, with the total as the headline. */
export function callsMeasure(input: CallsInput, windowText: string): Measure {
  const called = input.thoughts.filter((t) => t.called);
  const reflections = called.filter((t) => t.wakeReason === 'reflection').length;
  const thoughts = called.length - reflections;
  const useful = usefulMinutes(input.thoughts, input.receipts, input.intentByAction);
  const values: Record<string, Value> = {
    model_calls_total: called.length,
    thought_calls: thoughts,
    reflection_calls: reflections,
    useful_minutes: useful,
  };
  if (useful === 0) {
    return {
      id: 'calls',
      title: 'Inference calls per useful minute',
      verdict: 'UNKNOWN',
      window: windowText,
      values,
      note: 'no useful minute in the window',
    };
  }
  values.per_useful_minute_total = ratio(called.length, useful);
  values.per_useful_minute_thoughts = ratio(thoughts, useful);
  values.per_useful_minute_reflections = ratio(reflections, useful);
  // Spec 10 records this number and gives no threshold for it, so it is INFO: not a PASS that
  // reads as a judged result, and not a FAIL. The note says the number has no threshold.
  return {
    id: 'calls',
    title: 'Inference calls per useful minute',
    verdict: 'INFO',
    window: windowText,
    values,
    note: 'recorded, no threshold in the spec',
  };
}

export interface LatencyInput {
  thoughts: ThoughtRow[];
  p95MaxMs: number | null;
  hardLimitMs: number | null;
}

/** Thought latency from `thoughts.latency_ms`: p50, p95, max, and the hard limit. */
export function latencyMeasure(input: LatencyInput, windowText: string): Measure {
  // An errored call has no answer to time: it is counted apart and kept out of the latency.
  const errored = input.thoughts.filter((t) => t.called && t.errored).length;
  const samples = input.thoughts
    .filter((t) => t.called && !t.errored && t.latencyMs !== null)
    .map((t) => t.latencyMs as number)
    .sort((a, b) => a - b);
  const title = 'Thought latency (p95 under the criterion)';
  if (samples.length === 0) {
    return {
      id: 'latency',
      title,
      verdict: 'UNKNOWN',
      window: windowText,
      values: { samples: 0, errored_calls: errored },
      note: 'no model call with a latency',
    };
  }
  const p50 = percentile(samples, 50);
  const p95 = percentile(samples, 95);
  const max = samples[samples.length - 1] ?? null;
  const values: Record<string, Value> = {
    samples: samples.length,
    errored_calls: errored,
    p50_ms: p50,
    p95_ms: p95,
    max_ms: max,
  };
  if (input.p95MaxMs === null) {
    return { id: 'latency', title, verdict: 'UNKNOWN', window: windowText, values, note: PENDING };
  }
  const over =
    input.hardLimitMs === null
      ? 0
      : samples.filter((s) => s > (input.hardLimitMs as number)).length;
  values.over_hard_limit = over;
  let verdict: Verdict = (p95 ?? 0) < input.p95MaxMs ? 'PASS' : 'FAIL';
  if (over > 0) verdict = 'FAIL';
  const note =
    over > 0 ? `${over} thought(s) past the hard limit` : `p95 compared with ${input.p95MaxMs} ms`;
  return { id: 'latency', title, verdict, window: windowText, values, note };
}

/** The outcome histogram over every row in the window, keys sorted. */
export function outcomeHistogram(thoughts: ThoughtRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const t of thoughts) {
    const key = outcomeOf(t);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}
