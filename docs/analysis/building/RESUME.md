# Building campaign resume

Refreshed 2026-11-22. State: nothing merged to main; integration branch `building/integration` only (local, never pushed). `building/integration` = `ecae177c` (BLD-38h merged). `origin/main` = `5828b498` carries the campaign docs only; no building packet is on `main`.

## Read in order
1. [README.md](README.md): purpose, exit criteria, decisions, packet table, risks, open questions.
2. [work-packets.md](work-packets.md): the parallelism section (shared files, Wave 0 scaffold, DAG, ownership table, conflict check), then the packet you dispatch.
3. Decisions [0420 to 0429](../../decisions/README.md).
4. Worknotes in [worknotes/](worknotes/): each packet's own status and open items.

## Owner rulings (2026-11-22, binding)
Break anything; nothing protected; no dig-safety refusals; next life inherits the seen map; survival materials, one block at a time; background plan lane; no caps (tick-budgeted); all 19 at once behind `body_actions.building`; seen-block map only, kept across death; skip changed cells; teach verbs, never nudge; Paper first, NeoForge gated.

## State
- Merged to `building/integration`: BLD-S1, S2, S3a, S3b, S3c; BLD-04 to 11, 12, 13 to 24 (all in the packet table as Done); BLD-26, 27, 28, 30, 36, 37; the BLD-38 family (38, 38b, 38b2, 38c, 38d, 38e, 38f, 38g, 38h).
- Not merged: BLD-S4 (Ready, unverified). BLD-25 is Done in the kit repo (kit PR 137); its tag and upgrades are MANUAL.
- Manual, not run: BLD-29 (test-shard evidence), BLD-31 (Paper go-live). BLD-28 live test is written and NOT run (`GELDAR_IT=1`).
- BlockedDecision: BLD-32 to 35 (NeoForge; owner settles 0387 and 0390).
- Live lane: pending for every packet; nothing has been run against a server.

## Open items
1. Reviews not yet run on the merged packets (BLD-26 is marked "review pending" in its worknote).
2. Survey `plan` and seen predecessor on restart has no source. `restartBody` only runs for the same life; a predecessor exists only for a newborn life after a death, and no life registry exists in golem (BLD-38g). The same-life restart now reloads its own map (BLD-38h). Until a source exists, `seen` has no `predecessor` and nothing is inherited.
3. Dockerfile change for golem is unbuilt. BLD-38b2 notes the existing `golem/Dockerfile` copy of `player-core`; the new change is not made.
4. Manual NATS bucket seeding for `geldar-plans` and `geldar-seen` is not done: the NATS role for both buckets and the seed (`docs/runbooks/nats-auth-inplace.md`, `golem/src/seed-buckets.ts`). BLD-18 and BLD-38c depend on it.
5. BLD-38f behaviour change: an unexpected throw from `queue.step` now fails the plan (`wire-lane.ts` calls `lane.fail()`, emits the `failed` event once, then rethrows). The unexpected-throw path has no test yet (BLD-38f worknote).
6. BLD-23 is merged but its worknote says the `plan_progress` presenter is not done.
7. BLD-38's own worknote reads "Blocked before any code change"; the packet was then split into 38b to 38h, which are merged.
8. `tools/repo-checks`: `nats-human-grants-nf.test.ts` (5 failures) and `scratch-human.test.ts` (1 failure) fail on the base worktree too (BLD-38f worknote). Not ours; not fixed.
9. Many worknotes still say "Writing" for merged packets; the ledger in README.md is the status source until they are updated.

## Next steps
1. Run the reviews for the merged packets, starting with BLD-26 and the BLD-38 family.
2. Decide the predecessor source for the next life (owner question; the seen map inheritance depends on it).
3. Write the Dockerfile change for golem and the NATS seeding for both buckets (manual, operator).
4. Add a test for the unexpected-throw path in `wire-lane.ts` (open item 5).
5. Run BLD-28 (`GELDAR_IT=1`) on the test shard, then BLD-29 evidence; BLD-31 go-live waits on the owner.
6. Kit half: BLD-25 tag and upgrades are manual; the kit session tracks them.
7. NeoForge: owner settles 0387 and 0390 before BLD-32 can start.
