import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const CI = fileURLToPath(new URL('../../../.github/workflows/ci.yml', import.meta.url));

type Job = { needs?: string[]; if?: string };
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

  it('has no job-level condition on a needed job (a skipped job would fail the gate)', () => {
    for (const name of jobs.gate?.needs ?? []) expect(jobs[name]?.if).toBeUndefined();
  });
});
