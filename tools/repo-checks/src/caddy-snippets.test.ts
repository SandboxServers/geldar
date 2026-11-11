import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const dir = resolve(repo, 'deploy/caddy');
const read = (name: string): string => readFileSync(resolve(dir, name), 'utf8');

/** Each public site, the methods its live file accepts, and its route paths. */
const SITES = [
  { site: 'map', methods: 'GET HEAD', paths: [] },
  {
    site: 'glass',
    methods: 'GET HEAD',
    paths: [
      '/api/agents',
      '/api/thoughts',
      '/api/thoughts/*',
      '/api/receipts',
      '/',
      '/app.css',
      '/app.js',
      '/js/*',
    ],
  },
  { site: 'mcp', methods: 'POST GET DELETE', paths: ['^/p/[a-z][a-z0-9-]{1,38}$'] },
] as const;

/** The three strip lines drop client copies; the proxy block then sets the one value Caddy vouches for. */
const STRIPS = [
  'request_header -x-geldar-client-ip',
  'request_header -X-Forwarded-For',
  'request_header -CF-Connecting-IP',
];
const SET = 'header_up x-geldar-client-ip {remote_host}';

/** The body of every reverse_proxy block that has one, in a file. */
const proxyBlocks = (text: string): string[] =>
  [...text.matchAll(/reverse_proxy \{\$[A-Z_]+\} \{((?:[^{}]|\{[^{}]*\})*)\}/g)].map(
    (m) => m[1] ?? '',
  );

const IPV4 = /\b\d{1,3}(?:\.\d{1,3}){3}\b/;

describe('deploy/caddy site files', () => {
  for (const { site, methods, paths } of SITES) {
    describe(site, () => {
      const text = read(`${site}.caddy`);

      it('serves the site address from the project domain placeholder', () => {
        expect(text).toContain(`${site}.{$GELDAR_DOMAIN} {`);
      });

      it('refuses every method but the ones it serves, with 405', () => {
        expect(text).toMatch(new RegExp(`^\\s*@not_allowed not method ${methods}$`, 'm'));
        expect(text).toMatch(/handle @not_allowed \{\s*respond 405\s*\}/);
      });

      it('strips the incoming address headers and sets its own inside every reverse_proxy', () => {
        for (const line of STRIPS) {
          expect(text).toContain(line);
        }
        expect(text).not.toMatch(/^\s*request_header x-geldar-client-ip/m);
        const blocks = proxyBlocks(text);
        expect(blocks.length).toBe([...text.matchAll(/reverse_proxy /g)].length);
        for (const block of blocks) {
          expect(block).toContain(SET);
        }
      });

      it('proxies only to a placeholder upstream', () => {
        const targets = [...text.matchAll(/reverse_proxy\s+(\S+)/g)].map((m) => m[1]);
        expect(targets.length).toBeGreaterThan(0);
        for (const target of targets) {
          expect(target).toMatch(/^\{\$GELDAR_[A-Z_]+_UPSTREAM\}$/);
        }
      });

      it('has a kill-switch file that answers 503 for the same host', () => {
        const off = `${site}-off.caddy`;
        expect(existsSync(resolve(dir, off))).toBe(true);
        const killed = read(off);
        expect(killed).toContain(`${site}.{$GELDAR_DOMAIN} {`);
        expect(killed).toContain('respond 503');
        expect(killed).not.toContain('reverse_proxy');
      });

      it('routes only its own paths and answers anything else with 404', () => {
        if (paths.length === 0) return; // BlueMap serves its whole static tree
        expect(text).toContain('respond 404');
        for (const path of paths) {
          expect(text).toContain(path);
        }
      });
    });
  }

  it('sets Host to localhost in every Glass proxy block, which Glass accepts and a public Host gets 421', () => {
    const blocks = proxyBlocks(read('glass.caddy'));
    expect(blocks.length).toBe(3);
    for (const block of blocks) {
      expect(block).toMatch(/^\s*header_up Host localhost$/m);
    }
  });

  it('routes GET and HEAD for the page and its assets to Glass', () => {
    expect(read('glass.caddy')).toMatch(
      /@glass_page path \/ \/app\.css \/app\.js \/js\/\*\s+handle @glass_page \{\s+reverse_proxy/,
    );
  });

  it('does not route /api/stats', () => {
    expect(read('glass.caddy')).not.toContain('/api/stats');
  });

  it('sets nosniff, Referrer-Policy and frame-ancestors on BlueMap responses', () => {
    const text = read('map.caddy');
    expect(text).toMatch(/^\s*X-Content-Type-Options nosniff$/m);
    expect(text).toMatch(/^\s*Referrer-Policy no-referrer$/m);
    expect(text).toMatch(/^\s*Content-Security-Policy "frame-ancestors 'none'"$/m);
  });

  it('sets the SSE stream route to flush at once', () => {
    expect(read('glass.caddy')).toMatch(/path \/api\/stream[\s\S]*flush_interval -1/);
  });

  it('holds no loopback or other IPv4 literal in any site file', () => {
    const files = readdirSync(dir).filter((name) => name.endsWith('.caddy'));
    expect(files.length).toBeGreaterThanOrEqual(6);
    for (const name of files) {
      const text = read(name);
      expect(text).not.toContain('127.0.0.1');
      expect(IPV4.test(text)).toBe(false);
    }
  });
});
