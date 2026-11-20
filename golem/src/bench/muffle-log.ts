/**
 * Parses the plugin's `muffle-bench` log lines (written when `chat.muffle.bench_log` is on, one per
 * chat line) and summarizes them for the MH-8a cost bench. Pure: no I/O, no server.
 */

// Matched anywhere in the line, so the docker prefix (`paper-1  | [12:00:00 INFO]: [GeldarCore] `),
// the console format and the latest.log format all parse. `ns=(\d+)\b` refuses a negative ns.
const LINE =
  /muffle-bench line speaker=(\S+) tick=(\d+) listeners=(\d+) reads=(\d+) capHit=(true|false) ns=(\d+)\b/;

/** One parsed `muffle-bench line` record. */
export interface MuffleBenchLine {
  speaker: string;
  tick: number;
  listeners: number;
  reads: number;
  capHit: boolean;
  ns: number;
}

/** Nearest-rank p50, p95 and max of one measure. */
export interface Stats {
  p50: number;
  p95: number;
  max: number;
}

/** What `summarizeMuffle` reports: line count, per-line reads and ns stats, and capHit lines. */
export interface MuffleSummary {
  lines: number;
  reads: Stats | null;
  ns: Stats | null;
  capHit: number;
}

/** The record in a `muffle-bench line` log line, or null when the line is not one. */
export function parseMuffleBenchLine(line: string): MuffleBenchLine | null {
  const match = LINE.exec(line.trim());
  if (!match) return null;
  return {
    speaker: match[1] as string,
    tick: Number(match[2]),
    listeners: Number(match[3]),
    reads: Number(match[4]),
    capHit: match[5] === 'true',
    ns: Number(match[6]),
  };
}

/** Every `muffle-bench line` record in a log text, in order; other lines are skipped. */
export function parseMuffleLog(text: string): MuffleBenchLine[] {
  const records: MuffleBenchLine[] = [];
  for (const line of text.split('\n')) {
    const record = parseMuffleBenchLine(line);
    if (record) records.push(record);
  }
  return records;
}

/** Nearest-rank percentile (p in 1..100) of an ascending, non-empty list. */
export function percentile(sorted: number[], p: number): number {
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] as number;
}

function statsOf(values: number[]): Stats | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1] as number,
  };
}

/** Per-line reads and ns percentiles, and how many lines hit the read cap. */
export function summarizeMuffle(records: readonly MuffleBenchLine[]): MuffleSummary {
  return {
    lines: records.length,
    reads: statsOf(records.map((r) => r.reads)),
    ns: statsOf(records.map((r) => r.ns)),
    capHit: records.filter((r) => r.capHit).length,
  };
}

/** One server tick: how many bench lines it logged, and their summed reads and ns. */
export interface TickTotal {
  tick: number;
  lines: number;
  reads: number;
  ns: number;
}

/**
 * Per-tick aggregation. The `*PerTick` stats are taken across ticks: p50, p95 and max of each tick's
 * line count, summed reads and summed ns. `worst` is the tick with the largest summed ns (the lowest tick
 * number wins a tie), so a burst that lands K lines in one tick shows up here.
 */
export interface TickSummary {
  ticks: number;
  linesPerTick: Stats | null;
  readsPerTick: Stats | null;
  nsPerTick: Stats | null;
  worst: TickTotal | null;
}

/** Groups the records by tick and totals each tick. Pure. */
export function totalsByTick(records: readonly MuffleBenchLine[]): TickTotal[] {
  const byTick = new Map<number, TickTotal>();
  for (const r of records) {
    const total = byTick.get(r.tick) ?? { tick: r.tick, lines: 0, reads: 0, ns: 0 };
    total.lines += 1;
    total.reads += r.reads;
    total.ns += r.ns;
    byTick.set(r.tick, total);
  }
  return [...byTick.values()].sort((a, b) => a.tick - b.tick);
}

/** Per-tick aggregation of a log: the stats of each tick's totals, and the worst tick by summed ns. */
export function summarizeByTick(records: readonly MuffleBenchLine[]): TickSummary {
  const totals = totalsByTick(records);
  let worst: TickTotal | null = null;
  for (const t of totals) {
    if (worst === null || t.ns > worst.ns) worst = t;
  }
  return {
    ticks: totals.length,
    linesPerTick: statsOf(totals.map((t) => t.lines)),
    readsPerTick: statsOf(totals.map((t) => t.reads)),
    nsPerTick: statsOf(totals.map((t) => t.ns)),
    worst,
  };
}
