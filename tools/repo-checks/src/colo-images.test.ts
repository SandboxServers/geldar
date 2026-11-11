import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { checkActionPins } from './pin-rules.ts';
import { parseFirstPartyPrefixes } from './release-age.ts';

// The Colo image workflow (decision 0084): it publishes four first-party images and writes the release manifest.
const WORKFLOW = '.github/workflows/colo-images.yml';
const RELEASE_EXAMPLE = 'deploy/release.env.example';
const text = readFileSync(new URL(`../../../${WORKFLOW}`, import.meta.url), 'utf8');

/** The four published images: the Dockerfile each is built from and the repository it is pushed to. */
const IMAGES = [
  { job: 'body', file: 'golem/Dockerfile', repository: 'geldar-body', key: 'GELDAR_BODY_IMAGE' },
  {
    job: 'mind',
    file: 'animus/Dockerfile.mind',
    repository: 'geldar-mind',
    key: 'GELDAR_MIND_IMAGE',
  },
  {
    job: 'eventsink',
    file: 'eventsink/Dockerfile',
    repository: 'geldar-eventsink',
    key: 'GELDAR_EVENTSINK_IMAGE',
  },
  {
    job: 'mcp',
    file: 'threshold/mcp/Dockerfile',
    repository: 'geldar-mcp',
    key: 'GELDAR_MCP_IMAGE',
  },
];

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

/** A `uses:` value pinned to a full 40-hex commit SHA. */
function isPinnedUses(uses: string): boolean {
  return /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/.test(uses);
}

/**
 * Problems in one image's Dockerfile and its sibling .dockerignore: every FROM digest-pinned, the last USER not
 * root, and the .dockerignore excluding `**\/.env*`. The inputs are the file texts, so the rule is testable alone.
 */
function imageHygieneProblems(dockerfile: string, dockerignore: string): string[] {
  const problems: string[] = [];
  const froms = dockerfile.split('\n').filter((line) => /^FROM\s/.test(line));
  if (froms.length === 0) problems.push('no FROM line');
  for (const from of froms) {
    if (!/@sha256:[0-9a-f]{64}/.test(from)) problems.push(`FROM is not digest-pinned: ${from}`);
  }
  const users = [...dockerfile.matchAll(/^USER\s+(\S+)/gm)].map((m) => m[1]);
  const lastUser = users.at(-1);
  if (lastUser === undefined) problems.push('no USER line (the image would run as root)');
  else if (/^(root|0)(:.*)?$/.test(lastUser)) problems.push(`last USER is root: ${lastUser}`);
  if (!dockerignore.split('\n').some((line) => line.trim() === '**/.env*')) {
    problems.push('.dockerignore does not exclude **/.env*');
  }
  return problems;
}

describe('colo-images.yml triggers', () => {
  it('runs on a push to main and on manual dispatch, never on a pull request', () => {
    expect(Object.keys(workflow.on).sort()).toEqual(['push', 'workflow_dispatch']);
    expect(workflow.on.push?.branches).toEqual(['main']);
  });

  it('is path-filtered to the image sources, the MCP sources and the lockfile', () => {
    const paths = workflow.on.push?.paths ?? [];
    for (const required of [
      'golem/**',
      'animus/**',
      'eventsink/**',
      'threshold/mcp/**',
      'shards/phase0.yaml',
      'tools/repo-checks/src/identity-mode.ts',
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
    expect(uses.filter((u) => !isPinnedUses(u))).toEqual([]);
    expect(checkActionPins(WORKFLOW, text)).toEqual([]);
  });

  it('accepts a SHA pin and refuses a tag, a branch or a short SHA', () => {
    expect(isPinnedUses('docker/login-action@81c6f93d4bc991e510b342a00b419b3bb4efc5c6')).toBe(true);
    expect(isPinnedUses('docker/login-action@v4')).toBe(false);
    expect(isPinnedUses('docker/login-action@main')).toBe(false);
    expect(isPinnedUses('docker/login-action@81c6f93')).toBe(false);
  });

  it('uses no secret other than GITHUB_TOKEN', () => {
    const secrets = [...text.matchAll(/secrets\.([A-Za-z0-9_]+)/g)].map((m) => m[1]);
    expect(secrets.length).toBeGreaterThan(0);
    expect(secrets.filter((name) => name !== 'GITHUB_TOKEN')).toEqual([]);
  });

  it('grants the top level only contents: read', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' });
  });

  it('grants packages: write only to the four image jobs, and each of them only to the upstream repository', () => {
    const imageJobs = IMAGES.map((image) => image.job).sort();
    const writers = Object.entries(jobs)
      .filter(([, job]) => job.permissions?.packages === 'write')
      .map(([name]) => name)
      .sort();
    expect(writers).toEqual(imageJobs);
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
    expect(builds.map((step) => step.with?.file).sort()).toEqual(
      IMAGES.map((image) => image.file).sort(),
    );
    for (const step of builds) {
      expect(step.with?.push).toBe(true);
      expect(step.with?.provenance).toBe(false);
      expect(step.with?.sbom).toBe(false);
    }
  });

  it('keeps each image Dockerfile in the repository, digest-pinned, non-root, with a .env ignore', () => {
    for (const image of IMAGES) {
      expect(existsSync(new URL(`../../../${image.file}`, import.meta.url))).toBe(true);
      const dockerfile = readFileSync(new URL(`../../../${image.file}`, import.meta.url), 'utf8');
      const ignorePath = `${image.file}.dockerignore`;
      const dockerignore = readFileSync(new URL(`../../../${ignorePath}`, import.meta.url), 'utf8');
      expect(imageHygieneProblems(dockerfile, dockerignore), image.file).toEqual([]);
    }
  });

  it('refuses a root image, an unpinned FROM and a missing .env ignore', () => {
    const pinned = `FROM node:22-slim@sha256:${'a'.repeat(64)}`;
    expect(imageHygieneProblems(`${pinned}\nUSER 1000:1000\n`, '**/.env*')).toEqual([]);
    expect(imageHygieneProblems(`${pinned}\n`, '**/.env*')).toEqual([
      'no USER line (the image would run as root)',
    ]);
    expect(imageHygieneProblems(`${pinned}\nUSER root\n`, '**/.env*')).toEqual([
      'last USER is root: root',
    ]);
    expect(imageHygieneProblems('FROM node:22-slim\nUSER 1000\n', '**/.env*')).toEqual([
      'FROM is not digest-pinned: FROM node:22-slim',
    ]);
    expect(imageHygieneProblems(`${pinned}\nUSER 1000\n`, '*\n')).toEqual([
      '.dockerignore does not exclude **/.env*',
    ]);
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
    expect(unique).toEqual(
      IMAGES.map((image) => `ghcr.io/sandboxservers/${image.repository}`).sort(),
    );
    for (const repository of unique) {
      expect(parsed.prefixes.some((prefix) => repository.startsWith(prefix))).toBe(true);
    }
  });

  it('tags each image with main and a 12-character commit, and reads the digest from the push step', () => {
    for (const image of IMAGES) {
      expect(jobs[image.job]?.outputs?.digest).toBe(`\${{ steps.push.outputs.digest }}`);
    }
    expect(text).toContain(`\${GITHUB_SHA:0:12}`);
    expect(text.match(/:main$/gm)?.length).toBe(IMAGES.length);
  });
});

describe('colo-images.yml release manifest', () => {
  const manifest = jobs.manifest;

  it('runs after the four image jobs', () => {
    expect(([] as string[]).concat(manifest?.needs ?? []).sort()).toEqual(
      IMAGES.map((image) => image.job).sort(),
    );
  });

  it('validates all four digests before it writes the manifest', () => {
    const validator = manifest?.steps.find((step) => step.run?.includes('for digest in'));
    const loop = validator?.run?.match(/for digest in ([^;]+); do/)?.[1] ?? '';
    for (const image of IMAGES) {
      expect(loop).toContain(`"$${image.job.toUpperCase()}_DIGEST"`);
    }
  });

  it('writes release.env with the four *_IMAGE digest references', () => {
    const writer = manifest?.steps.find((step) => step.run?.includes('> release.env'));
    expect(writer).toBeDefined();
    for (const image of IMAGES) {
      expect(writer?.run).toContain(
        `${image.key}=ghcr.io/sandboxservers/${image.repository}@$${image.job.toUpperCase()}_DIGEST`,
      );
    }
  });

  it('keeps the example manifest in step with the four keys, each a digest reference', () => {
    const example = readFileSync(new URL(`../../../${RELEASE_EXAMPLE}`, import.meta.url), 'utf8');
    const digestRef = /^[A-Za-z0-9./:_-]+@sha256:[0-9a-f]{64}$/;
    const values = new Map(
      example
        .split('\n')
        .filter((line) => /^[A-Z][A-Z0-9_]*_IMAGE=/.test(line))
        .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
    );
    for (const image of IMAGES) {
      expect(values.has(image.key), image.key).toBe(true);
      expect(digestRef.test(values.get(image.key) ?? ''), image.key).toBe(true);
    }
    expect([...values.keys()].sort()).toEqual(IMAGES.map((image) => image.key).sort());
  });

  it('uploads release.env as the artifact of the same name', () => {
    const upload = manifest?.steps.find((step) =>
      step.uses?.startsWith('actions/upload-artifact@'),
    );
    expect(upload?.with).toMatchObject({ name: 'release.env', path: 'release.env' });
  });
});
