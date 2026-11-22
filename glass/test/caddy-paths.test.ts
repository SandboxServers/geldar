/**
 * Caddy is the only way to Glass from outside, and it routes the page by a list of paths
 * (deploy/caddy/glass.caddy, `@glass_page`). A page file missing from that list is a 404 in production: the
 * page loses a stylesheet, its script or its typefaces. These tests hold the list to the files Glass serves.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STATIC_FILES } from '../src/static-files.ts';

const CADDY = readFileSync(new URL('../../deploy/caddy/glass.caddy', import.meta.url), 'utf8');
const line = /^\s*@glass_page path (.+)$/m.exec(CADDY)?.[1] ?? '';
const matchers = line.split(/\s+/).filter((part) => part !== '');

/** Caddy's path matcher: an exact path, or a prefix ending in "*". */
function routed(path: string): boolean {
  return matchers.some((m) => (m.endsWith('*') ? path.startsWith(m.slice(0, -1)) : m === path));
}

describe('the Caddy route for the page', () => {
  it('lets every file Glass serves through', () => {
    expect(matchers.length).toBeGreaterThan(5);
    for (const path of STATIC_FILES.keys()) expect(routed(path), path).toBe(true);
  });

  it('routes nothing Glass does not serve: each matcher has a file behind it', () => {
    const paths = [...STATIC_FILES.keys()];
    for (const matcher of matchers) {
      const used = matcher.endsWith('*')
        ? paths.some((path) => path.startsWith(matcher.slice(0, -1)))
        : paths.includes(matcher);
      expect(used, matcher).toBe(true);
    }
  });

  it('keeps the API, the register service and Kino out of the page route', () => {
    for (const path of ['/api/thoughts', '/api/stream', '/register/', '/roster', '/kino/', '/x']) {
      expect(routed(path), path).toBe(false);
    }
    // A wildcard covers one folder of the page, never the root.
    for (const matcher of matchers.filter((m) => m.endsWith('*'))) {
      expect(matcher).toMatch(/^\/(js|fonts|icons)\/\*$/);
    }
  });
});
