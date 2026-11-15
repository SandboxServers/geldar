import { describe, expect, it } from 'vitest';
import {
  parseMuffleBenchLine,
  parseMuffleLog,
  percentile,
  summarizeByTick,
  summarizeMuffle,
} from './muffle-log.ts';

const GOOD =
  'muffle-bench line speaker=MuffleBench00 tick=1200 listeners=14 reads=86 capHit=false ns=5400';

describe('parseMuffleBenchLine', () => {
  it('reads every field of a well-formed line', () => {
    expect(parseMuffleBenchLine(GOOD)).toEqual({
      speaker: 'MuffleBench00',
      tick: 1200,
      listeners: 14,
      reads: 86,
      capHit: false,
      ns: 5400,
    });
  });

  it('reads capHit=true and tolerates a trailing carriage return', () => {
    const record = parseMuffleBenchLine(`${GOOD.replace('false', 'true')}\r`);
    expect(record?.capHit).toBe(true);
  });

  it('refuses a line with a missing field', () => {
    expect(parseMuffleBenchLine(GOOD.replace(' ns=5400', ''))).toBeNull();
  });

  it('refuses a line with a non-numeric count', () => {
    expect(parseMuffleBenchLine(GOOD.replace('reads=86', 'reads=8x'))).toBeNull();
  });

  it('refuses a capHit that is not true or false', () => {
    expect(parseMuffleBenchLine(GOOD.replace('capHit=false', 'capHit=yes'))).toBeNull();
  });

  it('accepts the docker compose prefix', () => {
    const line = `paper-1  | [12:00:00 INFO]: [GeldarCore] ${GOOD}`;
    expect(parseMuffleBenchLine(line)?.tick).toBe(1200);
  });

  it('accepts the server console format', () => {
    const line = `[12:00:00 INFO]: [GeldarCore] ${GOOD}`;
    expect(parseMuffleBenchLine(line)?.speaker).toBe('MuffleBench00');
  });

  it('accepts the latest.log format', () => {
    const line = `[12:00:00] [Server thread/INFO]: [GeldarCore] ${GOOD}`;
    expect(parseMuffleBenchLine(line)?.ns).toBe(5400);
  });

  it('refuses a negative ns', () => {
    expect(parseMuffleBenchLine(GOOD.replace('ns=5400', 'ns=-5400'))).toBeNull();
  });

  it('refuses a different log line and an empty line', () => {
    expect(parseMuffleBenchLine('Done (3.2s)! For help, type "help"')).toBeNull();
    expect(parseMuffleBenchLine('')).toBeNull();
  });
});

describe('parseMuffleLog', () => {
  it('keeps the matching lines in order and skips the rest', () => {
    const text = [
      'server starting',
      GOOD,
      'muffle-bench line speaker=MuffleBench00 tick=1240 listeners=14 reads=3 capHit=true ns=900',
      'garbage muffle-bench line',
    ].join('\n');
    const records = parseMuffleLog(text);
    expect(records.map((r) => r.tick)).toEqual([1200, 1240]);
    expect(records[1]?.capHit).toBe(true);
  });
});

describe('percentile', () => {
  it('uses nearest rank on an ascending list', () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(sorted, 50)).toBe(5);
    expect(percentile(sorted, 95)).toBe(10);
    expect(percentile(sorted, 10)).toBe(1);
    expect(percentile(sorted, 100)).toBe(10);
  });

  it('returns the only value of a one-item list for every p', () => {
    expect(percentile([7], 50)).toBe(7);
    expect(percentile([7], 95)).toBe(7);
  });
});

/** One fixture log line, in the plugin's format, for a given speaker, tick, reads and ns. */
const fixture = (speaker: number, tick: number, reads: number, ns: number): string =>
  `[12:00:00 INFO]: [GeldarCore] muffle-bench line speaker=MuffleBench0${speaker} tick=${tick} ` +
  `listeners=8 reads=${reads} capHit=false ns=${ns}`;

describe('summarizeByTick', () => {
  // Tick 100 holds a 3-speaker burst (3 lines), tick 101 one line, tick 102 two lines and the worst ns.
  const text = [
    fixture(0, 100, 10, 1000),
    fixture(1, 100, 20, 2000),
    fixture(2, 100, 30, 3000),
    fixture(0, 101, 5, 500),
    fixture(0, 102, 8, 4000),
    fixture(1, 102, 8, 4000),
  ].join('\n');

  it('totals each tick: lines, summed reads and summed ns', () => {
    const summary = summarizeByTick(parseMuffleLog(text));
    expect(summary.ticks).toBe(3);
    expect(summary.linesPerTick).toEqual({ p50: 2, p95: 3, max: 3 });
    expect(summary.readsPerTick).toEqual({ p50: 16, p95: 60, max: 60 });
    expect(summary.nsPerTick).toEqual({ p50: 6000, p95: 8000, max: 8000 });
  });

  it('reports the worst tick by summed ns', () => {
    const summary = summarizeByTick(parseMuffleLog(text));
    expect(summary.worst).toEqual({ tick: 102, lines: 2, reads: 16, ns: 8000 });
  });

  it('counts a burst tick as one tick with every speaker line in it', () => {
    const burst = summarizeByTick(parseMuffleLog(text.split('\n').slice(0, 3).join('\n')));
    expect(burst.ticks).toBe(1);
    expect(burst.worst).toEqual({ tick: 100, lines: 3, reads: 60, ns: 6000 });
  });

  it('breaks an ns tie by the lowest tick number', () => {
    const tied = [fixture(0, 205, 1, 700), fixture(0, 200, 1, 700), fixture(0, 210, 1, 100)];
    expect(summarizeByTick(parseMuffleLog(tied.join('\n'))).worst?.tick).toBe(200);
  });

  it('is empty for no lines, with null stats and no worst tick', () => {
    expect(summarizeByTick([])).toEqual({
      ticks: 0,
      linesPerTick: null,
      readsPerTick: null,
      nsPerTick: null,
      worst: null,
    });
  });
});

describe('summarizeMuffle', () => {
  const line = (reads: number, ns: number, capHit: boolean) => ({
    speaker: 'MuffleBench00',
    tick: 0,
    listeners: 14,
    reads,
    capHit,
    ns,
  });

  it('reports p50, p95, max of reads and ns, and counts capHit lines', () => {
    const records = [
      line(10, 300, false),
      line(20, 100, true),
      line(30, 200, false),
      line(40, 400, true),
    ];
    expect(summarizeMuffle(records)).toEqual({
      lines: 4,
      reads: { p50: 20, p95: 40, max: 40 },
      ns: { p50: 200, p95: 400, max: 400 },
      capHit: 2,
    });
  });

  it('is empty for no lines, with null stats', () => {
    expect(summarizeMuffle([])).toEqual({ lines: 0, reads: null, ns: null, capHit: 0 });
  });
});
