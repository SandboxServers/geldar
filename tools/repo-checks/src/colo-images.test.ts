import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { checkActionPins } from './pin-rules.ts';
import { parseFirstPartyPrefixes } from './release-age.ts';

// The Colo image workflow (decision 0084): it publishes three first-party images and writes the release manifest.
const WORKFLOW = '.github/workflows/colo-images.yml';
const text = readFileSync(new URL(`../../../${WORKFLOW}`, import.meta.url), 'utf8');

type Step = {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
};
type Job = {
  needs?: string | string[];
  if?: string;
  permissions?: Record<string, string>;
  outputs?: Record<string, string>;
  steps: Step[];
};
const workflow = parse(text) as {
  on: Record<string, { branches?: string[]; paths?: string[] } | null>;
  permissions: Record<string, string>;
  jobs: Record<string, Job>;
};
const jobs = workflow.jobs;
const allSteps = Object.values(jobs).flatMap((job) => job.steps);

/** The build-push steps, one per image job. */
const builds = Object.values(jobs).flatMap((job) =>
  job.steps.filter((step) => step.uses?.startsWith('docker/build-push-action@')),
);

describe('colo-images.yml triggers', () => {
  it('runs on a push to main and on manual dispatch, never on a pull request', () => {
    expect(Object.keys(workflow.on).sort()).toEqual(['push', 'workflow_dispatch']);
    expect(workflow.on.push?.branches).toEqual(['main']);
  });

  it('is path-filtered to the image sources and the lockfile', () => {
    const paths = workflow.on.push?.paths ?? [];
    for (const required of [
      'golem/**',
      'animus/**',
      'eventsink/**',
      'contract/**',
      'pnpm-lock.yaml',
    ]) {
      expect(paths).toContain(required);
    }
  });
});

describe('colo-images.yml pins and permissions', () => {
  it('pins every uses: to a full 40-hex commit SHA', () => {
    const uses = allSteps.flatMap((step) => (step.uses ? [step.uses] : []));
    expect(uses.length).toBeGreaterThan(0);
    expect(uses.filter((u) => !/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/.test(u))).toEqual([]);
    expect(checkActionPins(WORKFLOW, text)).toEqual([]);
  });

  it('uses no secret other than GITHUB_TOKEN', () => {
    const secrets = [...text.matchAll(/secrets\.([A-Za-z0-9_]+)/g)].map((m) => m[1]);
    expect(secrets.length).toBeGreaterThan(0);
    expect(secrets.filter((name) => name !== 'GITHUB_TOKEN')).toEqual([]);
  });

  it('grants the top level only contents: read', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' });
  });

  it('grants packages: write only to the three image jobs, and each of them only to the upstream repository', () => {
    const writers = Object.entries(jobs)
      .filter(([, job]) => job.permissions?.packages === 'write')
      .map(([name]) => name)
      .sort();
    expect(writers).toEqual(['body', 'eventsink', 'mind']);
    for (const [name, job] of Object.entries(jobs)) {
      expect(job.permissions ?? {}).toEqual(
        writers.includes(name) ? { contents: 'read', packages: 'write' } : { contents: 'read' },
      );
      expect(job.if).toContain("github.repository == 'SandboxServers/geldar'");
    }
  });
});

describe('colo-images.yml images', () => {
  it('builds each image from its own Dockerfile and pushes it without provenance or SBOM', () => {
    expect(builds.map((step) => step.with?.file).sort()).toEqual([
      'animus/Dockerfile.mind',
      'eventsink/Dockerfile',
      'golem/Dockerfile',
    ]);
    for (const step of builds) {
      expect(step.with?.push).toBe(true);
      expect(step.with?.provenance).toBe(false);
      expect(step.with?.sbom).toBe(false);
    }
  });

  it('names each image under a first-party allowlisted prefix, one name per image', () => {
    const allowlist = readFileSync(new URL('./first-party-images.json', import.meta.url), 'utf8');
    const parsed = parseFirstPartyPrefixes(allowlist, 'first-party-images.json');
    expect(parsed.problems).toEqual([]);
    const repositories = builds.flatMap((step) =>
      String(step.with?.tags ?? '')
        .split('\n')
        .map((tag) => tag.trim())
        .filter((tag) => tag !== '')
        .map((tag) => tag.slice(0, tag.lastIndexOf(':'))),
    );
    const unique = [...new Set(repositories)].sort();
    expect(unique).toEqual([
      'ghcr.io/sandboxservers/geldar-body',
      'ghcr.io/sandboxservers/geldar-eventsink',
      'ghcr.io/sandboxservers/geldar-mind',
    ]);
    for (const repository of unique) {
      expect(parsed.prefixes.some((prefix) => repository.startsWith(prefix))).toBe(true);
    }
  });

  it('tags each image with main and a 12-character commit, and reads the digest from the push step', () => {
    for (const job of ['body', 'mind', 'eventsink']) {
      expect(jobs[job]?.outputs?.digest).toBe(`\${{ steps.push.outputs.digest }}`);
    }
    expect(text).toContain(`\${GITHUB_SHA:0:12}`);
    expect(text.match(/:main$/gm)?.length).toBe(3);
  });
});

describe('colo-images.yml release manifest', () => {
  const manifest = jobs.manifest;

  it('runs after the three image jobs', () => {
    expect(([] as string[]).concat(manifest?.needs ?? []).sort()).toEqual([
      'body',
      'eventsink',
      'mind',
    ]);
  });

  it('writes release.env with the three *_IMAGE digest references', () => {
    const writer = manifest?.steps.find((step) => step.run?.includes('> release.env'));
    expect(writer).toBeDefined();
    expect(writer?.run).toContain(
      'GELDAR_BODY_IMAGE=ghcr.io/sandboxservers/geldar-body@$BODY_DIGEST',
    );
    expect(writer?.run).toContain(
      'GELDAR_MIND_IMAGE=ghcr.io/sandboxservers/geldar-mind@$MIND_DIGEST',
    );
    expect(writer?.run).toContain(
      'GELDAR_EVENTSINK_IMAGE=ghcr.io/sandboxservers/geldar-eventsink@$EVENTSINK_DIGEST',
    );
  });

  it('uploads release.env as the artifact of the same name', () => {
    const upload = manifest?.steps.find((step) =>
      step.uses?.startsWith('actions/upload-artifact@'),
    );
    expect(upload?.with).toMatchObject({ name: 'release.env', path: 'release.env' });
  });
});
