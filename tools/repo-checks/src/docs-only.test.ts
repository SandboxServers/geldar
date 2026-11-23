import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { isDocsOnly, isDocsPath } from './docs-only.ts';

const CI = fileURLToPath(new URL('../../../.github/workflows/ci.yml', import.meta.url));
const CLI = fileURLToPath(new URL('./docs-only.ts', import.meta.url));
type Step = { name?: string; run?: string; env?: Record<string, string> };
const jobs = (parse(readFileSync(CI, 'utf8')) as { jobs: Record<string, { steps?: Step[] }> }).jobs;
const SH = spawnSync('sh', ['-c', 'exit 0']).status === 0 ? 'sh' : null;

describe('isDocsPath', () => {
  it('counts docs/ and Markdown outside prompts/ as documentation', () => {
    for (const p of [
      'docs/spec.md',
      'docs/art/skins/zack.PNG',
      'docs/notes.yaml',
      'README.md',
      'glass/README.md',
    ])
      expect(isDocsPath(p), p).toBe(true);
  });

  it('does not count code, config, workflows or prompt templates', () => {
    for (const p of [
      'golem/src/main.ts',
      '.github/workflows/ci.yml',
      'prompts/thought/v1.md',
      'package.json',
      '',
    ])
      expect(isDocsPath(p), p).toBe(false);
  });

  it('does not let a path escape docs/ with ..', () => {
    expect(isDocsPath('docs/../golem/src/main.ts')).toBe(false);
  });
});

describe('isDocsOnly', () => {
  it('is true only when every changed path is documentation', () => {
    expect(isDocsOnly(['docs/spec.md', 'README.md', ''])).toBe(true);
    expect(isDocsOnly(['docs/spec.md', 'sql/0001-init.sql'])).toBe(false);
  });

  it('is false for an empty change list (nothing to compare runs the whole suite)', () => {
    expect(isDocsOnly([])).toBe(false);
    expect(isDocsOnly(['', '  '])).toBe(false);
  });

  it('is false for a code file moved into docs/ (listed as a delete plus an add with --no-renames)', () => {
    expect(isDocsOnly(['golem/src/x.ts', 'docs/x.md'])).toBe(false);
  });
});

describe('docs-only CLI', () => {
  const run = (input: string) => spawnSync(process.execPath, [CLI], { input, encoding: 'utf8' });

  it('prints docs_only=true for a docs-only list', () => {
    expect(run('docs/a.md\nCONTRIBUTING.md\n').stdout).toBe('docs_only=true\n');
  });

  it('prints docs_only=false when any path is code', () => {
    expect(run('docs/a.md\r\neventsink/src/main.ts\r\n').stdout).toBe('docs_only=false\n');
  });
});

describe('ci.yml changes job', () => {
  const classify = jobs.changes?.steps?.find((s) => s.name?.startsWith('classify'));

  it('diffs without rename detection and feeds the classifier', () => {
    expect(classify?.run).toContain('git diff --no-renames --name-only');
    expect(classify?.run).toContain('node tools/repo-checks/src/docs-only.ts');
  });
});

// The gate script runs under sh with the env CI would give it. It must pass a docs-only change that skipped the
// heavy jobs, and fail every other skip or failure.
describe.skipIf(SH === null && !process.env.CI)('ci gate script', () => {
  const step = (jobs as Record<string, { steps?: Step[] }>).gate?.steps?.[0];
  const gate = (env: Record<string, string>) =>
    spawnSync(SH ?? 'sh', ['-c', step?.run ?? 'exit 99'], {
      env: { PATH: process.env.PATH ?? '', ...env },
    }).status;
  const heavySkipped = 'success success skipped skipped skipped skipped skipped skipped';
  const allPass = 'success success success success success success success success';

  it('reads its inputs from the changes and typescript results', () => {
    expect(step?.env?.DOCS_ONLY).toBe('${{ needs.changes.outputs.docs_only }}');
    expect(step?.env?.CHANGES).toBe('${{ needs.changes.result }}');
    expect(step?.env?.TYPESCRIPT).toBe('${{ needs.typescript.result }}');
  });

  it('passes a full run, and a docs-only change with the heavy jobs skipped', () => {
    expect(
      gate({ RESULTS: allPass, CHANGES: 'success', TYPESCRIPT: 'success', DOCS_ONLY: 'false' }),
    ).toBe(0);
    expect(
      gate({ RESULTS: heavySkipped, CHANGES: 'success', TYPESCRIPT: 'success', DOCS_ONLY: 'true' }),
    ).toBe(0);
  });

  it('fails a skip that is not docs only, a failure, or a skipped changes/typescript job', () => {
    expect(
      gate({
        RESULTS: heavySkipped,
        CHANGES: 'success',
        TYPESCRIPT: 'success',
        DOCS_ONLY: 'false',
      }),
    ).toBe(1);
    expect(
      gate({ RESULTS: heavySkipped, CHANGES: 'success', TYPESCRIPT: 'success', DOCS_ONLY: '' }),
    ).toBe(1);
    const failed = 'success success failure skipped skipped skipped skipped skipped';
    expect(
      gate({ RESULTS: failed, CHANGES: 'success', TYPESCRIPT: 'success', DOCS_ONLY: 'true' }),
    ).toBe(1);
    expect(
      gate({ RESULTS: heavySkipped, CHANGES: 'failure', TYPESCRIPT: 'success', DOCS_ONLY: 'true' }),
    ).toBe(1);
    expect(
      gate({ RESULTS: heavySkipped, CHANGES: 'success', TYPESCRIPT: 'skipped', DOCS_ONLY: 'true' }),
    ).toBe(1);
  });
});
