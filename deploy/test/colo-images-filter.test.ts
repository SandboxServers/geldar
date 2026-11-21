// The push `paths` filter of .github/workflows/colo-images.yml decides which pushes rebuild the Colo images, and so which
// pushes recreate the 19 player hosts. Test-only files under golem/ must not trigger it (CI-2, #868). The workflow is read
// as text: its push `paths` list is a plain list of glob lines, and each line is matched with the rule GitHub documents
// (the last matching pattern wins, so a `!` pattern drops files that an earlier positive pattern kept).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WORKFLOW = fileURLToPath(new URL('../../.github/workflows/colo-images.yml', import.meta.url));

/** The push `paths` entries, in file order, with comments and quotes removed. */
function pushPaths(text: string): string[] {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^\s{4}paths:\s*$/.test(l));
  const end = lines.findIndex((l, i) => i > start && /^\s{2}\S/.test(l));
  if (start < 0 || end < 0) throw new Error('no push paths list in colo-images.yml');
  return lines
    .slice(start + 1, end)
    .map((l) => l.match(/^\s+-\s+(.*?)\s*$/))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => m[1].replace(/^['"]|['"]$/g, ''));
}

/** A GitHub-style glob: `**` spans directories, `*` does not cross `/`. */
function globToRegExp(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        out += '(?:.*/)?';
        i += 2;
      } else {
        out += '.*';
        i += 1;
      }
    } else if (c === '*') {
      out += '[^/]*';
    } else {
      out += c.replace(/[.+^${}()|[\]\\?]/g, '\\$&');
    }
  }
  return new RegExp(`^${out}$`);
}

/** True when a push that changes `file` runs the workflow: the last pattern that matches decides. */
function triggers(patterns: string[], file: string): boolean {
  let hit = false;
  for (const p of patterns) {
    const negated = p.startsWith('!');
    if (globToRegExp(negated ? p.slice(1) : p).test(file)) hit = !negated;
  }
  return hit;
}

const patterns = pushPaths(readFileSync(WORKFLOW, 'utf8'));

describe('colo-images push filter (CI-2, #868)', () => {
  it('still triggers on golem source, including the players source', () => {
    expect(triggers(patterns, 'golem/src/body/executor.ts')).toBe(true);
    expect(triggers(patterns, 'golem/src/players/roster.ts')).toBe(true);
    expect(triggers(patterns, 'golem/Dockerfile')).toBe(true);
  });

  it('does not trigger on golem test files, in golem/test or next to the source', () => {
    expect(triggers(patterns, 'golem/test/fixtures/world.ts')).toBe(false);
    expect(triggers(patterns, 'golem/src/body/programs/farm.test.ts')).toBe(false);
    expect(triggers(patterns, 'golem/src/players/roster.test.ts')).toBe(false);
  });

  it('keeps the other images triggered and does not trigger on their tests alone', () => {
    expect(triggers(patterns, 'animus/src/loop/plan.ts')).toBe(true);
    expect(triggers(patterns, 'player-core/src/validate/bounds.ts')).toBe(true);
    expect(triggers(patterns, 'player-core/src/validate/bounds.test.ts')).toBe(false);
  });

  it('keeps the negations after the positive patterns they drop', () => {
    const golem = patterns.indexOf('golem/**');
    expect(golem).toBeGreaterThanOrEqual(0);
    expect(patterns.indexOf('!golem/test/**')).toBeGreaterThan(golem);
    expect(patterns.indexOf('!**/*.test.ts')).toBeGreaterThan(
      patterns.indexOf('golem/src/players/**'),
    );
  });
});
