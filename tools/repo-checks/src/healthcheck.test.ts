import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** The text of a repo file, read from the repo root. */
function repoFile(rel: string): string {
  return readFileSync(fileURLToPath(new URL(`../../../${rel}`, import.meta.url)), 'utf8');
}

/** The one `test:` line of a compose healthcheck that names the given marker file. */
function healthTest(compose: string, marker: string): string {
  const lines = compose
    .split('\n')
    .filter((l) => l.trim().startsWith('test:') && l.includes(marker));
  expect(lines, `one healthcheck names ${marker}`).toHaveLength(1);
  return lines[0] ?? '';
}

describe('shard healthchecks', () => {
  const compose = repoFile('compose/phase0.yml');

  it('never read the rolling server log', () => {
    // Paper and Velocity roll latest.log at midnight UTC; a check that reads it turns a live server unhealthy.
    const tests = compose.split('\n').filter((l) => l.trim().startsWith('test:'));
    expect(tests.length).toBeGreaterThan(0);
    expect(tests.join('\n')).not.toContain('latest.log');
  });

  it('prove the Paper plugin enabled in the current process', () => {
    const test = healthTest(compose, '/tmp/geldar-core.ready');
    expect(test).toContain('mc-health');
    expect(test).toContain('/proc/$$pid/stat');
    expect(test).toContain('$$start');
    expect(test).not.toContain('grep');
  });

  it('prove the Velocity identity plugin enabled in the current process', () => {
    const test = healthTest(compose, '/tmp/geldar-identity.ready');
    expect(test).toContain('/proc/$$pid/stat');
    expect(test).toContain('$$start');
    expect(test).toContain('/dev/tcp/127.0.0.1/25565');
    expect(test).not.toContain('grep');
  });

  it('name the same marker files the plugins write', () => {
    expect(repoFile('plugin/core/src/main/java/dev/geldar/core/GeldarCore.java')).toContain(
      'Path.of("/tmp/geldar-core.ready")',
    );
    expect(
      repoFile('plugin/velocity-identity/src/main/java/dev/geldar/identity/IdentityPlugin.java'),
    ).toContain('Path.of("/tmp/geldar-identity.ready")');
  });
});
