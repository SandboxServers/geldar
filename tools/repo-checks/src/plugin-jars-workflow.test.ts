import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// The plugin-jars workflow (GE-01a, GE-01w1b): after the artifact upload, it checks the committed lock against the build.
const WORKFLOW = '.github/workflows/plugin-jars.yml';
const LOCK = 'plugin/plugin-jars.lock';
const text = readFileSync(new URL(`../../../${WORKFLOW}`, import.meta.url), 'utf8');

type Step = {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
  if?: unknown;
  'continue-on-error'?: unknown;
};
const workflow = parse(text) as { jobs: Record<string, { steps: Step[] }> };
const steps = workflow.jobs['plugin-jars']?.steps ?? [];
const uploadIndex = steps.findIndex((step) => step.uses?.startsWith('actions/upload-artifact@'));
const verifyIndex = steps.findIndex((step) => step.run?.includes('verify-plugin-lock.sh'));
const verifyRun = steps[verifyIndex]?.run ?? '';

describe('plugin-jars.yml committed lock check', () => {
  it('has the lock file the check reads', () => {
    expect(existsSync(new URL(`../../../${LOCK}`, import.meta.url))).toBe(true);
  });

  it('reads the lock from the built commit through the existing checkout', () => {
    expect(steps[0]?.uses?.startsWith('actions/checkout@')).toBe(true);
    expect(steps[0]?.with).toBeUndefined();
    expect(steps[0]?.uses).toMatch(/@[0-9a-f]{40}$/);
  });

  it('runs after the artifact upload, as the last step, so the artifact survives a failed check', () => {
    expect(uploadIndex).toBeGreaterThanOrEqual(0);
    expect(verifyIndex).toBeGreaterThan(uploadIndex);
    expect(verifyIndex).toBe(steps.length - 1);
  });

  it('cannot soft-fail: the verify step has no continue-on-error and no if condition', () => {
    const verify = steps[verifyIndex];
    expect(verify).toBeDefined();
    expect(verify).not.toHaveProperty('continue-on-error');
    expect(verify).not.toHaveProperty('if');
  });

  it('checks the uploaded directory against the committed lock, strictly', () => {
    expect(verifyRun).toContain(`sh deploy/genesis/verify-plugin-lock.sh plugin-jars ${LOCK}`);
    expect(verifyRun).not.toContain('--allow-pending');
  });

  it('fails the job with a message that says the committed lock differs from the build', () => {
    expect(verifyRun).toContain('exit 1');
    expect(verifyRun).toContain('the committed plugin/plugin-jars.lock differs from this build');
    expect(verifyRun).toContain('Update the lock');
  });
});
