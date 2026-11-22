# Building campaign resume

Refreshed 2026-11-22 (docs packet B8-docs2) to the integration state `building/integration` = `a72acaac` (merge of `phase1/b8-fix12-codes`). State: nothing merged to main; integration branch `building/integration` only (local, never pushed). `origin/main` = `5828b498` carries the campaign docs only; no building packet is on `main`. Draft PR #932 was opened at `784b4f27`; this packet does not check its state.

## Read in order
1. [README.md](README.md): purpose, exit criteria, decisions, packet table, risks, open questions.
2. [work-packets.md](work-packets.md): the parallelism section (shared files, Wave 0 scaffold, DAG, ownership table, conflict check), then the packet you dispatch.
3. Decisions [0420 to 0429](../../decisions/README.md).
4. Worknotes in [worknotes/](worknotes/): each packet's own status and open items.

## Owner rulings (2026-11-22, binding)
Break anything; nothing protected; no dig-safety refusals (decision 0428 limits this to `break`, `mine` and plans); next life inherits the seen map; survival materials, one block at a time; background plan lane; no caps (tick-budgeted); all 19 at once behind `body_actions.building`; seen-block map only, kept across death; skip changed cells; teach verbs, never nudge; Paper first, NeoForge gated.

## State
- Merged to `building/integration`: BLD-S1, S2, S3a, S3b, S3c; BLD-04 to 11, 12, 13 to 24; BLD-22b; BLD-26, 27, 28, 30, 36, 37; the BLD-38 family (38, 38b, 38b2, 38c, 38d, 38e, 38f, 38g, 38h); review fixes BLD-fix1, fix2a, fix2b, fix2d, fix3a, fix3b, fix4a, fix4b, fix5, fix5b.
- B8 follow-up, all merged (ancestors of `a72acaac`): B8-wire(2) `b35bba5f`, B8-cfg `e4a4403d`, B8-seen `f91464a9`, B8-lazy `52bc5b08`, B8-pcheck `a1493f5a`, B8-inherit `2bb9500a`, B8-lazy7 `db02ba79`, B8-fix6a `02c96eeb`, B8-fix6b `8297a30b`, B8-fix7 `a2e25fe6`, B8-fix12 `da86ca3f`, B8-prompt2 `c6b49737`. The ledger rows are in README.md.
- BLD-09 and BLD-10 are wired behind the flag (`golem/src/building/cell-stand.ts` calls `standFor`, `scaffoldFor` and `hazardAt`); `retainBlock` and `orderCells` are not (see known gaps).
- Body-api: the Mind renders v12 when `body_actions.building` is on (`BUILDING_BODY_API_VERSION` = 12 in `animus/src/prompts/library.ts`, selected by `bodyApiVersionFor`). No body-api v13 exists: v12 never described the survey. The survey reply description (`contract/schemas/mcp-survey.schema.json`) gained one sentence on the `@<minutes>` mark and the trailing `i` (inherited) flag (B8-prompt2); that is a contract text change, not a body-api version.
- Not merged: BLD-S4 (Ready, unverified). BLD-25 is Done in the kit repo (kit PR 137); its tag and upgrades are MANUAL.
- Manual, not run: BLD-29 (test-shard evidence), BLD-31 (Paper go-live). BLD-28 live test is written and NOT run (`GELDAR_IT=1`).
- BlockedDecision: BLD-32 to 35 (NeoForge; owner settles 0387 and 0390).
- Live lane: pending for every packet; no live test has been run against a server.

## Open items
1. Reviews not yet run on the merged packets (BLD-26 is marked "review pending" in its worknote). The B8 packets were checked by their own coder runs only.
2. Seen predecessor on restart has no source. `restartBody` runs only for the same life; a predecessor would exist only for a newborn life after a death, and golem has no life registry to find it (BLD-38g). The same-life restart reloads its own map (BLD-38h). Until a source exists, `seen` has no `predecessor`, and nothing is inherited.
3. `golem/Dockerfile` copies `player-core` (BLD-38b2). The golem image is not built and not verified.
4. Owner step, by hand: the NATS role for `geldar-plans` and `geldar-seen` in the live conf (see Manual steps).
5. BLD-38f: an unexpected throw from `queue.step` fails the plan (`wire-lane.ts` calls `lane.fail()`). The test exists (`golem/src/building/wire-lane.test.ts`, BLD-fix1c).
6. BLD-23: the `plan_progress` presenter is merged, but `status.active_plan` has no source (`threshold/mcp/src/world.ts` calls `statusTool` without `activePlan`).
7. `tools/repo-checks`: `nats-human-grants-nf.test.ts` and `scratch-human.test.ts` failed on the base worktree in BLD-38f's run. Not ours; not fixed here.
8. Many worknotes still say "Writing" or "Checks running" for merged packets; the ledger in README.md is the status source.
9. B8-fix6b left `plan_too_large` in `threshold/mcp/src/body-gateway.ts` (about lines 143 to 157), `threshold/mcp/src/ports.ts` (about line 128) and `threshold/mcp/src/plan-check-gateway.test.ts` (about lines 42 to 45). The fix removed it from the tool files only. These need a follow-up packet.
10. B8-fix6b: `MAX_INVALID_STEPS` = 256 truncates the `invalid_steps` list silently. The contract has no `maxItems` and no total count, and `docs/runbooks/building.md` and this file still describe the list. Owner or follow-up decision: add a total count to the contract, or accept the truncation.
11. B8-fix7: the stream path has no `NoResponders` fast-fail (publish does not report it). A `plan_check` to a Body that is not listening now fails after 5 s as a stall, not at once as unavailable. Flagged for the owner.
12. B8-fix6a: `cellsOf(rest())` in the active replace's format 1 `keep` still walks the rest of the plan synchronously when a store is set. Cursor drift during the replace awaits is accepted; the replace refuses only when the active entry changed.
13. B8-lazy7: `merge` picks the next cell by scanning the live steps (O(steps) per cell); no test covers a plan with thousands of steps. A sphere with a radius near 2e9 is not checked (`r*r` passes 2^53). The sphere row loop still runs O(radius) per layer for empty rows.
14. B8-fix12: no test covers the `inView` wiring in `wire-lane.ts` (the `viewFromBot` call and its throw fallback). `no_reference` and `state_unachievable` are not collapsed; the owner should rule on whether they say something about an unseen cell.
15. `status.active_plan` and the Glass feed remain unwired (items 6 above and the Known gaps list below).

## Known gaps and owner decisions

Factual list at `a72acaac`. Each item is a code gap or an owner call, or is marked Closed with the packet that closed it; none is fixed by the docs.

1. **Open (owner): oriented and facing blocks refused for every kind.** `FACING_VERIFIED` is empty (`golem/src/actions/place-state.ts`), so stairs take `half` only and doors, furnaces, chests and trapped chests take no state. A `facing` or `axis` key is refused as `state_unachievable`. BLD-08 tier 1 is unmet. The owner chose to ship without facing. Verify live later: the live test (`place.live.test.ts`) is written and not run.
2. **Open (owner): seen-map privacy for already-seen cells.** Nothing settles what the seen map may reveal about cells another agent saw. Owner decision.
3. **Open: NATS `seed` role cannot create `geldar-plans` or `geldar-seen`.** `seed-buckets.ts` creates only the identity buckets; the building buckets need the `body` role in the live conf before the flag-on restart. `geldar.ps1` has no entry for them.
4. **Closed (B8-cfg): prompt follows the flag.** The Mind renders body-api v12 (`break` and `plan`) while `body_actions.building` is on and v10 while it is off (`bodyApiVersionFor`, `animus/src/prompts/library.ts`). The Minds read the flag when they start. Eight animus tests (`animus/src/validate`, `animus/src/prompts`) were reported failing at `6fe2448b`; not re-run since.
5. **Closed (B8-cfg): colo lists `survey` and `plan_check` while the flag is on.** `shards/colo-mind.yaml` sets `show_unavailable_tools: false`; with `body_actions.building` on, the MCP lists `survey` and `plan_check` anyway (`hiddenToolsFor`, `threshold/mcp/src/tools/unavailable.ts`). Setting `show_unavailable_tools` to `true` would also list six other tools the world does not run (`write_book`, `define_skill`, `use_skill`, `offer`, `propose`, `vote`).
6. **Sources not wired.** Glass plan-activity is merged with `PLAN_ACTIVITY_ENABLED = false` and no feed route. The seen predecessor has no source (open item 2). `status.active_plan` has no source (open item 6).
7. **Closed (B8-pcheck): cap on `plan_check`.** The 8192-cell cap (`PLAN_CHECK_CELL_CAP`, `plan_too_large`) is gone from the Body and the dry run streams. Still in code: the survey box is capped at 32768 cells (`box_too_large`, `SURVEY_MAX_CELLS`), a health bound. Decisions and the runbook say "no caps". The `invalid_steps` truncation is open (open item 10); `plan_too_large` leftovers are open (open item 9).
8. **Flag-off answers.** `survey` and `plan_check` answer `not_available` from the Body with the flag off; the MCP tool returns `body_unavailable`, not `not_available`.
9. **Open: `retainBlock` and `orderCells` are unwired.** `hazardAt` returns `retainBlock` and `orderCells` sorts falling blocks; neither is called from production. The stand, scaffold and hazard modules otherwise have a production caller behind the flag (BLD-09/10 wiring). Owner call on the 0428 wording (lava `retainBlock`; sand and gravel `orderCells`).
10. **Dig-safety still applies outside plans.** The refusal still runs in `unstick`, `unstick-up`, `pillar`, the escape ladder and stairs, and the reflex dig (decision 0428 limits the removal to `break`, `mine` and plans).
11. **Seen view cone is a constant.** `golem/src/perception/view/viewport.ts` sets `H_FOV` 90 and `V_FOV` 45 degrees. No `seen_fov` config key exists in golem, the contract or the shards.
12. **Closed (B8-lazy, B8-lazy7): eager plan expansion.** `golem/src/body/create-body.ts` takes the lane's cells from `createPlanSource` (`golem/src/building/wire-expand.ts`), which expands on read. The eager `createPlanExpand` is still in that file, unused by the Body. B8-lazy7 streams box, sphere, wall, line, place, replace and break layer by layer. Circle keeps one sorted outline index (O(radius)) and list keeps one sorted index of its cells (O(list)). Both are stated; neither has a cap.
13. **Closed (B8-inherit): inheritance writes marks wrongly.** The store round-trips the inherited bit through flush and reload (review-code-4 F6, reported at `6fe2448b`).
14. **Open: bot listeners not removed.** `wire-seen.ts` adds three `bot.on` listeners that `stop()` does not remove; each Body restart on the same bot adds more (review-code-4 F7, reported at `6fe2448b`).
15. **Metrics reach SigNoz only with `GELDAR_TELEMETRY_URL`.** Without it the series are computed and not pushed.
16. **Flag path for the node is unverified.** The runbook says the node checkout must carry the shard change; the mechanism (`colo-images.yml` paths, bind mount) is not verified here.
17. **Saved plans replay.** A stored plan has no expiry or cleanup, and it resumes when the flag goes back on.
18. **No live test has been run.** Every `GELDAR_IT=1` and `*.live.test.ts` case for this campaign is written and not run. This includes the NATS stream transport for `plan_check` (B8-fix7) and the Body cancel path, which are untested against a real server; only the live lane can cover them.
19. **Open: scaffold removal under the agent is unverified live.** B8-fix6a's F2 test proves only the queue-level `fresh` flag on a restored plan. It does not run a stand-port scaffold removal after a restart. Unit tests only.
20. **Open: active-plan replace still stores cells (format 1).** A replace keeps the cells, not only the placed keys; a placed-key filter needs a design first.
21. **Closed (B8-fix12): out-of-view cells report one code.** For `done_already`, `changed`, `blocked`, `unbreakable` and `no_tool`, a cell out of view at report time is counted as `changed`; in-view cells keep the detailed code. Open detail: item 14 of the open items.
22. **Closed (B8-fix7): `plan_check` streams progress.** The idle timer resets per chunk (5 s); a stall or failure sends a cancel on the same plan_check subject; no new subject or permission was added. The NATS stream transport is covered only by the live lane (item 18).
23. **Open: the 0424 addendum is a coordinator interpretation.** [0424](../../decisions/0424-seen-block-map.md) carries a dated "Interpretation, 2026-11-22, by the coordinator from the owner rulings; owner may overrule" section. It is not an owner decision. The owner must overrule or accept it.
24. **Open: animus library token-budget tests fail at base.** The animus prompt-library token-budget tests fail at `a72acaac`'s base (reported; not fixed here).
25. **Merge commits with the wrong trailer.** `2423825f`, `8bcd725f`, `a2dd9846`, `41d325a0` and `1602440e` carry `Co-Authored-By: Claude Haiku 5.5`. Not rewritten; no force.
26. **Main CI lint failure is pre-existing.** Biome `useTemplate` and `useIndexOf` fail in files outside this campaign.

## Manual steps

Owner and operator steps, in the order RESUME has always listed them. None has been run.

1. **NATS role for the building buckets (owner, by hand).** The `body` role needs `$KV.geldar-plans.>` and `$KV.geldar-seen.>` in the Pub list of the live conf, then a reload. Procedure: `docs/runbooks/nats-auth-inplace.md`; the runbook is in `docs/runbooks/building.md`.
2. **Bucket creation order.** Create `geldar-plans`, then `geldar-seen`, with an admin identity and default settings. Player Bodies and Adam's Body both create the buckets at start with the flag on, so this step must come before the flag-on restart.
3. **Image rebuild.** `golem/Dockerfile` copies `player-core` (BLD-38b2). Rebuild the golem image and verify it; neither has been done.
4. **BLD-31 flag (owner, Paper go-live).** Owner adds `building: true` under `body_actions` in `shards/colo-mind.yaml` (line 29), after steps 1 and 2. Then restart the Minds and the MCP. The go-live waits on the owner; BLD-29 test-shard evidence is not run.
5. **BLD-29 and BLD-31 (not run).** BLD-29 (test-shard evidence) is manual and not run. BLD-31 (Paper go-live) is manual and not run.
6. **BLD-28 live test (not run).** `GELDAR_IT=1` on the test shard.
7. **BLD-25 kit tag and upgrades (manual).** Kit PR 137 is merged in the kit repo. Its tag and the per-player upgrades are manual and not run; the kit session tracks them.
8. **Owner decision pending: animus change (body-api v12 selection).** When the flag is on, the choice of body-api v12 is made in animus code (`bodyApiVersionFor`, `animus/src/prompts/library.ts`). The owner has questioned whether animus is the live Mind; the live Mind is the scriptorium. Decision: revert the animus change or keep it. If animus is not live, selecting v12 is a manual scriptorium step. This packet does not decide it.

## Next steps
1. Run the reviews for the merged packets, starting with BLD-26 and the BLD-38 family, and the B8 packets (open item 1).
2. Decide the predecessor source for the next life (owner question; the seen map inheritance depends on it).
3. Owner: the NATS role for both building buckets (manual step 1), before the flag-on restart.
4. Owner: decide known gaps 1, 2, 9, 19 and 20 (facing, seen privacy, hazard retaining block and ordering, scaffold removal, active-plan replace), and the 0424 addendum (known gap 23).
5. Run BLD-28 (`GELDAR_IT=1`) on the test shard, then BLD-29 evidence; BLD-31 go-live waits on the owner.
6. Kit half: BLD-25 tag and upgrades are manual; the kit session tracks them.
7. NeoForge: owner settles 0387 and 0390 before BLD-32 can start.
8. Erasure (B8): erasing a life also removes its bare `<life_id>` body checkpoint in `geldar-checkpoints` (`tools/players-cli/src/erase-building.ts`). Test-covered; the runbook line is in `building.md`. B8-fix6b also erases `<life>.inflight` checkpoint keys.

### Config lines that change (B8)

| File and line | What changes | Manual? |
| --- | --- | --- |
| `animus/src/prompts/library.ts` (`BUILDING_BODY_API_VERSION`, `bodyApiVersionFor`) | The Mind renders body-api v12 while the flag is on, v10 while off. `DEFAULT_BODY_API_VERSION` stays 10. `BUILDING_BODY_API_VERSION` stays 12; no v13. Owner decision pending (manual step 8). | No (code). Restart the Minds after the flag changes. |
| `animus/src/main.ts`, `animus/src/config.ts` (`buildingOn`) | Reads `body_actions.building` from the shard file. | No (code). |
| `threshold/mcp/src/tools/unavailable.ts`, `config.ts`, `main.ts`, `world-session.ts` | `survey` and `plan_check` listed while `body_actions.building` is on, even with `show_unavailable_tools: false`. | No (code). Restart the MCP. |
| `contract/schemas/mcp-survey.schema.json` (survey description) | One sentence added on the `@<minutes>` mark and the trailing `i` flag (B8-prompt2). Generated files regenerated. | No (code and generated). |
| `shards/colo-mind.yaml` line 63, `show_unavailable_tools: false` | Unchanged. Not needed for survey and plan_check now. | No edit. |
| `shards/colo-mind.yaml` line 29, `body_actions` | Not changed here. Owner adds `building: true` at go-live (BLD-31). | Yes, manual, after the NATS steps. |
| Live NATS conf, `body` role Pub list | Add `$KV.geldar-plans.>` and `$KV.geldar-seen.>`, then reload. | Yes, manual (`nats-auth-inplace.md`, MANUAL create order). |
| Live NATS buckets `geldar-plans`, `geldar-seen` | Create in that order, with an admin identity, default settings. | Yes, manual. |
| `tools/players-cli/src/erase-building.ts` | Erasure also removes the bare `<life_id>` body checkpoint and `<life>.inflight` keys. | No (code). |
