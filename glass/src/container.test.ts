import { readFileSync } from 'node:fs';
import { dirname, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (path: string): string => readFileSync(resolve(repo, path), 'utf8');

const ignoreLines = read('glass/Dockerfile.dockerignore')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l !== '' && !l.startsWith('#'));

/** One dockerignore pattern, anchored at the context root, as a regular expression. */
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
  for (const line of ignoreLines) {
    const negate = line.startsWith('!');
    const re = toRegExp(negate ? line.slice(1) : line);
    if (candidates.some((c) => re.test(c))) result = !negate;
  }
  return result;
}

/** Repo files a source file reaches through relative imports and `new URL('...', import.meta.url)` reads. */
function reachableFrom(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    if (seen.has(file)) continue;
    seen.add(file);
    if (!file.endsWith('.ts')) continue;
    const source = read(file);
    for (const m of source.matchAll(/(?:\bfrom\s+|\bimport\s*\(?\s*)['"](\.[^'"]+)['"]/g)) {
      queue.push(posix.join(posix.dirname(file), m[1] as string));
    }
  }
  return seen;
}

describe('glass/Dockerfile.dockerignore', () => {
  it('keeps tokens, env files, secrets, tests and installed trees out of the build context', () => {
    expect(excluded('glass/.env.local')).toBe(true);
    expect(excluded('glass/mcp-tokens.json')).toBe(true);
    expect(excluded('compose/secrets/postgres-glass.txt')).toBe(true);
    expect(excluded('glass/src/server.test.ts')).toBe(true);
    expect(excluded('glass/test/harness.ts')).toBe(true);
    expect(excluded('glass/node_modules/pg/index.js')).toBe(true);
    expect(excluded('.git/config')).toBe(true);
  });

  it('keeps the workspace manifests the frozen install needs', () => {
    for (const kept of [
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      '.nvmrc',
      'glass/package.json',
      'contract/package.json',
    ]) {
      expect(excluded(kept), kept).toBe(false);
    }
  });

  it('leaves the other workspaces and the docs out of the build context', () => {
    for (const left of ['golem/src/view.ts', 'docs/spec.md', 'compose/mcp.yml']) {
      expect(excluded(left), left).toBe(true);
    }
  });
});

describe('glass/Dockerfile', () => {
  const dockerfile = read('glass/Dockerfile');

  it('pins every base image by digest, runs as uid 1000 and starts src/main.ts', () => {
    const froms = dockerfile.split('\n').filter((l) => l.startsWith('FROM '));
    expect(froms).toHaveLength(2);
    for (const line of froms) expect(line).toMatch(/@sha256:[0-9a-f]{64}\b/);
    expect(dockerfile).toMatch(/^USER 1000:1000$/m);
    expect(dockerfile).toMatch(/^ENTRYPOINT \["node", "src\/main\.ts"\]$/m);
    expect(dockerfile).toMatch(
      /--frozen-lockfile --prod --ignore-scripts --filter "@geldar\/glass\.\.\."/,
    );
  });

  it('exposes the default port the server config listens on', () => {
    expect(read('glass/src/config.ts')).toMatch(/'GELDAR_GLASS_PORT', 8787\)/);
    expect(dockerfile).toMatch(/^EXPOSE 8787$/m);
  });
});

describe('the image holds everything Glass reads or imports', () => {
  it('keeps every file reached from src/main.ts and the static page http.ts serves', () => {
    const reached = reachableFrom('glass/src/main.ts');
    expect(reached.has('glass/src/server.ts')).toBe(true);
    expect(reached.has('glass/src/http.ts')).toBe(true);
    expect(reached.size).toBeGreaterThan(8);
    for (const file of reached) expect(excluded(file), file).toBe(false);
    for (const page of ['index.html', 'app.js', 'app.css']) {
      expect(read('glass/src/http.ts')).toContain(page);
      expect(excluded(`glass/public/${page}`), page).toBe(false);
    }
  });

  it('imports no other workspace package, so none needs to be in the image', () => {
    for (const file of reachableFrom('glass/src/main.ts')) {
      expect(read(file), file).not.toMatch(/from\s+['"]@geldar\//);
    }
  });
});
