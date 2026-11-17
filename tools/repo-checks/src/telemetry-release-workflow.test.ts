import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { checkActionPins } from './pin-rules.ts';

// The telemetry release workflow (decision 0373). It runs only on a pushed `telemetry-v*` tag, holds only
// contents: write, uses only GITHUB_TOKEN, and never publishes to a registry or overwrites a release.
const WORKFLOW = '.github/workflows/telemetry-release.yml';
const text = readFileSync(new URL(`../../../${WORKFLOW}`, import.meta.url), 'utf8');

type Step = { name?: string; uses?: string; run?: string; env?: Record<string, string> };
const workflow = parse(text) as {
  on: Record<string, unknown>;
  permissions?: Record<string, string>;
  jobs: Record<string, { permissions?: Record<string, string>; steps: Step[] }>;
};
const steps = Object.values(workflow.jobs).flatMap((job) => job.steps);

describe('telemetry-release.yml', () => {
  it('triggers on a push of telemetry-v* tags only: no branches, no pull_request, no dispatch', () => {
    expect(workflow.on).toEqual({ push: { tags: ['telemetry-v*'] } });
  });

  it('holds contents: write and nothing else, at the top level and in every job', () => {
    expect(workflow.permissions).toEqual({ contents: 'write' });
    for (const job of Object.values(workflow.jobs)) {
      expect(job.permissions ?? { contents: 'write' }).toEqual({ contents: 'write' });
    }
  });

  it('uses no secret except GITHUB_TOKEN', () => {
    const secrets = [...text.matchAll(/secrets\.([A-Za-z0-9_]+)/g)].map((m) => m[1]);
    expect(secrets.length).toBeGreaterThan(0);
    expect(secrets.filter((name) => name !== 'GITHUB_TOKEN')).toEqual([]);
  });

  it('never publishes to a registry', () => {
    const runs = steps.map((s) => s.run ?? '').join('\n');
    expect(runs).not.toMatch(/\b(?:pnpm|npm|yarn)\b[^\n]*\bpublish\b/);
  });

  it('pins every action by commit SHA', () => {
    expect(checkActionPins(WORKFLOW, text)).toEqual([]);
  });

  it('checks the tag against the package version, and fails when a release already exists', () => {
    const runs = steps.map((s) => s.run ?? '').join('\n');
    expect(runs).toMatch(/"\$TAG" != "telemetry-v\$\{version\}"/);
    expect(runs).toContain('gh release view "$TAG"');
    expect(runs).toContain('gh release create "$TAG"');
    expect(runs).toContain('--verify-tag');
    expect(runs).not.toContain('--clobber');
    expect(runs).not.toContain('gh release upload');
    expect(runs).not.toContain('--draft');
  });

  it('tests, builds and packs before it creates the release', () => {
    const order = [
      'pnpm --filter @geldar/telemetry typecheck',
      'pnpm --filter @geldar/telemetry test',
      'pnpm --filter @geldar/telemetry build',
      'pnpm --filter @geldar/telemetry pack',
      'gh release create',
    ].map((command) => steps.findIndex((s) => (s.run ?? '').includes(command)));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});
