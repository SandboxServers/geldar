import { describe, expect, it } from 'vitest';
import { JobLedger } from './jobs.ts';

describe('JobLedger', () => {
  it('accepts an answer once, for an issued job, before its deadline', () => {
    let now = 1000;
    const ledger = new JobLedger(() => now);
    ledger.issue('jb_a', 'm', 2000);
    now = 1999;
    expect(ledger.claim('jb_a')).toBe('accepted');
    expect(ledger.anomalies).toBe(0);
  });

  it('refuses a duplicate answer and counts it', () => {
    const ledger = new JobLedger(() => 0);
    ledger.issue('jb_a', 'm', 10);
    expect(ledger.claim('jb_a')).toBe('accepted');
    expect(ledger.claim('jb_a')).toBe('answered');
    expect(ledger.anomalies).toBe(1);
  });

  it('refuses a job id that was never issued here and counts it', () => {
    const ledger = new JobLedger(() => 0);
    expect(ledger.claim('jb_foreign')).toBe('unknown');
    expect(ledger.anomalies).toBe(1);
  });

  it('refuses an answer after the deadline and counts it', () => {
    let now = 0;
    const ledger = new JobLedger(() => now);
    ledger.issue('jb_a', 'm', 100);
    now = 101;
    expect(ledger.claim('jb_a')).toBe('late');
    expect(ledger.anomalies).toBe(1);
  });

  it('drops an answer that crossed our cancel without calling it an anomaly', () => {
    const ledger = new JobLedger(() => 0);
    ledger.issue('jb_a', 'm', 100);
    ledger.cancel('jb_a');
    expect(ledger.claim('jb_a')).toBe('cancelled');
    expect(ledger.anomalies).toBe(0);
    expect(ledger.crossedCancel).toBe(1);
  });

  it('counts open jobs per model, and not answered or cancelled ones', () => {
    const ledger = new JobLedger(() => 0);
    ledger.issue('jb_a', 'x', 100);
    ledger.issue('jb_b', 'x', 100);
    ledger.issue('jb_c', 'y', 100);
    expect(ledger.openCount('x')).toBe(2);
    ledger.claim('jb_a');
    ledger.cancel('jb_b');
    expect(ledger.openCount('x')).toBe(0);
    expect(ledger.openCount('y')).toBe(1);
  });
});
