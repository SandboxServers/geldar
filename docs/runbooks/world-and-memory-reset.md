---
title: World and memory reset
type: how-to
audience: owner
status: draft
last_verified: 2026-11-16 against 03c1f5de
companions: [README.md, ../concepts/world-operations-exceptions.md, ../concepts/principles-in-practice.md, ../reference/database-schema.md, ../reference/shard-config.md, add-a-decision-record.md, account-deletion.md]
sources: [docs/spec.md, CLAUDE.md, docs/decisions/0339-journal-reset-one-time-exception.md, docs/decisions/0085-append-only-audit-tables.md, docs/decisions/0064-exit-run-lives.md, docs/decisions/0076-backup-scope-and-destination.md, docs/decisions/0130-phase1-owner-rulings-for-c1.md, docs/decisions/0262-account-deletion-erases-dead-lives-too.md, docs/analysis/autonomy/review-and-plan-2026-11-14.md, compose/colo.yml, shards/colo-mind.yaml, shards/phase0.yaml, sql/0007_journals_append_only.sql, sql/test/check-schema.sql, golem/test/live/adam-reset.ts, deploy/colo-cd.sh]
---

# World and memory reset

How the owner orders, and an operator carries out, a reset of the live world or of agents' memory as a **bounded, one-time exception** to Principle 1. This is not a routine procedure. The repo records exactly one such reset, the journal and sleep-mark reset of 2026-11-15 ([decision 0339](../decisions/0339-journal-reset-one-time-exception.md)), and that decision says: "This is not a reset routine. No new reset verb, script or migration is added. Any future journal reset needs its own decision and the owner's order."

So this page gives no commands. It lists the preconditions the decisions set, the order of work they imply, and what the 2026-11-15 cutover did and did not leave in the repo. Each future reset gets its own decision, and that decision, not this page, carries the exact operating steps.

Evidence is the repo at 03c1f5de on 2026-11-16. Nothing on the node, the VM, the database or the world was read (plan decision D8). Claims that exist only in operator session notes outside the repo are marked **unverified**.

## Why this is an exception

Principle 1: "No humans inside. Humans may observe through the map, the thought stream, and silent spectator cameras. Humans never speak, build, give items, or intervene. If something breaks, fix the infrastructure, not the story." ([spec section 2](../spec.md#2-principles)). [CLAUDE.md](../../CLAUDE.md) adds that nothing Geldar builds lets a human act inside the world.

The owner's ruling "real stakes, no rescues" puts "editing an agent's memory", "moving a Body", "giving or removing items" and "placing or breaking blocks" in the **never** row, and world rules on the exhibition world change "only by a recorded decision at a change window" ([autonomy review](../analysis/autonomy/review-and-plan-2026-11-14.md), section E4). That ruling lives in an analysis file; no decision record carries it yet ([world-operations exceptions](../concepts/world-operations-exceptions.md#conflicts-recorded), conflict 3). A world or memory reset is in the never row, so it needs everything below.

## Preconditions

Do not start unless every item holds. Each comes from a decision or the review, as cited.

1. **The owner's order, for this one reset.** 0339 ran "under the owner's reset order and the coordinator's OK" (0339, Decision). A reset that deletes rows of a life used by a live test is an owner decision ([0064](../decisions/0064-exit-run-lives.md) item 5).
2. **Its own decision record, written first**, that names the reset one-time and says what it does not authorise (0339, Consequences). Any migration that changes an append-only table needs its own decision ([0085](../decisions/0085-append-only-audit-tables.md), Consequences). Use [add a decision record](add-a-decision-record.md).
3. **The coordinator's OK** (0339, Decision).
4. **Backups taken first and kept operator-only.** 0339 took a full database dump and a dump of the affected tables, mode 0600, in the operator state directory (0339 item 1). There is no backup system to fall back on: the coordinated checkpoint of [0076](../decisions/0076-backup-scope-and-destination.md) (scope B) was accepted but its destination and build are deferred ([0130](../decisions/0130-phase1-owner-rulings-for-c1.md) ruling 2), so "a running colo shard has no restore path" (0076, owner ruling). The dumps you take are the only way back.
5. **A logged UTC time window**, so later measurements can separate the change from agent behaviour (review section E2: "every world edit logged as an exception").
6. **No standing tool comes out of it.** No reset verb, script or migration is added (0339, Consequences).

## Steps

1. **Confirm it is not something else.** Several resets are routine and are not this runbook (see [Not this runbook](#not-this-runbook)). If yours is one of them, stop here.
2. **Get the owner's order in writing** and the coordinator's OK (preconditions 1 and 3).
3. **Write the decision record** (precondition 2). Name the tables, rows, world changes and roles involved; the backup to take; how the count is checked; who may read the archive; and what is left out. Use 0339's Decision section as the shape: dumps first, archive before delete, one transaction, the append-only trigger kept installed and enabled, owner-only grants on the archive. Get the record merged or accepted before any change.
4. **Take the backups** the record names (precondition 4) and note their UTC time.
5. **Carry out exactly the steps in the record**, in a logged window (precondition 5). For the 2026-11-15 journal reset, the steps are 0339 items 2 to 4. No repo document gives steps for wiping a world, building a town or placing Bodies; do not improvise them from this page.
6. **Verify against the record.** For a journal reset on the 0339 pattern: the copied row count equals the deleted count (0339 item 2); the append-only triggers from `sql/0007_journals_append_only.sql` are still installed and enabled (0339 item 2, "The trigger stays installed and enabled"; `sql/test/check-schema.sql` asserts each trigger in CI); the archive tables have no grant beyond the table owner (0339 item 4).
7. **Return to the standing rule at once**, and record the exception: add a row to the record table in [world-operations exceptions](../concepts/world-operations-exceptions.md#the-record), and follow the doc-update map row for a world-operations exception ([doc-update map](../agents/doc-update-map.md)).

*Untested:* no step on this page has been run for this page. The only recorded run is the one 0339 describes.

## Roll back

- 0339's rows are recoverable from the archive tables and from the dumps (0339, Why). A future record must say the same for what it removes.
- No restore procedure for the 0339 dumps or archive tables is in any decision. The [backup and restore](backup-and-restore.md) runbook (written in the same wave, W3) covers the backups that exist; a restore of a reset's own dumps is a node operation its record must spell out.
- Deploy dumps are separate: `deploy/colo-cd.sh` writes a `pg_dump` before it applies migrations (lines 389 to 397), but release rollbacks never reverse migrations (comment above `rollback()`).

## The 2026-11-15 cutover: what the repo shows

| Item | In the repo | Evidence |
|---|---|---|
| World border moved to radius 9500 (diameter 19000) on the Colo | Yes, as config | `compose/colo.yml` lines 137 to 138 (`worldborder set 19000` in the startup commands); `shards/colo-mind.yaml` line 10 (`world_border_radius: 9500`). The comment says the two must match; no test checks it. The Phase 0 shard keeps 1500 (`shards/phase0.yaml` line 6). |
| All agents wiped and started over in a new spawn town, the wipe at 21:25:51Z | As a statement only | 0339, Context. What the wipe removed is not stated, apart from what it missed. |
| Journal and sleep-mark reset, about 21:57 to 21:58Z | Yes | 0339, Decision items 1 to 4 (13,997 journal rows of 19 lives archived; figures from the record, not re-measured) |
| How the town was built, what it contains, how Bodies were placed | No | **Unverified.** Operator session notes outside the repo say the town was built and 19 Bodies were placed. |
| That the border move, the town and the memory reset together are a temporary rescission of the prime directive, not a new normal | No | **Unverified.** The owner's framing is in operator session notes outside the repo. The only bound in the repo is 0339's. |
| That backups were kept | Partly | 0339 item 1 for the database dumps. **Unverified** for any world copy: session notes only. |

## Not this runbook

| Case | Why it is not a world-operations exception | Where it is covered |
|---|---|---|
| A fresh world for a Phase 0 exit run | Each exit run gets a new volume and fresh lives by design: `./geldar.ps1 adam-run <profile> prepare-volume --run-id <run-id>` | [0064](../decisions/0064-exit-run-lives.md) items 1 (lives) and 2 (volumes) |
| The live-test reset of the 8B test life | Clears that one test life's mutable rows (memories, goals, relationships) before each live case; logs, and never runs, deletes on append-only tables | `golem/test/live/adam-reset.ts`; [0085](../decisions/0085-append-only-audit-tables.md) item 8 |
| Account deletion | An owner's right of erasure; it removes records, not anything in the world | [0262](../decisions/0262-account-deletion-erases-dead-lives-too.md); [account deletion](account-deletion.md) |
| A scratch or test stack | Throwaway; not the live world | [scratch stack](scratch-stack.md); [signcheck shard](signcheck-shard.md) |

## Conflicts recorded

1. **Reset by new shard, or by deleting rows.** 0076's recommendation (scope B, accepted) says "A reset creates a new shard rather than deleting rows." 0339 deleted rows from the live `mcp_journal` after archiving them, with a one-transaction trigger bypass. 0339 does not cite 0076 on this point. Recorded, not resolved.
2. **The border has no decision.** Spec section 5.1 sets radius 1500 on the baseline shard; the Colo has 9500 since 2026-11-15 (`compose/colo.yml` line 137), and the review requires a recorded decision for a world-rule change on the exhibition world. No record covers it ([world-operations exceptions](../concepts/world-operations-exceptions.md#conflicts-recorded), conflict 2).
3. **The test-life reset and 0064.** 0064's consequences say `adam-reset.ts` "still deletes that life's journal rows", against its item 5. Since 0085, the reset never runs deletes on the append-only tables (`thoughts`, `suppressed_wakeups`) but still deletes the test life's `memories`, `goals` and `relationships` (`golem/test/live/adam-reset.ts`), which 0085 item 2 calls mutable by design.
4. **The archive tables and erasure.** 0339 records a known gap: account deletion ([0262](../decisions/0262-account-deletion-erases-dead-lives-too.md)) does not reach the archive tables. The owner's answer is open (0339, Consequences).

## Related

- Explanation: [world-operations exceptions](../concepts/world-operations-exceptions.md), [principles in practice](../concepts/principles-in-practice.md#principle-1-no-humans-inside).
- Decisions: [0339](../decisions/0339-journal-reset-one-time-exception.md), [0085](../decisions/0085-append-only-audit-tables.md), [0076](../decisions/0076-backup-scope-and-destination.md), [0064](../decisions/0064-exit-run-lives.md).
- Reference: [database schema](../reference/database-schema.md) (append-only triggers), [shard config](../reference/shard-config.md) (the border).
- How-to: [add a decision record](add-a-decision-record.md); [incident response](incident-response.md).
