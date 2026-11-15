import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiagSink } from '../actions/stall-diag.ts';
import { OWNERSHIP_LOG_INTERVAL_MS, startOwnershipCounters } from './ownership-counters.ts';

type Totals = Record<string, number | null>;
interface Line {
  event: string;
  interval_ms: number;
  total: Totals;
  interval: Totals;
}

const sink = (lines: string[]): DiagSink => ({
  log: (line: string) => {
    lines.push(line);
  },
  now: () => 0,
});
const parse = (line: string | undefined): Line => JSON.parse(line ?? 'null') as Line;

describe('ownership counters (decision 0217)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits nothing while no lookup or query happened', () => {
    const lines: string[] = [];
    const counters = startOwnershipCounters({ diag: sink(lines) });
    vi.advanceTimersByTime(OWNERSHIP_LOG_INTERVAL_MS * 3);
    expect(lines).toEqual([]);
    counters.stop();
  });

  it('emits one line per minute with cumulative and interval counts, then resets the interval', () => {
    const lines: string[] = [];
    const counters = startOwnershipCounters({ diag: sink(lines) });
    counters.lookup(true);
    counters.query();
    counters.settled('answered', 10);
    vi.advanceTimersByTime(OWNERSHIP_LOG_INTERVAL_MS);
    expect(lines).toHaveLength(1);
    expect(parse(lines[0]).total).toMatchObject({
      lookups: 1,
      cache_hits: 1,
      queries: 1,
      answered: 1,
      avg_latency_ms: 10,
      max_latency_ms: 10,
    });
    counters.lookup(false);
    counters.settled('error', 30);
    vi.advanceTimersByTime(OWNERSHIP_LOG_INTERVAL_MS);
    expect(lines).toHaveLength(2);
    const second = parse(lines[1]);
    expect(second.interval_ms).toBe(OWNERSHIP_LOG_INTERVAL_MS);
    expect(second.interval).toMatchObject({
      lookups: 1,
      cache_hits: 0,
      queries: 0,
      answered: 0,
      errors: 1,
      avg_latency_ms: 30,
      max_latency_ms: 30,
    });
    expect(second.total).toMatchObject({
      lookups: 2,
      cache_hits: 1,
      answered: 1,
      errors: 1,
      avg_latency_ms: 20,
      max_latency_ms: 30,
    });
    counters.stop();
  });

  it('reports null latency when no query has settled', () => {
    const lines: string[] = [];
    const counters = startOwnershipCounters({ diag: sink(lines) });
    counters.lookup(false);
    vi.advanceTimersByTime(OWNERSHIP_LOG_INTERVAL_MS);
    expect(parse(lines[0]).total).toMatchObject({
      avg_latency_ms: null,
      max_latency_ms: null,
      answered: 0,
      truncated: 0,
      unknown: 0,
      errors: 0,
    });
    counters.stop();
  });

  it('the line is one top-level JSON object with the event name and the counts only', () => {
    const lines: string[] = [];
    const counters = startOwnershipCounters({ diag: sink(lines) });
    counters.query();
    counters.settled('truncated', 5);
    vi.advanceTimersByTime(OWNERSHIP_LOG_INTERVAL_MS);
    expect(Object.keys(parse(lines[0])).sort()).toEqual([
      'event',
      'interval',
      'interval_ms',
      'total',
    ]);
    expect(parse(lines[0]).event).toBe('ownership_lookups');
    expect(parse(lines[0]).total).toMatchObject({ truncated: 1 });
    counters.stop();
  });

  it('stop clears the timer, so no line follows', () => {
    const lines: string[] = [];
    const counters = startOwnershipCounters({ diag: sink(lines) });
    counters.lookup(false);
    counters.stop();
    vi.advanceTimersByTime(OWNERSHIP_LOG_INTERVAL_MS * 2);
    expect(lines).toEqual([]);
  });

  it('the interval is 60000 ms: no line at 59_999 ms, exactly one at 60_000 ms', () => {
    const lines: string[] = [];
    const counters = startOwnershipCounters({ diag: sink(lines) });
    counters.lookup(false);
    vi.advanceTimersByTime(59_999);
    expect(lines).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(lines).toHaveLength(1);
    expect(parse(lines[0]).interval_ms).toBe(60000);
    counters.stop();
  });

  it('total and interval carry exactly the documented counts, no other keys', () => {
    const lines: string[] = [];
    const counters = startOwnershipCounters({ diag: sink(lines) });
    counters.lookup(true);
    counters.settled('answered', 4);
    vi.advanceTimersByTime(OWNERSHIP_LOG_INTERVAL_MS);
    const documented = [
      'answered',
      'avg_latency_ms',
      'cache_hits',
      'errors',
      'lookups',
      'max_latency_ms',
      'queries',
      'truncated',
      'unknown',
      'with_block',
    ];
    const line = parse(lines[0]);
    expect(Object.keys(line.total).sort()).toEqual(documented);
    expect(Object.keys(line.interval).sort()).toEqual([...documented, 'blocks', 'other'].sort());
    counters.stop();
  });

  it('counts the parsed block names: with_block in both, and a per-name count in the interval', () => {
    const lines: string[] = [];
    const counters = startOwnershipCounters({ diag: sink(lines) });
    counters.query();
    counters.block('farmland');
    counters.block('farmland');
    counters.block('dirt');
    vi.advanceTimersByTime(OWNERSHIP_LOG_INTERVAL_MS);
    const line = parse(lines[0]);
    expect(line.total.with_block).toBe(3);
    expect(line.interval.with_block).toBe(3);
    expect(line.interval.blocks).toEqual({ farmland: 2, dirt: 1 });
    expect(line.interval.other).toBe(0);
    expect(line.total).not.toHaveProperty('blocks');
    counters.stop();
  });

  it('caps the names at 8 per interval: a ninth distinct name counts under other, a known name still counts', () => {
    const lines: string[] = [];
    const counters = startOwnershipCounters({ diag: sink(lines) });
    counters.query();
    for (let i = 0; i < 10; i++) counters.block(`block_${i}`);
    counters.block('block_0');
    vi.advanceTimersByTime(OWNERSHIP_LOG_INTERVAL_MS);
    const line = parse(lines[0]);
    expect(Object.keys(line.interval.blocks ?? {})).toHaveLength(8);
    expect(line.interval.blocks).toMatchObject({ block_0: 2, block_7: 1 });
    expect(line.interval.blocks).not.toHaveProperty('block_8');
    expect(line.interval.other).toBe(2);
    expect(line.total.with_block).toBe(11);
    counters.stop();
  });

  it('the next interval starts its names and other again; the total keeps with_block', () => {
    const lines: string[] = [];
    const counters = startOwnershipCounters({ diag: sink(lines) });
    counters.query();
    for (let i = 0; i < 9; i++) counters.block(`block_${i}`);
    vi.advanceTimersByTime(OWNERSHIP_LOG_INTERVAL_MS);
    counters.query();
    counters.block('dirt');
    vi.advanceTimersByTime(OWNERSHIP_LOG_INTERVAL_MS);
    const second = parse(lines[1]);
    expect(second.interval.blocks).toEqual({ dirt: 1 });
    expect(second.interval.other).toBe(0);
    expect(second.total.with_block).toBe(10);
    counters.stop();
  });

  it('the timer is unref-ed, so a live Body does not hold the process open', () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    const counters = startOwnershipCounters({ diag: sink([]) });
    const handle = spy.mock.results[0]?.value;
    expect(handle?.hasRef()).toBe(false);
    counters.stop();
    spy.mockRestore();
  });
});
