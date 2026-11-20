# 0385. Progression is a per-shard flag that relaxes Principle 2 for flagged shards only

- Status: Proposed (owner must accept; nothing is in force). Revised 2026-11-19 for the colo shard (see "Revision 2026-11-19"); the owner accepts the revised text.
- Date: 2026-11-17; revised 2026-11-19
- Spec: section 13 (open decisions) and Principle 2 ("no quests, no scoring"); source `docs/analysis/neoforge/progression-design.md` (2026-11-16); defaults `docs/analysis/neoforge/progression-defaults.md`; campaign `docs/analysis/progression/`

## Decision

Progression is a per-shard feature flag, `progression.enabled`. It relaxes Principle 2 ("no quests, no scoring") for shards that set the flag, and only for them. Every shard that does not set the flag keeps Principle 2 as written. The spec is not edited (only the owner edits `docs/spec.md`).

The defaults, from `progression-defaults.md`, which this record adopts as proposals:

1. The flag is off by default, on every shard.
2. `proficiency-state` is the only skill and XP signal. Progression keeps no second skill meter.
3. Agents see only their own marks and capabilities, as plain MCP tool text, through existing tools. No leaderboards, no other agents' numbers.
4. A small, fixed starter stipend. No purchase of marks.
5. Waypoints are names only. No coordinates to other agents.
6. Claims markers only in v1.
7. No held recipes in v1. Recipe holds would need a second flag, `progression.recipe_holds`, off by default, in v2 only.
8. Humans earn nothing.

## Revision 2026-11-19: the colo shard

The first version kept the colo shard out ("The colo shard and every shard that does not set the flag keep Principle 2 as written"). The owner's lead asked on 2026-11-19 to plan the first run for colo instead. This revision, once accepted, replaces that sentence with the one in Decision above and adds:

1. **Colo may set the flag.** The code ships with the flag off. Setting it on colo is a separate, dated owner act: the owner names the start time in the campaign ledger (`docs/analysis/progression/README.md`, D-PR-02). Merging code never turns it on.
2. **Earliest start.** Not before the engagement campaign's U0-02 watch closes (about 2026-11-21 01:03Z), so the two changes are not confounded, and not before a before-period baseline exists (D-PR-03).
3. **No control world in v1.** All colo agents get progression at once. The comparison is before and after on the same agents. This is weaker evidence than a control world; a second unflagged colo world is the alternative, left to the owner (D-PR-03).
4. **Colo v1 scope.** Points from novelty (design section 3.2) with the daily cap (3.4), one overall level (4.1), and two unlocks: a claim marker around the set bed and named waypoints usable as a `goto` target. No marks, stipend, contracts, professions, reputation, workshop sets or held recipes in v1, so defaults 3 and 4 apply only as "own capabilities" and the stipend does not exist yet.
5. **Built on what colo has.** The award engine extends the existing proficiency XP in `eventsink/src/xp/` (default 2); no NeoForge mod is involved on colo.
6. **What agents read** follows design section 8: plain lines about their own state through an existing read tool (on colo, `status`, which already reports facts about the agent's own life; the snapshot's self section comes from the Body and has no access to these records), one mechanics sentence in that tool's description, and the banned-word lint (should, try, must, hurry, soon, now, best, recommend, goal, quest, score, rank, leaderboard, test, server, plus `MARKER_WORD`). Nothing is said in chat, and agents are not told the system is new or measured.
7. **Turning it off.** Clearing the flag stops awards and removes the agent-visible text; stored points are kept for the record. This is the kill switch.

## Why

The design needs a per-shard research variable so that a shard can test progression without changing the spec. The defaults keep the strongest protections (no comparison between agents, no held recipes, no human earnings) and the smallest surface (names only, markers only).

Why colo (2026-11-19): colo has the long-lived agents whose narrow play started the engagement campaign, and its proficiency XP already exists, so v1 is a small change there. The cost is that colo is the main research world: from the start date its agents live under a scoring rule, and their behaviour afterwards answers "what do agents do with points", not "what do agents do unprompted".

## Consequences

- **Not in force.** The owner must accept this record. Until then progression packets may be written, but no progression code merges, and the flag is not set anywhere.
- The Principle 2 relaxation is an owner decision: whether this record is enough or the spec needs a line (only the owner edits the spec). It overlaps engagement D-EN-05 (Principle 2: pilot, broad amendment, or leave as is); one ruling can settle both.
- On colo, a dated world-rule change, like 0389: analyses that span the start date must split at it.
- The progress audit (numbers only) and any telemetry of progression data are governed by `docs/decisions/0350-telemetry-scope-and-full-capture.md`, not by this record.
- The defaults may be revised by a later record.
