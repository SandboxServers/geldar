/**
 * The files of the Thought Stream page: its markup, styles and scripts, the service worker and manifest of
 * the installable app, and the two typefaces and the icons it loads from this origin. They are read once
 * at load and keyed by URL path. A request selects an entry in this table; no path from a request names a
 * file on disk.
 */
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

export interface StaticFile {
  body: string | Buffer;
  type: string;
  /** The Cache-Control value. The page's own code is checked on every load; typefaces and icons are kept a week. */
  cache: string;
}

const PUBLIC = new URL('../public/', import.meta.url);
const SOURCE = new URL('./', import.meta.url);

const CSS = 'text/css; charset=utf-8';
const JS = 'text/javascript; charset=utf-8';
const CHECKED = 'no-cache';
const KEPT = 'public, max-age=604800';

/** The render modules, served under /js/ as JavaScript with their types stripped. */
export const RENDER_MODULES = [
  'render-model',
  'render-view',
  'render-stream',
  'render-sigil',
  'render-detail',
  'render-reader',
  'render-filters',
  'render-install',
] as const;

/** The typeface files under /fonts/: two faces of each family, each split in Latin and Latin Extended. */
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

/** The app icons under /icons/, named by the manifest. */
export const ICON_FILES = ['icon-192', 'icon-512', 'maskable-512'] as const;

function text(dir: URL, name: string, type: string): StaticFile {
  return { body: readFileSync(new URL(name, dir), 'utf8'), type, cache: CHECKED };
}

function bytes(name: string, type: string): StaticFile {
  return { body: readFileSync(new URL(name, PUBLIC)), type, cache: KEPT };
}

export const STATIC_FILES: ReadonlyMap<string, StaticFile> = new Map<string, StaticFile>([
  ['/', text(PUBLIC, 'index.html', 'text/html; charset=utf-8')],
  ['/fonts.css', text(PUBLIC, 'fonts.css', CSS)],
  ['/app.css', text(PUBLIC, 'app.css', CSS)],
  ['/entries.css', text(PUBLIC, 'entries.css', CSS)],
  ['/reader.css', text(PUBLIC, 'reader.css', CSS)],
  ['/app.js', text(PUBLIC, 'app.js', JS)],
  // The worker is served from the root, so its scope is the origin; it answers only for the files here.
  ['/sw.js', text(PUBLIC, 'sw.js', JS)],
  ['/manifest.webmanifest', text(PUBLIC, 'manifest.webmanifest', 'application/manifest+json')],
  ...RENDER_MODULES.map((name): [string, StaticFile] => {
    const file = text(SOURCE, `${name}.ts`, JS);
    return [`/js/${name}.ts`, { ...file, body: stripTypeScriptTypes(String(file.body)) }];
  }),
  ...FONT_FILES.map((name): [string, StaticFile] => [
    `/fonts/${name}.woff2`,
    bytes(`fonts/${name}.woff2`, 'font/woff2'),
  ]),
  ...ICON_FILES.map((name): [string, StaticFile] => [
    `/icons/${name}.png`,
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
export function pageWithDelay(delaySeconds: number): StaticFile {
  const page = STATIC_FILES.get('/') as StaticFile;
  const html = String(page.body);
  if (html.split(DELAY_SLOT).length !== 2) throw new Error('index.html has no single delay slot');
  const seconds = Number.isFinite(delaySeconds) ? Math.max(0, Math.floor(delaySeconds)) : 0;
  return { ...page, body: html.replace(DELAY_SLOT, `data-delay="${seconds}"`) };
}
