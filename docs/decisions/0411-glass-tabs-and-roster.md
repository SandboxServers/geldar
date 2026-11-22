# 0411. Glass tabs and a public Roster

- Status: Proposed (implementer; owner rules D3, D4, D5, D6 and D7)
- Date: 2026-11-21
- Spec: section 2 (Principle 1), section 5.13 (the Observatory), decisions 0072 (public Glass and agent visibility) and 0410 (mobile redesign and installable page).

## Requirement

The Glass mobile design reserves space for navigation between the Observatory's windows. Issues #906 and #907 ask for a bottom bar and a Roster, and #908 offers three ways to reach the map. This change implements the link option. The page stays read-only.

## Decision

1. **D1. A view at the root.** Roster is `/?view=roster`. Glass is the fallback for every other value, and view changes use browser history so bookmarks and Back work. Caddy already reserves `/roster*` for the register service.
2. **D2. Use the existing routes and policy.** Serve new CSS and browser modules under `/js/`, list them in the static table and the worker shell, and keep Caddy, the API and the Content-Security-Policy as shipped. This works with the existing deployment route.
3. **D3. Use the already visible agents.** Roster renders only the agents returned by `/api/agents`. Decision 0072 item 4 protects the names of living sovereign agents whose thoughts are private.
4. **D4. Date of death.** Show the reader's locale date from `died_at` and append the cause after an em dash when supplied. The API has a timestamp and no world day for a death.
5. **D5. Count the listed agents.** The two counts summarize the displayed groups. Hidden agents and the API's 500-row cap can make them lower than a world census.
6. **D6. Three tabs for now.** Glass, Map and Roster are in that order. Equal columns extend to four when Kino ships.
7. **D7. Link to BlueMap.** Map uses the same URL and link relationship as the existing About link. It needs no map integration or policy change.
8. **D8. Ordinary navigation.** A labeled navigation landmark contains anchors, with `aria-current="page"` on the current view, the shared focus ring and 54px targets. A normal press on Glass or Roster switches views in place. Modified clicks keep normal browser behavior.
9. **D9. Read on selection.** The feed and Roster share the agents reply. Selecting an agent at 700px or wider requests their six latest entries from the existing thoughts API. The pane discards stale replies, and phone presses spend no profile request.
10. **D10. Keep the feed running.** The feed continues behind Roster with its pause state intact. The fresh control stays with the feed and accounts for arrivals while it is out of sight. The install strip stays above the panes and the bar occupies its own row below them.
11. **D11. World text stays text.** Names, modes, causes, wake reasons and entry text go through `display()` into text nodes. The two new sigil sizes are fixed classes on canvases drawn by `makeSigil`.
12. **D12. Both themes.** Use the existing light and dark tokens, with no new motion.

### Implementation choices

- Keep the order from the API within each group, Alive first. Always show both group headings. The Roster has no search of its own.
- Keep Glass's filter query when switching tabs. Opening an agent in Glass sets the agent, clears the keyword and retains the filters under More. Back restores the previous view and filters. Both ways of opening an agent in Glass move focus to the Glass heading. Back between views with identical filters does not fetch the first page again.
- A wide Roster starts with a prompt to select an agent. Closing the view or folding clears the selection, so unfolding again leaves a fresh prompt. Pressing the selected row again does not repeat the request. An error or empty list has a text status. Press the row again to retry after an error. The hidden thought reader does not fetch details while Roster is open.
- Share a pending or successful agents request even if the first thought page is retried. A failed agents request shows an unavailable status. The next first-page retry also retries the agents request. If thoughts loaded successfully, reload the page to retry the agents request.
- The tab row allows space for the bottom safe-area inset. Counts and other metadata can wrap in narrow panes. The worker uses the existing shell cache key because this change only adds files to the shell.
- Format profile entry times as in the Glass list and use the same thought view model and text limit. A missing life field uses an em dash. An invalid death timestamp shows “died” and the cause if available.

### Changed in review

A review of the first version of this change, before it was offered for merge, changed four things.

- **The page script kept its comments.** The first version stayed under the 500-line cap by deleting 34 lines of comments from `glass/public/app.js`, the file header among them. They are back. The room came from moving the "new entries" control into its own module, `glass/src/render-fresh.ts`, and the storage helper next to the install code.
- **The page can no longer grow taller than the screen.** This was a fault in the live redesign (decision 0410), found here by measuring. A screen-reader label (`.sr`) is placed absolutely; inside a row far down the list it was placed in the page, outside the list that scrolls. On the live site the document was 11,391px taller than the screen. A reader could not drag it, but anything that scrolls by itself (find-in-page, a focus change) could slide the whole layout away. A button is now the box its label is placed in.
- **A count that was announced twice.** Entries that arrived above while the reader was scrolled away were still counted after a pause and a return to the top. Back at the top, the count is now forgotten whether or not the feed is paused.
- **The death date has the month as a word** ("Nov 14, 2026"). A date written as 11/14 or 14/11 reads differently in different places.

A second, independent review then found no fault in how world text, addresses or requests are handled, and these smaller things, all changed:

- **No tab label on the hinge.** With three equal columns the middle label, "Map", sat in the middle 30px of an unfolded screen (362px to 387px of 750). A wide screen now has the design's four slots, with Kino's left empty until it is built: Glass, a gap, Map, Roster. Measured at 750px, the labels are at 81 to 122, 454 to 478 and 624 to 673. A phone keeps equal columns.
- **The reader pane keeps what it has behind the Roster.** Each return to Glass on a wide screen fetched the selected entry again, so a dozen quick trips ran into the rate limit. The reader now does nothing while another view covers it. Twelve trips cost no request.
- **A screen reader hears the short status, not six entries.** The live region was the box the entries were put in, so a selection announced all of them. The status line ("Loading entries…", "No entries yet.", the error) is now the only live region.
- **The document title names the view**: "Glass: Roster" while the Roster shows.
- **Tests for eight behaviours that had none**: the heading that takes focus, clicks with a modifier key or another button, the fallback when the browser refuses a history entry, "/" on the Roster, the dash for a missing life field, a death time that is no time, a settled row not asking again, and a profile starting at its top.

Not changed, and recorded as a doubt: after Back or Forward the keyboard focus is on the page body, not on the view that came back.

## Open questions for the owner

1. Keep the current privacy rule for hidden living sovereign agents, or consider a new visibility ruling for their names?
2. Keep the localized death date, or extend the API with the world day of death?
3. Keep the current count line, qualify it as a count of visible agents, or remove the numbers?
4. Keep three tabs until Kino ships? On a wide screen Kino's slot is an empty gap between Glass and Map until then.
5. Keep Map as a link? Embedding and drawing the map in Glass are still open options in #908 and would need separate policy and privacy decisions.

## Validation

Local Chromium used the preview handler with invented data. The 360 × 776 and 750 × 768 viewports were compared with the handoff in light and dark, and a 780 × 360 viewport was checked with More and the install strip open. A cold load used the shipped limits, with no refusals. Automated tests cover history, profile races, text rendering, and the static and worker file lists. After the review changes the cold load is 56 replies on the cover size and 58 unfolded, none refused, with 30 shell files.

A physical Fold, real home-screen installation, live BlueMap navigation, production data and deployment, and a roster of 500 agents were outside local validation. Rapid presses across different agents can still exhaust the existing API bucket. An error is shown in the profile.
