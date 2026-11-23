/**
 * The files Glass serves for the page and the installable app: every one answers with its type, the
 * security headers and a cache rule; the typefaces and icons arrive byte for byte; the page carries the
 * configured delay; and the page asks for nothing that is not in the table.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createHandler, SECURITY_HEADERS } from '../src/http.ts';
import type { PublicPolicy } from '../src/policy.ts';
import type { SqlClient } from '../src/query.ts';
import type { SseHub } from '../src/sse.ts';
import {
  etagOf,
  FONT_FILES,
  ICON_FILES,
  pageWithDelay,
  pageWithOptions,
  RENDER_MODULES,
  STATIC_FILES,
  WORKER_PATH,
  withDelay,
  withKinoTab,
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

function send(
  port: number,
  method: string,
  path: string,
  headers: Record<string, string> = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method, path, headers }, (res) => {
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

/** The tag Glass sends for a path. The page is built per configuration (delay 0, no Kino tab here), so it is not the table's entry. */
function servedTag(path: string): string {
  return path === '/' ? pageWithOptions(0, false).etag : (STATIC_FILES.get(path)?.etag as string);
}

describe('the static files: ETag and 304', () => {
  it('give every file a strong ETag of its body, hashed at load', () => {
    for (const [path, file] of STATIC_FILES) {
      expect(file.etag, path).toMatch(/^"[\w-]{22}"$/);
      expect(file.etag, path).toBe(etagOf(file.body));
    }
  });

  it('send the ETag on a 200, with the cache rule and the file headers', async () => {
    const port = await start();
    for (const path of STATIC_FILES.keys()) {
      const reply = await send(port, 'GET', path);
      expect(reply.status, path).toBe(200);
      expect(reply.headers.etag, path).toBe(servedTag(path));
      expect(reply.headers['cache-control'], path).toBe(STATIC_FILES.get(path)?.cache);
    }
  });

  it('answer 304 with no body when If-None-Match matches, keeping the headers', async () => {
    const port = await start();
    for (const path of STATIC_FILES.keys()) {
      const etag = servedTag(path);
      const reply = await send(port, 'GET', path, { 'if-none-match': etag });
      expect(reply.status, path).toBe(304);
      expect(reply.body.length, path).toBe(0);
      expect(reply.headers.etag, path).toBe(etag);
      expect(reply.headers['cache-control'], path).toBe(STATIC_FILES.get(path)?.cache);
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
        expect(reply.headers[name.toLowerCase()], `${path} ${name}`).toBe(value);
      }
    }
    // The worker's Service-Worker-Allowed is one of the file's own headers, so the 304 keeps it too.
    const worker = await send(port, 'GET', WORKER_PATH, {
      'if-none-match': STATIC_FILES.get(WORKER_PATH)?.etag as string,
    });
    expect(worker.headers['service-worker-allowed']).toBe('/');
    // A HEAD with a matching tag is the same 304.
    const head = await send(port, 'HEAD', '/app.js', {
      'if-none-match': STATIC_FILES.get('/app.js')?.etag as string,
    });
    expect(head.status).toBe(304);
  });

  it('answer 200 with the body when If-None-Match is another tag or absent', async () => {
    const port = await start();
    const other = await send(port, 'GET', '/app.js', {
      'if-none-match': '"0000000000000000000000"',
    });
    expect(other.status).toBe(200);
    expect(other.body.length).toBeGreaterThan(0);
    const none = await send(port, 'GET', '/app.js');
    expect(none.status).toBe(200);
    expect(none.body.length).toBeGreaterThan(0);
  });

  it('change the ETag when the content changes: the page with another delay or Kino tab', async () => {
    expect(pageWithDelay(60).etag).not.toBe(pageWithDelay(0).etag);
    expect(pageWithDelay(60).etag).toBe(etagOf(pageWithDelay(60).body));
    expect(pageWithOptions(0, true).etag).not.toBe(pageWithOptions(0, false).etag);
    expect(pageWithOptions(0, false).etag).not.toBe(STATIC_FILES.get('/')?.etag);
    // A client holding the tag of the page with delay 0 gets a fresh 200 from a server with delay 60.
    const old = pageWithOptions(0, false).etag;
    const port = await start({ delaySeconds: 60 });
    const reply = await send(port, 'GET', '/', { 'if-none-match': old });
    expect(reply.status).toBe(200);
    expect(String(reply.body)).toContain('data-delay="60"');
    expect(reply.headers.etag).toBe(pageWithOptions(60, false).etag);
  });
});

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
        '/js/entries.css',
        '/js/fonts.css',
        '/js/manifest.webmanifest',
        '/js/reader.css',
        '/js/roster.css',
        '/js/sw.js',
        ...RENDER_MODULES.map((name) => `/js/${name}.ts`),
        ...FONT_FILES.map((name) => `/js/fonts/${name}.woff2`),
        ...ICON_FILES.map((name) => `/js/icons/${name}.png`),
      ].sort(),
    );
    expect(FONT_FILES).toHaveLength(8);
    expect(ICON_FILES).toEqual(['icon-192', 'icon-512', 'maskable-512']);
  });

  it('all sit at /, /app.css, /app.js or under /js/: the only page paths the live Caddy routes', () => {
    for (const path of STATIC_FILES.keys()) {
      expect(
        path === '/' || path === '/app.css' || path === '/app.js' || path.startsWith('/js/'),
        path,
      ).toBe(true);
    }
  });

  it('lets the worker, and no other file, take the whole origin as its scope', async () => {
    const port = await start();
    expect(WORKER_PATH).toBe('/js/sw.js');
    for (const path of STATIC_FILES.keys()) {
      const reply = await send(port, 'GET', path);
      expect(reply.headers['service-worker-allowed'], path).toBe(
        path === WORKER_PATH ? '/' : undefined,
      );
    }
    // An unknown path under /js/ gets no such header: only the one fixed file does.
    expect(
      (await send(port, 'GET', '/js/evil.js')).headers['service-worker-allowed'],
    ).toBeUndefined();
    expect((await send(port, 'HEAD', WORKER_PATH)).headers['service-worker-allowed']).toBe('/');
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
      const kept = path.startsWith('/js/fonts/') || path.startsWith('/js/icons/');
      expect(reply.headers['cache-control'], path).toBe(
        kept ? 'public, max-age=604800' : 'no-cache',
      );
    }
  });

  it('send the typefaces and the icons byte for byte', async () => {
    const port = await start();
    for (const name of FONT_FILES) {
      const reply = await send(port, 'GET', `/js/fonts/${name}.woff2`);
      expect(reply.body.subarray(0, 4).toString('latin1'), name).toBe('wOF2');
      expect(reply.body.equals(readFileSync(new URL(`fonts/${name}.woff2`, PUBLIC))), name).toBe(
        true,
      );
    }
    for (const name of ICON_FILES) {
      const reply = await send(port, 'GET', `/js/icons/${name}.png`);
      expect(reply.body.subarray(1, 4).toString('latin1'), name).toBe('PNG');
      expect(reply.body.equals(readFileSync(new URL(`icons/${name}.png`, PUBLIC))), name).toBe(
        true,
      );
    }
  });

  it('are the typeface files the third-party notice lists, hash for hash', () => {
    const notice = readFileSync(new URL('../../THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8');
    const listed = new Map(
      [...notice.matchAll(/^([0-9a-f]{64}) {2}(\S+\.woff2)$/gm)].map((m) => [m[2], m[1]]),
    );
    expect([...listed.keys()].sort()).toEqual(FONT_FILES.map((name) => `${name}.woff2`).sort());
    for (const name of FONT_FILES) {
      const bytes = readFileSync(new URL(`fonts/${name}.woff2`, PUBLIC));
      expect(createHash('sha256').update(bytes).digest('hex'), name).toBe(
        listed.get(`${name}.woff2`),
      );
    }
    // Each typeface's licence text travels with its files.
    for (const licence of ['OFL-instrument-serif.txt', 'OFL-dm-mono.txt']) {
      expect(readFileSync(new URL(`fonts/${licence}`, PUBLIC), 'utf8')).toContain(
        'SIL OPEN FONT LICENSE Version 1.1',
      );
    }
  });

  it('answer a HEAD without a body and refuse a write with 405', async () => {
    const port = await start();
    for (const path of [
      '/js/sw.js',
      '/js/manifest.webmanifest',
      '/js/fonts/dm-mono-latin-400-normal.woff2',
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
      '/js/fonts/',
      '/js/fonts/OFL-dm-mono.txt',
      '/js/fonts/dm-mono-latin-400-normal.woff',
      '/js/fonts/../../../package.json',
      '/js/fonts/..%2f..%2fpackage.json',
      '/js/icons/icon-1024.png',
      '/js/icons/../index.html',
      '/js/manifest.json',
      '/js/sw.js.map',
      // The same files at the root, where the folders on disk might suggest they are: not served there.
      '/sw.js',
      '/fonts.css',
      '/manifest.webmanifest',
      '/fonts/dm-mono-latin-400-normal.woff2',
      '/icons/icon-192.png',
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

  it('refuses a page without exactly one delay slot, instead of serving one that says nothing', () => {
    const slot = '<button data-delay="0">';
    expect(withDelay(slot, 60)).toBe('<button data-delay="60">');
    expect(() => withDelay('<button>', 60)).toThrow(/no single delay slot/);
    expect(() => withDelay(slot + slot, 60)).toThrow(/no single delay slot/);
  });

  it('writes the Kino tab into its one slot, removes the slot when off, and refuses any other page', () => {
    const slot = '      <!-- kino-tab -->\n';
    const page = `<nav>\n${slot}</nav>`;
    expect(withKinoTab(page, true)).toBe(
      '<nav>\n      <a id="tab-kino" href="/kino/">Kino</a>\n</nav>',
    );
    expect(withKinoTab(page, false)).toBe('<nav>\n</nav>');
    expect(() => withKinoTab('<nav></nav>', true)).toThrow(/no single Kino tab slot/);
    expect(() => withKinoTab('<nav></nav>', false)).toThrow(/no single Kino tab slot/);
    expect(() => withKinoTab(page + slot, true)).toThrow(/no single Kino tab slot/);
  });

  it('asks only for files in the table: every link, script, import, typeface and icon', () => {
    const text = (path: string): string => String(STATIC_FILES.get(path)?.body);
    const wanted = new Set<string>();
    for (const m of text('/').matchAll(/<(?:link|script)\b[^>]*?(?:href|src)="(\/[^"]*)"/g)) {
      wanted.add(m[1] as string);
    }
    for (const m of text('/app.js').matchAll(/from '(\/[^']+)'/g)) wanted.add(m[1] as string);
    for (const m of text('/js/fonts.css').matchAll(/url\("([^"]+)"\)/g)) wanted.add(m[1] as string);
    const manifest = JSON.parse(text('/js/manifest.webmanifest')) as { icons: { src: string }[] };
    for (const icon of manifest.icons) wanted.add(icon.src);
    wanted.add(WORKER_PATH);
    expect(wanted.size).toBeGreaterThan(20);
    for (const path of wanted) expect(STATIC_FILES.has(path), path).toBe(true);
    // And nothing in the table is dead: each file is asked for by the page, or imported by a module that is.
    // The plan-activity panel (BLD-37) is imported by render-view as './plan-activity/index.ts'.
    const imported = RENDER_MODULES.flatMap((name) =>
      [
        ...text(`/js/${name}.ts`).matchAll(
          /from '\.\/((?:render-[a-z]+|plan-activity\/index)\.ts)'/g,
        ),
      ].map((m) => `/js/${m[1]}`),
    );
    for (const path of STATIC_FILES.keys()) {
      expect(path === '/' || wanted.has(path) || imported.includes(path), path).toBe(true);
    }
  });
});

describe('the app manifest', () => {
  const manifest = JSON.parse(String(STATIC_FILES.get('/js/manifest.webmanifest')?.body)) as Record<
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
      { src: '/js/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/js/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/js/icons/maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
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
