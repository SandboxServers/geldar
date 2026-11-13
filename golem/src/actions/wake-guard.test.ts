import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** golem/src, the tree the repo guard scans. */
const SRC = fileURLToPath(new URL('..', import.meta.url));
/** The wake module itself, its test, and this guard (which names the call it forbids). */
const EXEMPT = new Set(['actions/wake.ts', 'actions/wake.test.ts', 'actions/wake-guard.test.ts']);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

describe('bot.wake() is never called outside wakeBot', () => {
  it('finds no `.wake(` call in golem/src outside wake.ts (mineflayer sends stop_sprinting for it)', () => {
    const offenders = sourceFiles(SRC)
      .map((file) => relative(SRC, file).replace(/\\/g, '/'))
      .filter((name) => !EXEMPT.has(name))
      .filter((name) => /\bbot\.wake\(|\.wake\(\)/.test(readFileSync(join(SRC, name), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
