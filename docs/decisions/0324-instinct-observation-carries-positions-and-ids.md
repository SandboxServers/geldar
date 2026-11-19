# 0324. The kit's instinct observation carries positions and ids

- Status: Accepted in principle (operator ruling, 2026-11-18). **The exact agent-visible wording is pending OD approval and is not accepted by this record.**
- Date: 2026-11-18
- Spec: section 2 (Principles 1 and 2), section 5.8 ("No telepathy"). `docs/spec.md` is not edited.
- Related: 0058 (character knowledge boundary), 0059 (agents are never told they are watched), 0281 (the sheet never in an agent context); [sheet-next-wave-order.md](../analysis/harness/sheet-next-wave-order.md) section 3 item 4; cards HC-22, HC-27b (and HC-46 if that is the card that extends `observe.ts`)

## Context

The merged kit instinct `Observation` (`packages/instinct/src/observe.ts` on `scriptorium/hw0`) carries distances only: `agents: {name, distance}[]` and `notable: {kind, distance}[]`, with no coordinates and no actor ids. HC-22 (novelty radius) and HC-27b (social observation by actor id and position sampling) cannot be computed from that. The choice was to extend the observation or to rewrite those rules as distance-only. Extending it also raises what the agent is then told about the world.

## Decision

1. **The kit's observation carries positions and ids.** The instinct observation is extended with the positions of what the Body perceived and the ids of the agents it perceived (the life id resolved from a visible agent's name). The world output the kit parses is extended to match.
2. **What the agent is told about positions and ids is decided here in principle:** an agent may be told positions and ids only as facts its own Body perceived. The exact agent-visible sentences are **pending OD approval**; until they are approved, no card renders positions or ids into agent-visible text, and any such text ships unselected or off.
3. **Every use obeys the spec principles and decisions 0058 and 0059:**
   - facts only: what the Body saw, heard or was given, never advice, a goal or coaching (Principle 2);
   - no knowledge beyond the character's own perception: no position or id of anything the Body did not perceive, nothing from another life's sheet, and no hidden truth (0058; spec 5.8 "No telepathy"; 0281 for the sheet);
   - never told that it is watched, and nothing about humans observing (0059; Principle 1).

## Consequences

- The kit card that extends `observe.ts` and the world output it reads (HC-46 in the ledger, to be confirmed by the card author) is unblocked in principle. HC-22 and HC-27b are corrected to read the new fields.
- Positions and ids used only inside the instinct step (supervisor side) need no wording approval. Any agent-visible rendering needs the pending OD approval before it is selected.
- HC-21a's recipe and seen-block inputs are not covered: they are positions of nothing and ids of nothing, and need their own card choice or ruling.
- On the NeoForge shard a human has no life id; the human rule is OD-NF-2 (open), and no human name reaches an agent through this observation.
