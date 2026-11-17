import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const CI = fileURLToPath(new URL('../../../.github/workflows/ci.yml', import.meta.url));

type Job = { needs?: string[]; if?: string; steps?: unknown[] };
const jobs = (parse(readFileSync(CI, 'utf8')) as { jobs: Record<string, Job> }).jobs;

// `ci gate` is the one required check: a job it does not need guards nothing, and a job with a job-level `if`
// can be skipped, which the gate counts as a failure.
describe('ci gate wiring', () => {
  it('needs every other job', () => {
    const others = Object.keys(jobs)
      .filter((name) => name !== 'gate')
      .sort();
    expect([...(jobs.gate?.needs ?? [])].sort()).toEqual(others);
  });

  it('includes the neoforge lane', () => {
    expect(jobs.gate?.needs).toContain('neoforge');
  });

  it('neoforge lane prints a test summary and uploads reports only on failure, for 7 days', () => {
    const steps = (jobs.neoforge?.steps ?? []) as Array<{
      name?: string;
      if?: string;
      uses?: string;
      with?: { 'retention-days'?: number };
    }>;
    const summary = steps.find((s) => s.name?.startsWith('test summary'));
    const upload = steps.find((s) => s.uses?.startsWith('actions/upload-artifact@'));
    expect(summary?.if).toBe('always()');
    expect(upload?.if).toBe('failure()');
    expect(upload?.uses).toMatch(/@[0-9a-f]{40}$/);
    expect(upload?.with?.['retention-days']).toBe(7);
  });

  it('has no job-level condition on a needed job (a skipped job would fail the gate)', () => {
    for (const name of jobs.gate?.needs ?? []) expect(jobs[name]?.if).toBeUndefined();
  });
});

// A wrapper stored as 100644 fails on Linux with "Permission denied" before Gradle starts (the neoforge-ledger lane did).
describe('gradle wrappers', () => {
  it('every tracked gradlew is executable in the git index (mode 100755)', () => {
    const root = fileURLToPath(new URL('../../../', import.meta.url));
    const listing = execFileSync('git', ['ls-files', '-s', '--', '*gradlew'], {
      cwd: root,
      encoding: 'utf8',
    });
    const wrappers = listing.split('\n').filter((l) => /\sgradlew$|\/gradlew$/.test(l));
    expect(wrappers.length).toBeGreaterThan(0);
    expect(wrappers.filter((l) => !l.startsWith('100755 '))).toEqual([]);
  });
});
