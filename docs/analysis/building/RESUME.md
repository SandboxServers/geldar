# Building campaign resume

Refreshed 2026-11-22 (docs packet BLD-docsfix2). State: nothing merged to main; integration branch `building/integration` only (local, never pushed). `building/integration` = `d87221c4` at the time of this packet, after the review fixes (fix1 to fix5b). `origin/main` = `5828b498` carries the campaign docs only; no building packet is on `main`.

## Read in order
1. [README.md](README.md): purpose, exit criteria, decisions, packet table, risks, open questions.
2. [work-packets.md](work-packets.md): the parallelism section (shared files, Wave 0 scaffold, DAG, ownership table, conflict check), then the packet you dispatch.
3. Decisions [0420 to 0429](../../decisions/README.md).
4. Worknotes in [worknotes/](worknotes/): each packet's own status and open items.

## Owner rulings (2026-11-22, binding)
Break anything; nothing protected; no dig-safety refusals (decision 0428 limits this to `break`, `mine` and plans); next life inherits the seen map; survival materials, one block at a time; background plan lane; no caps (tick-budgeted); all 19 at once behind `body_actions.building`; seen-block map only, kept across death; skip changed cells; teach verbs, never nudge; Paper first, NeoForge gated.

## State
- Merged to `building/integration`: BLD-S1, S2, S3a, S3b, S3c; BLD-04 to 11, 12, 13 to 24; BLD-22b; BLD-26, 27, 28, 30, 36, 37; the BLD-38 family (38, 38b, 38b2, 38c, 38d, 38e, 38f, 38g, 38h); review fixes BLD-fix1, fix2a, fix2b, fix2d, fix3a, fix3b, fix4a, fix4b, fix5, fix5b. BLD-09 and BLD-10 modules are merged but not wired (see known gaps).
- Not merged: BLD-S4 (Ready, unverified). BLD-25 is Done in the kit repo (kit PR 137); its tag and upgrades are MANUAL.
- Manual, not run: BLD-29 (test-shard evidence), BLD-31 (Paper go-live). BLD-28 live test is written and NOT run (`GELDAR_IT=1`).
- BlockedDecision: BLD-32 to 35 (NeoForge; owner settles 0387 and 0390).
- Live lane: pending for every packet; nothing has been run against a server.

## Open items
1. Reviews not yet run on the merged packets (BLD-26 is marked "review pending" in its worknote).
2. Seen predecessor on restart has no source. `restartBody` runs only for the same life; a predecessor would exist only for a newborn life after a death, and golem has no life registry to find it (BLD-38g). The same-life restart reloads its own map (BLD-38h). Until a source exists, `seen` has no `predecessor`, and nothing is inherited.
3. `golem/Dockerfile` copies `player-core` (BLD-38b2). The golem image is not built and not verified.
4. Owner step, by hand: the NATS role for `geldar-plans` and `geldar-seen` in the live conf (the `body` role needs `$KV.geldar-plans.>` and `$KV.geldar-seen.>`). Procedure in `docs/runbooks/nats-auth-inplace.md`; the runbook is in `docs/runbooks/building.md`. Player Bodies and Adam's Body both create the buckets at start with the flag on.
5. BLD-38f: an unexpected throw from `queue.step` fails the plan (`wire-lane.ts` calls `lane.fail()`). The test exists (`golem/src/building/wire-lane.test.ts`, BLD-fix1c).
6. BLD-23: the `plan_progress` presenter is merged, but `status.active_plan` has no source (`threshold/mcp/src/world.ts` calls `statusTool` without `activePlan`).
7. `tools/repo-checks`: `nats-human-grants-nf.test.ts` and `scratch-human.test.ts` failed on the base worktree in BLD-38f's run. Not ours; not fixed here.
8. Many worknotes still say "Writing" or "Checks running" for merged packets; the ledger in README.md is the status source.

## Known gaps and owner decisions

Factual list at `d87221c4`. Each item is either a code gap or an owner call; none is fixed by the docs.

1. **Facing refused for every block kind.** `FACING_VERIFIED` is empty (`golem/src/actions/place-state.ts`), so stairs take `half` only and doors, furnaces, chests and trapped chests take no state. A `facing` or `axis` key is refused as `state_unachievable`. BLD-08 tier 1 is unmet. Its live test (`place.live.test.ts`) is written and not run.
2. **Seen-map privacy for already-seen cells.** Open: nothing settles what the seen map may reveal about cells another agent saw. Owner decision.
3. **NATS `seed` role cannot create `geldar-plans` or `geldar-seen`.** `seed-buckets.ts` creates only the identity buckets; the building buckets need the `body` role in the live conf before the flag-on restart. `geldar.ps1` has no entry for them.
4. **Prompt follows the flag (B8).** The Mind renders body-api v12 (`break` and `plan`) while `body_actions.building` is on and v10 while it is off (`bodyApiVersionFor`, `animus/src/prompts/library.ts`). The Minds read the flag when they start. Eight animus tests (`animus/src/validate`, `animus/src/prompts`) were reported failing at `6fe2448b`; not re-run for this packet.
5. **colo lists `survey` and `plan_check` while the flag is on (B8).** `shards/colo-mind.yaml` sets `show_unavailable_tools: false`; with `body_actions.building` on, the MCP lists `survey` and `plan_check` anyway (`hiddenToolsFor`, `threshold/mcp/src/tools/unavailable.ts`). Setting `show_unavailable_tools` to `true` would also list six other tools the world does not run (`write_book`, `define_skill`, `use_skill`, `offer`, `propose`, `vote`). Owner decision.
6. **Sources not wired.** Glass plan-activity is merged with `PLAN_ACTIVITY_ENABLED = false` and no feed route. The seen predecessor has no source (item 2 above). `status.active_plan` has no source (item 6 above).
7. **Caps.** `plan_check` refuses over 8192 cells (`PLAN_CHECK_CELL_CAP`, `plan_too_large`) and returns at most 256 `invalid_steps`; the contract has no `maxItems` on `invalid_steps`. The survey box is capped at 32768 cells (`box_too_large`). Decisions and the runbook say "no caps"; these are health bounds in code.
8. **Flag-off answers.** `survey` and `plan_check` answer `not_available` from the Body with the flag off; the MCP tool returns `body_unavailable`, not `not_available`.
9. **Stand, scaffold and hazard modules have no production caller.** `stand.ts`, `scaffold.ts` and `hazards.ts` (BLD-09 and BLD-10) are built and unit-tested. The cell executor and the lane do not call `standFor`, `scaffoldFor`, `hazardAt` or `orderCells`. Owner call: wire them, or mark BLD-09 and BLD-10 Partial.
10. **Dig-safety still applies outside plans.** The refusal still runs in `unstick`, `unstick-up`, `pillar`, the escape ladder and stairs, and the reflex dig (decision 0428 limits the removal to `break`, `mine` and plans).
11. **Seen view cone is a constant.** `golem/src/perception/view/viewport.ts` sets `H_FOV` 90 and `V_FOV` 45 degrees. No `seen_fov` config key exists in golem, the contract or the shards.
12. **Unbounded eager plan expansion.** `createPlanExpand` (`golem/src/building/wire-expand.ts`) builds every cell of a plan before the lane runs, and the plan action has no size bound. The lazy and bounded options are in `docs/analysis/building/worknotes/BLD-fix6.md`; none is implemented.
13. **Inheritance writes marks wrongly.** Closed on `phase1/b8-seen-inherit-flush`: the store round-trips the inherited bit through flush and reload (review-code-4 F6, reported at `6fe2448b`).
14. **Bot listeners not removed.** `wire-seen.ts` adds three `bot.on` listeners that `stop()` does not remove; each Body restart on the same bot adds more (review-code-4 F7, reported at `6fe2448b`).
15. **Metrics reach SigNoz only with `GELDAR_TELEMETRY_URL`.** Without it the series are computed and not pushed.
16. **Flag path for the node is unverified.** The runbook says the node checkout must carry the shard change; the mechanism (`colo-images.yml` paths, bind mount) is not verified here.
17. **Saved plans replay.** A stored plan has no expiry or cleanup, and it resumes when the flag goes back on.
18. **No live test has been run.** Every `GELDAR_IT=1` and `*.live.test.ts` case for this campaign is written and not run.

## Next steps
1. Run the reviews for the merged packets, starting with BLD-26 and the BLD-38 family.
2. Decide the predecessor source for the next life (owner question; the seen map inheritance depends on it).
3. Owner: the NATS role for both building buckets in the live conf (item 4 above), before the flag-on restart.
4. Owner: decide known gaps 1, 2, 5, 9 and 12 (facing, seen privacy, tool visibility, stand/scaffold/hazard wiring, expansion bound).
5. Run BLD-28 (`GELDAR_IT=1`) on the test shard, then BLD-29 evidence; BLD-31 go-live waits on the owner.
6. Kit half: BLD-25 tag and upgrades are manual; the kit session tracks them.
7. NeoForge: owner settles 0387 and 0390 before BLD-32 can start.
8. Erasure (B8): erasing a life also removes its bare `<life_id>` body checkpoint in `geldar-checkpoints` (`tools/players-cli/src/erase-building.ts`). Test-covered; the runbook line is in `building.md`.

### Config lines that change (B8)

| File and line | What changes | Manual? |
| --- | --- | --- |
| `animus/src/prompts/library.ts` (`BUILDING_BODY_API_VERSION`, `bodyApiVersionFor`) | New: the Mind renders body-api v12 while the flag is on, v10 while off. `DEFAULT_BODY_API_VERSION` stays 10. | No (code). Restart the Minds after the flag changes. |
| `animus/src/main.ts`, `animus/src/config.ts` (`buildingOn`) | New: read `body_actions.building` from the shard file. | No (code). |
| `threshold/mcp/src/tools/unavailable.ts`, `config.ts`, `main.ts`, `world-session.ts` | `survey` and `plan_check` listed while `body_actions.building` is on, even with `show_unavailable_tools: false`. | No (code). Restart the MCP. |
| `shards/colo-mind.yaml` line 63, `show_unavailable_tools: false` | Unchanged. Not needed for survey and plan_check now. | No edit. |
| `shards/colo-mind.yaml` line 29, `body_actions` | Not changed here. Owner adds `building: true` at go-live (BLD-31). | Yes, manual, after the NATS steps below. |
| Live NATS conf, `body` role Pub list | Add `$KV.geldar-plans.>` and `$KV.geldar-seen.>`, then reload. | Yes, manual (`nats-auth-inplace.md`, MANUAL create order). |
| Live NATS buckets `geldar-plans`, `geldar-seen` | Create in that order, with an admin identity, default settings. | Yes, manual. |
| `tools/players-cli/src/erase-building.ts` | Erasure also removes the bare `<life_id>` body checkpoint. | No (code). |
