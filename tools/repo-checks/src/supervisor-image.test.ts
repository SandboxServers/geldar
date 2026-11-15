import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

// The supervisor image (C7-03b5, decision 0260): no Docker CLI and no socket path in the image, the base image
// digest-pinned and non-root, and a build job in colo-images.yml that uses the same action pins as the body job.
const DOCKERFILE = 'supervisor/Dockerfile';
const WORKFLOW = '.github/workflows/colo-images.yml';

const read = (path: string): string =>
  readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');

interface Step {
  uses?: string;
  with?: Record<string, unknown>;
}
interface Job {
  if?: string;
  steps: Step[];
}

const dockerfile = read(DOCKERFILE);
const workflowText = read(WORKFLOW);
const jobs = (parse(workflowText) as { jobs: Record<string, Job> }).jobs;

function usesOf(job: Job): string[] {
  return job.steps.map((step) => step.uses).filter((uses): uses is string => uses !== undefined);
}

describe('supervisor/Dockerfile: no Docker client, digest-pinned, non-root', () => {
  it('installs no Docker CLI and names no socket path', () => {
    const runLines = dockerfile.split('\n').filter((line) => /^RUN\s/.test(line));
    expect(runLines.filter((line) => /docker/i.test(line))).toEqual([]);
    expect(dockerfile).not.toMatch(/docker\.sock/i);
    expect(dockerfile).not.toMatch(/docker-(ce|cli)|docker\.io/i);
  });

  it('pins every FROM by digest', () => {
    const froms = dockerfile.split('\n').filter((line) => /^FROM\s/.test(line));
    expect(froms.length).toBeGreaterThan(0);
    for (const from of froms) expect(from).toMatch(/@sha256:[0-9a-f]{64}/);
  });

  it('runs as a numeric non-root user', () => {
    const users = [...dockerfile.matchAll(/^USER\s+(\S+)$/gm)].map((match) => match[1]);
    expect(users.at(-1)).toBe('1000:1000');
  });
});

describe('colo-images.yml: the supervisor build job', () => {
  it('builds the supervisor image from its Dockerfile and pushes it as geldar-supervisor', () => {
    const job = jobs.supervisor;
    expect(job).toBeDefined();
    const build = job?.steps.find((step) => step.uses?.startsWith('docker/build-push-action@'));
    expect(build?.with?.file).toBe(DOCKERFILE);
    expect(String(build?.with?.tags)).toContain('ghcr.io/sandboxservers/geldar-supervisor:main');
    expect(String(build?.with?.tags)).toContain(
      `ghcr.io/sandboxservers/geldar-supervisor:\${{ steps.sha.outputs.short }}`,
    );
  });

  it('uses the same action pins as the body job', () => {
    expect(usesOf(jobs.supervisor as Job)).toEqual(usesOf(jobs.body as Job));
  });

  it('runs only on the upstream repository', () => {
    expect(jobs.supervisor?.if).toContain("github.repository == 'SandboxServers/geldar'");
  });

  it('triggers on changes under supervisor/', () => {
    expect(workflowText).toMatch(/^\s+- supervisor\/\*\*$/m);
  });
});
