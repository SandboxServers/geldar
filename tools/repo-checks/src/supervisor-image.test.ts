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
  id?: string;
  uses?: string;
  with?: Record<string, unknown>;
}
interface Job {
  if?: string;
  outputs?: Record<string, string>;
  steps: Step[];
}

// The first Docker mention in a Dockerfile's instructions, as a fixed label, or null. Comment lines are skipped. Every
// instruction is checked, not only RUN: a COPY --from or FROM of a docker image, a VOLUME of the run directory and a
// download from Docker's own host are each a way to put a Docker client in the image.
export function dockerfileMention(text: string): string | null {
  for (const line of text.split('\n')) {
    if (/^\s*#/.test(line)) continue;
    if (/docker\.sock/i.test(line)) return 'the Docker socket path';
    if (/\/var\/run\/docker/i.test(line)) return 'the Docker run directory';
    if (/docker/i.test(line)) return 'a Docker instruction';
  }
  return null;
}

const dockerfile = read(DOCKERFILE);
const workflowText = read(WORKFLOW);
const jobs = (parse(workflowText) as { jobs: Record<string, Job> }).jobs;

function usesOf(job: Job): string[] {
  return job.steps.map((step) => step.uses).filter((uses): uses is string => uses !== undefined);
}

describe('supervisor/Dockerfile: no Docker client, digest-pinned, non-root', () => {
  it('installs no Docker CLI and names no socket path', () => {
    expect(dockerfileMention(dockerfile)).toBeNull();
  });

  it('the scan catches a Docker CLI copied from a docker stage, a docker FROM, a run dir and a download', () => {
    const digest = `@sha256:${'a'.repeat(64)}`;
    expect(
      dockerfileMention('COPY --from=docker:27-cli /usr/local/bin/docker /usr/local/bin/docker'),
    ).not.toBeNull();
    expect(dockerfileMention(`FROM docker:27-cli${digest} AS cli`)).not.toBeNull();
    expect(dockerfileMention('VOLUME /var/run/docker')).toBe('the Docker run directory');
    expect(dockerfileMention('VOLUME /var/run/docker.sock')).toBe('the Docker socket path');
    expect(
      dockerfileMention('RUN curl -fsSL https://download.docker.com/linux/static/x.tgz | tar x'),
    ).not.toBeNull();
    expect(dockerfileMention('RUN apt-get install -y docker-cli')).not.toBeNull();
    expect(dockerfileMention('ADD https://get.docker.com/ /tmp/install.sh')).not.toBeNull();
  });

  it('a comment that mentions Docker is not an instruction', () => {
    expect(dockerfileMention('# holds no Docker socket\nFROM node@sha256:0')).toBeNull();
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

  it('exposes the pushed digest as a job output, read from the push step as the body job does', () => {
    const job = jobs.supervisor as Job;
    expect(job.steps.find((step) => step.uses?.startsWith('docker/build-push-action@'))?.id).toBe(
      'push',
    );
    expect(job.outputs?.digest).toBe(`\${{ steps.push.outputs.digest }}`);
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
