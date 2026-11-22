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
      '/api/session',
      '/register',
      '/roster/*',
      '/',
      '/fonts.css',
      '/app.css',
      '/entries.css',
      '/reader.css',
      '/app.js',
      '/sw.js',
      '/manifest.webmanifest',
      '/js/*',
      '/fonts/*',
      '/icons/*',
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
  [...text.matchAll(/reverse_proxy \{\$[A-Z_]+(?::[^}]*)?\} \{((?:[^{}]|\{[^{}]*\})*)\}/g)].map(
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
        expect(text).toMatch(new RegExp(`^\\s*(?:@not_allowed )?not method ${methods}$`, 'm'));
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
        expect(killed).toMatch(
          /respond `\{"error":\{"code":"unavailable","message":"Service unavailable"\}\}` 503/,
        );
        expect(killed).toContain('header Content-Type application/json');
        expect(killed).not.toContain('reverse_proxy');
      });

      it.each([`${site}.caddy`, `${site}-off.caddy`])(
        '%s drops the Server header and sets nosniff and no-referrer (R4-05)',
        (file) => {
          const body = read(file);
          expect(body).toMatch(/^\s*-Server$/m);
          expect(body).toMatch(/^\s*X-Content-Type-Options nosniff$/m);
          expect(body).toMatch(/^\s*Referrer-Policy no-referrer$/m);
        },
      );

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
    expect(blocks.length).toBe(6); // read API, page, stream, Kino textures, Kino (off by default), register
    // Two blocks keep the public Host: the register upstream (it checks Origin, not Host) and the
    // Kino textures block, which proxies the map upstream exactly as map.caddy does (no Host override).
    const glass = blocks.filter((b) => /^\s*header_up Host localhost$/m.test(b));
    const keepsHost = blocks.filter((b) => !/header_up Host /.test(b));
    expect(keepsHost.length).toBe(2);
    expect(glass.length).toBe(4);
  });

  it('sets Host to localhost in the MCP proxy block, so the public Host does not get 403 host_rejected', () => {
    const blocks = proxyBlocks(read('mcp.caddy'));
    expect(blocks.length).toBe(1);
    expect(blocks[0]).toMatch(/^\s*header_up Host localhost$/m);
  });

  it('sets stream_close_delay 5s in every MCP proxy block and in the Glass stream route', () => {
    for (const block of proxyBlocks(read('mcp.caddy'))) {
      expect(block).toMatch(/^\s*stream_close_delay 5s$/m);
    }
    expect(read('glass.caddy')).toMatch(/^\s*stream_close_delay 5s$/m);
  });

  it('routes GET and HEAD for the page and its assets to Glass', () => {
    expect(read('glass.caddy')).toMatch(
      /@glass_page path \/ \/fonts\.css \/app\.css \/entries\.css \/reader\.css \/app\.js \/sw\.js \/manifest\.webmanifest \/js\/\* \/fonts\/\* \/icons\/\*\s+handle @glass_page \{\s+reverse_proxy/,
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

describe('register shares the Glass host (decision 0135, amendment R42)', () => {
  it('is not a separate site: no register site file, and colo-public.sh installs map glass mcp only', () => {
    const script = readFileSync(resolve(repo, 'deploy/colo-public.sh'), 'utf8');
    expect(script).toMatch(/^SITES="map glass mcp"$/m);
    // No separate register SITE: the SITES list above is exact, and no register site file is named or installed. The
    // GELDAR_REGISTER_UPSTREAM placeholder on the glass site is allowed. Would fail on e.g. SITES="map glass mcp register",
    // a `$s-register` variable, or an 'install register.caddy' line.
    expect(script).not.toMatch(/register(-off)?\.caddy|-register\b|SITES=[^\n]*register/);
    expect(existsSync(resolve(dir, 'register.caddy'))).toBe(false);
    expect(existsSync(resolve(dir, 'register-off.caddy'))).toBe(false);
  });

  it('routes /register* and /roster* on the glass host to the register upstream, with POST and an 8 KiB body', () => {
    const text = read('glass.caddy');
    expect(text).toMatch(/@register path \/register \/register\/\* \/roster \/roster\/\*/);
    expect(text).toMatch(
      /handle @register \{\s+reverse_proxy \{\$GELDAR_REGISTER_UPSTREAM\} \{\s+header_up x-geldar-client-ip \{remote_host\}\s+\}\s+\}/,
    );
    expect(text).toMatch(/not method GET HEAD POST/);
    expect(text).toMatch(/request_body @register \{\s+max_size 8KiB/);
    expect(text).toMatch(/request_body @not_register \{\s+max_size 1KiB/);
  });

  it('keeps Glass itself read-only: its 405 covers every non-register path, before any proxy', () => {
    const text = read('glass.caddy');
    expect(text).toMatch(
      /@not_allowed \{\s+not path \/register[^\n]*\n\s+not method GET HEAD\s+\}/,
    );
    expect(text.indexOf('handle @not_allowed')).toBeLessThan(text.indexOf('reverse_proxy'));
    expect(text.indexOf('handle @register_not_allowed')).toBeLessThan(
      text.indexOf('reverse_proxy'),
    );
  });
});

describe('map-neoforge site (NF-BM-4, the BlueMap NeoForge shard)', () => {
  const live = read('map-neoforge.caddy');
  const off = read('map-neoforge-off.caddy');

  it('serves map.neoforge from the project domain placeholder, live and off alike', () => {
    expect(live).toContain('map.neoforge.{$GELDAR_DOMAIN} {');
    expect(off).toContain('map.neoforge.{$GELDAR_DOMAIN} {');
  });

  it('refuses every method but GET and HEAD with 405, as the first handle', () => {
    expect(live).toMatch(/^\s*@not_allowed not method GET HEAD$/m);
    expect(live).toMatch(/handle @not_allowed \{\s*respond 405\s*\}/);
    expect(live.indexOf('handle @not_allowed')).toBeLessThan(live.indexOf('reverse_proxy'));
  });

  it('strips the incoming address headers and sets its own in its one reverse_proxy', () => {
    for (const line of STRIPS) {
      expect(live).toContain(line);
    }
    expect(live).not.toMatch(/^\s*request_header x-geldar-client-ip/m);
    const blocks = proxyBlocks(live);
    expect(blocks.length).toBe(1);
    expect(blocks[0]).toContain(SET);
  });

  it('proxies to the NeoForge upstream placeholder only, never to the Paper map upstream', () => {
    expect(live).toMatch(/reverse_proxy \{\$GELDAR_MAP_NF_UPSTREAM\} \{/);
    expect(live).not.toContain('{$GELDAR_MAP_UPSTREAM}');
  });

  it('caps the request body at 1 KiB', () => {
    expect(live).toMatch(/request_body \{\s+max_size 1KiB\s+\}/);
  });

  it('keeps the map.caddy response header block: -Server, nosniff, no-referrer and frame-ancestors', () => {
    expect(live).toMatch(/^\s*-Server$/m);
    expect(live).toMatch(/^\s*X-Content-Type-Options nosniff$/m);
    expect(live).toMatch(/^\s*Referrer-Policy no-referrer$/m);
    expect(live).toMatch(/^\s*Content-Security-Policy "frame-ancestors 'none'"$/m);
  });

  it('kill switch answers 503 on the same host and never proxies or names the upstream', () => {
    expect(off).toMatch(
      /respond `\{"error":\{"code":"unavailable","message":"Service unavailable"\}\}` 503/,
    );
    expect(off).not.toContain('reverse_proxy');
    expect(off).not.toContain('GELDAR_MAP_NF_UPSTREAM');
    expect(off).toMatch(/^\s*-Server$/m);
  });
});

describe('OTLP ingest route (otel.caddy, caddy-ingest-route.md)', () => {
  const text = read('otel.caddy');
  const off = read('otel-off.caddy');
  const PATHS = '/v1/traces /v1/logs /v1/metrics';
  /** The text without comment lines, so a comment cannot satisfy or break an assertion. */
  const code = (s: string): string =>
    s
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('#'))
      .join('\n');

  it('takes the site address and every value from the env placeholders only', () => {
    expect(text).toContain('{$GELDAR_INGEST_HOST:otel.invalid} {');
    expect(text).toContain('reverse_proxy {$GELDAR_INGEST_UPSTREAM:localhost:4320} {');
    expect(text).toContain('header Authorization "Bearer {$GELDAR_INGEST_TOKEN}"');
    expect(off).toContain('{$GELDAR_INGEST_HOST:otel.invalid} {');
    const names = new Set([...text.matchAll(/\{\$([A-Z_]+)(?::[^}]*)?\}/g)].map((m) => m[1]));
    expect([...names].sort()).toEqual([
      'GELDAR_INGEST_HOST',
      'GELDAR_INGEST_TOKEN',
      'GELDAR_INGEST_UPSTREAM',
    ]);
  });

  it('lets only POST pass, on the three OTLP paths, and answers 405, 401 and 404 otherwise', () => {
    expect(text).toMatch(/@not_post not method POST\s+handle @not_post \{\s*respond 405\s*\}/);
    expect(text).toMatch(new RegExp(`@ingest \\{\\s+path ${PATHS}\\s+header Authorization`));
    // An empty or short token must never match (a header of just `Bearer `): the matcher carries a size guard.
    expect(text).toContain("expression `size('{$GELDAR_INGEST_TOKEN}') >= 64`");
    expect(text).toMatch(new RegExp(`@signal path ${PATHS}\\s+handle @signal \\{\\s*respond 401`));
    expect(text).toMatch(/handle \{\s*respond 404\s*\}/);
    expect(text.indexOf('handle @not_post')).toBeLessThan(text.indexOf('reverse_proxy'));
    expect(text.indexOf('handle @ingest')).toBeLessThan(text.indexOf('handle @signal'));
  });

  it('caps the body at 8 MiB and sets the per-site proxy timeouts', () => {
    expect(text).toMatch(/request_body \{\s+max_size 8MiB\s+\}/);
    const blocks = proxyBlocks(text);
    expect(blocks.length).toBe(1);
    expect(blocks[0]).toMatch(
      /transport http \{\s+dial_timeout 5s\s+response_header_timeout 60s\s+\}/,
    );
    expect(blocks[0]).toMatch(/^\s*header_up Host localhost$/m);
    expect(blocks[0]).toContain(SET);
  });

  it('strips the incoming address headers', () => {
    for (const line of STRIPS) {
      expect(text).toContain(line);
    }
  });

  it('deletes the Authorization, Cookie and Proxy-Authorization headers from the access log', () => {
    expect(text).toMatch(
      /log \{\s+format filter \{\s+wrap json\s+fields \{\s+request>headers>Authorization delete\s+request>headers>Cookie delete\s+request>headers>Proxy-Authorization delete\s+\}\s+\}\s+\}/,
    );
  });

  it('has no global options block, no servers timeouts, no plain-HTTP listener and no token value', () => {
    const body = code(text);
    expect(body).not.toMatch(/^\{\s*$/m);
    expect(body).not.toMatch(
      /\bservers\b|timeouts|read_body|read_header|idle_timeout|write_timeout/,
    );
    expect(body).not.toMatch(/http:\/\/|:80\b|auto_https|admin /);
    expect(body).not.toMatch(/Bearer (?!\{\$GELDAR_INGEST_TOKEN\}")/);
    expect(code(off)).not.toMatch(/\bservers\b|Authorization|Bearer/);
  });

  it('has a kill switch that answers 503 on the same host and proxies nothing', () => {
    expect(code(off)).toMatch(/\{\$GELDAR_INGEST_HOST:otel\.invalid\} \{\s+respond 503\s+\}/);
    expect(off).not.toContain('reverse_proxy');
  });
});
