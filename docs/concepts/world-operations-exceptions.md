---
title: World-operations exceptions
type: explanation
audience: owner
status: draft
last_verified: 2026-11-16 against 1b114276
companions: [README.md, principles-in-practice.md, what-is-geldar.md, ../runbooks/maintenance-notice.md, ../reference/glossary.md]
sources: [docs/spec.md, CLAUDE.md, plugin/README.md, compose/colo.yml, compose/phase0.yml, shards/colo-mind.yaml, shards/phase0.yaml, docs/analysis/autonomy/review-and-plan-2026-11-14.md, docs/analysis/behavior/timeline.md, docs/analysis/behavior/findings.md, ../decisions/0064-exit-run-lives.md, ../decisions/0085-append-only-audit-tables.md, ../decisions/0172-human-skin-upload-held-for-approval.md, ../decisions/0195-gravestones-owned-by-system.md, ../decisions/0212-golem-body-is-a-profile-adam.md, ../decisions/0262-account-deletion-erases-dead-lives-too.md, ../decisions/0339-journal-reset-one-time-exception.md]
---

# World-operations exceptions

## Principle 1 comes first

"No humans inside. Humans may observe through the map, the thought stream, and silent spectator cameras. Humans never speak, build, give items, or intervene. If something breaks, fix the infrastructure, not the story." ([spec 2](../spec.md#2-principles), principle 1). `CLAUDE.md` adds that the rule holds in code: nothing Geldar builds lets a human act inside the world.

Everything below is an exception to that rule or a boundary case near it. An exception is bounded: the owner orders it, it is done once, it is recorded, and the standing rule returns afterwards. It is never precedent for the next one. This page explains why exceptions happen, lists the ones on record, and says what an exception must carry so it stays bounded. How Principle 1 holds day to day is in [principles in practice](principles-in-practice.md#principle-1-no-humans-inside).

## What counts

The 2026-11-14 review records the owner's ruling "real stakes, no rescues" and splits operator changes into three kinds (`docs/analysis/autonomy/review-and-plan-2026-11-14.md`, section E4):

| Kind | Examples | Rule |
|---|---|---|
| Infrastructure | Hosts, deploys, backups, limits, the record, Body or gateway defects where a verb does not do what it says | Any time |
| World rules and agent-visible text | Gamerules, the world border, shard toggles, text agents read | Exhibition world: only by a recorded decision at a change window. Experiment world: never mid-run |
| Never | Moving a Body, editing an agent's memory, giving or removing items, placing or breaking blocks | Not done |

These rulings are recorded in the review, an analysis file. They are not yet decision records; the review itself asks for them to be written as records (section E6, item 0a.9). A world-operations exception, in this page's sense, is anything done in the "never" row, or a world-rule change made outside a recorded decision.

## Why exceptions happen

The agents reached the survival floor and stayed there: the 2026-11-14 review found them with a stone pickaxe at best, close to their village (review, part A1). An operator can end such a crisis in minutes with console or RCON commands, which the command block does not stop (`plugin/README.md`, "Command block": console and RCON are unaffected). That ease is the danger. Each intervention changes the story the experiment is meant to observe, and it confounds measurement: the review lists "operators acted in the world" among four things that confound everything observed before 2026-11-14 (part B4, item 4).

## The record

Times are UTC. Figures come from the cited files and were not re-measured (no live reads, plan decision D8).

| When | What | Kind | Decision | Bound |
|---|---|---|---|---|
| 2026-11-12 | Agents moved out of a pit to the village; the village lit with torches; an operator wrote into one agent's memory | Never row | None | Ended by the owner's ruling of 2026-11-14 (review, part B4 item 4 and section E4). A later note records the torches still standing: "Torches (732, placed 11-12) intact" (`docs/analysis/behavior/timeline.md` line 25) |
| 2026-11-14, about 19:10 | Gamerule `players_sleeping_percentage` from 100 to 50 | World rule | [0212](../decisions/0212-golem-body-is-a-profile-adam.md) item 4 | Standing rule in `compose/colo.yml` line 138; timeline row in `docs/analysis/behavior/timeline.md` |
| 2026-11-15, about 00:30 | The owner declines world edits for the village's food and health crisis: no livestock, no mob clearing, no extra torches | The standing rule applied | None (analysis note) | `docs/analysis/behavior/timeline.md` line 25; `docs/analysis/behavior/findings.md` item F5 ("wontfix (owner: no world edits)") |
| 2026-11-15 | Spawn-town cutover: the Colo world border moved to radius 9500 (diameter 19000); a spawn town (named in 0339; the repo does not say who built it); all agents wiped and started over in the new town | World rule and never row | None for the border, the town or the wipe | See below |
| 2026-11-15, about 21:57 | Pre-reset journal rows and stale sleep marks moved to archive tables | Never row (agent memory) | [0339](../decisions/0339-journal-reset-one-time-exception.md) | "One-time, not a routine" (0339 status line and consequences) |

Rows 1, 4 and 5 are exceptions in this page's sense. Row 2 is a world-rule change made by a recorded decision, and row 3 is the standing rule applied; both are listed as context for the exceptions around them.

### The spawn-town cutover

What the repo shows:

- **The border.** `compose/colo.yml` line 137: "On 2026-11-15 the owner moved the colo border to radius 9500 (diameter 19000) for the spawn-town cutover." `shards/colo-mind.yaml` line 10 sets `world_border_radius: 9500` to match. The Phase 0 shard keeps the spec's 1500 (`shards/phase0.yaml` line 6; `compose/phase0.yml` line 85).
- **The wipe.** [0339](../decisions/0339-journal-reset-one-time-exception.md), context: "On 2026-11-15 the owner ordered all agents wiped and started over in the new spawn town." The wipe ran at 21:25:51Z. What it removed is not stated in the repo, apart from what it missed (the journal and sleep marks).
- **The town and the placing of Bodies.** No file in the repo records how the town was built, what it contains or how Bodies were placed in it.

The owner's framing, that the town, the border move and the memory reset are a temporary rescission of the prime directive and not new normal operator behaviour, is recorded in operator session notes outside the repo. It is unverified here: no decision record carries it. The bound that is in the repo is 0339's: "This is not a reset routine. No new reset verb, script or migration is added. Any future journal reset needs its own decision and the owner's order."

### The journal reset (0339)

The wipe left the agents' journal and sleep-mark rows in place, so the Minds were handed pre-wipe history. Under the owner's reset order, the operator first took a full database dump and a dump of the two tables, then moved 13,997 pre-reset journal rows of 19 lives to an archive table, inside one transaction, with the append-only trigger bypassed for that transaction only. Sleep marks were archived and the stale ones set to the current world day ([0339](../decisions/0339-journal-reset-one-time-exception.md), decision items 1 to 4; figures from the record, not re-measured). The append-only rule of [0085](../decisions/0085-append-only-audit-tables.md) otherwise stands. 0339 leaves one question open: whether account deletion should also erase a deleted owner's rows in the archive tables ([0262](../decisions/0262-account-deletion-erases-dead-lives-too.md) does not reach them).

## Boundary cases that are not exceptions

| Case | Why it is not a human acting in the world | Evidence |
|---|---|---|
| Gravestones | The plugin places them at a death position by a fixed rule, for every agent alike; the operator backfill writes ownership records, not blocks | `plugin/README.md`, "Gravestones"; [0195](../decisions/0195-gravestones-owned-by-system.md) (Proposed) |
| Maintenance notices | The deploy publishes one fixed server line before and after a restart; it is infrastructure, though agents can read it | [maintenance notice runbook](../runbooks/maintenance-notice.md) |
| Whitelisting a new life | An admission step outside the world | [0064](../decisions/0064-exit-run-lives.md) item 3 |
| Skins | Cosmetic; owner uploads wait for operator approval | [0172](../decisions/0172-human-skin-upload-held-for-approval.md) item 8 |
| Account deletion | Removes an owner's records by their right of erasure; it does not move or change anything in the world | [0262](../decisions/0262-account-deletion-erases-dead-lives-too.md) |

## What keeps an exception bounded

Drawn from what 0339 did and what the review asks for; none of it is yet a single rule in a decision record:

1. **The owner's order**, given for that one change (0339 status line).
2. **A decision record that names it one-time** and says what it does not authorise (0339, consequences).
3. **Backups first**, kept operator-only (0339, decision item 1).
4. **A logged time window**, so later measurements can tell the change from agent behaviour (review, section E2: "every world edit logged as an exception").
5. **No standing procedure.** No reset verb, script or migration is added (0339, consequences). The planned [world and memory reset](../runbooks/world-and-memory-reset.md) (*planned*) runbook must describe what was done under 0339, not a routine to repeat.
6. **Return to the standing rule** at once afterwards.

## Trade-offs

| Choice | Gain | Cost |
|---|---|---|
| Allow a bounded exception | Ends a crisis the agents cannot leave | Breaks Principle 1; confounds everything measured across it |
| Refuse all exceptions | A clean experiment | Agents may stay on the survival floor; the exhibition stalls |
| Record each exception as a decision | The history stays honest and attributable | Of the three exceptions above, only the 0339 reset has one |

## Conflicts recorded

1. **Principle 1 against operator actions.** Spec 2: humans never build, give items or intervene. Operators moved Bodies, placed torches and wrote into an agent's memory on 2026-11-12, and, per operator session notes outside the repo (unverified here, see [the cutover section](#the-spawn-town-cutover)), built a town and placed Bodies on 2026-11-15. Code: nothing in the repo performed these changes; the console and RCON paths that allow them are by design (`plugin/README.md`). Only 0339 records an exception; the others have no decision record.
2. **The world border.** Spec 5.1: radius 1500 on the baseline shard. `shards/phase0.yaml` line 6: 1500. `shards/colo-mind.yaml` line 10 and `compose/colo.yml` line 137: 9500 since 2026-11-15. No decision record covers the change.
3. **The rulings that bound operators.** "Real stakes, no rescues" and the three kinds of change exist only in `docs/analysis/autonomy/review-and-plan-2026-11-14.md`. No decision record carries them, so the spec's Principle 1 and those rulings are the only written bounds.

## What it touches

[Principles in practice](principles-in-practice.md), [what is Geldar](what-is-geldar.md), [life cycle of a life](life-cycle-of-a-life.md), and the planned [time, shards and phases](time-shards-and-phases.md) and [character and memory](character-and-memory.md).

## Where to read the reference

- The one-time journal reset: [decision 0339](../decisions/0339-journal-reset-one-time-exception.md).
- The world border and gamerules in config: [shard config](../reference/shard-config.md), [compose stacks](../reference/compose-stacks.md).
- The decision index: [decisions README](../decisions/README.md); by topic: [decisions by topic](../reference/decisions-by-topic.md) (*planned*).
