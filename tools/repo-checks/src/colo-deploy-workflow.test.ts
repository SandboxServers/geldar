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
  steps: { name?: string; uses?: string; run?: string; 'timeout-minutes'?: number }[];
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
    // checks: read is read-only; the manifest step needs it to read the check-run annotation fallback.
    // toEqual fails on any write permission or any other added permission.
    expect(job.permissions).toEqual({ contents: 'read', actions: 'read', checks: 'read' });
    expect(job['timeout-minutes']).toBe(30);
    const download = job.steps.find((s) => s.name?.startsWith('download the release manifest'));
    expect(download?.['timeout-minutes']).toBe(5);
  });

  it('checks out no repository code: it calls the entrypoint, which fetches main itself', () => {
    expect(jobs).toHaveLength(1);
    const uses = (workflow.jobs.deploy as Job).steps.map((step) => step.uses ?? '');
    expect(uses.filter((u) => u.startsWith('actions/checkout'))).toEqual([]);
  });
});

describe('colo-deploy.yml commands', () => {
  it('runs no gh command: the runner has no GitHub CLI, so the steps call the REST API with curl and jq', () => {
    const ghCommand = /(^|[^\w.-])gh(\s|$)/m;
    const runs = (workflow.jobs.deploy as Job).steps.map((step) => step.run ?? '');
    expect(runs.filter((run) => ghCommand.test(run))).toEqual([]);
  });
});

describe('colo-deploy.yml pins', () => {
  it('pins every action by full commit SHA', () => {
    expect(checkActionPins(WORKFLOW, text)).toEqual([]);
  });
});
