import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Static checks on the sink image (eventsink/Dockerfile and its ignore file), read as text. The workspace
// dependency on @geldar/telemetry needs three things to line up: the package.json entry, the COPY and
// the allowlist line (the T-06 and T-07 container lessons).
const repoRoot = resolve(import.meta.dirname, '..', '..');
const read = (path: string): string => readFileSync(join(repoRoot, path), 'utf8');
const meaningful = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));

const dockerfile = meaningful(read('eventsink/Dockerfile'));
const ignoreLines = meaningful(read('eventsink/Dockerfile.dockerignore'));

describe('eventsink image', () => {
  it('depends on @geldar/telemetry as a workspace package', () => {
    const pkg = JSON.parse(read('eventsink/package.json')) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies['@geldar/telemetry']).toBe('workspace:*');
  });

  it('copies telemetry and the allowlist lets it into the build context', () => {
    expect(dockerfile).toContain('COPY telemetry ./telemetry');
    expect(ignoreLines).toContain('!telemetry');
  });

  it('re-includes every local COPY source', () => {
    const sources = dockerfile
      .filter((line) => line.startsWith('COPY ') && !line.includes('--from='))
      .flatMap((line) => line.slice('COPY '.length).split(/\s+/).slice(0, -1));
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources.filter((s) => !s.endsWith('.yaml') && !s.endsWith('.json'))) {
      expect(ignoreLines, `COPY ${source} has no !${source} line`).toContain(`!${source}`);
    }
  });

  it('installs from the frozen lockfile for the sink and its workspace dependencies', () => {
    expect(dockerfile).toContain(
      'RUN pnpm install --frozen-lockfile --prod --filter @geldar/eventsink...',
    );
  });
});
