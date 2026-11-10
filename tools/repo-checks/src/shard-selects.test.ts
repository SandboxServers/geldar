import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// Static guard: `adam select` rewrites mind.agent.username, mind.agent.tier and mind.run_tier in the
// working tree, so a test that reads the live shard file must not assert those keys (a run tree
// would fail). Such a test reads them through fixtures instead (animus/src/phase0-shard.fixture.ts).

const ROOT = join(import.meta.dirname, '..', '..', '..');
const SCANNED = ['animus', 'golem', 'tools'];
const SELF = 'tools/repo-checks/src/shard-selects.test.ts';
/** A test that reads the shard file by a path built with join(..., 'shards', 'phase0.yaml'). */
const LIVE_READ = /['"]shards['"],\s*['"]phase0\.yaml['"]/;
const SELECTED = /agent\.username|agent\.tier|run_tier/;
/** Reviewed exceptions, each with the reason it does not depend on the selected life. */
const REVIEWED = new Set([
  // Checks only the shape of those keys: any life or tier passes.
  'golem/src/mind-link/senses.test.ts',
  // Applies selectLife to the file text, so the rewritten keys do not depend on the working tree.
  'tools/adam-cli/src/yaml-edit.test.ts',
  // Writes its own temp repo tree with a shard file; never reads the checked-in one.
  'tools/adam-run/src/adapters.test.ts',
]);

function testFiles(): string[] {
  const found: string[] = [];
  for (const dir of SCANNED) {
    for (const entry of readdirSync(join(ROOT, dir), { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.test.ts')) continue;
      if (entry.parentPath.includes('node_modules')) continue;
      found.push(relative(ROOT, join(entry.parentPath, entry.name)).replaceAll('\\', '/'));
    }
  }
  return found;
}

describe('the live shard file is read without asserting select-rewritten keys', () => {
  const files = testFiles();

  it('scans the test files of animus, golem and tools', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain('animus/src/config.test.ts');
  });

  it('no test reads shards/phase0.yaml and asserts agent.username, agent.tier or run_tier', () => {
    const offenders = files.filter((file) => {
      if (file === SELF || REVIEWED.has(file)) return false;
      const text = readFileSync(join(ROOT, file), 'utf8');
      return LIVE_READ.test(text) && SELECTED.test(text);
    });
    expect(offenders).toEqual([]);
  });
});
