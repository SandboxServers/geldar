# PX-1: hurt event with source and bearing

Branch `phase1/px-1-hurt-event`. Decision 0154, provisional vocabulary 0143.

## What changed

- `contract/src/outcome-words.ts`: `hurtSentence({source, bearing, amount})` builds the player's hurt line
  from the source code, the bearing code and the amount alone. Unknown source reads as `other`; a bearing
  is used only for attack sources (melee, arrow, explosion, other); a missing or zero amount leaves out the
  "You lost N health." clause. Exported from `contract/src/index.ts`.
- `golem/src/perception/hurt.ts` (new): `sourceOf` (cause code to source), `bearingOf` (attacker relative
  to the Body's facing, yaw in radians, Minecraft convention: 0 faces +z), `hurtEvent` (rounded and capped
  amount, zero amounts dropped, unknown attacker gives `other` with no bearing), `HurtReporter` (drops
  hurts after `close()`).
- `threshold/mcp/src/events/handlers/damage.ts`: a damage payload with a `source` reads as `hurtSentence`;
  a payload without one keeps the old cause wording.

## Schema

`contract/schemas/hurt-event.schema.json` and its validator test were already on main (PX-S0). No schema
or generated-code change in this packet.

## Not wired in this packet

- The live Body trigger (looking up the attacker from the damage event and calling `HurtReporter.report`)
  is not connected. `RecentEvents` does not carry a `hurt` digest entry yet.
- No new Mind event type. `hurt` is carried as a `damage` payload (`source`, `bearing`), because the
  `MindEvent` union is in `animus/src/ports/body.ts`, which is outside this card's may-edit list.
- No new presenter and no new `mcp-mock` present-events kind: the output is still kind `damage`, which
  the existing presenter already prints from `cause`.
- `mob` is not set by the golem.

## Tests

- `golem/src/perception/hurt.test.ts`: source table, unknown source, bearing on +x, -x, +z, -z for yaw
  0, 90, -90, 180; zero and NaN damage; cap (19.7 at 4 gives 4); rounding; missing attacker; reporter
  open and closed.
- `threshold/mcp/src/events/handlers/damage-hurt.test.ts`: the hurt sentence through the mapper, unknown
  source, fall with a bearing, legacy cause wording, zero amount.
- Revert check: `golem/src/perception/hurt.ts`, `const forward = dx * -Math.sin(self.yaw) + dz * Math.cos(self.yaw);`
  mutated to `const forward = dz;` (yaw ignored). 10 of 39 bearing and hurt tests fail. Restored.

## Player-facing text changes

- Damage line with a hurt source: "An arrow hit you from behind. You lost 3 health." (and the other
  sources in `HURT_SOURCE_SENTENCE`). Prompts were not bumped; a later packet does that.

## Live

`hurt-arrow-bearing` is not written in this pass (the Body trigger is not wired, so a live arrow would
show no bearing). `live: pending`; the case remains to do with the trigger.
