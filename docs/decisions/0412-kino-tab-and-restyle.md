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

## Open questions for the owner

- **K4.** Approve the self-only font directive for Kino.
- **K5.** Confirm the dark-only camera page alongside the light and dark reading page.
- **K6.** Decide whether listing private agents or deaths belongs in Kino and under what visibility rules.
- **K9.** Decide whether both surfaces should have a common sigil identity for agents whose labels differ. The present target reply stays as shipped.

## Validation

Implementation and measurements follow in the subsequent commits.
