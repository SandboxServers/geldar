import type { DiagSink } from '../actions/stall-diag.ts';

/**
 * The ownership lookup counters (decision 0217): how the Body's block ownership client answers, so
 * `geldar-worldops` can see whether CoreProtect answers at all. Counts only: no coordinates and no
 * player names. The block names of the interval are item IDs (decision 0219), counted per name.
 */

/** Distinct block names the interval counts by name; any further name is counted under `other`. */
export const BLOCK_NAMES_PER_INTERVAL = 8;

/** The `ownership_lookups` line goes out at most once in this many ms, and only when a lookup or query happened. */
export const OWNERSHIP_LOG_INTERVAL_MS = 60_000;

/**
 * How one chunk query ended: a complete reply (`answered`), a truncated one (`truncated`, its cells are
 * unknown), no answer at all (`unknown`: a timeout or no responder), or a reply that did not parse or
 * broke the contract (`error`).
 */
export type QueryOutcome = 'answered' | 'truncated' | 'unknown' | 'error';

interface Tally {
  lookups: number;
  cache_hits: number;
  queries: number;
  answered: number;
  truncated: number;
  unknown: number;
  errors: number;
  latency_samples: number;
  latency_total_ms: number;
  latency_max_ms: number;
  /** Parsed owned cells that carried a block name (decision 0219). */
  with_block: number;
  /** Per block name, interval only: at most BLOCK_NAMES_PER_INTERVAL distinct names. */
  block_names: Map<string, number>;
  block_other: number;
}

const emptyTally = (): Tally => ({
  lookups: 0,
  cache_hits: 0,
  queries: 0,
  answered: 0,
  truncated: 0,
  unknown: 0,
  errors: 0,
  latency_samples: 0,
  latency_total_ms: 0,
  latency_max_ms: 0,
  with_block: 0,
  block_names: new Map(),
  block_other: 0,
});

/** The counts one Body's ownership client keeps. */
export interface OwnershipCounters {
  /** One ownership lookup; `cacheHit` when a complete cached chunk answered it. */
  lookup(cacheHit: boolean): void;
  /** One chunk query sent to the plugin. */
  query(): void;
  /** One chunk query that ended, with its latency in ms. */
  settled(outcome: QueryOutcome, latencyMs: number): void;
  /** One parsed owned cell that carried this block name (decision 0219). */
  block(name: string): void;
  /** Clears the timer: no further line. */
  stop(): void;
}

export interface OwnershipCountersOptions {
  /** Where the line goes: the top-level diagnostic sink, not the body log's envelope. */
  diag: DiagSink;
  intervalMs?: number;
}

const view = (tally: Tally) => ({
  lookups: tally.lookups,
  cache_hits: tally.cache_hits,
  queries: tally.queries,
  answered: tally.answered,
  truncated: tally.truncated,
  unknown: tally.unknown,
  errors: tally.errors,
  with_block: tally.with_block,
  avg_latency_ms:
    tally.latency_samples === 0 ? null : Math.round(tally.latency_total_ms / tally.latency_samples),
  max_latency_ms: tally.latency_samples === 0 ? null : tally.latency_max_ms,
});

/** Starts the counters of one Body: a timer emits the cumulative and the interval counts each minute. */
export function startOwnershipCounters(options: OwnershipCountersOptions): OwnershipCounters {
  const intervalMs = options.intervalMs ?? OWNERSHIP_LOG_INTERVAL_MS;
  const total = emptyTally();
  let current = emptyTally();
  const each = (apply: (tally: Tally) => void): void => {
    apply(total);
    apply(current);
  };
  const flush = (): void => {
    // Idle: no lookup and no query in the interval, so no line.
    if (current.lookups === 0 && current.queries === 0) return;
    options.diag.log(
      JSON.stringify({
        event: 'ownership_lookups',
        interval_ms: intervalMs,
        total: view(total),
        interval: {
          ...view(current),
          blocks: Object.fromEntries(current.block_names),
          other: current.block_other,
        },
      }),
    );
    current = emptyTally();
  };
  const timer = setInterval(flush, intervalMs);
  timer.unref();
  return {
    lookup(cacheHit: boolean): void {
      each((tally) => {
        tally.lookups += 1;
        if (cacheHit) tally.cache_hits += 1;
      });
    },
    query(): void {
      each((tally) => {
        tally.queries += 1;
      });
    },
    settled(outcome: QueryOutcome, latencyMs: number): void {
      each((tally) => {
        if (outcome === 'error') tally.errors += 1;
        else tally[outcome] += 1;
        tally.latency_samples += 1;
        tally.latency_total_ms += latencyMs;
        tally.latency_max_ms = Math.max(tally.latency_max_ms, latencyMs);
      });
    },
    block(name: string): void {
      each((tally) => {
        tally.with_block += 1;
      });
      const seen = current.block_names.get(name);
      if (seen !== undefined) current.block_names.set(name, seen + 1);
      else if (current.block_names.size < BLOCK_NAMES_PER_INTERVAL)
        current.block_names.set(name, 1);
      else current.block_other += 1;
    },
    stop(): void {
      clearInterval(timer);
    },
  };
}
