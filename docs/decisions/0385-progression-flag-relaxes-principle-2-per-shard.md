# 0385. Progression is a per-shard flag that relaxes Principle 2 for flagged shards only

- Status: Proposed (owner must accept; nothing is in force)
- Date: 2026-11-17
- Spec: section 13 (open decisions) and Principle 2 ("no quests, no scoring"); source `docs/analysis/neoforge/progression-design.md` (2026-11-16); defaults `docs/analysis/neoforge/progression-defaults.md`

## Decision

Progression is a per-shard feature flag, `progression.enabled`. It relaxes Principle 2 ("no quests, no scoring") for shards that set the flag, and only for them. The colo shard and every shard that does not set the flag keep Principle 2 as written. The spec is not edited (only the owner edits `docs/spec.md`).

The defaults, from `progression-defaults.md`, which this record adopts as proposals:

1. The flag is off by default, on every shard.
2. `proficiency-state` is the only skill and XP signal. Progression keeps no second skill meter.
3. Agents see only their own marks and capabilities, as plain MCP tool text, through existing tools. No leaderboards, no other agents' numbers.
4. A small, fixed starter stipend. No purchase of marks.
5. Waypoints are names only. No coordinates to other agents.
6. Claims markers only in v1.
7. No held recipes in v1. Recipe holds would need a second flag, `progression.recipe_holds`, off by default, in v2 only.
8. Humans earn nothing.

## Why

The design needs a per-shard research variable so that a NeoForge shard can test progression without changing the spec or the colo shard. The defaults keep the strongest protections (no comparison between agents, no held recipes, no human earnings) and the smallest surface (names only, markers only).

## Consequences

- **Not in force.** The owner must accept this record. Until then the flag does not exist in code, and progression work (P6 to P8 in `RESUME.md`) stays on hold.
- The Principle 2 relaxation is an owner decision: whether this record is enough or the spec needs a line (only the owner edits the spec).
- The progress audit (numbers only) and any telemetry of progression data are governed by `docs/decisions/0350-telemetry-scope-and-full-capture.md`, not by this record.
- The defaults may be revised by a later record.
