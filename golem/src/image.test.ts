import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Static checks on the Body image (golem/Dockerfile and its ignore file), read as text. No build runs here;
// the build and the container smoke are the image gate (docs/analysis/phase1/worknotes/P1-C1-03.md).
const repoRoot = resolve(import.meta.dirname, '..', '..');
const dockerfile = readFileSync(join(repoRoot, 'golem', 'Dockerfile'), 'utf8');
const ignoreLines = readFileSync(join(repoRoot, 'golem', 'Dockerfile.dockerignore'), 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line !== '' && !line.startsWith('#'));

/** The instructions of a Dockerfile: the non-empty lines that are not comments. */
function instructions(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

/** The name and value of each ARG or ENV line, in the `NAME=value` and `NAME value` forms. */
function assignments(lines: string[]): { name: string; value: string }[] {
  return lines.flatMap((line) => {
    const match = /^(?:ARG|ENV)\s+([A-Za-z_][A-Za-z0-9_]*)(?:=|\s+)(.*)$/.exec(line);
    return match === null ? [] : [{ name: match[1] ?? '', value: match[2] ?? '' }];
  });
}

const lines = instructions(dockerfile);

describe('golem/Dockerfile (the Body image)', () => {
  it('pins every base image by digest', () => {
    const froms = lines.filter((line) => line.startsWith('FROM '));
    expect(froms.length).toBeGreaterThan(0);
    for (const from of froms) {
      expect(from).toMatch(/^FROM \S+@sha256:[0-9a-f]{64}( AS \w+)?$/);
    }
  });

  it('installs from the frozen lockfile', () => {
    expect(dockerfile).toMatch(
      /RUN pnpm install --frozen-lockfile --prod --ignore-scripts --filter "@geldar\/golem\.\.\."/,
    );
  });

  it('bakes in no credential: a PASSWORD or TOKEN name is only ever a *_FILE path', () => {
    for (const { name, value } of assignments(lines)) {
      if (!/PASSWORD|TOKEN|SECRET/i.test(name)) continue;
      expect(name, `${name} is baked in as a value`).toMatch(/_FILE$/);
      expect(value, `${name} must be a path`).toMatch(/^\//);
    }
  });

  it('does not copy secrets or env files into the image', () => {
    const copies = lines.filter((line) => line.startsWith('COPY '));
    expect(copies.length).toBeGreaterThan(0);
    for (const copy of copies) {
      expect(copy).not.toMatch(/secrets|\.env/);
    }
  });

  it('runs as a non-root user', () => {
    const user = lines.filter((line) => line.startsWith('USER ')).at(-1);
    expect(user).toBeDefined();
    expect(user).not.toMatch(/^USER (root|0)(:|$)/);
  });

  it('starts an entry point that exists in the repository', () => {
    const entry = lines.find((line) => line.startsWith('ENTRYPOINT '));
    expect(entry).toBeDefined();
    const argv = JSON.parse(entry?.slice('ENTRYPOINT'.length).trim() ?? '[]') as string[];
    const script = argv.at(-1) ?? '';
    expect(existsSync(join(repoRoot, 'golem', script))).toBe(true);
  });
});

describe('golem/Dockerfile.dockerignore', () => {
  it('is an allowlist that leaves out secrets, env files, tests and node_modules', () => {
    expect(ignoreLines).toEqual(
      expect.arrayContaining([
        '*',
        '!golem',
        '**/node_modules',
        'golem/test',
        '**/*.test.ts',
        'compose/secrets',
        '**/*.env',
        '**/.env*',
        '**/*.fakes.ts',
      ]),
    );
  });
});
