import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

type Job = { needs?: string | string[]; if?: string; permissions?: Record<string, string> };

function jobsOf(file: string): Record<string, Job> {
  const text = readFileSync(new URL(`../../../.github/workflows/${file}`, import.meta.url), 'utf8');
  return parse(text).jobs as Record<string, Job>;
}

describe('ci.yml gate', () => {
  const jobs = jobsOf('ci.yml');
  const gateNeeds = ([] as string[]).concat(jobs.gate?.needs ?? []);

  it('lists every other job in its needs, so no job can fail without failing the gate', () => {
    const others = Object.keys(jobs).filter((name) => name !== 'gate');
    expect(others.length).toBeGreaterThan(0);
    expect(others.filter((name) => !gateNeeds.includes(name))).toEqual([]);
  });

  it('names no job that does not exist', () => {
    expect(gateNeeds.filter((name) => !(name in jobs))).toEqual([]);
  });
});

describe('mcp-mock-image.yml publishing', () => {
  const jobs = jobsOf('mcp-mock-image.yml');
  const writers = Object.entries(jobs).filter(([, job]) => job.permissions?.packages === 'write');

  it('grants packages: write only to a job that runs on main, never on pull requests', () => {
    expect(writers.map(([name]) => name)).toEqual(['publish']);
    for (const [, job] of writers) {
      expect(job.if).toContain("github.ref == 'refs/heads/main'");
      expect(job.if).toContain("github.event_name != 'pull_request'");
    }
  });

  it('runs the publish job only after the image test job', () => {
    expect(([] as string[]).concat(jobs.publish?.needs ?? [])).toContain('image');
  });
});
