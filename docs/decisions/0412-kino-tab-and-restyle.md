# 0412. Kino joins the Glass tab bar

- Status: Proposed (implementer; owner rules K4, K5, K6 and K9)
- Date: 2026-11-21
- Spec: section 2 (Principle 1) and section 5.13 (the Observatory), decisions 0075, 0166, 0410 and 0411.

## Requirement

Issue #909 brings the monitor wall into the Glass navigation and visual design. The camera still observes through a separate page.

## Decision

1. **K1. Keep Kino at `/kino/`.** The tab is an ordinary link. Kino keeps its own policy and loads its own renderer.
2. **K2. Publish the tab only when Kino is mounted.** The root handler substitutes a fixed link into a single markup slot at startup when the server has built Kino with a feed. Kino itself shows all four tabs.
3. **K3. Use the reserved second slot.** Glass retains three equal slots on phones and the reserved gap on wide screens when Kino is off. At 750px all four labels clear the middle 30px with Kino on.
4. **K4. Add `font-src 'self'` to Kino's policy (owner call).** This admits Glass's existing local WOFF2 files for Instrument Serif and DM Mono. All other directives and Glass's policy stay as shipped.
5. **K5. Use Glass's dark tokens (owner call).** Kino declares the same values in its own stylesheet, checked against Glass by a test. Glass retains its light theme, while the 3D view stays dark.
6. **K6. Use the permitted targets only (owner call).** The guide lists what `/kino/targets` returns. The private and dead rows drawn in the design require a separate visibility decision.
7. **K7. Keep the camera and feed contracts.** The interface calls follow mode Chase. Its other mode labels are Orbit and Free. Camera, relay and world code keep their existing behavior.
8. **K8. Preserve the monitor wall features.** The focused camera's controls sit beside the wall on wide screens and below it on phones. The channel guide is inline when wide and a modal sheet when narrow.
9. **K9. Generate sigils from the displayed label (owner call).** Kino reuses the Glass generator. Kino targets supply the configured alias or the agent ID, and the client truncates labels at 40 code units. Glass uses the alias or the stored display name. Matching labels produce matching sigils, while a truncated alias or an ID that differs from the stored name can produce a different one.
10. **K10. Use the existing routes.** Kino's own assets stay under `/kino/` and outside the service worker shell. The shared resources were already served under `/js/`.

## Implementation choices

1. Both pages load the existing tab rules in `/js/roster.css`. On the root page the server
   substitutes a fixed link or removes the slot line. The markup when off is byte for byte the same
   as the base branch.
2. Use the Glass breakpoint of 700px. Wall displays a two-by-two grid on both screen shapes.
   Feature keeps the existing side strip on wide screens and the strip below the picture on
   phones. On short screens the wall pane and the dock can scroll inside the viewport.
3. The active monitor's buttons move into the dock. The More controls disclosure carries the
   original rotation, step zoom, recentre, surfing, guide, solo and per-monitor details buttons.
   Global feed details and help remain in the header. The Clear button closes the active monitor.
4. Near, Medium and Far select the existing Chase steps. Orbit supports a continuously adjustable
   radius and Free moves through the world. Their existing step buttons and gestures continue to
   work. Only Chase reports a fixed distance in the monitor caption.
5. Numbered empty cards open the guide for that vacancy. Each open monitor keeps its channel number
   until closed, and the wall places vacancies by number. The remembered wall uses its existing
   storage format and restores the saved monitors in order, so gaps are compacted on reload.
6. One set of guide rows moves between an inline section and a native modal dialog. The phone sheet
   closes with Close, Escape or a backdrop press. Focus returns to its opener or the Channels button
   if the opener was a vacancy that has just been filled. A resize takes focus between the list
   and the trigger when their visibility changes.
7. The channel guide uses sigils in place of skin thumbnails. The WebGL feeds keep their rendered
   skins and labels. The existing hashed import map points the browser at Glass's sigil module.
   The guide keeps the New monitor action as a separate plus button. At capacity it is disabled
   while retuning an existing monitor is still available. Agent names label buttons through text
   elements referenced by fixed IDs.
8. The test preview serves the already published Glass resources and applies the Kino page
   policy with a hash of its import map, so a screenshot run exercises the font permission.
   The preview world, targets and feed remain invented.

## Open questions for the owner

- **K4.** Approve the self-only font directive for Kino.
- **K5.** Confirm the dark-only camera page alongside the light and dark reading page.
- **K6.** Decide whether listing private agents or deaths belongs in Kino and under what visibility rules.
- **K9.** Decide whether both surfaces should have a common sigil identity for agents whose labels differ. The present target reply stays as shipped.

## Validation

Chromium at 2× device scale and with font hinting disabled was checked at 360×776 and
750×768 CSS pixels against the two design references. The prototype's placeholder pictures
were replaced by the existing preview world. Kino loaded both typefaces with its policy
applied and stayed dark under a light system preference. The document had 0px overflow
in both dimensions. The phone sheet stayed within 70% of the viewport, closed with Close
and Escape and returned focus to Channels. Folding and unfolding moved the focused guide
between its two layouts. Wall, Feature, Solo, active Chase zoom, Clear, filling a numbered
vacancy, Help and feed details were exercised in the preview.

At 750px the x-ranges of the labels were the same on Glass with Kino enabled and on Kino.
Glass occupied 80.84–121.66px, Kino 267.42–300.06px, Map 454.00–478.48px and Roster
624.27–673.23px. All clear the hinge band at 360–390px. Disabling Kino kept the three
labels in their original positions and left the second slot empty on the wide screen.

A real foldable, a signed-out or restricted production account, a live shard and its
textures, and an installed app were outside the browser run.

The Glass suite passed 997 tests with 16 skipped. Each of 38 temporary single-behavior
reverts was caught by its test, including a Chromium check for tuning the selected
vacancy when more than one channel is empty.
