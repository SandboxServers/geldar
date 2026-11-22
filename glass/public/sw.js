/**
 * The Thought Stream's service worker. It keeps a copy of the page's own files (the shell) so the installed
 * app opens without a network, and it does nothing else.
 *
 * - It answers only a GET for one of the paths in SHELL, on this origin. Every other request (the API, the
 *   stream, Kino, the register service's pages and forms) is left alone: the worker does not answer it,
 *   does not read it and never stores its reply. Thoughts are live and delayed by policy; none is cached.
 * - The network is always asked first, so a reader gets today's page, and whatever the server answers is
 *   passed on as it is: a refusal (the kill switch's 503) reaches the reader. The copy is used only when
 *   the network gives no answer at all.
 *
 * glass/test/service-worker.test.ts runs this file and holds SHELL equal to the files Glass serves.
 */
const CACHE = 'glass-shell-v1';

const SHELL = [
  '/',
  '/fonts.css',
  '/app.css',
  '/entries.css',
  '/reader.css',
  '/app.js',
  '/js/render-model.ts',
  '/js/render-view.ts',
  '/js/render-stream.ts',
  '/js/render-sigil.ts',
  '/js/render-detail.ts',
  '/js/render-install.ts',
  '/js/render-reader.ts',
  '/js/render-filters.ts',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
  '/fonts/instrument-serif-latin-400-normal.woff2',
  '/fonts/instrument-serif-latin-400-italic.woff2',
  '/fonts/instrument-serif-latin-ext-400-normal.woff2',
  '/fonts/instrument-serif-latin-ext-400-italic.woff2',
  '/fonts/dm-mono-latin-400-normal.woff2',
  '/fonts/dm-mono-latin-500-normal.woff2',
  '/fonts/dm-mono-latin-ext-400-normal.woff2',
  '/fonts/dm-mono-latin-ext-500-normal.woff2',
];

const SHELL_PATHS = new Set(SHELL);

/** Keeps a good answer as the copy. A store that fails (a full disk) is not the reader's problem. */
async function keep(path, response) {
  try {
    const cache = await caches.open(CACHE);
    await cache.put(path, response);
  } catch {
    // The copy stays as it was. The next good answer tries again.
  }
}

/** The network's answer, kept as the copy when it is a good one; the copy only when there is no answer. */
async function shellFile(request, path) {
  let response;
  try {
    response = await fetch(request);
  } catch (error) {
    const cache = await caches.open(CACHE);
    const kept = await cache.match(path);
    if (kept !== undefined) return kept;
    throw error;
  }
  if (response.ok) await keep(path, response.clone());
  return response;
}

self.addEventListener('install', (event) => {
  // A file that cannot be fetched fails the install, and the browser keeps the worker it had.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith('glass-shell-') && name !== CACHE)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !SHELL_PATHS.has(url.pathname)) return;
  // The query is not part of the key: "/?agent=..." is the same page as "/".
  event.respondWith(shellFile(request, url.pathname));
});
