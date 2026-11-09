import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ignorePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'Dockerfile.dockerignore',
);
const lines = readFileSync(ignorePath, 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l !== '' && !l.startsWith('#'));

/** Translate one dockerignore pattern (anchored at the context root) to a regular expression. */
function toRegExp(pattern: string): RegExp {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i] as string;
    if (c === '*' && pattern[i + 1] === '*') {
      if (pattern[i + 2] === '/') {
        out += '(?:.*/)?';
        i += 2;
      } else {
        out += '.*';
        i += 1;
      }
    } else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

/** Last matching pattern wins; a leading "!" re-includes. Ancestor directories are tried too. */
function excluded(path: string): boolean {
  const parts = path.split('/');
  const candidates = parts.map((_, i) => parts.slice(0, i + 1).join('/'));
  let result = false;
  for (const line of lines) {
    const negate = line.startsWith('!');
    const re = toRegExp(negate ? line.slice(1) : line);
    if (candidates.some((c) => re.test(c))) result = !negate;
  }
  return result;
}

// A clean checkout has no tokens file, so the image test cannot prove the exclusion in CI by itself.
describe('Dockerfile.dockerignore', () => {
  it('keeps token files out of the build context', () => {
    expect(excluded('threshold/mcp-mock/mcp-tokens.json')).toBe(true);
    expect(excluded('a/b/tokens.json')).toBe(true);
    expect(excluded('mcp-tokens.json')).toBe(true);
  });

  it('keeps env files, tests and test-support out of the build context', () => {
    expect(excluded('threshold/mcp-mock/.env.local')).toBe(true);
    expect(excluded('threshold/mcp-mock/src/app.test.ts')).toBe(true);
    expect(excluded('threshold/mcp-mock/test-support/docker.ts')).toBe(true);
  });

  it('keeps what the Dockerfile needs (it never copies tokens.example.json)', () => {
    for (const kept of [
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      '.nvmrc',
      'threshold/mcp-mock/package.json',
      'threshold/mcp-mock/src/cli.ts',
      'threshold/mcp-mock/scenarios/dawn.scenario.json',
      'contract/package.json',
    ]) {
      expect(excluded(kept), kept).toBe(false);
    }
  });
});
