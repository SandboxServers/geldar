/**
 * The files of the Thought Stream page: its markup, styles and scripts, the service worker and manifest of
 * the installable app, and the two typefaces and the icons it loads from this origin. They are read once
 * at load and keyed by URL path. A request selects an entry in this table; no path from a request names a
 * file on disk.
 *
 * Every path here is `/`, `/app.css`, `/app.js` or under `/js/`. Those are the only page paths Caddy routes
 * to Glass (deploy/caddy/glass.caddy), and the deploy pipeline rolls a Glass image by itself but never
 * applies a Caddy change. A file anywhere else would be a 404 in production until an operator restarted the
 * shared Caddy by hand. So the stylesheets, typefaces, icons, manifest and worker added by the redesign live
 * under `/js/` too, whatever they are. glass/test/caddy-paths.test.ts holds this table to that route.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

export interface StaticFile {
  body: string | Buffer;
  type: string;
  /** The Cache-Control value. The page's own code is checked on every load; typefaces and icons are kept a week. */
  cache: string;
  /** Headers this one file needs besides its type and cache rule. */
  headers?: Record<string, string>;
  /** A strong ETag of the body, hashed once at load. A request that sends it back gets a 304 with no body. */
  etag: string;
}

/** The strong ETag of a body: a 22-character base64url SHA-256 prefix, quoted. Same form as the Kino files. */
export function etagOf(body: string | Buffer): string {
  const digest = createHash('sha256').update(body).digest('base64url').slice(0, 22);
  // base64url has no character that needs escaping, so JSON.stringify only adds the quotes.
  return JSON.stringify(digest);
}

/**
 * Whether an If-None-Match header matches the ETag (RFC 9110 13.1.2: GET and HEAD use the weak comparison). The
 * header may be `*`, a comma list, or weak (`W/"tag"`, which a compressing CDN adds); the weak prefix is ignored.
 */
export function etagMatches(header: string | undefined, etag: string): boolean {
  if (header === undefined) return false;
  const bare = (tag: string): string => tag.trim().replace(/^W\//, '');
  const target = bare(etag);
  return header.split(',').some((part) => {
    const tag = part.trim();
    return tag === '*' || bare(tag) === target;
  });
}

/** The same entry with another body. The ETag follows the body, so a rewritten page is never tagged with the old one. */
function withBody(file: StaticFile, body: string | Buffer): StaticFile {
  return { ...file, body, etag: etagOf(body) };
}

const PUBLIC = new URL('../public/', import.meta.url);
const SOURCE = new URL('./', import.meta.url);

const CSS = 'text/css; charset=utf-8';
const JS = 'text/javascript; charset=utf-8';
const CHECKED = 'no-cache';
const KEPT = 'public, max-age=604800';

/** The plan-activity panel (decision 0429), a human-only view. It is served with the render modules; render-view re-exports it. */
export const PLAN_ACTIVITY_MODULE = 'plan-activity/index' as const;

/** The render modules, served under /js/ as JavaScript with their types stripped. */
export const RENDER_MODULES = [
  PLAN_ACTIVITY_MODULE,
  'render-model',
  'render-view',
  'render-stream',
  'render-sigil',
  'render-detail',
  'render-reader',
  'render-filters',
  'render-fresh',
  'render-install',
  'render-more',
  'render-roster',
  'render-tabs',
] as const;

/** Where the service worker is served. */
export const WORKER_PATH = '/js/sw.js';

/** The typeface files under /js/fonts/: two faces of each family, each split in Latin and Latin Extended. */
export const FONT_FILES = [
  'instrument-serif-latin-400-normal',
  'instrument-serif-latin-400-italic',
  'instrument-serif-latin-ext-400-normal',
  'instrument-serif-latin-ext-400-italic',
  'dm-mono-latin-400-normal',
  'dm-mono-latin-500-normal',
  'dm-mono-latin-ext-400-normal',
  'dm-mono-latin-ext-500-normal',
] as const;

/** The app icons under /js/icons/, named by the manifest. */
export const ICON_FILES = ['icon-192', 'icon-512', 'maskable-512'] as const;

function text(dir: URL, name: string, type: string): StaticFile {
  const body = readFileSync(new URL(name, dir), 'utf8');
  return { body, type, cache: CHECKED, etag: etagOf(body) };
}

function bytes(name: string, type: string): StaticFile {
  const body = readFileSync(new URL(name, PUBLIC));
  return { body, type, cache: KEPT, etag: etagOf(body) };
}

export const STATIC_FILES: ReadonlyMap<string, StaticFile> = new Map<string, StaticFile>([
  ['/', text(PUBLIC, 'index.html', 'text/html; charset=utf-8')],
  ['/app.css', text(PUBLIC, 'app.css', CSS)],
  ['/js/fonts.css', text(PUBLIC, 'fonts.css', CSS)],
  ['/js/entries.css', text(PUBLIC, 'entries.css', CSS)],
  ['/js/roster.css', text(PUBLIC, 'roster.css', CSS)],
  ['/js/reader.css', text(PUBLIC, 'reader.css', CSS)],
  ['/app.js', text(PUBLIC, 'app.js', JS)],
  // A worker's scope is its own folder unless the server says otherwise. This one file may take the whole
  // origin, which the page at `/` needs; it answers only for the files of this table.
  [WORKER_PATH, { ...text(PUBLIC, 'sw.js', JS), headers: { 'Service-Worker-Allowed': '/' } }],
  ['/js/manifest.webmanifest', text(PUBLIC, 'manifest.webmanifest', 'application/manifest+json')],
  ...RENDER_MODULES.map((name): [string, StaticFile] => {
    const file = text(SOURCE, `${name}.ts`, JS);
    return [`/js/${name}.ts`, withBody(file, stripTypeScriptTypes(String(file.body)))];
  }),
  ...FONT_FILES.map((name): [string, StaticFile] => [
    `/js/fonts/${name}.woff2`,
    bytes(`fonts/${name}.woff2`, 'font/woff2'),
  ]),
  ...ICON_FILES.map((name): [string, StaticFile] => [
    `/js/icons/${name}.png`,
    bytes(`icons/${name}.png`, 'image/png'),
  ]),
]);

/** The attribute the page ships with. The handler replaces it with the configured delay. */
const DELAY_SLOT = 'data-delay="0"';

/**
 * The page with the public delay written into it, so the status control can say "Live −60s". The value is
 * a whole number from the configuration, never text from a request or from the world. A page without the
 * slot is a mistake in the markup, and is refused at start instead of serving a page that says nothing.
 */
export function withDelay(html: string, delaySeconds: number): string {
  if (html.split(DELAY_SLOT).length !== 2) throw new Error('index.html has no single delay slot');
  const seconds = Number.isFinite(delaySeconds) ? Math.max(0, Math.floor(delaySeconds)) : 0;
  return html.replace(DELAY_SLOT, `data-delay="${seconds}"`);
}

/** The literal slot includes its line ending so the off page keeps the original markup. */
const KINO_TAB_SLOT = '      <!-- kino-tab -->\n';
const KINO_TAB = '      <a id="tab-kino" href="/kino/">Kino</a>\n';

/**
 * The page with the Kino tab in its slot, or with the slot line removed. The tab is a fixed link. A
 * page without the one slot is refused at start: it would serve the comment, or never show the tab.
 */
export function withKinoTab(html: string, kinoMounted: boolean): string {
  if (html.split(KINO_TAB_SLOT).length !== 2)
    throw new Error('index.html has no single Kino tab slot');
  return html.replace(KINO_TAB_SLOT, kinoMounted ? KINO_TAB : '');
}

/** The page entry with the configured delay and the link to Kino, if mounted. */
export function pageWithOptions(delaySeconds: number, kinoMounted: boolean): StaticFile {
  const page = pageWithDelay(delaySeconds);
  return withBody(page, withKinoTab(String(page.body), kinoMounted));
}

/** The page entry of the table with the configured delay in it. */
export function pageWithDelay(delaySeconds: number): StaticFile {
  const page = STATIC_FILES.get('/') as StaticFile;
  return withBody(page, withDelay(String(page.body), delaySeconds));
}
