# Progression campaign: novelty points, a level and two unlocks on colo (v1)

Ledger for v1 of the progression system on the colo shard. Design source: `docs/analysis/neoforge/progression-design.md` (2026-11-16, written for NeoForge) and `progression-defaults.md`. Record: [0385](../../decisions/0385-progression-flag-relaxes-principle-2-per-shard.md), revised 2026-11-19 for colo, still Proposed.

**Purpose.** Give colo agents points for actions that are new to them in a place, one level from those points, and two capabilities the level unlocks: a claim marker around their bed and named places they can walk to by name. Agents read their own state as plain facts. Everything sits behind `progression.enabled`, off by default.

**Out of v1.** Marks, stipend, contracts, professions, reputation, usefulness points (design 3.3, which needs item provenance), workshop sets, held recipes, claim protection, the anti-grind audit (design 10; a later packet).

**Exit criteria.** X1 to X4 merged with the flag off; D-PR-01 accepted; the flag set on colo at the owner's dated start (D-PR-02); X5's live check passed and its before/after measurement written. What agents then do is data, not a target (Principle 5).

**Merge rule (owner, 2026-11-19).** Packets may be written and reviewed now. No progression code merges before Cadacious accepts revised 0385 (D-PR-01).

## Facts found while planning (2026-11-19, Plan agent, checked by the orchestrator)

- **XP does not run on colo.** `compose/colo.yml` gives eventsink no `GELDAR_XP` or `GELDAR_SHEET_SHARD`; they exist only in `compose/opt-in/sheet-sink.yml`, which no deploy uses.
- **Held-live ruling (sheet campaign, owner, 2026-11-15):** every character-sheet feature stays held on the live server until that whole campaign is complete, each validated first by agent runs on a test shard. Inert code still merges. Progression on colo builds on the sheet's XP (default B2), so this ruling blocks the start (D-PR-04).
- **Levels are pinned.** `psyche/src/proficiency.ts` `DEFAULT_THRESHOLDS = [10, 30, 70]`; `eventsink/src/sink-plan.ts` refuses other thresholds while the state service runs, because the Body checks levels with the defaults. Today one piece of evidence is one XP (`pg-xp-store.ts`).
- **Combat is awarded today** (`awards.ts`, `kill:<action_id>`); the defaults say combat is never awarded.
- **`goto` takes a position or an agent name**, not a place name (`thought.schema.json`, `golem/src/actions/goto.ts`). A place name could collide with an agent name.
- **Action records carry no position** (`action-record.schema.json`, `additionalProperties: false`); the envelope carries `world_day` and `world_tick`. The bed position is in a completed `sleep`'s `result.detail.bed`.
- **The MCP cannot read XP**: `sql/0050` revokes the proficiency tables from `geldar_mcp`.
- **Eventsink reads no shard yaml**, only env. The MCP and golem read `shards/colo-mind.yaml` (`body_actions` is the model for a flag).

## Decisions

| Id | Question | Status | Record |
|---|---|---|---|
| D-PR-01 | Accept revised 0385 (colo may set the flag by a dated owner act; colo v1 scope) | Open (Cadacious) | [0385](../../decisions/0385-progression-flag-relaxes-principle-2-per-shard.md) |
| D-PR-02 | The start date for the flag on colo | Open; not before the U0-02 watch closes (about 2026-11-21 01:03Z) | - |
| D-PR-03 | Measurement: before/after on the same agents (needs a before-period baseline, which overlaps engagement C0 and D-EN-03), or a second unflagged colo world as control | Open | - |
| D-PR-04 | The sheet held-live ruling: (a) exempt the XP that progression needs from it, (b) run progression on a sheet test shard first, as that ruling asks, or (c) give progression its own counter outside the sheet (against default B2) | Open (owner) | - |
| D-PR-05 | Points against pinned levels: progression's level comes from its own total with the design's table (60, 160, 300) and the proficiency domains keep +1 per evidence unchanged (recommended), or novelty points feed the domains and the thresholds become per-shard (a Body change) | Open | - |
| D-PR-06 | Combat while the flag is on: no novelty points for combat (recommended, matches the defaults) | Open | - |
| D-PR-07 | Usefulness points (design 3.3) out of v1 (recommended: they need item provenance) | Open | - |
| D-PR-08 | Claim markers visible to other agents: no in v1 (recommended) | Open | - |
| D-PR-09 | Waypoints: `note` gains an optional `place` name, and `goto` gains a `{ place }` target, separate from agent names (recommended) | Open | - |

## Packets

| Packet | What | Status | Depends on | Notes |
|---|---|---|---|---|
| X0 | This ledger, the packets, RESUME; revised 0385 | Writing | - | Branch `progression/x0-campaign` |
| X1 | The flag in the MCP (yaml) and eventsink (env), off by default | Ready to write; merge waits for D-PR-01 | - | |
| X2a | Golem stamps the region of a completed action into its result | Ready to write; merge waits for D-PR-01 | - | Parallel with X1 |
| X2b | Pure novelty engine: keys, decay, pay, floor, daily cap | Ready to write; merge waits for D-PR-01 | D-PR-05, D-PR-06 for the class table | Parallel with X1 |
| X2c | Progression ledger, migration 0067, writer wiring | BlockedDecision | X1, X2a, X2b, D-PR-04, D-PR-05 | |
| X3a | Level and unlock table; claim marker on sleep | BlockedDecision | X2c, D-PR-05, D-PR-08 | |
| X3b | Named places: contract, Body echo, eventsink store, MCP `goto {place}` | BlockedDecision | X2c, D-PR-09 | |
| X4 | Agent-visible text in `status` and the mechanics sentence | BlockedDecision | X1, X3a, X3b | Text is owner-approved before merge |
| X5 | Ops: deploy env, set the flag at the start date, live check, measurement | BlockedDecision | X1 to X4, D-PR-02, D-PR-03, D-PR-04 | Orchestrator |
