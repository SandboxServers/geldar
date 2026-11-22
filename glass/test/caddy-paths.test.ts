/**
 * Caddy is the only way to Glass from outside, and it routes the page by a list of paths
 * (deploy/caddy/glass.caddy, `@glass_page`). A page file missing from that list is a 404 in production: the
 * page loses a stylesheet, its script or its typefaces.
 *
 * The deploy pipeline rolls a new Glass image by itself, but it never applies a Caddy change: that is an
 * operator's restart of the shared Caddy. So the page must fit the route that is live, and the route must
 * not change in the same step as the page. These tests hold both: every file Glass serves is under the
 * live route, and the route is the one the node has.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STATIC_FILES } from '../src/static-files.ts';

const CADDY = readFileSync(new URL('../../deploy/caddy/glass.caddy', import.meta.url), 'utf8');
const line = /^\s*@glass_page path (.+)$/m.exec(CADDY)?.[1] ?? '';
const matchers = line.split(/\s+/).filter((part) => part !== '');

/** Caddy's path matcher: an exact path, or a prefix when it ends in "*" (a prefix crosses slashes). */
function routed(path: string): boolean {
  return matchers.some((m) => (m.endsWith('*') ? path.startsWith(m.slice(0, -1)) : m === path));
}

describe('the Caddy route for the page', () => {
  it('is the route the node has: the page, its first stylesheet, its script, and everything under /js/', () => {
    // Checked against the live site on 2026-11-22: a path under /js/ reaches Glass (its JSON 404), nested
    // folders included, and /fonts.css or /sw.js at the root stops at Caddy. Changing this line does not
    // change the node: an operator has to load the file there first, in a change of its own.
    expect(matchers).toEqual(['/', '/app.css', '/app.js', '/js/*']);
  });

  it('lets every file Glass serves through', () => {
    expect(STATIC_FILES.size).toBeGreaterThan(20);
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
    // The same files at the root are not routed: a page that asked for them there would break.
    for (const path of ['/sw.js', '/fonts.css', '/manifest.webmanifest', '/fonts/a.woff2']) {
      expect(routed(path), path).toBe(false);
    }
  });
});
