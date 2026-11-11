import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// glass/Dockerfile.dockerignore is an allowlist. Glass reads glass/web/kino at startup when Kino is on
// (wiring.ts), so a runtime-read path that the allowlist drops crash-loops the deployed image. No Docker needed.
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ignoreFile = join(repo, 'glass/Dockerfile.dockerignore');

function globToRegExp(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob.charAt(i);
    if (c === '*' && glob.charAt(i + 1) === '*') {
      i++;
      if (glob.charAt(i + 1) === '/') {
        i++;
        out += '(?:.*/)?';
      } else out += '.*';
    } else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

type Rule = { negate: boolean; re: RegExp };
function parse(text: string): Rule[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'))
    .map((l) => ({
      negate: l.startsWith('!'),
      re: globToRegExp(l.replace(/^!/, '').replace(/^\//, '')),
    }));
}

// Docker semantics: a path matches a rule when the path or any parent directory matches; the last match wins.
function included(rules: Rule[], path: string): boolean {
  const parts = path.split('/');
  const prefixes = parts.map((_, i) => parts.slice(0, i + 1).join('/'));
  let keep = true;
  for (const r of rules) {
    if (prefixes.some((p) => r.re.test(p))) keep = r.negate;
  }
  return keep;
}

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );
}

const rules = parse(readFileSync(ignoreFile, 'utf8'));
const rel = (p: string) => relative(repo, p).split('\\').join('/');

describe('glass/Dockerfile.dockerignore', () => {
  it('keeps the Kino static app, the sources and the public page', () => {
    expect(included(rules, 'glass/web/kino/index.html')).toBe(true);
    expect(included(rules, 'glass/web/kino/camera/rig.ts')).toBe(true);
    expect(included(rules, 'glass/src/main.ts')).toBe(true);
    expect(included(rules, 'glass/src/kino/wiring.ts')).toBe(true);
    expect(included(rules, 'glass/package.json')).toBe(true);
  });

  it('still drops tests, installed trees and secrets', () => {
    expect(included(rules, 'glass/src/http.test.ts')).toBe(false);
    expect(included(rules, 'glass/node_modules/three/package.json')).toBe(false);
    expect(included(rules, 'glass/test/x.ts')).toBe(false);
    expect(included(rules, 'compose/secrets/a')).toBe(false);
  });

  it('includes every path Glass resolves with new URL(..., import.meta.url)', () => {
    const files = walk(join(repo, 'glass/src')).filter(
      (f) => f.endsWith('.ts') && !f.endsWith('.test.ts'),
    );
    let seen = 0;
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/new URL\(\s*'([^']+)'\s*,\s*import\.meta\.url/g)) {
        const target = resolve(dirname(f), m[1] as string);
        const r = rel(target);
        if (r.includes('node_modules')) continue; // installed by pnpm in the image, not copied from context
        expect(existsSync(target), `${r} exists`).toBe(true);
        const probe = statSync(target).isDirectory()
          ? (walk(target).find((p) => !p.endsWith('.test.ts')) as string)
          : target;
        expect(included(rules, rel(probe)), `${r} is in the build context`).toBe(true);
        seen++;
      }
    }
    expect(seen).toBeGreaterThanOrEqual(3);
  });
});
