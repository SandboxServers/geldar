/**
 * The files Glass serves for the page and the installable app: every one answers with its type, the
 * security headers and a cache rule; the typefaces and icons arrive byte for byte; the page carries the
 * configured delay; and the page asks for nothing that is not in the table.
 */
import { readFileSync } from 'node:fs';
import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createHandler, SECURITY_HEADERS } from '../src/http.ts';
import type { PublicPolicy } from '../src/policy.ts';
import type { SqlClient } from '../src/query.ts';
import type { SseHub } from '../src/sse.ts';
import {
  FONT_FILES,
  ICON_FILES,
  pageWithDelay,
  RENDER_MODULES,
  STATIC_FILES,
} from '../src/static-files.ts';

const PUBLIC = new URL('../public/', import.meta.url);
const servers: Server[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function start(policy: Partial<PublicPolicy> = {}): Promise<number> {
  const handler = createHandler({ db: {} as SqlClient, hub: {} as SseHub, policy });
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

function send(port: number, method: string, path: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method, path }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }),
      );
    });
    req.on('error', reject);
    req.end();
  });
}

const TYPES: [RegExp, string][] = [
  [/^\/$/, 'text/html; charset=utf-8'],
  [/\.css$/, 'text/css; charset=utf-8'],
  [/\.(js|ts)$/, 'text/javascript; charset=utf-8'],
  [/\.webmanifest$/, 'application/manifest+json'],
  [/\.woff2$/, 'font/woff2'],
  [/\.png$/, 'image/png'],
];

describe('the static files', () => {
  it('are exactly the page, its styles and scripts, the worker, the manifest, the typefaces and the icons', () => {
    expect([...STATIC_FILES.keys()].sort()).toEqual(
      [
        '/',
        '/app.css',
        '/app.js',
        '/entries.css',
        '/fonts.css',
        '/manifest.webmanifest',
        '/reader.css',
        '/sw.js',
        ...RENDER_MODULES.map((name) => `/js/${name}.ts`),
        ...FONT_FILES.map((name) => `/fonts/${name}.woff2`),
        ...ICON_FILES.map((name) => `/icons/${name}.png`),
      ].sort(),
    );
    expect(FONT_FILES).toHaveLength(8);
    expect(ICON_FILES).toEqual(['icon-192', 'icon-512', 'maskable-512']);
  });

  it('each answer 200 with its type, the security headers and a cache rule', async () => {
    const port = await start();
    for (const path of STATIC_FILES.keys()) {
      const reply = await send(port, 'GET', path);
      expect(reply.status, path).toBe(200);
      const type = TYPES.find(([pattern]) => pattern.test(path))?.[1];
      expect(reply.headers['content-type'], path).toBe(type);
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
        expect(reply.headers[name.toLowerCase()], `${path} ${name}`).toBe(value);
      }
      // The page's own code is checked with the server on every load; a typeface or an icon is kept a week.
      const kept = path.startsWith('/fonts/') || path.startsWith('/icons/');
      expect(reply.headers['cache-control'], path).toBe(
        kept ? 'public, max-age=604800' : 'no-cache',
      );
    }
  });

  it('send the typefaces and the icons byte for byte', async () => {
    const port = await start();
    for (const name of FONT_FILES) {
      const reply = await send(port, 'GET', `/fonts/${name}.woff2`);
      expect(reply.body.subarray(0, 4).toString('latin1'), name).toBe('wOF2');
      expect(reply.body.equals(readFileSync(new URL(`fonts/${name}.woff2`, PUBLIC))), name).toBe(
        true,
      );
    }
    for (const name of ICON_FILES) {
      const reply = await send(port, 'GET', `/icons/${name}.png`);
      expect(reply.body.subarray(1, 4).toString('latin1'), name).toBe('PNG');
      expect(reply.body.equals(readFileSync(new URL(`icons/${name}.png`, PUBLIC))), name).toBe(
        true,
      );
    }
  });

  it('answer a HEAD without a body and refuse a write with 405', async () => {
    const port = await start();
    for (const path of [
      '/sw.js',
      '/manifest.webmanifest',
      '/fonts/dm-mono-latin-400-normal.woff2',
    ]) {
      const head = await send(port, 'HEAD', path);
      expect([head.status, head.body.length], path).toEqual([200, 0]);
      const write = await send(port, 'POST', path);
      expect([write.status, write.headers.allow], path).toEqual([405, 'GET, HEAD']);
    }
  });

  it('serve no other file: a path picks an entry of the table and never names a file on disk', async () => {
    const port = await start();
    for (const path of [
      '/fonts/',
      '/fonts/OFL-dm-mono.txt',
      '/fonts/dm-mono-latin-400-normal.woff',
      '/fonts/../../package.json',
      '/fonts/..%2f..%2fpackage.json',
      '/icons/icon-1024.png',
      '/icons/../index.html',
      '/manifest.json',
      '/sw.js.map',
      '/js/render-install.test.ts',
      '/js/static-files.ts',
    ]) {
      expect((await send(port, 'GET', path)).status, path).toBe(404);
    }
  });
});

describe('the page', () => {
  it('carries the configured delay, so the status control can say how old the newest thought is', async () => {
    expect(String(STATIC_FILES.get('/')?.body)).toContain('data-delay="0"');
    const delayed = await send(await start({ delaySeconds: 60 }), 'GET', '/');
    expect(delayed.body.toString('utf8')).toContain('data-delay="60"');
    expect(delayed.body.toString('utf8')).not.toContain('data-delay="0"');
    const live = await send(await start(), 'GET', '/');
    expect(live.body.toString('utf8')).toContain('data-delay="0"');
  });

  it('writes the delay as a whole number of seconds, never anything else', () => {
    const slot = (seconds: number): string | undefined =>
      /data-delay="([^"]*)"/.exec(String(pageWithDelay(seconds).body))?.[1];
    expect(slot(60)).toBe('60');
    expect(slot(90.9)).toBe('90');
    expect(slot(-5)).toBe('0');
    expect(slot(Number.NaN)).toBe('0');
    expect(slot(Number.POSITIVE_INFINITY)).toBe('0');
  });

  it('asks only for files in the table: every link, script, import, typeface and icon', () => {
    const text = (path: string): string => String(STATIC_FILES.get(path)?.body);
    const wanted = new Set<string>();
    for (const m of text('/').matchAll(/(?:href|src)="(\/[^"]*)"/g)) wanted.add(m[1] as string);
    for (const m of text('/app.js').matchAll(/from '(\/[^']+)'/g)) wanted.add(m[1] as string);
    for (const m of text('/fonts.css').matchAll(/url\("([^"]+)"\)/g)) wanted.add(m[1] as string);
    const manifest = JSON.parse(text('/manifest.webmanifest')) as { icons: { src: string }[] };
    for (const icon of manifest.icons) wanted.add(icon.src);
    wanted.add('/sw.js');
    // The sign-in link goes to the register service, which Caddy routes; it is not a Glass file.
    wanted.delete('/register/');
    expect(wanted.size).toBeGreaterThan(20);
    for (const path of wanted) expect(STATIC_FILES.has(path), path).toBe(true);
    // And nothing in the table is dead: each file is asked for by the page, or imported by a module that is.
    const imported = RENDER_MODULES.flatMap((name) =>
      [...text(`/js/${name}.ts`).matchAll(/from '\.\/(render-[a-z]+\.ts)'/g)].map(
        (m) => `/js/${m[1]}`,
      ),
    );
    for (const path of STATIC_FILES.keys()) {
      expect(path === '/' || wanted.has(path) || imported.includes(path), path).toBe(true);
    }
  });
});

describe('the app manifest', () => {
  const manifest = JSON.parse(String(STATIC_FILES.get('/manifest.webmanifest')?.body)) as Record<
    string,
    unknown
  >;

  it('names the app, opens it standalone at the page, and uses the page colours', () => {
    expect(manifest).toMatchObject({
      name: 'Glass: Thought Stream',
      short_name: 'Glass',
      id: '/',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#0c0f0b',
      theme_color: '#0c0f0b',
    });
  });

  it('lists a 192 and a 512 icon and a maskable one, all from this origin', () => {
    expect(manifest.icons).toEqual([
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ]);
  });

  it('gives the installed app no way to act: no share target, handler or shortcut', () => {
    for (const key of [
      'share_target',
      'protocol_handlers',
      'file_handlers',
      'shortcuts',
      'related_applications',
      'launch_handler',
    ]) {
      expect(manifest, key).not.toHaveProperty(key);
    }
  });
});
