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
- Keep Glass's filter query when switching tabs. Opening an agent in Glass sets the agent, clears the keyword and retains the filters under More. Back restores the previous view and filters. Both promotion paths move focus to the Glass heading.
- A wide Roster starts with a prompt to select an agent. Closing the view or folding clears the selection, so unfolding again leaves a fresh prompt. Pressing the selected row again does not repeat the request. An error or empty list has a text status.
- Format profile entry times as in the Glass list and use the same thought view model. An invalid death timestamp shows “died” and the cause if available.

## Open questions for the owner

1. Keep the current privacy rule for hidden living sovereign agents, or consider a new visibility ruling for their names?
2. Keep the localized death date, or extend the API with the world day of death?
3. Keep the current count line, qualify it as a count of visible agents, or remove the numbers?
4. Keep three tabs until Kino ships?
5. Keep Map as a link? Embedding and drawing the map in Glass are still open options in #908 and would need separate policy and privacy decisions.

## Validation

See the implementation handoff for the local checks. A physical Fold, a real install and the live deployment are outside local validation.
