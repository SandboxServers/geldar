# Glass mobile redesign: validation

What was checked for the Glass mobile redesign (decision [0410](../../decisions/0410-glass-mobile-redesign-and-pwa.md)), how, and what was not. Written 2026-11-21 with the change.

## How the page was looked at

The page was served by the test-only preview (`node glass/test/page-preview/server.ts`): Glass's real handler, files, headers and Content-Security-Policy, with invented agents, thoughts and receipts. It was opened in headless Chromium (Playwright 1.64.1, the version `tools/kino-shot` pins) at the sizes the design handoff gives for a Galaxy Z Fold:

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

Not checked: adding the app to a real home screen, the splash screen, and the icon as a launcher draws it. `beforeinstallprompt` does not fire in headless Chromium, so the install strip in shots 03 and 04 was shown by sending the page that event by hand; the strip's logic is covered by `glass/src/render-install.test.ts`.

## Tests

`glass/` has 930 passing tests with this change. Each new behaviour was reverted by hand, one at a time (36 reverts: the worker's file list and its refusal to answer for the API, the policy line, the delay slot, the reader's wait, the breakpoint behaviour, the pause control, the chips, the sigil hash, the receipts cells, the design tokens, the hinge padding, touch targets, reduced motion, the Caddy route, the manifest and the icons), and a test failed for every one.
