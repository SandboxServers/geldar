import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { describe, expect, it } from 'vitest';

// The admin image (decision 0133) runs the mcp-tokens CLI. That CLI imports golem files by relative path, so the
// image does not start unless its Dockerfile copies them (C1-11b, finisher A: the image closure).
const DOCKERFILE = 'tools/admin/Dockerfile';
const CLI = 'tools/mcp-tokens/src/cli.ts';
const dockerfile = readFileSync(new URL(`../../../${DOCKERFILE}`, import.meta.url), 'utf8');
const cli = readFileSync(new URL(`../../../${CLI}`, import.meta.url), 'utf8');

/** The repo-relative golem paths the CLI imports (`../../../golem/...` from tools/mcp-tokens/src). */
function golemImports(source: string): string[] {
  const specs = [...source.matchAll(/from\s+['"](\.\.\/[^'"]*)['"]/g)].map((m) => m[1] ?? '');
  return specs
    .map((spec) => posix.normalize(posix.join(posix.dirname(CLI), spec)))
    .filter((path) => path.startsWith('golem/'));
}

/** The build-context sources of the Dockerfile's COPY lines (the ones that copy from the context, not from a stage). */
function copySources(dockerfileText: string): string[] {
  return dockerfileText
    .split('\n')
    .filter((line) => /^COPY\s/.test(line) && !line.includes('--from='))
    .flatMap((line) => line.trim().split(/\s+/).slice(1, -1))
    .map((source) => posix.normalize(source));
}

/** A path is in the image when a COPY source names it or one of its parent directories. */
function copiedInto(path: string, sources: string[]): boolean {
  return sources.some((source) => path === source || path.startsWith(`${source}/`));
}

describe('tools/admin/Dockerfile: the golem files the mcp-tokens CLI imports are in the image', () => {
  it('imports at least one golem file, so the check below is not vacuous', () => {
    expect(golemImports(cli).length).toBeGreaterThan(0);
  });

  it('copies every golem file the CLI imports (a COPY source names it or a parent directory)', () => {
    const sources = copySources(dockerfile);
    const missing = golemImports(cli).filter((path) => !copiedInto(path, sources));
    expect(missing).toEqual([]);
  });

  it('copies golem/package.json and installs the @geldar/golem closure, for the @nats-io packages the imports need', () => {
    expect(copySources(dockerfile)).toContain('golem/package.json');
    expect(dockerfile).toContain('--filter "@geldar/golem..."');
  });

  it('refuses a COPY that names only a sibling directory (golem/test is not golem/src)', () => {
    const sources = copySources('COPY golem/test ./golem/test\n');
    expect(copiedInto('golem/src/players/life-removal.ts', sources)).toBe(false);
    expect(copiedInto('golem/src/players/life-removal.ts', ['golem/src'])).toBe(true);
  });
});
