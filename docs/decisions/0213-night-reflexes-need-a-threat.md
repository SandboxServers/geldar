# 0213: night reflexes need a threat; dark shelter ignores unknown light

- Status: Accepted
- Date: 2026-11-14
- Why: the two night reflexes fire far more often than they help. Live counts for 24 h (excluding ag_colo_01):
  - `panic_burrow` at night: 458 runs, 22 handled, 422 abandoned, 14 failed (all 422 abandoned with "no suitable block"). The trigger was night, no bed within 32 blocks and not enclosed. It never read hostiles or light. After #357 the same reflex abandoned 14 runs in 30 minutes.
  - `dark_shelter`: 963 runs, 4 handled, 956 abandoned, 3 failed. The light at the trigger was exactly 0 in 872 of 956 abandoned rows. One Body (zack) made 831 of the 963 runs, mostly 09:00 to 14:00 UTC.
  - The Body's own reason text, "a threat was close, you dug in" (threshold/mcp present-handlers/reflex.ts), is false for the night trigger, which had no threat at all. The approved wording replaces it: "a {kind} was {distance} blocks away, so you dug in." and "you took damage at night with no bed near, so you dug in." (no 'a hostile').
- Design intent kept: the night burrow (spec 375, "Night and no shelter and no bed: dig a 1x2 hole and seal it"; decision 0074, a hole counts as shelter) is right when a threat is near. This record changes when it starts, not whether it exists.

## (a) panic_burrow starts only on a threat

The night burrow starts only when one of these holds (`nightThreat` in `golem/src/body/reflexes/panic-burrow.ts`):

- a hostile within `THREAT_RADIUS` (8 blocks), by the same `dangers` rule as the other reflexes; the trigger names the hostile and its distance (`cause: 'hostile'`), or
- damage taken within `HURT_WINDOW_TICKS` (100 ticks, 5 s at 20 TPS) (`cause: 'damage'`).

Night alone never starts it. This is the owner and geldar-93 ruling of 2026-11-14. The bed rule, the dawn branches, `run()` and the burrow itself are unchanged, so a direct run with no hostile still digs.

## (b) dark_shelter does not require night, and unknown light is not dark

`dark_shelter` (`golem/src/body/reflexes/shelter.ts`) keeps its trigger: a light at head at or below `DARK_LIGHT` (7), a hostile within `DARK_HOSTILE_RADIUS` (8), not enclosed. Changes:

- A null light (unknown) returns null. It is never read as dark. `lightAtHead` (`golem/src/body/light.ts`) returns null when the chunk column or the section holding the head cell is missing.
- The backoff after an abandoned run holds while the Body stays within `REFUSAL_MOVE_BLOCKS` (8) of the abandoned spot, even when the light rises above 7. It ends on a move past that, on a later handled run, or on a respawn. Expiry by time still works.

## (c) What does NOT change

- The night burrow design (spec 375, decision 0074) for the threat case.
- The dawn branches of `panic_burrow` and their outcomes.
- Hibernation (spec 337). `run()` still digs when called directly.
- The refusal pause (`burrowPaused`) and the idle_stuck and unstick interplay of 0196 and 0210.

## Open item: the unloaded-section guard is unverified

`sectionLoaded` in `light.ts` treats a head cell as unknown when its column has a section list and the section entry is missing. This was written from the 26.1 shape assumed in the reports, and it is not verified against the real chunk shape. What the prismarine-chunk 1.41.0 source in `node_modules` shows (`src/pc/1.18/ChunkColumn.js`):

- The block sections (`sections`) are always pre-filled, one `ChunkSection` per section, so the guard as written never trips for a loaded or an unloaded section. It is probably inert live.
- Light is kept in separate arrays (`blockLightSections`, `skyLightSections`), indexed by the light section index. A missing light section reads as 0 (`getBlockLight` / `getSkyLight` return 0). That is the likely source of the "light exactly 0" rows: unknown light reads as pitch dark.
- A null entry in the light arrays is also how a section with no stored light is written, so null alone cannot separate "unloaded" from "no light data". Not settled from source.

The live probe (`golem/test/live/sleep-signal.live.test.ts`, branch `phase1/sleep-signal-probe`) reads `block.light` and `block.skyLight` on one sunny cell and one interior cell, and settles which cells read 0 with a loaded section. Until that capture, the guard is kept as written and is not treated as the fix. The rule "light 0 and skyLight 0 on a cell with open sky above is unknown" is NOT implemented: it needs a scan of the cells above and is not justified until the probe runs.

## Agent-facing reflex text (geldar-93 owns the wording)

The text in `threshold/mcp` present-handlers/reflex.ts must match the trigger. This is the approved wording; it is not yet applied there. The Mind-side presenter (`threshold/mcp` present-handlers/reflex.ts) renders it in a separate change, and this record does not touch that file.

- cause `hostile` (panic_burrow or dark_shelter): "a {kind} was {distance} blocks away, so you dug in." The trigger key for `{kind}` is `hostile` (the hostile's name, for example zombie). `{distance}` is a whole number: the Body rounds the distance to the nearest block (`Math.round`), so a zombie at 5.4 reads 5.
- cause `damage` (panic_burrow at night): "you took damage at night with no bed near, so you dug in."
- cause `dark` (dark_shelter): keeps its own text. Its trigger is a hostile in the dark, so the hostile sentence also fits.

No text should say "night" as the reason on its own.

## Consequences

- Fewer night burrows, so fewer abandoned digs ("no suitable block") and fewer refusals per hour.
- A hungry or hurt Body at night with no threat no longer digs in. The damage window covers the hurt case.
- A zombie that stays in sight and is not hostile by `dangers` (a spider in daylight, for example) still does not count, as before.
