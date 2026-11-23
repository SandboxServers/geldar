# 0410. Glass mobile redesign: a foldable two-pane layout and an installable page

- Status: Proposed (implementer; owner rules A2, A3, A4, A5 and A8)
- Date: 2026-11-21
- Spec: section 2 (Principle 1), section 5.13 (the Observatory: the Thought Stream), the names table in section 2a (the Glass). Decisions 0072 and 0093 (Glass is public, read-only, hardened), 0138 (who reads a sovereign player's thoughts), 0166 (the Kino page).

## Requirement

The owner approved a mobile design for the Glass page and handed it over as a package (`design_handoff_glass_mobile_fold`: a README with the tokens and the screens, an HTML prototype, ten screenshots, and an issue text). The main target is Chrome on a Samsung Galaxy Z Fold, on the cover screen and unfolded. The issue asks for three things: restyle the page to the design, add a two-pane layout for wide and unfolded screens, and make the page installable.

The owner asked for this to be planned and built autonomously, with every open question answered by the implementer and written down. This record is that list. Each assumption is the implementer's call until the owner rules. A2, A3, A4, A5 and A8 answer the issue's open questions or change something an owner ruling touches, so they are marked **owner call** and this record stays Proposed until the owner rules on them.

## Decision

### 1. Scope: the Glass page, restyled, with a wide layout and an install mode

The redesign is in scope as Phase 1 Glass work. Spec 5.13 calls the Thought Stream "the single most-used page" and says nothing about its layout, so the layout is ours to settle.

It changes presentation only. The page stays read-only. It uses the same six API routes with the same parameters. The 60 second delay, the sovereign filter, the Host check, the rate limit and the kill switch are untouched. Rows are still built from text only (`textContent` and text nodes).

**Assumption A1: the other tabs are not built.** The prototype sketches Kino, Map and Roster tabs and a bottom tab bar. The handoff says to ship Glass first and to show the tab bar only when a second tab ships. None of that is in this change; it is in `docs/ideas.md`.

### 2. The banner wording (owner call)

**Assumption A2: the banner reads "One-way glass. You can read; nothing you do here reaches the agents."** It replaces "Read-only. For human observers only. Nothing you do on this page reaches the agents." The new sentence says the same two things (you can read; you cannot act) in the page's own name. The words "read-only" stay in the page description that search engines and link previews show. No decision fixed the old wording; the tests that quoted it now quote the new one.

### 3. Light and dark (owner call)

**Assumption A3: the page keeps a light theme.** The prototype is dark only. The dark theme is now exactly the design's tokens (`#0c0f0b` ground, `#f5a524` amber as the only accent). The light theme stays for a reader whose system asks for one, with the same token names and values derived from the light tokens the page had.

Why keep it: the page had a light theme, and removing one from a public page is a loss for people who read in daylight or find light text on dark hard to read. Keeping it costs one token block. It is also the choice that is cheap to reverse: to go dark only, delete the light `:root` block in `glass/public/app.css` and the light `theme-color` line. The app manifest's colours are the dark ones either way.

### 4. The Content-Security-Policy (owner call)

**Assumption A4: three directives are added, each `'self'` only.**

Before: `default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`

After: `default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; font-src 'self'; manifest-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`

- `font-src 'self'`: the two typefaces are files on the Glass origin.
- `manifest-src 'self'`: the app manifest.
- `worker-src 'self'`: the service worker.
- `img-src` stays `'none'`. The issue allowed `img-src 'self'` "only if the manifest icon needs it". It does not: in Chromium (checked 2026-11-21 with the real header) the page installs and `Page.getInstallabilityErrors` is empty with `img-src 'none'`. The page shows no image; sigils are drawn on canvas.

What this opens under the threat model of the Glass README:

- A font is parsed by the browser. A hostile font would have to be served by Glass itself, from a fixed table of eight files whose hashes are in `THIRD_PARTY_NOTICES.md`. World text cannot name a font.
- A service worker can answer requests for its whole scope, and the register service's pages and forms and Kino are on the same origin. This is the real cost of the change, and section 6 is how it is bounded. A worker can only be registered from a script on the origin, the origin serves no script that world text can influence, and `script-src 'self'` with no inline script is unchanged.
- No source other than `'self'` and `'none'` appears in the policy. A test holds that.

The fallback, if the owner does not want a worker on a public origin with no login: delete `sw.js`, the manifest link and `worker-src`/`manifest-src`. The redesign and the fonts do not depend on them.

### 5. The app icon (owner call)

**Assumption A5: the icon is generated, not drawn.** The issue asks who supplies it. Until the owner supplies art, the icon is the sigil of the name "Glass" from the page's own generator, in the design's amber on its dark ground: 192px, 512px and a maskable 512px whose sigil stays inside the middle 80% circle. `glass/test/app-icon.ts` writes the three PNGs with no image library, and a test holds the committed files to it pixel for pixel. They are the first image files outside `docs/`. Two checks forbid such files, and each now excuses exactly these three: the test that forbids game textures under `glass/`, and the leak scan that treats any PNG outside `docs/` as a skin (`tools/players-cli/src/leak-scan.ts`). The leak scan excuses them by path and by the SHA-256 of their bytes, so another picture under the same name is flagged again. New icon art means new hashes there, in a reviewed change.

### 6. The service worker

- **Shell only.** It answers a `GET` for a path in a fixed list: the files Glass serves, minus the worker itself. A test holds that list equal to the static table. Every other request is not answered, not read and never stored: `/api/*`, the stream, `/kino/*`, `/register*`, `/roster*`, any write, any other origin.
- **No thought is ever cached.** Thoughts are live and delayed by policy, and the sovereign filter can hide an agent later. An installed app holds none.
- **Network first.** A reader online always gets the server's page. Whatever the server answers is passed on, so the kill switch's `503` reaches the reader and is never replaced by the copy. The copy is used only when the network gives no answer at all. Offline, the page opens, shows no thoughts and says "Reconnecting...". When the feed comes back, the page asks for its first page again.
- **Updates.** The worker is served with `no-cache`, and a browser checks for a new one on every visit; a new one takes over at once (`skipWaiting`, `clients.claim`) and removes older copies. A copy that cannot be stored never stands in for the server's answer.
- **The rate limit.** One cold load is about 50 requests for small files: the page asks for each, then the installing worker asks again. The general bucket (20 at once, 60 a minute) refused half of them, so the worker never installed and a first visit could lose a stylesheet. The page's files now have their own bucket, 200 at once and 600 a minute for each client, the size Kino's files already had. The API stays on the general bucket. A review found this; the first validation had run the page with no limiter. The preview now runs under the shipped limits, and a test runs a cold load against them.

### 7. The delay in the status control

The design's status pill says "Live −60s", and the handoff says the number is the configured delay. The page had no way to know it.

**Assumption A6: the server writes the delay into the page.** `index.html` carries `data-delay="0"` on the status control, and the handler replaces it once, at start, with `GELDAR_GLASS_DELAY_SECONDS` as a whole number. The page reads it as digits only; anything else is no delay. No route is added and no API reply changes. The delay is already public (it is the README's default). A page without exactly one slot stops Glass at start instead of serving a page that says nothing.

### 8. Receipts (owner call)

The design shows "receipts — what the body actually did" as rows of action, outcome and ticks. The prototype's receipts are invented. Real receipts carry `kind`, `phase`, `item`, `count` and `credits`, and no duration.

**Assumption A7: the three cells are what the Record has.** The action is the kind, the item and, above one, the count ("place oak_planks ×4"). The outcome is the receipt's phase in its own words (committed in green, aborted in red, anything else in amber). The third cell is the credits ("3 cr"), not ticks.

**Assumption A8 (owner call): on live data the receipts do not appear yet, and this change does not fix that.** The page asks for receipts only when a thought row names its action. Neither `GET /api/thoughts` nor `GET /api/thoughts/:id` sends an `action_id` (`glass/src/query.ts`; the `thoughts` table has none, the link runs through `intents` and `actions`). This is how the page behaved before the redesign too: the receipts table was built and tested but never fed. Serving the link is an API change, and the issue keeps the API as it is. Until it is served, the detail and the reader show the facts and "Copy entry", and say nothing about receipts. For a thought, the page says "No receipts: nothing was done with this entry." only for an action it asked about, never for an answer it does not have. A journal line is a note, not a decision: it has no action, and the page says so without asking. The link is in `docs/ideas.md`.

### 9. The layouts

- **Narrow (under 700px).** One column: a header that stays put, then the list, which scrolls inside its own pane. The page itself never scrolls. When the header would leave the list no room (a screen under 540px tall, or the "More" panel open), the whole pane scrolls instead.
- **Wide (700px and up).** Two panes, half the screen each, capped at 1180px in total on a desktop so a line of text stays readable. The reader shows the selected entry, or the newest while nothing is selected. Rows do not open in place; a press anywhere selects.
- **The hinge.** The pane paddings keep text and controls out of the middle 30px. The prototype's dark stripe is a mock-up of the crease and is not built. Where Chrome reports two screens (`horizontal-viewport-segments: 2`), each pane takes one; otherwise the 50% split stands.
- **The breakpoint is CSS.** The script asks `matchMedia('(min-width: 700px)')` only to decide whether an entry opens in place or in the reader. A fold or an unfold moves an open detail into the reader and back.

**Assumption A9: "More" sits at the end of the banner.** The design does not show where the time range, outcome and template filters, "About this page" and the sign-in link go; the handoff suggests one "More" disclosure. It is an inline disclosure at the end of the banner's last line, so it costs the header no height, with a 44px touch target. It turns amber while a filter inside it is set, so a folded filter is never a hidden one. It no longer opens by itself for a bookmark.

**Assumption A10: the reader waits 800 ms before it fetches the facts of an entry it only follows.** While nothing is selected the reader follows the feed, and each new entry would cost a request from the reader's rate limit (60 a minute, burst 20). A burst of entries now costs one request. A selected entry is fetched at once. On a phone the reader fetches nothing.

**Assumption A11: one "new entries" control does two jobs.** While paused it counts what waits, and a press resumes (the design). While live it still counts what arrived above when the reader has scrolled away, and a press goes to the top (what the page did before). The status pill says "Paused"; the count is in the control beside the list, not in the status text.

**Assumption A12: the detail keeps one fact the design drops.** The design's grid has world day, tick, tier, latency and template. The exact time ("written", UTC to the millisecond) stays, because the row shows only a local clock time. A dead agent's "died" and "cause" stay. The agent id, the outcome and the wake reason leave the grid: the row and the URL already show them. "Copy entry" moves from the row into the detail and the reader, as designed.

### 10. Typefaces

**Assumption A13: the fonts are vendored files, not a dependency.** Instrument Serif (regular and italic) and DM Mono (400 and 500), Latin and Latin Extended subsets, eight WOFF2 files, about 116 KB. They are copied unmodified from `@fontsource/instrument-serif` 5.3.0 and `@fontsource/dm-mono` 5.3.0 (both published 2026-07-19, so older than the two-week floor of decision 0005). The packages are not added to the workspace. The licence texts sit beside the files, and `THIRD_PARTY_NOTICES.md` has the notice and the hashes. Text outside both subsets falls back to the system fonts.

Fonts and icons are served with `Cache-Control: public, max-age=604800`; the page's own code stays `no-cache`.

### 11. Where the files are served: under `/js/`, so no Caddy change

Caddy routes the Glass page by an explicit list: `/`, `/app.css`, `/app.js` and everything under `/js/`. The deploy pipeline rolls a new Glass image by itself on a merge to main, but it never applies a Caddy change: that is an operator's restart of the shared Caddy, which interrupts every site behind it and needs the node owner's window. A new page file outside the live route is a 404 in production until that restart.

**Assumption A15: every file the redesign adds is served under `/js/`.** The three new stylesheets, the typefaces, the icons, the manifest and the service worker are at `/js/fonts.css`, `/js/fonts/...`, `/js/icons/...`, `/js/manifest.webmanifest`, `/js/sw.js`, whatever they are. The folder name is wrong for most of them; it is the one folder the live route already passes. Checked against the live site on 2026-11-22: a nested path under `/js/` reaches Glass (its own JSON 404), and `/fonts.css` or `/sw.js` at the root stops at Caddy. With this, the page deploys by itself with nothing to do on the node. `deploy/caddy/` is byte for byte what it was before this work.

The service worker needs one more thing there. A worker's scope is its own folder unless the server says otherwise, and the page is at `/`. Glass sends `Service-Worker-Allowed: /` with `/js/sw.js`, and with no other file, so that one fixed script may take the whole origin. The header gives it nothing a worker served from the root would not have; a test holds it to the one path.

How this was reached: the first version served the files at the root and changed the Caddy route with them. A check of the deploy pipeline showed that would put the new page live behind the old route, unstyled, until an operator acted. The route was then merged ahead of the page (PR #893) so it could be loaded on the node first. No operator was available to do that, so the page was changed to fit the live route instead, and this change takes #893's route back out. The node never had it.

A later change may move the files to better paths. It must change the Caddy route in a step of its own, loaded on the node before the page that needs it. `glass/test/caddy-paths.test.ts` fails if the page and the route change together.

### 12. Storage

**Assumption A14: the page stores one flag.** "Not now" on the install strip is remembered in `localStorage` as `glass.install.dismissed`. It is the first thing the Glass page stores. It says nothing about the reader or what they read.

## Why

Glass is the public window on the vivarium (Principle 1: humans watch, and only watch). It was one reading column at every width, so the unfolded screen of a foldable was half empty, and it had no full-screen mode. The owner approved a design that fixes both.

## Consequences

- No Caddy change and nothing to do on the node: every page file is under the route that is already live (section 11). A test holds the page to that route and the route to what the node has.
- The first image files in the repository (three generated icons) and the first font files.
- The receipts list will show on live data only after the API links a thought to its action (A8).

- A first page that fails is asked for again five times with a growing wait (0.5 to 8 seconds), and after that only when the feed comes back. A reply to an older filter change is dropped, so a slow reply cannot overwrite a newer one.
- Tests: every behaviour here has a test; the PR lists the ones checked by reverting the change.
- Not verified on a real device. The layouts were checked in headless Chromium at 360x780 and 750x760 CSS pixels (the handoff's estimates for the Fold). Install was checked with Chromium's installability audit, not by adding the app to a phone's home screen.

## Addendum: owner ruling on A8 (2026-11-22)

Owner ruling (via the campaign lead, 2026-11-22): A8 many actions per thought.

A thought can lead to many actions, so the API links a thought to each of them. `GET /api/thoughts/:id` sends `action_ids`: the actions the thought led to, in order (by intent start tick, then action sequence). The join runs thought -> `intents.thought_id` -> `actions.intent_id`, keeps only the actions of the thought's own agent, and repeats the thought's visibility (the sovereign filter and the delay) on the join. An action is named only when its first receipt is inside the delay window (or the agent is the viewer's own). The page asks `GET /api/receipts?action_id=` for each id, in that order, four requests at a time, and shows the receipts together under the thought; a request that fails drops only its own receipts. A thought with no action says nothing about receipts, as before. Assumption A8 above is superseded by this ruling for the receipts that now show.
