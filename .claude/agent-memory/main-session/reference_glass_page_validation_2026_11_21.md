---
name: reference_glass_page_validation_2026_11_21
description: How to look at the Glass page without a shard, and three traps when checking it in headless Chromium
---

Learned 2026-11-21 while building the Glass mobile redesign (decision 0410). Full notes: `docs/analysis/glass-mobile/README.md`.

- **Preview.** `node glass/test/page-preview/server.ts [port] [live-seconds] [delay-seconds] [unlimited]` serves the page through Glass's real handler (real files, headers, CSP and rate limits) with invented data. Pass `unlimited` only for a script that loads the page many times.
- **Trap: a preview without the rate limiter hides a broken page.** The first validation ran with no limiter and missed that a page load overran the general bucket (burst 20): half the files got 429 and the service worker never installed. A reviewer caught it. Count the requests of one cold load (page files, the worker's precache, the API) against the buckets in `glass/src/policy.ts` whenever the page gains files. Open `http://localhost:<port>/`: Glass answers that Host, and a service worker needs `localhost` or HTTPS.
- **Playwright is already in the repo** (`tools/kino-shot`, 1.64.1). A scratch script can import it from `tools/kino-shot/node_modules/playwright/index.mjs`; no new dependency is needed for screenshots.
- **Trap: headless Linux text is about 6% wider.** Without `--font-render-hinting=none`, Chromium rounds each glyph advance up to a whole pixel. A line that fits on a phone wraps in the screenshot. Launch with that flag before judging a layout, and leave real slack in any one-line header.
- **Trap: Playwright blocks or allows service workers per context** (`serviceWorkers: 'block'`). Block them for layout shots; allow them to check install and offline. `Page.getInstallabilityErrors` and `Page.getAppManifest` over a CDP session say whether Chrome would offer the install.
- **Trap: `beforeinstallprompt` never fires headless.** To see the install strip, dispatch the event by hand.
- **Fact: Chrome installs a PWA under `img-src 'none'`.** The manifest's icons are fetched by the browser, not as page images (checked with Chromium 1248, 2026-11-21).
- **Fact: Caddy routes the Glass page by an explicit path list** (`deploy/caddy/glass.caddy`, `@glass_page`). A new page file must be added there too; `glass/test/caddy-paths.test.ts` fails otherwise.
