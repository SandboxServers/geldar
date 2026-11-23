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

  // A skipped job fails the gate unless the change is docs only, so the one job-level condition allowed on a needed
  // job is the docs-only skip, and only on a job that needs `changes` (where that output comes from).
  it('conditions a needed job only on the docs-only skip', () => {
    const DOCS_SKIP = "needs.changes.outputs.docs_only != 'true'";
    for (const name of jobs.gate?.needs ?? []) {
      const job = jobs[name];
      if (job?.if === undefined) continue;
      expect(job.if, name).toBe(DOCS_SKIP);
      expect(([] as string[]).concat(job.needs ?? []), name).toContain('changes');
    }
  });

  it('never skips changes or typescript (typescript tests read docs/)', () => {
    expect(jobs.changes?.if).toBeUndefined();
    expect(jobs.typescript?.if).toBeUndefined();
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
