import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Guard for decision 0430: the animus package was removed and must not come back.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SKIP_DIRS = new Set(['node_modules', '.git', '.pnpm-store', 'dist', 'coverage']);
const REMOVED_NAME = '@geldar/animus';

/** Every package.json under the repo root, skipping dependency and build output trees. */
function listPackageJsons(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) listPackageJsons(full, out);
    else if (entry.name === 'package.json') out.push(full);
  }
  return out;
}

describe('animus stays removed (decision 0430)', () => {
  it('has no animus/ directory with a package.json', () => {
    expect(existsSync(join(ROOT, 'animus', 'package.json'))).toBe(false);
  });

  it('has no workspace package named @geldar/animus', () => {
    const packages = listPackageJsons(ROOT);
    // Guards against the walk finding nothing and passing vacuously.
    expect(packages.length).toBeGreaterThan(10);
    const offenders = packages.filter((file) => {
      const name = JSON.parse(readFileSync(file, 'utf8')).name;
      return name === REMOVED_NAME;
    });
    expect(offenders).toEqual([]);
  });
});
