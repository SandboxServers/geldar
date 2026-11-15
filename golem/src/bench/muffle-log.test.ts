import { describe, expect, it } from 'vitest';
import { parseMuffleBenchLine, parseMuffleLog, percentile, summarizeMuffle } from './muffle-log.ts';

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

  it('refuses a line with extra text before or after', () => {
    expect(parseMuffleBenchLine(`[INFO] ${GOOD}`)).toBeNull();
    expect(parseMuffleBenchLine(`${GOOD} extra`)).toBeNull();
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
