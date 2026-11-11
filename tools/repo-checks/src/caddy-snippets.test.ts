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
    paths: ['/api/agents', '/api/thoughts', '/api/thoughts/*', '/api/receipts', '/api/stats'],
  },
  { site: 'mcp', methods: 'POST GET DELETE', paths: ['^/p/[a-z][a-z0-9-]{1,38}$'] },
] as const;

/** The three strip lines must come before the set line, so the set value is the only one left. */
const STRIPS = [
  'request_header -x-geldar-client-ip',
  'request_header -X-Forwarded-For',
  'request_header -CF-Connecting-IP',
];
const SET = 'request_header x-geldar-client-ip {remote_host}';

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
        expect(text).toContain('respond @not_allowed 405');
      });

      it('strips the incoming address headers before it sets its own', () => {
        const setAt = text.indexOf(SET);
        expect(setAt).toBeGreaterThan(-1);
        for (const line of STRIPS) {
          const at = text.indexOf(line);
          expect(at).toBeGreaterThan(-1);
          expect(at).toBeLessThan(setAt);
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
