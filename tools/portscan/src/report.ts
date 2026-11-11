import type { PortRange } from './expected.ts';
import { verdict } from './verdict.ts';

export interface ReportInput {
  target: string;
  startedAt: string;
  range: PortRange;
  expected: readonly number[];
  open: readonly number[];
}

/** The JSON report. It holds the target argument and the port sets only: no banner, no service data, no host name read from the network. */
export interface PortReport {
  target: string;
  startedAt: string;
  range: PortRange;
  expected: number[];
  open: number[];
  missing: number[];
  extra: number[];
  verdict: 'pass' | 'fail';
}

export function buildReport(input: ReportInput): PortReport {
  const result = verdict(input.expected, input.open);
  return {
    target: input.target,
    startedAt: input.startedAt,
    range: { low: input.range.low, high: input.range.high },
    expected: [...input.expected].sort((a, b) => a - b),
    open: result.open,
    missing: result.missing,
    extra: result.extra,
    verdict: result.pass ? 'pass' : 'fail',
  };
}
