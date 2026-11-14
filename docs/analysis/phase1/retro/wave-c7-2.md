# Retro: wave C7-2 (owner keys, supervisor NATS and adapters, onboarding)

Built on `phase1/c7-wave2` (head 87f2d081 at close). Packets: C7-02b, C7-05, C7-03b1, C7-03b3. Merge pending: PR #321 is held for geldar-93's metrics window until about 02:45Z. Nothing in this wave is merged or deployed yet. Plan: [packets/c7-wave-plan.md](../packets/c7-wave-plan.md). Previous wave: [wave-c7-1.md](wave-c7-1.md).

## What happened

- Four review passes (wave 1 had five). Pass 1 found tests that passed without the fix they named, and an escalation gap that only TypeScript enforced. Pass 4 returned ship.
- Twelve fix coders, counting continuations. Continuations resumed from WIP commits.
- One reviewer ran out of turns before writing a report. The reviewer briefs had no report-early rule; it is now in every reviewer brief.
- Pass 1 found an escalation gap that only TypeScript enforced. The gate rule needs to live in SQL, where every writer hits it.
- The SQL feedback loop ran on a Docker-capable scratch Postgres. Coders and ops reused the same recipe. It is still not committed as a script (carried from wave 1).
- The wave found that migration 0033 (`sql/0033_supervisor_display_name.sql`) lacked its `schema_migrations` insert. The fix added a repo test. The migrate test's expected list is still hand-written (wave-1 action 3, still open).
- Compose and node constraints from geldar-93 (no `compose up` on the node, `nats-auth.conf` edited by hand, passwords only on the node) forced the split of C7-03b into b1, b2, b3 and b4. The node steps moved into the C7-03b2 runbook.
- The machine hit critical memory pressure while several agents and CI watches ran at once.
- The ranger-host outage during this wave was caused by a golem change (#318, reverted by #325), not by C7. The orchestrator checked the diff before replying to blame.
- geldar-93 asked to hold the merge for a metrics window. The merge was not dispatched during that window.

## Actions

1. **Commit the scratch Postgres recipe.** Add `tools/scratch-postgres` (a script) or a runbook section under `docs/runbooks/`, so coders run every sql check locally. Carried from wave 1 (action 1 there, still open). Owner: process packet. Size: S.
2. **Gate rules go in SQL, not only TypeScript.** Any rule that must hold for every writer (escalation, ownership, append-only) gets a SQL constraint or trigger, with a gate test. Owner: orchestrator (card template). Size: S.
3. **Every named test gets its revert-check in the report.** Pass 1 found tests that passed with the fix removed. The reviewer checks the mutation output, not the coder's word. Owner: orchestrator (review brief). Size: S.
4. **Put "node constraints" in the card template.** Every card that touches compose, node auth or passwords states: no `compose up` on the node, hand-edited files are named, passwords stay on the node. Owner: orchestrator (card template). Size: S.
5. **Reviewer report-early rule.** Every reviewer brief says: write the report before the last check, and return it even if turns run short. Applied already in wave-2 briefs. Owner: orchestrator. Size: S. Status: done.
6. **Derive the migrate test's expected list from `sql/`, or sort it.** The 0033 insert miss showed the hand list is a trap. This is wave-1 action 3, still open. Owner: process packet, with the next SQL packet. Size: S.
7. **Cap concurrent agents at 3, and never run ops CI watches as long background tasks.** Use short polls. The memory pressure this wave came from parallel agents and watches. Owner: orchestrator. Size: S.
8. **Check the shared calendar and the metrics window before dispatching a merge.** geldar-93 asked for a hold. Owner: orchestrator. Size: S.
9. **Verify outage blame with a diff before replying.** Done this wave: the ranger-host outage was #318 (reverted #325), not C7. Owner: orchestrator. Size: S. Status: done.
10. **Keep the plan's wave table and the close brief in step.** The plan lists C7-04a and C7-04b in wave 2 (wave-plan lines 72 to 73). The wave-2 close note puts them in wave 3. The ledger follows the plan (wave 2). Pick one at the next plan update. Owner: orchestrator. Size: S.
11. **Split the oversize packet files.** `docs/analysis/phase1/packets/c1-packets.md` is 804 lines, over the 700 hard cap; `c2b-packets.md` is 558 and `c4-packets.md` is 501, over the 500 soft cap. Found by the line-count check at wave close, not by this wave's packets. Owner: orchestrator (docs), split by card group. Size: M.

## Carry-forward

- Wave-1 actions 1 and 3 (scratch Postgres, migrate test list) are still open; they are above as 1 and 6.
- Owner items still open: the geldar_supervisor Postgres password (an operator step, by hand, before C7-03b2), the C7-10 reason codes, and the erasure rule review (0171, gates C7-11 only).
- Wave 3 starts after PR #321 merges: C7-03b4, C7-04a, C7-04b, C7-04c, C7-06 (see RESUME for the order).
