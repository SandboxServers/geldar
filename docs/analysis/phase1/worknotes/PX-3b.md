# PX-3b worknote: light, health trend, regeneration hint

- Ruling 4 (0154): the regeneration hint is fixed text; the trend is data; no advice.
- Schema: `light`, `health_trend`, `regen_hint` were already in `contract/schemas/snapshot.schema.json` (PX-S0). No contract edit, no regeneration.
- Stub `golem/src/perception/self/light-regen.ts` was already registered in `self/index.ts` (PX-S1). It is filled in place. The brief's `perception/probes` folder does not exist on main.

## Light

- `golem/src/body/light.ts`: `lightAtHead` reads the head cell (feet + 1.62, floored) and returns the raw 0 to 15 level: max of block light and sky light, with sky light lowered by 11 at night (`isNightOrStorm`).
- Night darkening is an approximation of vanilla's sky darkening. Limitation: it is a flat 11 at night, not the daylight curve.
- `BodyView.lightAtHead` exposes the raw number for reflexes. No reflex reads light yet, so the view test is the only consumer.
- Words: bright from 12, dim from 4, dark below 4 (`lightWord`).

## Health trend

- `golem/src/perception/health-trend.ts`: a per-bot sampler, started on first probe call, samples `min(20, health)` every 5 s, keeps the last 3 samples. Trend compares oldest kept with newest.
- `death` clears the window. `end` clears the timer and closes the state (later reads give steady, no new timer).

## Regeneration hint

- Shown when `food < 18`. Threshold 18 is the vanilla FoodData value (natural regeneration needs food 18 or more).
- NOT verified against the Paper 26.1.2 source in this sandbox (no network access to the Paper source). The card asks for it to be read from the pinned source; this needs a check by the orchestrator or a follow-up.
- Exact text: "Health does not regenerate naturally while hunger is low. Hunger falls over time."

## Player-facing text

- New fixed sentence in the agent snapshot: the regen hint above. New fields `light` and `health_trend` values (words). No prompt text changed.

## Not touched

- `threshold/mcp/src/play-view.ts` and mcp-world schema: the snapshot fields do not reach the MCP world view (no existing `sun` or `hunger_bar` rendering there either), so nothing to mirror.
