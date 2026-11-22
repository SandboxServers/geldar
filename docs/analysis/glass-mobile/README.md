# Glass mobile redesign: validation

What was checked for the Glass mobile redesign (decision [0410](../../decisions/0410-glass-mobile-redesign-and-pwa.md)), how, and what was not. Written 2026-11-21 with the change.

## How the page was looked at

The page was served by the test-only preview (`node glass/test/page-preview/server.ts`): Glass's real handler, files, headers and Content-Security-Policy, with invented agents, thoughts and receipts. The screenshots were taken with the preview's rate limits off (`unlimited`), because the script loads the page seventeen times in a row; the cold-load check below ran with them on. It was opened in headless Chromium (Playwright 1.64.1, the version `tools/kino-shot` pins) at the sizes the design handoff gives for a Galaxy Z Fold:

| Screen | CSS pixels | Notes |
|---|---|---|
| Cover, installed app | 360 x 776 | |
| Cover, Chrome tab | 360 x 724 | 52px less for the toolbar |
| Unfolded, installed app | 750 x 768 | |
| Unfolded, Chrome tab | 750 x 716 | |
| Desktop | 1440 x 900 | |
| Phone on its side | 780 x 360 | |

Device pixel ratio 2, as in the handoff's screenshots. Chromium ran with `--font-render-hinting=none`: without it, headless Linux rounds every glyph up to a whole pixel and text is about 6% wider than on a phone. Reduced motion was on, so no shot catches an entry mid-animation.

The sizes are the handoff's estimates. **Nothing here was checked on a real Fold.**

## Screenshots

Compare 01 to 04 with the handoff's `01-glass-unfolded.png`, `05-glass-cover.png`, `09-glass-cover-in-chrome.png` and `10-glass-unfolded-in-chrome.png`. The sample text differs (the handoff's is invented too); the layout, type and colours are what to compare.

| File | What it shows |
|---|---|
| `01-glass-unfolded.png` | Unfolded: the list and the reader. Nothing is selected, so the reader shows the newest entry and its row is marked. |
| `02-glass-cover.png` | Cover screen: the header, the agent chips, the list. |
| `03-glass-cover-in-chrome-install.png` | Cover, in a Chrome tab, with the install strip. |
| `04-glass-unfolded-in-chrome-install.png` | Unfolded, in a Chrome tab, with the install strip. |
| `05-cover-detail-open.png` | Cover: the time pressed, the detail card under the entry (facts, receipts, "Copy entry"). |
| `06-cover-more-open.png` | Cover: "More" open (time range, outcome, template, "About this page", sign-in). The whole pane scrolls while it is open. |
| `07-cover-paused-new-entries.png` | Cover: paused. The pill says "Paused" and the "2 new entries" control counts what waits. |
| `08-cover-search-marks.png` | Cover: a search, with its matches marked and counted. |
| `09-cover-search-empty.png` | Cover: a search with no match. |
| `10-cover-agent-chip-dead-journal.png` | Cover: a dead agent's chip is on; its journal entries are in italics. |
| `11-unfolded-selected-unparsed.png` | Unfolded: a selected entry whose reply did not parse. |
| `12-unfolded-journal-dead-agent.png` | Unfolded: a dead agent's journal entry in the reader, with when and how it died. |
| `13-glass-cover-light.png` | Cover, light theme (decision 0410, A3). |
| `14-glass-unfolded-light.png` | Unfolded, light theme. |
| `15-desktop-1440.png` | A desktop: the two panes, capped at 1180px. |
| `16-phone-landscape.png` | A phone on its side: two panes, and the list pane scrolls as a whole. |
| `17-offline-shell.png` | The installed app opened with no network: the shell from the service worker, no thoughts, "Reconnecting...". |

In the preview a thought names its action, so the receipts show. The real API does not send one yet (decision 0410, A8), so on live data the detail and the reader stop after the facts and "Copy entry".

## The installable app

Checked in the same Chromium, with the real policy header (`img-src 'none'` included):

- The service worker registers with scope `/` and activates.
- `Page.getAppManifest` reports no manifest error.
- `Page.getInstallabilityErrors` is empty: Chromium would offer the install. So the manifest's icons load without `img-src 'self'`.
- The cache holds the 25 shell files and nothing under `/api/`.
- Offline, a reload shows the shell with "Reconnecting..." and no entry. Back online, the feed reconnects, the pill says "Live −60s" and the list fills.

## The deploy, and why the files are under `/js/`

Caddy routes the Glass page by an explicit list, and the deploy pipeline never applies a Caddy change. The first version of this work served its new files at the root and changed the route with them; that would have put an unstyled page live until an operator restarted the shared Caddy. The page now serves every new file under `/js/`, which the live route already passes (decision 0410, section 11).

Checked against the live site on 2026-11-22, with plain GETs:

| Path | Reply | Meaning |
|---|---|---|
| `/js/render-model.ts` | 200, with Glass's policy header | routed to Glass |
| `/js/nested/deeper/x.woff2` | 404, Glass's JSON body and policy header | nested paths under `/js/` reach Glass |
| `/fonts.css`, `/fonts/x.woff2`, `/sw.js` | 404, empty, no policy header | stopped at Caddy |

In Chromium, with the worker at `/js/sw.js` and Glass's `Service-Worker-Allowed: /` header: the worker's scope is the whole origin, it activates, the manifest loads from `/js/manifest.webmanifest` with no error, and the installability audit is empty.

Not checked: that the live Caddy passes the `Service-Worker-Allowed` response header through unchanged. It passes Glass's other headers, and its site file removes only `Server`. If it were dropped, the worker would fail to register and the page would work as it does today, without install or offline.

## The rate limit

A first visit is about 48 requests on the cover screen and 49 unfolded: the page's files, the service worker asking for each again, and the API. Under the limits Glass ships with (the preview with no `unlimited`), in Chromium:

| Visit | Replies | Refused (429) | Worker |
|---|---|---|---|
| Cover, first visit | 48 | 0 | activated, 26 files copied |
| Unfolded, first visit | 49 | 0 | activated, 26 files copied |
| Unfolded, three visits in a row | 128 | 0 | activated |

This is the result after a fix. The first version of this change charged the page's files to the general bucket (20 at once), and a reviewer's probe showed 24 of 44 requests refused on a first visit: the worker never installed and a typeface was lost. The first round of validation missed it because the preview then ran with no limiter. The page's files now have their own bucket (decision 0410, section 6), the preview runs under the shipped limits by default, and `glass/test/page-rate.test.ts` runs a cold load against them.

Not checked: adding the app to a real home screen, the splash screen, and the icon as a launcher draws it. `beforeinstallprompt` does not fire in headless Chromium, so the install strip in shots 03 and 04 was shown by sending the page that event by hand; the strip's logic is covered by `glass/src/render-install.test.ts`.

## The tab bar and the Roster (decision 0411)

Added after the redesign, checked the same way: the preview with invented data, headless Chromium, the same sizes.

| File | What it shows |
|---|---|
| `18-glass-cover-with-tabs.png` | Cover screen: the Glass view with the tab bar under it. |
| `19-glass-unfolded-with-tabs.png` | Unfolded: the bar has four slots, and Kino's is empty until it is built, so no label sits on the hinge. |
| `20-roster-cover.png` | Cover screen: the Roster, living agents first, then the dead. |
| `21-roster-unfolded.png` | Unfolded: a living agent selected, with its latest entries. |
| `22-roster-unfolded-dead.png` | Unfolded: a dead agent selected, with when and how it died. |
| `23-roster-cover-light.png`, `24-roster-unfolded-light.png` | The Roster in the light theme. |
| `25-roster-unfolded-prompt.png` | Unfolded, before any agent is selected. |
| `26-landscape-with-tabs.png` | A phone on its side: the bar takes 61 of 360 pixels. |

Measured in Chromium:

- A first visit under the shipped rate limits is 56 replies on the cover size and 58 unfolded, none refused; three visits in a row are 152, none refused. The worker copies 30 files.
- The bar is 61px tall with 54px tabs at all three sizes. At 750px the labels sit at 81 to 122, 454 to 478 and 624 to 673: none in the middle 30px.
- A tab press, Back and Forward keep the address and the marked tab right. A row press on a phone lands on Glass with the agent's chip on.
- Twelve trips to the Roster and back with an entry selected cost no request.
- The document is no taller than the screen on either view. On the live redesign it was 11,391px taller (see decision 0411, "Changed in review").

Not checked: a real device, the live map behind the Map tab, real data, a roster of hundreds of agents.

## Tests

`glass/` has 945 passing tests with this change. Each new behaviour was reverted by hand, one at a time (57 reverts: the worker's file list and its refusal to answer for the API, the policy line, the delay slot, the reader's wait, the breakpoint behaviour, the pause control, the chips, the sigil hash, the receipts cells, the design tokens, the hinge padding, touch targets, reduced motion, the Caddy route, the manifest and the icons, the page's rate bucket and its cap, the retry of a failed first page and its cap, stale replies, the worker's cache write), and a test failed for every one. Two reverts were not caught at first; their tests were tightened until they were.

## Review

An independent read-only review of the first version found seven things, all fixed in the same pull request:

1. The page's files shared the general rate bucket (above). High.
2. Pressing an agent chip dropped the keyboard focus, because the row is drawn again. The pressed chip now gets it back.
3. A slow reply to an earlier filter change could overwrite the list of a later one. Only the latest request's reply is used, for the first page and for "Load older".
4. A first page that failed while the feed was live was never asked for again. It is now retried five times with a growing wait, and after that when the feed next comes back.
5. In the service worker, a failed cache write could hide a good server answer. The write is now apart from the answer.
6. Two guards had no test (the page's delay slot, and the 2000-row cap for live entries). Both have one.
7. Three doc claims were stronger than the code (receipts for journal lines, how a worker is replaced, the font hashes). The sentences are corrected and a test holds the font files to the hashes in `THIRD_PARTY_NOTICES.md`.
