import { describe, expect, it } from 'vitest';
import { buildReport } from '../src/report.ts';
import { verdict } from '../src/verdict.ts';

describe('verdict: the open set must equal the expected set exactly', () => {
  it('passes when the open set matches the expected list', () => {
    const result = verdict([25565, 25570], [25570, 25565]);
    expect(result).toEqual({ pass: true, open: [25565, 25570], missing: [], extra: [] });
  });

  it('fails when one open port is not expected', () => {
    const result = verdict([25565], [25565, 8080]);
    expect(result.pass).toBe(false);
    expect(result.extra).toEqual([8080]);
    expect(result.missing).toEqual([]);
  });

  it('fails when one expected port is not open', () => {
    const result = verdict([25565, 25570], [25565]);
    expect(result.pass).toBe(false);
    expect(result.missing).toEqual([25570]);
    expect(result.extra).toEqual([]);
  });

  it('passes a closed-range run when nothing is open and nothing is expected', () => {
    expect(verdict([], [])).toEqual({ pass: true, open: [], missing: [], extra: [] });
  });

  it('fails a closed-range run when a port opens that was not expected', () => {
    expect(verdict([], [1]).pass).toBe(false);
  });
});

describe('buildReport: the report holds the port sets and the verdict, and nothing else', () => {
  it('has exactly the fixed keys and no banner or service field', () => {
    const report = buildReport({
      target: '127.0.0.1',
      startedAt: '2026-11-11T00:00:00.000Z',
      range: { low: 1, high: 65535 },
      expected: [25565],
      open: [25565],
    });
    expect(Object.keys(report).sort()).toEqual(
      ['expected', 'extra', 'missing', 'open', 'range', 'startedAt', 'target', 'verdict'].sort(),
    );
    expect(report.verdict).toBe('pass');
  });

  it('reports fail with the extra port named', () => {
    const report = buildReport({
      target: 'scan-fixture.invalid',
      startedAt: '2026-11-11T00:00:00.000Z',
      range: { low: 25560, high: 25570 },
      expected: [25565],
      open: [25565, 25566],
    });
    expect(report.verdict).toBe('fail');
    expect(report.extra).toEqual([25566]);
  });
});
