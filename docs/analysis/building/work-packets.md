# Building campaign: work packets

Ledger: [README.md](README.md). Rules: decisions [0420](../../decisions/0420-agents-build-and-break-freely-in-survival.md) to [0427](../../decisions/0427-delete-the-dead-inline-build-action.md). Written 2026-11-22 against `origin/main` = `c05574a6`. Line numbers below come from the research reports and were not all re-read: a coder finds code by symbol name, not by line.

## Dispatch rules

1. One packet, one `packet-coder`, one worktree `../geldar-wt-bld-NN` from the wave branch `phase1/building-wave<N>` (branch `phase1/bld-NN-<slug>`). Commit trailers, verbatim: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and the `Claude-Session:` line the orchestrator gives.
2. Each packet is under about 40k working tokens. A packet that reads over 12 items is split before dispatch.
3. Inlined repo rules (the coder skips CLAUDE.md): change `contract/schemas/*`, never `contract/src/generated/*` (regenerate with `./geldar.ps1 pnpm --filter @geldar/contract generate`, commit the output, verify with `check:generated`); files soft cap 500 lines, hard 700 (JSON and TOML count, Markdown does not); LF endings; no secrets, account names or IPs; pin exact versions two weeks old (these packets add no dependency); prompt changes are a new file in `prompts/`, never an edit of a released one; a behavior change needs a test that fails when the change is reverted (the coder reverts the change and runs the test once).
4. Checks, in order, per package touched: `./geldar.ps1 pnpm lint`, `./geldar.ps1 pnpm --filter <pkg> typecheck`, `./geldar.ps1 pnpm --filter <pkg> test`; a contract change adds `check:generated`. No full local `./geldar.ps1 check` (CI runs it). Live tests, Docker and the shard are never run by a coder; ops runs them serially.
5. **Colo-images restarts.** A merge to `main` that touches `golem/**`, `contract/**`, `player-core/**`, `threshold/mcp/**`, `eventsink/**`, `animus/**`, `supervisor/**`, `sql/**`, `shards/phase0.yaml` or the other paths of `.github/workflows/colo-images.yml` restarts all 19 Bodies. Test-only paths (`golem/test/**`, `**/*.test.ts`) do not. Tell geldar-93 before each merge window; the packets are batched into three windows (R1, R2, R3) below. Correction to the research report: `contract/**` IS a colo-images path, so a contract-only merge restarts Bodies too.
6. **Manual steps** are marked MANUAL; a coder never performs them. New KV buckets (BLD-05, BLD-18) need the Body NATS role to be allowed to create and use them: that is a manual change under `docs/runbooks/nats-auth-inplace.md`, plus a bucket seed step. Enabling `body_actions.building` is a node config change.
7. Every cell failure code comes from the shared list below. There is no `protected` code (0420).
8. Principle: the Body never receives a server command for building. Any packet that adds `/fill`, `/setblock`, creative mode, operator status or a bulk world edit is wrong.

## Shared contract (names the packets build against)

- Action `{do:"break", at:{x,y,z}}` (0421). Action `{do:"plan", op:"add"|"replace"|"cancel", plan_id, ...}`:
  - `op:add|replace` fields: `palette` (map key to `{block, state?}`), `steps` (array of step objects), `origin` (Position or `"here"`, resolved once at add time; steps are absolute or relative to it), `final` (boolean, default true; false lets a plan arrive in several `act` calls), `seq` (integer, order of chunks), `order` (`bottom_up` default | `given`).
  - Step objects: `{op:"place",pal,at}`, `{op:"break",at}`, `{op:"replace",pal,at}` (break then place), and geometry helpers `{op:"box"|"hollow_box",pal,from,to}`, `{op:"line",pal,from,to}`, `{op:"wall",pal,from,to,height}`, `{op:"circle",pal,center,radius,axis}`, `{op:"sphere",pal,center,radius,hollow}`, `{op:"list",pal,cells:[[x,y,z],...]}`, each with an optional `break:true` form. No maximum on counts (0423); the only bounds are integer coordinates inside the border and the 32 KiB per thought text cap, which chunked upload (`final`, `seq`) avoids.
  - `op:cancel`: `plan_id` or `"all"`.
- Cell failure codes: `done_already`, `changed` (stale), `blocked`, `no_reference`, `out_of_reach`, `not_loaded`, `missing_materials`, `no_tool`, `unbreakable`, `state_unachievable`, `timeout`, `refused`.
- Event `plan_progress`: `{plan_id, total, done, placed, broken, skipped_by_code{}, phase, next_need?:{block,count}}`; no unseen-block data; sample indexes are the plan's own cell numbers.
- MCP tools (free, rate limited like `see`): `survey {box, layers?}` and `plan_check {plan}`; `status` gains an `active_plan` block. While the flag is off the Body answers `not_available` and the agent sees a tool error `body_unavailable`; the MCP does not read the flag. On colo the two tools are also hidden by `show_unavailable_tools: false` in `shards/colo-mind.yaml`, which hides six unavailable tools (`threshold/mcp/src/tools/unavailable.ts`). (Corrected 2026-11-22 to the code at `building/integration` d87221c4.)
- Dig-safety refusals (falling column, liquid, walled-in) are removed for `break`, plan and `mine` (0428, BLD-36); deaths are part of the experiment. Only physically impossible refusals remain: `out_of_reach`, `unbreakable` (bedrock and the like), `not_loaded`, `no_tool`.
- Survey reply (the next life's read includes the predecessor's inherited map, 0424; inherited runs carry their last-seen ages and an `inherited` mark): layers by Y, each a list of run-length rows over a legend `{key: block name}`, a last-seen age per run in game minutes, the key `unknown` for any cell not seen. No owner field.
- Flag: `body_actions.building`, default false, plumbed like `body_actions.use` (decision 0218: `golem/src/body/create-body.ts` options, `golem/src/adam/adam-config.ts`, the shard config files, the MCP flag read).
- KV buckets: `geldar-plans` (key `<life_id>.<plan_id>.<seq>`, value at most 64 KiB), `geldar-seen` (key `<life_id>.<sx>.<sy>.<sz>`, a 16-cube section). The running cursor lives in the existing `geldar-checkpoints` entry.

## Restart windows

| Window | Waves | Why one window | MANUAL |
|---|---|---|---|
| R1 | 0, 1 and 2 (incl. BLD-36) | contract, validator, pure libraries and cell code, all dormant (flag off, lane unregistered) | none |
| R2 | 3 and 4 | lane, seen map, the Body survey endpoint; flag still off | NATS role for `geldar-plans` and `geldar-seen` in the live conf (BLD-05, BLD-18) before the flag goes on; the Body creates the buckets itself, there is no seed step |
| R3 | 5 (BLD-21 to 23), BLD-26, BLD-27, BLD-37 | MCP tools, descriptions, metrics, the Glass plan-activity view (`glass/**`) | none; prompts (BLD-24) and kit (BLD-25) do not restart Bodies |

Paper go-live (BLD-31) is a config flip plus one restart, after R3 and the quality packets. Nothing needs a Paper plugin or jar: there is no enforcement (0420), and recording already exists.

---

## Parallelism and file ownership (owner requirement, binding)

Goal: after one small serial gate (Wave 0), every other packet creates or edits only files that no other packet touches, so many worktrees run at once and merge without conflict.

### Shared files found, and how Wave 0 removes each

| Shared file or output | Who would collide | Wave 0 fix |
|---|---|---|
| `contract/schemas/thought.schema.json`, `event.schema.json`, `mcp-play.schema.json`, `program-shapes.schema.json` | BLD-01, 02, 23, 26 | S1 adds one `$ref` line each, once; every verb, event and tool shape lives in its own new file (`action-break`, `action-plan`, `build-plan`, `plan-progress-event`, `mcp-survey`, `mcp-plan-check`). No later packet edits these four files except the two named in the generated-code rule. |
| `contract/src/generated/*` | every contract change | Regenerated once, in S1. Rule below. |
| `player-core/src/validate/bounds.ts` (`PHASE0_VERBS`), `action-shapes.ts`, `thought-output.ts` | BLD-03 | S2 makes the whole validator change (both verbs, shapes, range check) against S1's shapes. BLD-03 is delivered by S2. |
| `golem/src/actions/index.ts`, `registry.ts` | BLD-06, 07, 08, 13 | S3 registers `break` and `plan` once, with stub handlers that refuse while the flag is off; BLD-06 and BLD-14 then replace only the stub bodies in their own files. |
| `golem/src/body/create-body.ts`, `restart.ts`, `wake.ts`, `golem/src/metrics.ts` | BLD-13, 14, 16, 27 | S3 adds one inert hook line each (`createPlanLane(flag)` returns null when off; `resumePlanLane` no-op; the wake reason and the metric names pre-reserved in `golem/src/building/names.ts`). Later packets fill `building/*` modules and never edit these files. |
| `golem/src/seed-buckets.ts`, `docs/runbooks/nats-auth-inplace.md` | BLD-05, 18 | S3 declares both bucket names and the seed lines; the runbook gets one paragraph in S4. |
| Account-erasure path and its coverage test | BLD-18 | S3 lists `geldar-seen` and `geldar-plans` in the erase coverage list (a test marked pending until BLD-18 fills the store). |
| `threshold/mcp` tool registry, `unavailable.ts`, `events/mapper.ts`, `status` projection, `body-gateway.ts` | BLD-20, 21, 22, 23 | S3b registers stub tools `survey` and `plan_check` (hidden while the flag is off), the `plan_progress` mapper entry pointing at a stub handler file, an `active_plan` projection stub file and the gateway message names. Later packets replace stub bodies in their own files. |
| Pure plan library imported by both golem and MCP | BLD-04, 22 | Lives in `player-core/src/building/` from the start (S2 creates the stubs), so BLD-22 never moves files. |
| `prompts/body-api/*`, `prompts/README.md` | BLD-24 | One owner (BLD-24 creates `v12.json` and its row). |
| Kit repo files, `template/.claude/settings.json` | BLD-25 | One owner. |
| `docs/decisions/README.md`, `0349` status line | BLD-06 | S4 (the orchestrator-owned docs scaffold) edits both, once. |
| Ledger, `README.md` packet table | every packet | Only the orchestrator edits `README.md`. Each packet writes its status to its own `worknotes/BLD-NN.md` (stubs exist in this commit). No shared append-only file. |
| Test fixtures and goldens | BLD-04, 11, 17, 20, 28 | Each packet owns `.../fixtures/<packet>/` and its own `*.test.ts`; no shared golden. |
| Flag key `body_actions.building` | BLD-03, 17, 21 | Declared once in S1 (schema) and S3 (plumbing, default off). |
| `glass/**` registry | BLD-37 | S3c adds the one registry line; BLD-37 owns `glass/src/plan-activity/**`. |
| `golem/src/actions/dig-safety.ts`, `mine.ts` | BLD-06, 10, 36 | BLD-36 alone edits them; BLD-06 and BLD-10 import nothing from dig-safety. |
| Plugin config | none | No plugin change in this campaign (0420). |

### Wave 0: scaffold (the only serial gate)

All five packets (S1, S2, S3a, S3b, S3c, S4: six counting S3c) are S or M, disjoint, and run in parallel; they merge into the integration branch `phase1/building` in the order S1, then S2, S3, S4 (S2, S3a, S3b and S3c import S1's generated types). Dormant: flag off, stubs refuse or return null.

#### BLD-S1 Contract scaffold (absorbs BLD-01 and BLD-02)
- Size S to M (it carries the full shapes of BLD-01 and BLD-02 below, but no behavior). Restarts: Y when it reaches main. Branch `phase1/bld-s1-contract`; commit `BLD-S1: contract shapes for break, plan, plan_progress, survey and plan_check`.
- Files: the six new schema files and the four one-line `$ref` edits and the flag key; `contract/test/*` per new file; regenerated `contract/src/generated/*` (the only regeneration of the campaign's main run).
- The sections BLD-01 and BLD-02 below are the content spec for this packet.

#### BLD-S2 Validator and pure-library stubs (absorbs BLD-03; stubs for BLD-04)
- Size S to M. Branch `phase1/bld-s2-validator`; commit `BLD-S2: validate break and plan; player-core building library stubs`.
- Files: `player-core/src/validate/bounds.ts`, `action-shapes.ts`, `thought-output.ts` (once); `player-core/src/building/{expand,geometry,order,tally}.ts` each exporting the typed interface and throwing `not_implemented`; `player-core/src/building/index.ts`; the validator tests. BLD-03's section is the content spec.

#### BLD-S3 Body and MCP scaffold
- Size M (split in two coders if it passes 40k: S3a Body, S3b MCP). Branch `phase1/bld-s3a-body`, `phase1/bld-s3b-mcp`.
- S3a files: stub modules, each exporting the agreed names and signatures and throwing `not_implemented`: `golem/src/building/{plan-store,plan-checkpoint,cell-do,materials,stand,scaffold,hazards,lane,lane-state,queue,contention,throttle,progress}.ts`, `golem/src/building/seen/{recorder,section,store,survey}.ts`, `names.ts` (event, metric, wake and bucket names), `index.ts`; the registry lines for `break` and `plan` with refusing stub handlers `golem/src/actions/break.ts` and `golem/src/building/queue-action.ts`; the inert hooks in `create-body.ts`, `restart.ts`, `wake.ts`, `metrics.ts`; the flag plumbing (default off); `seed-buckets.ts` lines; the erase coverage list.
- S3b files: `threshold/mcp/src/tools/survey.ts`, `plan-check.ts` (stubs), registry and `unavailable.ts` entries, `events/mapper.ts` entry and `events/handlers/plan-progress.ts` stub, `play-view/active-plan.ts` stub, the `body-gateway.ts` message names.
- Tests: with the flag off every stub verb is refused with the one neutral message; every stub module is imported by an `index` test; revert any registration line and that test fails.

#### BLD-S3c Glass scaffold
- Size S. Branch `phase1/bld-s3c-glass`; commit `BLD-S3c: Glass plan-activity registry stub`. Restarts: Y (`glass/**`).
- Files: one registry line in the Glass page or tab registry (find it from decisions 0410 and 0411) and a stub module `glass/src/plan-activity/index.ts` that renders nothing and is off by default; BLD-37 fills only files under `glass/src/plan-activity/`. Test: the registry lists the stub and renders nothing while off.

#### BLD-S4 Docs scaffold
- Size S. Branch `phase1/bld-s4-docs`. Files: `docs/decisions/README.md` rows (0420 to 0427, once; this commit already adds them: S4 only verifies), the status line of 0349, the nats-auth paragraph. May be done by the orchestrator in this commit chain; counts as done when verified.

### Generated-code rule

Only Wave 0 (S1) regenerates `contract/src/generated/*`. Two later packets change the contract: BLD-23 (the `act` description) and BLD-26 (delete the inline action). They edit different files (`mcp-play.schema.json` and `thought.schema.json`) but regenerate the same output, so they merge in a fixed order, BLD-23 first, BLD-26 second; BLD-26 regenerates after merging the integration branch in. A coder who needs another contract change stops and asks: the answer is a new schema file in the scaffold, not an edit.

### Dependency graph and width

```
Wave 0:  S1 -> (S2 || S3a || S3b || S3c || S4)                              width 5
Wave 1:  BLD-04 || BLD-05 || BLD-06 || BLD-07 || BLD-08 || BLD-09 || BLD-10 || BLD-12 || BLD-17 || BLD-36   width 10
Wave 2:  BLD-11 (needs 06-10) || BLD-18 (needs 17) || BLD-24    width 3
Wave 3:  BLD-13 (needs 04,05,11) || BLD-20 (needs 17)                      width 2
Wave 4:  BLD-14 || BLD-15 || BLD-16 (all need 13) || BLD-19 (needs 17,20) || BLD-21 (needs 20)   width 5
Wave 5:  BLD-22 (needs 04,20,21) || BLD-23 (needs 16) || BLD-27 (needs 16) || BLD-30 (needs 14)  width 4
Wave 6:  BLD-25 (kit; needs 21-23) || BLD-28 (integration test, needs all code) || BLD-37 (Glass; needs S3c, 27, 16) || BLD-26* (needs 23; owner side unblocked)   width 4
Wave 7:  BLD-29 evidence, then BLD-31 go-live
NeoForge: BLD-32 may start in Wave 1 (docs only, BlockedDecision), 33 after 32, 34 after 32 is accepted, 35 last
```
\* BLD-26 is also BlockedDecision (0427) and merges after BLD-23.

The wave numbers below (Wave 1 to Wave 7 headings) are topic groups, not the merge order: the graph above is the schedule. Dependencies stated in each packet stay valid.

### File ownership (zero overlap; a packet may touch only its row)

| Packet | Exclusive files (create or edit) |
|---|---|
| S1 | the six new schema files, the four `$ref` lines, `contract/test/*` for them, `contract/src/generated/*` |
| S2 | `player-core/src/validate/{bounds,action-shapes,thought-output}.ts`, `player-core/src/building/index.ts`, stub files there |
| S3a | `golem/src/building/**` stubs, `golem/src/actions/{index,registry}.ts` lines, `create-body.ts`, `restart.ts`, `wake.ts`, `metrics.ts`, `seed-buckets.ts`, erase coverage list |
| S3b | `threshold/mcp/src/{tools,events,play-view,body-gateway}` stub files and registry lines |
| S3c | `glass/src/plan-activity/index.ts` stub and one Glass registry line |
| BLD-36 | `golem/src/actions/dig-safety.ts` and its call sites in `mine.ts` and `mine-cell.ts` (not goto tier-2), their tests |
| BLD-37 | `glass/src/plan-activity/**` (own files only), its tests |
| S4 | `docs/decisions/README.md`, `0349` status, nats-auth paragraph |
| BLD-04 | `player-core/src/building/{expand,geometry,order,tally}.ts` and their tests and `fixtures/bld-04/` |
| BLD-05 | `golem/src/building/{plan-store,plan-checkpoint}.ts` (+ tests, fakes) |
| BLD-06 | `golem/src/actions/break.ts`, `break.test.ts` (imports no dig-safety; BLD-36 owns that module) |
| BLD-07 | `golem/src/actions/place.ts` (REPLACEABLE), `place-footprint.ts`, tests |
| BLD-08 | `golem/src/actions/place-state.ts`, and the single `placeState` option line in `place.ts` (BLD-07 edits another region of `place.ts`: the two packets are ordered, see check rule) |
| BLD-09 | `golem/src/building/stand.ts`, tests |
| BLD-10 | `golem/src/building/{scaffold,hazards}.ts`, tests |
| BLD-11 | `golem/src/building/{cell-do,materials}.ts`, tests |
| BLD-12 | `golem/src/perception/provenance/` property-break rule and test |
| BLD-13 | `golem/src/building/{lane,lane-state}.ts`, tests |
| BLD-14 | `golem/src/building/{queue,queue-action,contention}.ts`, tests |
| BLD-15 | `golem/src/building/throttle.ts`, tests |
| BLD-16 | `golem/src/building/progress.ts`, tests |
| BLD-17 | `golem/src/building/seen/{recorder,section}.ts`, tests |
| BLD-18 | `golem/src/building/seen/store.ts`, tests, the erase coverage test body |
| BLD-19 | `golem/src/building/seen/leak.test.ts`, `tools/repo-checks/src/{seen-fence,plan-activity-fence}.ts` and tests |
| BLD-20 | `golem/src/building/seen/survey.ts`, tests |
| BLD-21 | `threshold/mcp/src/tools/survey.ts` and test |
| BLD-22 | `threshold/mcp/src/tools/plan-check.ts` and test |
| BLD-23 | `threshold/mcp/src/events/handlers/plan-progress.ts`, `play-view/active-plan.ts`, `mcp-play.schema.json` description (+ generated), the pin test |
| BLD-24 | `prompts/body-api/v12.json`, `prompts/README.md` row, its test |
| BLD-25 | kit repo only |
| BLD-26 | `thought.schema.json` (`build` removal), `limits.ts` build line, generated, tests naming it |
| BLD-27 | `golem/src/building/metrics.ts` (a new file called by the S3a hook), eventsink plan handler, `docs/runbooks/progress-metrics.md` |
| BLD-28 | `golem/test/live/building*.test.ts` |
| BLD-29 | `worknotes/BLD-29-evidence.md` |
| BLD-30 | `docs/runbooks/building.md`, runbooks index row |
| BLD-31 | none (ops steps) |
| BLD-32 to 35 | their own docs; BLD-34 `neoforge/src/**` new files only |

Where a packet section below lists a shared file (for example `create-body.ts` for BLD-13, or `limits.ts` and the registries in BLD-03), the scaffold has already made that edit and the packet must not touch it. The ownership table wins over a section's Files line.

### Conflict check procedure (no script)

Before dispatching a wave, ops runs for each packet branch: `git merge-tree --write-tree origin/phase1/building <packet-branch>`; any conflict stops that dispatch. After each packet returns, ops repeats it against the current integration branch, then merges with `--no-ff`. Ops also runs `git diff --name-only origin/phase1/building...<packet-branch>` and compares the list with the ownership row: a file outside the row is sent back to the coder. Order rule for the one shared file, `place.ts`: BLD-07 merges before BLD-08.

### Merge order versus deploy windows

Packets merge into the integration branch `building/integration` (the name in use; the older `phase1/building` is not used) as they finish, in any order that the checks above allow; nothing deploys from there. The integration branch merges to `main` only at the windows: R1 after Wave 0 and Wave 1 are merged (all dormant), R2 after Wave 3 and 4 code, R3 after the MCP packets. Work is never serialised by a window.

## Wave 1: contract, validator and pure libraries (R1, dormant)

(Topic group. BLD-01, BLD-02 and BLD-03 are delivered by scaffold packets S1 and S2; their sections below are the content specs for them. BLD-04 and BLD-05 run in Wave 1 of the graph.)

### BLD-01 Contract: `break`, `plan`, `plan_progress`, the flag
- Size S. Restarts Bodies: Y (contract/**, window R1). Depends: none. Unblocks BLD-03 to BLD-16.
- Branch `phase1/bld-01-contract-actions`; worktree `../geldar-wt-bld-01`; commit `BLD-01: contract shapes for break, plan and plan_progress`.
- Files: `contract/schemas/thought.schema.json` (Action variants `break` and `plan`; do not touch `build`), new `contract/schemas/build-plan.schema.json` (palette, step shapes, the geometry helpers, typed like `program-shapes.schema.json`, decision 0344, every shape rejects an unknown key), new `contract/schemas/plan-progress-event.schema.json`, `contract/schemas/event.schema.json` (add the event), the shard-config flag in `contract/schemas/shard-config.schema.json` if `body_actions` is defined there (find where `use` is declared and mirror it), `contract/test/build-plan.test.ts`, regenerated `contract/src/generated/*`. Guide: `docs/runbooks/add-a-contract-schema.md`.
- Tests that fail on revert: accept and reject tables (valid break, negative y inside -64..320, unknown key, `final:false` without `seq`, a step with an unknown `op`); `agent-visible-text.test.ts` stays green (no coordinates or owner text in agent text).
- Checks: lint, contract typecheck, contract test, `check:generated`.

### BLD-02 Contract: survey, plan_check, status block
- Size S. Restarts: Y (R1). Depends: BLD-01.
- Branch `phase1/bld-02-contract-read-tools`; commit `BLD-02: contract shapes for survey, plan_check and the status plan block`.
- Files: `contract/schemas/mcp-world.schema.json` or a new `contract/schemas/mcp-survey.schema.json` (follow how `mcp-view.schema.json` and `mcp-see.schema.json` are split), the `status` schema where it lives, `contract/test/survey-shape.test.ts`, regenerated code. Tool descriptions say only what the tool does (no mention of recording, 0424).
- Tests: a survey reply with an owner field is rejected; an `unknown` run is valid; a reply over the size bound is rejected (bound: 6000 characters, as `view` uses 4000).
- Checks: as BLD-01.

### BLD-03 Validator: verbs, shapes, flag plumbing (off)
- Size M. Restarts: Y (player-core, golem; R1). Depends: BLD-01.
- Branch `phase1/bld-03-validator`; commit `BLD-03: validate break and plan actions; building flag, default off`.
- Files: `player-core/src/validate/bounds.ts` (`PHASE0_VERBS` gains `break`, `plan`), `player-core/src/validate/action-shapes.ts` (the `ACTION_FIELDS` table; its test asserts the table equals `PHASE0_VERBS`), `player-core/src/validate/thought-output.ts` (position range check for `at`, as `place`), the border rule for plan coordinates (border radius plus 16, as today), `golem/src/body/limits.ts` (`break` costs 1; `plan` costs 0 because the lane is not an intent), the flag plumbing (`create-body.ts`, `adam-config.ts`, `shards/*.yaml` default false), `threshold/mcp/src/tools/unavailable.ts` entries land in BLD-21.
- Tests: `break` accepted with the flag on and refused (`not_allowed`) off; a plan with a coordinate beyond the border refused; the table-equals test; a limits test (`break`=1). Revert any one: a test fails.
- Checks: lint, typecheck and test for player-core and golem.

### BLD-04 Plan library (pure)
- Size M. Restarts: Y (golem; R1). Depends: BLD-01.
- Branch `phase1/bld-04-plan-library`; commit `BLD-04: pure plan expansion, geometry helpers and ordering`.
- Files (new, no mineflayer import): `player-core/src/building/expand.ts` (steps to cells; location set by S2, see ownership table), `player-core/src/building/geometry.ts` (box, hollow box, line, wall, circle, sphere, list; deterministic cell order), `player-core/src/building/order.ts` (bottom-up, outward from an anchor, break top-down; falling blocks last bottom-up), `player-core/src/building/tally.ts` (cells to material counts), plus a `.test.ts` per file. Expansion is lazy (an iterator with a cursor) so a million-cell plan never materialises.
- Tests: golden cell lists for each helper (a 3x3x3 hollow box has 26 cells; a radius-2 circle on an axis); the order test (support before supported, top-down breaks); the lazy test (expanding a 1,000,000-cell box and taking 10 cells allocates no more than a bounded array); resume from a cursor yields the same tail.
- Checks: lint, golem typecheck, `--filter @geldar/player-core test building`.

### BLD-05 Plan store: chunked KV and cursor checkpoint
- Size M. Restarts: Y (golem; R1). Depends: BLD-01. MANUAL: bucket seed and NATS role (R2 prerequisite, not in this packet).
- Branch `phase1/bld-05-plan-store`; commit `BLD-05: chunked plan storage under the KV value limit`.
- Files: `golem/src/building/plan-store.ts` (add chunks, read a chunk, delete a plan, the interface `PlanKv` with a fake in `golem/src/building/plan-store.fakes.ts`), `golem/src/building/plan-checkpoint.ts` (cursor, counts, skipped summary under 4 KiB; reuses `body/checkpoint.ts` patterns: background, coalesced, retried), `golem/src/seed-buckets.ts` (add `geldar-plans` to the seed, test updated), docs line in `docs/runbooks/nats-auth-inplace.md` naming the permission to add.
- Tests: a plan of one million cells in chunks has no value over 64 KiB (this is the 1 MB risk test of 0423); a chunk lost in the middle makes the plan `failed: store`, not a silent partial; delete leaves no key; a checkpoint over 4 KiB is refused in the test (the summary truncates and counts the dropped).
- Checks: lint, golem typecheck, golem test.

### BLD-36 Remove the dig-safety refusals
- Size S. Restarts: Y (R1). Depends: S3a. Owner ruling 2026-11-22 (decision 0428).
- Branch `phase1/bld-36-dig-safety-off`; commit `BLD-36: mine and break no longer refuse falling columns, liquid or walled-in cells`.
- Files: `golem/src/actions/dig-safety.ts` (find `digSafetyRefusal` and its callers by symbol: `mine.ts`, `mine-cell.ts`, the `mineAt` path), `dig-safety.test.ts`, the tests of `mine` that expect those refusals. Delete the refusal for falling-block stacks overhead, liquid touching the cell and walled-in cells, and the "would drop you" refusal for the block under the feet in `mine`, `mineAt` and so `break` (owner ruling 2026-11-22, listed explicitly; a test digs the block under the feet and the agent falls). Keep the helpers (`isFalling`) that ordering code reads. Keep refusals that are physically impossible: out of reach, unbreakable (bedrock, barrier, `diggable === false`), unloaded chunk, no reachable stand. Goto tier-2 pathing rules (decision 0164) are unchanged; flag in the PR that the owner scoped this to plan, `break` and `mine`.
- Tests that fail on revert: a gravel column overhead is dug and the agent takes the fall; a block next to water is dug; a walled-in cell is dug; bedrock still refuses (`unbreakable`); restoring the refusal fails the first three.
- Checks: golem typecheck and test.

## Wave 2: Body cell operations (R1, dormant)

Fan-out: BLD-06, 07, 08, 09 and 10 run side by side (they touch different files); BLD-11 integrates and owns the shared interface (`cell-do.ts`).

### BLD-06 The `break` action
- Size M. Restarts: Y (R1). Depends: BLD-01, BLD-03.
- Branch `phase1/bld-06-break-action`; commit `BLD-06: break action digs one named cell`.
- Files: new `golem/src/actions/break.ts` (reuse the `mineAt` path in `mine.ts` and `mine-cell.ts`; typed reasons from 0421), register in `golem/src/actions/index.ts` and `registry.ts`, `golem/src/actions/break.test.ts`, `docs/decisions/0349-a-program-mines-one-exact-cell.md` status line becomes `Superseded by 0421` and its README row (only that line). No ownership check: do not import `protected-blocks.ts` or the block-owner cache.
- Behavior: refuse when the flag is off (`not_possible: building is off`); walk within reach (existing `moveNear`, tier-1, no digging); equip the best tool (`bestHarvestTool`); dig; verify the cell is air; walk onto the drop and pick it up (existing pickup constants).
- Tests: breaks the named cell and not the nearest of its kind; refuses bedrock (`unbreakable`); digs a block with lava or a falling column next to it without refusal (0428); an out-of-reach cell walks then breaks; a cell owned by another player IS broken (this test pins 0420: reverting to a gate fails it).
- Checks: lint, golem typecheck and test.

### BLD-07 Place: wider replaceable set and two-block items
- Size S. Restarts: Y (R1). Depends: BLD-03.
- Branch `phase1/bld-07-place-replaceable`; commit `BLD-07: place into plants and snow; doors and tall plants as one cell`.
- Files: `golem/src/actions/place.ts` (`REPLACEABLE`: add flowers, dead bush, vines, seagrass, glow lichen, other tall and short plants, snow layers; not lava, not any solid block; confirm the replaced-plant case does not produce a drop-pickup loop), a two-block footprint helper `golem/src/actions/place-footprint.ts` (doors, beds, tall plants), `place.test.ts` cases. Existing `place` behavior elsewhere unchanged.
- Tests: place into a poppy cell succeeds; into lava stays `blocked`; a door places both halves and the cell reads `done_already` on the second pass; reverting the set fails the poppy test.
- Checks: as BLD-06.

### BLD-08 Place: blockstate and orientation
- Size M. Restarts: Y (R1). Depends: BLD-03.
- Branch `phase1/bld-08-place-state`; commit `BLD-08: place with facing, axis and half`.
- Files: `golem/src/actions/place.ts` and new `golem/src/actions/place-state.ts`: a program-only run option `placeState` (the pattern of `mineAt` in decision 0349: not an agent field of the `place` action), choosing the reference face, the look yaw and pitch and the cursor height; verifying with the block's properties; tiers T1 (axis for logs and pillars, facing for stairs, doors, furnaces, chests; as built on 2026-11-22, facing is refused for every kind: `FACING_VERIFIED` is empty in `place-state.ts`, so this tier is NOT met, see the README ledger) and T2 (slab top or bottom, stair half); a corner stair shape is server-derived and is not forced. Unachievable property gives `state_unachievable`; the cell is not left wrong silently: the block is placed only if the achieved state matches, else not placed.
- Tests: fakes in `place.fakes.ts` model the click-to-state rule; log axis x, stair facing and half, slab top; an unachievable state is skipped with the code; revert test: remove the yaw choice and the facing test fails.
- Checks: as BLD-06.

### BLD-09 Standing-position solver
- Size M. Restarts: Y (R1). Depends: BLD-04.
- Branch `phase1/bld-09-stand-solver`; commit `BLD-09: choose a standing cell within reach and sight for a batch of cells`.
- Files: new `golem/src/building/stand.ts` (inputs: a batch of cells, a world read function; output: a stand cell, or `none`; the stand cell is not inside any batch cell, has solid floor, 2 free cells, is within reach 4.5 and line of sight of each target, prefers fewer moves, avoids liquid and the cell under a falling column), `stand.test.ts` with a synthetic world.
- Tests: three cases (open field, a wall that blocks sight from one side, a 1-wide corridor); a batch with no valid stand returns `none` and the caller defers (the test pins the return, not the walk); reverting the sight check fails the wall case.
- Checks: lint, golem typecheck and test building.

### BLD-10 Scaffolding, support and falling or fluid handling
- Size M. Restarts: Y (R1). Depends: BLD-04, BLD-09.
- Branch `phase1/bld-10-scaffold-hazards`; commit `BLD-10: scaffold, support and falling-block and fluid rules for the plan lane`.
- Files: `golem/src/building/scaffold.ts` (when no stand cell exists, pillar up or bridge with the agent's own cheapest placeable block, as a human would; remove it afterwards if it blocks the plan), `golem/src/building/hazards.ts` (ordering mechanics only, never a refusal (0428): place sand and gravel bottom-up and break top-down where that keeps the work possible; a cell touching lava or source water is worked as a human would, with a retaining block first if the agent holds one; do not import `digSafetyRefusal`), tests with `escape-ladder.fakes.ts`-style fakes. No scaffold is placed unless the agent holds the block.
- Tests: a cell 6 high with no stand gets a scaffold and the scaffold is removed; a sand column is broken top-down; a cell next to lava is worked, with a retaining block first when held, and never refused; no scaffold without material (`missing_materials`).
- Checks: as BLD-09.

### BLD-11 Cell executor
- Size M. Restarts: Y (R1). Depends: BLD-06, BLD-07, BLD-08, BLD-09, BLD-10. Integration packet: owns `cell-do.ts`.
- Branch `phase1/bld-11-cell-executor`; commit `BLD-11: place or break one planned cell with live verification`.
- Files: `golem/src/building/cell-do.ts` (read the live cell; `done_already` if it matches; `changed` if it is neither the planned prior block nor the target (ruling 9: skip, never overwrite); else equip, place or break through the actions of BLD-06 to 08, verify, return one code from the shared list; `recordOwnPlacement` for each placement, confirm `place.ts` calls it, add the call if missing), `golem/src/building/materials.ts` (tool choice per cell; the item to hold; chest withdrawals are not automatic: the Mind uses `withdraw`), tests.
- Tests: the full code table, one case per code; a cell changed by a third party is skipped with `changed` and the neighbours still run; a break-then-place of one item self-funds; reverting the `changed` rule fails the stale test.
- Checks: as BLD-09.

## Wave 3: the plan lane (R2)

BLD-12 is small and independent; BLD-13 then BLD-14 are serial; BLD-15 and BLD-16 run beside BLD-14.

### BLD-12 Provenance: an agent's own edits are not "someone broke your block"
- Size S. Restarts: Y (R2). Depends: none (can start in wave 1).
- Branch `phase1/bld-12-self-actor-filter`; commit `BLD-12: an agent's own breaks raise no property_broken observation`.
- Files: `golem/src/perception/provenance/` (the property-break rule; its test `property-break.test.ts` exists), `contract/src/observation.ts` only if the filter lives there (decision 0391 says the wording is the owner's: change no sentence).
- Tests: a break whose actor is the observing agent yields nothing; a break by another agent still yields the observation (no change); revert fails the first.
- Checks: golem typecheck and test provenance.

### BLD-13 Plan lane core and reflex pause
- Size M. Restarts: Y (R2). Depends: BLD-04, BLD-05, BLD-11.
- Branch `phase1/bld-13-plan-lane`; commit `BLD-13: plan lane steps cells between thoughts and pauses for reflexes`.
- Files: `golem/src/building/lane.ts` (steps a slice of cells, then returns; slices are time-bounded in ticks; holds no timer of its own, the Body loop calls it), `golem/src/building/lane-state.ts` (running, paused, waiting_materials, idle), wiring in `golem/src/body/create-body.ts` behind the flag, reuse of `ReflexRunner` pause hooks (`golem/src/body/reflex.ts`: `cancelAction` and `holdSlot`); on a reflex the in-flight cell is aborted and re-read on resume (cells are idempotent: BLD-11 `done_already`).
- Tests: a reflex mid-cell pauses and resumes with no cell double-placed; death ends the lane and clears the queue for that `life_id` (the plan gate of `death-cancel.ts`); with the flag off the lane does nothing and registers nothing.
- Checks: golem typecheck and test.

### BLD-14 Lane versus foreground intents; queue operations; resume
- Size M. Restarts: Y (R2). Depends: BLD-13.
- Branch `phase1/bld-14-lane-queue`; commit `BLD-14: add, replace and cancel plans; resume after restart; a foreground intent pauses the plan and it resumes after`.
- Files: `golem/src/building/queue.ts` (`plan` action handler: add with `seq` chunks until `final`, replace, cancel; one active plan at a time per life, others queued in order), `golem/src/building/contention.ts` (owner ruling 2026-11-22, 0423: a foreground intent such as `gather` or `travel` PAUSES the plan exactly as a reflex does, and the plan resumes after the intent ends; the plan has no priority and no slice share), `golem/src/body/restart.ts` hook (resume the lane from `geldar-checkpoints` and `geldar-plans`; a missing chunk fails the plan with a wake), tests.
- Tests: add in three chunks then a final starts the plan; replace discards unexecuted cells and keeps the placed ones; cancel stops within one slice; restart mid-plan resumes at the cursor (fake KV); a `gather` intent pauses the lane at once, the lane resumes when the intent ends, and a reflex still outranks both.
- Checks: golem typecheck and test.

### BLD-15 Tick budget and TPS throttle
- Size S. Restarts: Y (R2). Depends: BLD-13.
- Branch `phase1/bld-15-tps-throttle`; commit `BLD-15: widen the gap between block operations as server TPS falls`.
- Files: `golem/src/building/throttle.ts` (minimum gap in ticks between block operations, default 4; tps >= 18: gap as is; 12 to 18: doubled; below 12: the lane pauses and reports `waiting_tps`; the TPS source is the existing `server_tps` world event, the body's `timeScale` is respected), tests, a doc comment saying this is a health throttle and not a policy cap.
- Tests: the gap at 20, 15 and 8 TPS; the lane resumes when TPS recovers; no cap on total cells is introduced (a test runs 100,000 cells through the throttle with a fake clock and all complete).
- Checks: golem typecheck and test.

### BLD-16 Progress events and the materials wake
- Size M. Restarts: Y (R2). Depends: BLD-14.
- Branch `phase1/bld-16-progress-wake`; commit `BLD-16: plan progress events and a wake when materials run short`.
- Files: `golem/src/building/progress.ts` (counts by code, `next_need`, emits `plan_progress` every 25 cells or 30 s, bounded sample indexes; bounded sentence for `wait`; the sentence names no owner and no unseen block), wake in `golem/src/body/wake.ts` (reuse `precondition_failed` with the shortage text, following `programs/build.ts` wording), tests. The lane pauses in `waiting_materials` and resumes when the Mind adds items (it polls the inventory every slice) or cancels.
- Tests: running out of oak planks wakes the Mind once with the count and the plan waits; a later pickup resumes it; a completed plan wakes with `goal_completed`; revert the wake and the test fails.
- Checks: golem typecheck and test.

## Wave 4: the seen-block map (R2)

BLD-17 then BLD-18 are serial; BLD-19 and BLD-20 follow in parallel.

### BLD-17 Recorder
- Size M. Restarts: Y (R2). Depends: BLD-03 (flag).
- Branch `phase1/bld-17-seen-recorder`; commit `BLD-17: record the blocks the character has seen`.
- Files: `golem/src/building/seen/recorder.ts` (every N ticks, default 10, cast the same rays as the viewport, `golem/src/perception/view/viewport.ts` with `MAX_RANGE` 24 and `DARK_RANGE` 6, from the eyes and in the facing view cone (as built, the cone is the viewport's fixed 90 by 45 degrees, `golem/src/perception/view/viewport.ts`; no `building.seen_fov` config key exists; a head turn reveals more; line of sight only); record the first opaque block hit and the transparent blocks before it; add cells the Body placed or broke; a cell in an unloaded chunk is never recorded), `golem/src/building/seen/section.ts` (a 16-cube section: palette plus a last-seen value per cell), bounded work per tick (a ray budget), tests.
- Tests: a block behind a wall is not recorded (the leak test, first half); a block in an unloaded chunk is not recorded; a block in the dark beyond 6 is not recorded; looking at a cell twice updates its last-seen time; the work per tick never exceeds the ray budget.
- Checks: golem typecheck and test.

### BLD-18 Storage, death retention, size and write rate
- Size M. Restarts: Y (R2). Depends: BLD-17, BLD-05 (bucket seed pattern). MANUAL: NATS role and bucket (as BLD-05).
- Branch `phase1/bld-18-seen-store`; commit `BLD-18: persist seen sections per life, kept across death`.
- Files: `golem/src/building/seen/store.ts` (dirty sections flushed on an interval, default 30 s, coalesced, retried; section values compressed and under 64 KiB; evict least-recently-seen sections from memory only), death handling (nothing erased; the NEXT life of the same agent READS its predecessor's map: owner ruling 2026-11-22, an explicit deviation from the spec's read-only-archive rule, 0424; the successor finds the predecessor through the life registry and merges its sections under its own `life_id`, keeping each cell's original last-seen time; a different agent's map is never read), the erase coverage: add the bucket to the account-erasure path and its coverage test (`docs/runbooks/account-deletion.md`, decision 0323), `golem/src/building/seen/store.test.ts`, a measurement script note for BLD-29 (bytes per section, flushes per minute).
- Tests: a flush after 30 s writes only dirty sections; the death of a life leaves its sections readable under that `life_id`; the successor life's `survey` read includes the inherited cells with their last-seen ages and the `inherited` mark; an inherited map never contains a cell the predecessor did not see, and a different agent's sections are not read; an erasure deletes them; a corrupt section is dropped and re-seen later, not fatal.
- Checks: golem typecheck and test; repo-checks erase coverage test.

### BLD-19 Leak tests and the telemetry fence
- Size S. Restarts: N (test files only: `**/*.test.ts` are excluded; confirm in the PR) or Y if a source file changes. Depends: BLD-17, BLD-20.
- Branch `phase1/bld-19-seen-fence`; commit `BLD-19: the seen map never leaks unseen blocks or reaches telemetry`.
- Files: `golem/src/building/seen/leak.test.ts` (a world with a wall, a sealed cave and an unloaded chunk: the map and the survey reply contain none of them), `tools/repo-checks/src/` check (a static test) that `eventsink/`, `telemetry/` and `glass/` never import `golem/src/building/seen` nor subscribe to the seen subjects or bucket (the seen map is never shown on Glass), and the reverse fence for plan activity (0429): no agent-facing module (`threshold/mcp` tool replies, `animus`, `golem` snapshot and wake text, `player-core`) imports a Glass plan-activity module or reads the Glass feed subject, a NATS permission note: the MCP role does not read `geldar-seen` (it asks the Body through the gateway).
- Tests: as named; reverting the fence (adding such an import in a fixture) fails the static check.
- Checks: repo checks, golem test.

### BLD-20 Body survey endpoint
- Size M. Restarts: Y (R2). Depends: BLD-17, BLD-02.
- Branch `phase1/bld-20-body-survey`; commit `BLD-20: Body answers a layered run-length block read of the seen map`.
- Files: `golem/src/building/seen/survey.ts` (box to layers by Y, run-length rows over a legend, last-seen age in game minutes, `unknown` for unseen; a reply capped at 6000 characters: a larger box answers with the nearest slice and a `truncated` marker, a payload cap, not a policy cap; as built on 2026-11-22 the Body refuses a box over 32768 cells as `box_too_large` (`golem/src/building/survey-reply.ts`) and the MCP tool returns `invalid_input`, so the slice rule above is not what runs), the gateway handler next to the `see` and `view` handlers (`threshold/mcp/src/body-gateway.ts` has the client side; find the Body side by the snapshot request subject), tests.
- Tests: run-length encode and decode round trip; a mix of seen and unseen cells reads `unknown` for the unseen; no owner field; truncation marker; revert the unknown rule and the leak test fails.
- Checks: golem typecheck and test.

## Wave 5: MCP tools, descriptions, prompts, kit (R3)

Fan-out: BLD-21, 22, 23 run side by side after BLD-20; BLD-24 and BLD-25 need no Body code.

### BLD-21 MCP `survey` tool
- Size M. Restarts: Y (threshold/mcp; R3). Depends: BLD-02, BLD-20.
- Branch `phase1/bld-21-mcp-survey`; commit `BLD-21: survey tool reads the seen map`.
- Files: `threshold/mcp/src/tools/survey.ts` and `survey.test.ts` (rate limit as `see`: 1 per 5 s; free of credits), tool registration, `threshold/mcp/src/tools/unavailable.ts` entry (hidden and refused while the flag is off), the Body request through `body-gateway.ts`.
- Tests: flag off: the tool is absent from the list and refused with the one neutral message; flag on: a reply passes the schema; the rate limit refuses the second call in 5 s; no owner field.
- Checks: mcp typecheck and test.

### BLD-22 MCP `plan_check` dry run
- Size M. Restarts: Y (R3). Depends: BLD-04, BLD-20, BLD-21.
- Branch `phase1/bld-22-plan-check`; commit `BLD-22: plan_check dry run of a plan against the seen map and the pack`.
- Files: `threshold/mcp/src/tools/plan-check.ts` and test; the logic is the same expansion code as the lane. As built (BLD-22b, 2026-11-22) the dry run runs on the Body (`golem/src/building/plan-check-reply.ts`, `PLAN_CHECK_CELL_CAP` 8192, answer `plan_too_large`); the MCP tool only forwards the plan to the Body, so the "imported from `player-core`" wiring described here was not used for the tool. Reply: cell count, material needs against the pack, cells predicted `unknown` (never seen), estimated ticks, steps with invalid shapes. No world data about unseen cells.
- Tests: the reply for a plan equals the lane's first-pass counts on the same fakes; unseen cells are reported `unknown` and not guessed; a flag-off refusal.
- Checks: mcp, player-core and golem typecheck and test.

### BLD-23 MCP presenter, `status` block, `act` text
- Size M. Restarts: Y (R3). Depends: BLD-16, BLD-01.
- Branch `phase1/bld-23-mcp-present`; commit `BLD-23: present plan progress, status block and break and plan verbs`.
- Files: `threshold/mcp/src/events/mapper.ts` and a present handler for `plan_progress` (bounded sentence, no coordinates beyond the plan's own indexes), `status` projection (`active_plan`), `contract/schemas/mcp-play.schema.json` description of `act` (names `break` and `plan`; removes "Free-form build actions are not available"; regenerate), the test that pinned the old sentence (`threshold/mcp/src/events/build-failure.test.ts` lines near 126) is rewritten to pin the new text.
- Tests: the new description names both verbs and no nudge words (no "you should build"); a progress event renders to the bounded sentence; `status` shows `312/540`-style counts; revert the description and the pin fails.
- Checks: contract and mcp typecheck and test; `check:generated`.

### BLD-24 Prompts: body-api next version
- Size S. Restarts: N (`prompts/**` is not a colo-images path; confirm in the PR). Depends: BLD-01, BLD-03.
- Branch `phase1/bld-24-prompts`; commit `BLD-24: body-api v12 lists the break and plan verbs`.
- Files: new `prompts/body-api/v12.json` (v11 is reserved by AN-45b; if AN-45b has merged, v12 is still right; if v12 is taken, use the next free), `prompts/README.md` row, the animus test that loads the default list. Do not change the default selection: version choice stays a separate owner step (decision 0391 point 3). No building goal, no nudge (0425).
- Tests: v12 verbs equal `PHASE0_VERBS`; the examples validate; a grep test that the text has no suggestion to build.
- Checks: animus typecheck and test; repo checks.

### BLD-25 Kit skills and twins (kit repo, MANUAL release)
- Size M. Restarts: N. Depends: BLD-23, BLD-21, BLD-22. Repo: the scriptorium kit, not this one. The packet brief names that repo; the scriptorium orchestrator gives the go.
- Branch `phase1/bld-25-kit-building`; commit `BLD-25: kit teaches the break, plan and survey tools`.
- Files (kit repo): new `template/.claude/skills/building/SKILL.md` (the verbs, survival rules, how to read `survey` and `plan_check`, how to read progress and recover from `changed` and `missing_materials`; no nudge, no goal), `template/.claude/skills/intents-and-limits/SKILL.md` (mention the plan lane is separate from intents), `template/.claude/settings.json` (a `Skill(building)` line and allow lines for the two new MCP tools, owner ruling 2026-11-22: `survey` and `plan_check` are NEW kit tools, so `mcp__geldar__survey` and `mcp__geldar__plan_check` get allow entries; the kit runs in dontAsk mode, so an agent whose kit lacks them cannot call them), `template/CLAUDE.md` and `template-src/instructions.md` (twins, identical, one pointer line), template tests.
- Release: one kit tag (`docs/release.md` in the kit), then the per-player `geldar-play upgrade` PRs the owner merges; a running Mind reloads skills on restart. What reaches agents when: MCP descriptions and `prompts/` on MCP/animus redeploy (R3), kit skills only after the tag plus each upgrade merge. The `break` and `plan` actions work for every agent at R3 (they ride `act`). `survey` and `plan_check` are callable only after that player's upgrade PR is merged (allow lines) and its Mind restarted; until then the agent can build from what it sees with `look`, `view` and `see`, and has no seen-map read. Order: ship R3, then the kit tag, then the owner merges the upgrade PRs; go-live (BLD-31) may precede some upgrades.
- Tests: the kit's skill-list and instruction-twin tests; a text test for no nudge words.

### BLD-26 Delete the dead inline `build` action (0427)
- Size S. Restarts: Y (R2). Depends: BLD-23 (the text change lands together). Owner accepted 0427 (2026-11-22): unblocked on the owner side; it still waits for BLD-23 and the contract merge order.
- Branch `phase1/bld-26-delete-inline-build`; commit `BLD-26: remove the unused inline build action`.
- Files: `contract/schemas/thought.schema.json` (remove the `build` Action), `golem/src/body/limits.ts` (the `build` cost line), regenerated code, tests that name it, `docs/spec.md` untouched (the owner edits it; list the line in the PR).
- Tests: the schema rejects `do:"build"`; the `build` program still runs (`programs/build.test.ts`).
- Checks: contract and golem.

## Wave 6: quality, operations, rollout

### BLD-37 Glass plan-activity view (human-facing)
- Size M. Restarts: Y (`glass/**`, R3). Depends: S3c, BLD-27, BLD-16. Owner ruling 2026-11-22 (decision 0429): plan activity may be shown to humans on Glass; there is no building XP.
- Branch `phase1/bld-37-glass-plans`; commit `BLD-37: Glass shows plan activity to humans`.
- Files: only `glass/src/plan-activity/**` (a read-only panel fed by the eventsink `plan_progress` rows: the SAME agent label Glass already shows, no new identity data (owner ruling), plan name, counts by failure code, phase; not the seen map, not unseen blocks), its tests. Follow the Glass rules of 0410 to 0412 (CSP, self-hosted fonts, mobile layout).
- Tests (hard): a static and a runtime test that no plan or seen-map datum reaches an agent-readable path: no `threshold/mcp` reply, snapshot, wake text or `animus` input contains a Glass field; the Glass feed subject and route are not readable with the agent NATS role or the MCP token (a fixture of both roles is refused); Glass text contains no coordinates of unseen cells; the panel is off when `body_actions.building` is off. BLD-19's plan-activity fence runs in the same check.
- Checks: glass typecheck and test; repo checks.

### BLD-27 Metrics and telemetry for plans
- Size S. Restarts: Y (R3). Depends: BLD-16.
- Branch `phase1/bld-27-metrics`; commit `BLD-27: plan counters and gauges`.
- Files: `golem/src/metrics.ts` additions (cells placed and broken, by code; plan seconds; throttle waits; seen flush bytes and counts; plan queue depth), the eventsink handler for `plan_progress` where events are tabulated (find the `intent-event` handler and mirror it), an operator view line in `docs/runbooks/progress-metrics.md`. These go to operators only; no agent-facing text (project rule: agents are never told they are watched).
- Tests: counters increment per code; the event is stored; no metric name or label contains a block coordinate pair of an unseen cell (labels carry codes only).
- Checks: golem and eventsink typecheck and test.

### BLD-28 Automated Paper integration test
- Size M. Restarts: N (test files; confirm). Depends: R2 merged. Live lane: ops runs it; the coder writes it (`live: pending`).
- Branch `phase1/bld-28-integration`; commit `BLD-28: scripted building plans on a scratch Paper area`.
- Files: `golem/test/live/building.live.test.ts` (and helpers), run through `./geldar.ps1 pnpm --filter @geldar/golem test:live`; it starts its own stack (never `adam up`). Cases: a 5x5 floor with 3-high walls and a door; stairs with facing; a break-then-replace; a plan interrupted by a hostile mob (reflex) that resumes; Body restart mid-plan resumes at the cursor; a changed cell is skipped with `changed`; at 20 and 10 TPS; a block behind a wall is absent from `survey`; no `/fill` or `/setblock` appears in the server log.
- Gate: the case list is written first with failure messages that print inventory, position and the cell (the campaign's diagnostics-first rule).

### BLD-29 Test-shard agent evidence
- Size M. Restarts: N. Depends: BLD-28, R3 merged. Owner: ops with the sheet test-shard agent harness (`docs/analysis/sheet/`, decision 0391 item 2). Live lane: only user.
- Output: `docs/analysis/building/worknotes/BLD-29-evidence.md` with: did an agent given only the taught verbs build and break something unprompted, `plan_progress` event logs, a `survey` read of a built structure, the measured bytes per seen section and flushes per minute (BLD-18), the TPS during a 2,000-cell plan, the KV value sizes. The owner may go live without it (0426).

### BLD-30 Operator runbook, rollback, restart windows
- Size S. Restarts: N (docs). Depends: BLD-14.
- Files: new `docs/runbooks/building.md` (what the flag does; how to turn it off: `body_actions.building: false` and restart; how to see what happened: BlueMap, CoreProtect lookups from outside the world; there is no restore, say so; the three restart windows and the NATS role steps; principle 1 on the autonomous shard: operators act only from outside), `docs/runbooks/README.md` row.
- Tests: the repo's docs checks (links, front matter) pass.

### BLD-31 Paper go-live
- Size S. Restarts: Y (one config restart). Depends: BLD-29 or the owner's go, R1 to R3 merged. MANUAL, ops with geldar-93.
- Steps: seed the buckets and NATS role; set `body_actions.building: true` on the shard config; one restart of the 19 Bodies and the MCP; check the plugin-loaded lines and `/status`; watch `plan_progress` and TPS for the first hour. Rollback: flag false and restart.

## Wave 7: NeoForge human-directed shard (BlockedDecision: 0387 and 0390 open)

The Body (`golem/`) is platform-neutral (it is a vanilla-protocol client; `docs/analysis/sheet/neoforge-delta.md`), so BLD-03 to BLD-23 serve NeoForge unchanged. What differs is attribution: block ownership on NeoForge answers `known: false` (no block-owner log; P4 is on hold) and humans build there too.

### BLD-32 Design: attributing human and agent edits
- Size S (docs). Status BlockedDecision (needs 0387 and 0390 settled). Output `docs/analysis/building/neoforge-attribution.md`: the question each edit answers (who, human or agent, which life), where it is stored, what an agent may be told (0329 and 0390 differ: named equals versus acts of nature), which observation wording applies; options: reuse the provenance subjects of the sheet work, or a NeoForge listener. No code.

### BLD-33 NeoForge port assessment
- Size S (docs). Depends: BLD-32. Output: a checklist of what runs unchanged (the lane, the recorder, `survey`), what needs work (the seen-map recorder is client-side so unchanged; the Paper-only CoreProtect attribution; chat), and the test on the NeoForge scratch shard (`docs/runbooks/nf-live-project.md`).

### BLD-34 NeoForge edit-provenance listener
- Size M. Restarts: manual NeoForge deploy (a mod jar; `neoforge/` is built by its own Gradle, `(cd neoforge; ./gradlew build)`). Depends: BLD-32 accepted. Records only, never cancels an event (0420). Files: `neoforge/src/main/java/dev/geldar/...` following `ExportListeners` and `EventMapping`, tests under `neoforge/src/test/java`. The exact paths are found by the coder from `neoforge/README.md`.

### BLD-35 NeoForge enablement
- Size M. Depends: BLD-33, BLD-34, the owner's go. MANUAL. A flag per shard (the same `body_actions.building`), the evidence run with humans and agents building together, the human-model rules of the accepted decision.
