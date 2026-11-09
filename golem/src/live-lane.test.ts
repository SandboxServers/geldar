import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from './config.ts';

// The live tests need a running shard, so the root test run must skip them and the live config
// must keep picking them up. Both are plain text checks: no config is imported or executed.
describe('live-lane wiring', () => {
  it('the root vitest config excludes live tests', async () => {
    const text = await readFile(join(repoRoot(), 'vitest.config.ts'), 'utf8');
    expect(text).toContain("'**/*.live.test.ts'");
  });

  it('the golem live config includes only test/live/**/*.live.test.ts', async () => {
    const text = await readFile(join(repoRoot(), 'golem', 'vitest.live.config.ts'), 'utf8');
    expect(text).toContain("'test/live/**/*.live.test.ts'");
    expect(text).toContain('fileParallelism: false');
  });
});
