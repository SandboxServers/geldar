import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { checkActionPins } from './pin-rules.ts';

// The Colo deploy workflow (CD-2b). It runs the root-owned entrypoint on the self-hosted node, and only after the
// colo-images workflow succeeded on main. It must never be triggered by a pull request or by a push from a branch.
const WORKFLOW = '.github/workflows/colo-deploy.yml';
const text = readFileSync(new URL(`../../../${WORKFLOW}`, import.meta.url), 'utf8');

type Job = {
  'runs-on'?: string[];
  environment?: string;
  concurrency?: { group?: string; 'cancel-in-progress'?: boolean };
  permissions?: Record<string, string>;
  'timeout-minutes'?: number;
  if?: string;
  steps: { name?: string; uses?: string; run?: string }[];
};
const workflow = parse(text) as {
  on: Record<string, unknown>;
  jobs: Record<string, Job>;
};
const jobs = Object.entries(workflow.jobs);

describe('colo-deploy.yml triggers', () => {
  it('has exactly workflow_run of colo-images and workflow_dispatch, and no pull_request, pull_request_target or push', () => {
    expect(Object.keys(workflow.on).sort()).toEqual(['workflow_dispatch', 'workflow_run']);
    expect(workflow.on.workflow_run).toEqual({ workflows: ['colo-images'], types: ['completed'] });
  });

  it('gates workflow_run on a successful push or dispatch of main from this repository', () => {
    const job = workflow.jobs.deploy as Job;
    expect(job.if).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(job.if).toContain("github.event.workflow_run.head_branch == 'main'");
    expect(job.if).toContain("github.event.workflow_run.event == 'push'");
    expect(job.if).toContain("github.event.workflow_run.event == 'workflow_dispatch'");
    expect(job.if).toContain('github.event.workflow_run.repository.full_name == github.repository');
    expect(job.if).toContain(
      'github.event.workflow_run.head_repository.full_name == github.repository',
    );
  });
});

describe('colo-deploy.yml deploy job', () => {
  it('runs on the node label, in the colo environment, in one serial concurrency group', () => {
    const job = workflow.jobs.deploy as Job;
    expect(job['runs-on']).toEqual(['self-hosted', 'geldar-colo-deploy']);
    expect(job.environment).toBe('colo');
    expect(job.concurrency).toEqual({ group: 'colo-deploy', 'cancel-in-progress': false });
  });

  it('has read-only token permissions and a timeout', () => {
    const job = workflow.jobs.deploy as Job;
    expect(job.permissions).toEqual({ contents: 'read', actions: 'read' });
    expect(job['timeout-minutes']).toBeGreaterThan(0);
  });

  it('checks out no repository code: it calls the entrypoint, which fetches main itself', () => {
    expect(jobs).toHaveLength(1);
    const uses = (workflow.jobs.deploy as Job).steps.map((step) => step.uses ?? '');
    expect(uses.filter((u) => u.startsWith('actions/checkout'))).toEqual([]);
  });
});

describe('colo-deploy.yml pins', () => {
  it('pins every action by full commit SHA', () => {
    expect(checkActionPins(WORKFLOW, text)).toEqual([]);
  });
});
