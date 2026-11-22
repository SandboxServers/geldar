# Building campaign (free-form block placement and removal for agents)

Ledger. Schedule, file ownership and packet specs: [work-packets.md](work-packets.md). Resume: [RESUME.md](RESUME.md). Updated 2026-11-22 to the integration state: `building/integration` = `ecae177c` (BLD-38h merged). `origin/main` = `5828b498` carries the campaign docs only; no building packet is on `main`. Only the orchestrator edits this file; each packet reports in `worknotes/BLD-NN.md`.

## Purpose

Let an agent place and break any block, one at a time, with ordinary survival mechanics, and let its Mind hand the Body a plan of any size that the Body carries out in the background. Today an agent can `place` one block but cannot break a named cell (`mine` digs the nearest of a name), no verb teaches either, and the inline `build` action has no handler.

## Exit criteria

1. The `break` and `plan` verbs, and the `survey` and `plan_check` tools, work on the Paper autonomous shard for all 19 agents behind `body_actions.building` (default off).
2. A plan of any size runs between thoughts, pauses for reflexes and resumes, survives a Body restart, and stays under the KV value limit.
3. Every edit is a survival action: no server command, no creative supply.
4. The seen-block map never leaks an unseen block (test) and never reaches a telemetry path to an agent (test).
5. Each behavior change has a test that fails on revert; the Paper integration test passes; the test-shard evidence note exists (or the owner waives it).
6. The operator runbook, the rollback and the three restart windows are written.
7. NeoForge: the gated wave is either delivered after the owner settles 0387 and 0390, or left explicitly blocked.

## Decisions

| ID | Decision | Status | Record |
|---|---|---|---|
| D-BLD-01 | Break any block; nothing protected; survival materials; one block at a time | Accepted (owner 2026-11-22) | [0420](../../decisions/0420-agents-build-and-break-freely-in-survival.md) |
| D-BLD-02 | `break` verb; exact-cell dig reaches agents (supersedes 0349's visibility rule) | Accepted (verb), shape Proposed | [0421](../../decisions/0421-break-at-position-verb-exposes-exact-cell-dig.md) |
| D-BLD-03 | Accepted risks: no restore, nothing protected, no caps, all 19 at once; the unmet Shrine and Cradle promise | Accepted; known spec deviations (spec untouched) | [0422](../../decisions/0422-building-accepted-risks.md) |
| D-BLD-04 | Background plan lane, geometry helpers, stale-cell rule, health throttle, chunked storage | Proposed (behavior Accepted) | [0423](../../decisions/0423-background-plan-queue-for-block-edits.md) |
| D-BLD-05 | Seen-block map, kept across death, read by `survey` | Proposed (behavior Accepted); inherited by the next life | [0424](../../decisions/0424-seen-block-map.md) |
| D-BLD-06 | Teach the verbs, no nudge; prompt and kit delivery | Accepted | [0425](../../decisions/0425-teach-building-verbs-without-nudging.md) |
| D-BLD-07 | All 19 at once behind a flag; NeoForge gated | Accepted (Paper); NeoForge gated | [0426](../../decisions/0426-building-rollout-both-shards.md) |
| D-BLD-08 | Delete the dead inline `build` action | Accepted (owner 2026-11-22) | [0427](../../decisions/0427-delete-the-dead-inline-build-action.md) |
| D-BLD-09 | Dig-safety refusals removed for plans, break, mine; deaths are part of the experiment | Accepted | [0428](../../decisions/0428-dig-safety-refusals-removed.md) |
| D-BLD-10 | Plan activity may show on Glass; no building XP | Accepted | [0429](../../decisions/0429-plan-activity-on-glass-no-building-xp.md) |

Numbers 0420 to 0429 are all used. Verified on `origin/main` and every remote branch on 2026-11-22: no record above 0412.

## Packets

Size S, M. Restarts = merging to `main` restarts the 19 Bodies (colo-images paths). Windows R1 to R3 are in the packet file. Status values: Ready, BlockedDependency, BlockedDecision, Writing, Review, Done, Manual (not run). Wave 3a rows (BLD-38 family) have no entry in the packet file; their scope is the one-line summary in their worknote.

| ID | Title | Wave (graph) | Size | Restarts | Depends | Status |
|---|---|---|---|---|---|---|
| BLD-S1 | Contract scaffold (absorbs 01, 02) | 0 | M | Y | none | Done |
| BLD-S2 | Validator and pure-library stubs (absorbs 03) | 0 | M | Y | S1 | Done |
| BLD-S3a | Body scaffold (stubs, hooks, flag) | 0 | M | Y | S1 | Done |
| BLD-S3b | MCP scaffold (stub tools, mapper) | 0 | S | Y | S1 | Done |
| BLD-S3c | Glass scaffold (registry stub) | 0 | S | Y | S1 | Done |
| BLD-S4 | Docs scaffold | 0 | S | N | none | Ready (unverified) |
| BLD-04 | Plan expansion, geometry helpers, ordering | 1 | M | Y | S2 | Done |
| BLD-05 | Chunked plan store and cursor checkpoint | 1 | M | Y | S3a | Done |
| BLD-06 | `break` action | 1 | M | Y | S3a | Done |
| BLD-07 | Place: plants, snow, two-block items | 1 | S | Y | S3a | Done |
| BLD-08 | Place: blockstate and orientation | 1 | M | Y | S3a, after 07 on `place.ts` | Done |
| BLD-09 | Standing-position solver | 1 | M | Y | S3a | Done |
| BLD-10 | Scaffolding, falling blocks, fluids | 1 | M | Y | S3a | Done |
| BLD-12 | Own breaks raise no observation | 1 | S | Y | none | Done |
| BLD-36 | Remove dig-safety refusals (0428) | 1 | S | Y | S3a | Done |
| BLD-17 | Seen-block recorder | 1 | M | Y | S3a | Done |
| BLD-11 | Cell executor (verify, codes, stale rule) | 2 | M | Y | 06, 07, 08, 09, 10 | Done |
| BLD-18 | Seen storage, death retention and inheritance by the next life, erase coverage | 2 | M | Y (+ MANUAL NATS) | 17 | Done (MANUAL NATS role and seed open) |
| BLD-24 | prompts body-api v12 | 2 | S | N | S1, S2 | Done |
| BLD-26 | Delete inline `build` action | 6 | S | Y | 23 (0427 accepted) | Done (review pending) |
| BLD-13 | Plan lane core, reflex pause | 3 | M | Y | 04, 05, 11 | Done |
| BLD-20 | Body survey endpoint | 3 | M | Y | 17 | Done |
| BLD-14 | Queue ops, a foreground intent pauses the plan, resume | 4 | M | Y | 13 | Done |
| BLD-15 | TPS throttle | 4 | S | Y | 13 | Done |
| BLD-16 | Progress events, materials wake | 4 | M | Y | 13 | Done |
| BLD-19 | Leak tests, both fences (seen map to telemetry; Glass plan data to agents) | 4 | S | N or Y | 17, 20 | Done |
| BLD-21 | MCP `survey` tool | 4 | M | Y | S3b, 20 | Done |
| BLD-22 | MCP `plan_check` | 5 | M | Y | 04, 20, 21 | Done |
| BLD-23 | Presenter, status block, `act` text | 5 | M | Y | S3b, 16 | Done (worknote: plan_progress presenter not done) |
| BLD-27 | Metrics and telemetry | 5 | S | Y | 16 | Done |
| BLD-30 | Operator runbook | 5 | S | N | 14 | Done |
| BLD-37 | Glass plan-activity view and the hard no-agent-path test | 6 | M | Y (`glass/**`) | S3c, 27, 16 | Done |
| BLD-25 | Kit skills, twins and allow entries for `survey` and `plan_check` (kit repo, MANUAL tag and upgrade PRs) | 6 | M | N | 21, 22, 23 | Done in kit repo (kit PR 137; tag and upgrades MANUAL) |
| BLD-28 | Paper integration test | 6 | M | N | all code | Done (live test written, NOT run) |
| BLD-29 | Test-shard agent evidence | 7 | M | N | 28 | Manual (not run) |
| BLD-31 | Paper go-live (MANUAL) | 7 | S | Y (config) | 29 or owner go | Manual (not run) |
| BLD-32 | NeoForge: attribution design | NF | S | N | owner on 0387, 0390 | BlockedDecision |
| BLD-33 | NeoForge port assessment | NF | S | N | 32 | BlockedDecision |
| BLD-34 | NeoForge edit-provenance listener | NF | M | manual mod jar | 32 accepted | BlockedDecision |
| BLD-35 | NeoForge enablement | NF | M | MANUAL | 33, 34 | BlockedDecision |
| BLD-38 | Wire the building modules into the Body (wiring audit; work continued in 38b to 38h) | 3a | - | Y | see worknote | Done |
| BLD-38b | Plan queue and lane wired into the Body tick (flag on only) | 3a | - | Y | 38 family (merge order) | Done |
| BLD-38b2 | Wiring fixes: break and replace, stateful targets, shared import | 3a | - | Y | 38 family (merge order) | Done |
| BLD-38c | Plan store: cells as chunks in `geldar-plans`, cursor in the checkpoint | 3a | - | Y | 38 family (merge order) | Done (MANUAL NATS role and seed open) |
| BLD-38d | Seen map and survey wired into the Body (flag on only) | 3a | - | Y | 38 family (merge order) | Done |
| BLD-38e | Survey through the gateway and the golem responder | 3a | - | Y | 38 family (merge order) | Done |
| BLD-38f | Tick-based progress throttle; failed phase on an unexpected throw | 3a | - | Y | 38 family (merge order) | Done |
| BLD-38g | Survey reaches the production Body; seen map survives restart | 3a | - | Y | 38 family (merge order) | Done |
| BLD-38h | Restart reloads the life's own seen map | 3a | - | Y | 38 family (merge order) | Done |

BLD-01, 02, 03 are delivered by S1 and S2 (their sections in the packet file are the content specs).

## Corrections to the research reports (checked on `origin/main`)

- `contract/**` is a colo-images path (so a contract-only merge restarts the Bodies); the architecture report guessed it was not.
- Body-api v11 is reserved by AN-45b; this campaign plans v12.
- Zone, ownership gate, `protected` code and the per-day and per-plan caps in the architecture report are void under rulings 1, 2 and 6.
- "Plan is the intent" (architecture D1 v1) conflicts with ruling 5; a plan lane is required.
- A new `act` action needs no kit allow change, but new read tools (`survey`, `plan_check`) do (one line each), unless folded into existing tools.
- The 1 MB KV limit is the NATS default `max_payload`; the repo sets none; unverified on the node.
- `recordOwnPlacement` use inside `place.ts` was not confirmed (a grep found it in `goto-dig.ts`); BLD-11 checks.

## Risk register

| Risk | Owner-accepted | Mitigation inside the rulings |
|---|---|---|
| Agents die digging (no dig-safety) and wreck the town, ranger bases, the Shrine and Cradle | Yes (0420, 0422, 0428) | Flag off; recording stays (CoreProtect, block owner) for after-the-fact attribution; BlueMap view; the spec promise acknowledged, not silently dropped |
| No restore path | Yes (0130, 0422) | None promised; backups stay deferred; this is in the runbook |
| No caps: a huge plan loads the server | Yes | TPS throttle and tick budget (0423); `plan_progress` and metrics; cancel verb; flag off |
| Plan value over the 1 MB KV limit | No | Chunks under 64 KiB, cursor-only checkpoint, million-cell test |
| All 19 at once | Yes (0426) | Flag; test-shard evidence packet still offered; one restart rollback |
| Seen-map size and write rate unknown | No | Measured in BLD-29; dirty-section coalesced flush; section compression |
| Seen map leaks unseen blocks or reaches telemetry; Glass plan data reaches an agent | No | Leak test and both static fences (BLD-19), the hard Glass test (BLD-37); MCP role cannot read the bucket; the seen map is never on Glass |
| Inherited map exposes a predecessor's knowledge | Yes (0424) | Only cells the predecessor saw, with original ages; never another agent's map; test in BLD-18 |
| New kit tools unusable until each player upgrades | No | Said in the runbook; `break` and `plan` work for everyone at R3 |
| A foreground intent pauses the plan for a long time | Yes (0423) | Plan resumes after; progress events show `paused` |
| Own breaks tell the agent "someone broke your block" | No | BLD-12 |
| Plan lane and reflexes fight (death, hunger) | No | Pause and resume tests; death clears the queue |
| Contract regeneration conflicts | No | Only the scaffold regenerates; fixed order for BLD-23 then 26 |
| Kit skills reach agents slowly | No | Say so in the runbook; tool descriptions arrive with the MCP |
| NeoForge human edits mis-attributed | No | Gated wave and design packet BLD-32 |

## Answered by the owner (2026-11-22)

Q10 the "block under your feet" refusal in `mine` is removed too (0428, BLD-36). Q11 the Glass plan panel uses the same agent label Glass already shows, no new identity data (0429, BLD-37). Q1 the next life reads the predecessor's seen map (0424). Q2 the spec stays untouched; the deviations are recorded in 0422. Q3 0427 accepted. Q4 `survey` and `plan_check` are new kit tools with allow entries (0425, BLD-25). Q5 the facing 90 by 45 degree cone, config default. Q6 a foreground intent pauses the plan (0423). Q8 no XP; plan activity may show on Glass (0429). Q9 dig-safety refusals removed (0428).

## Open questions for the owner (not decided here)

1. The NeoForge human model (0387, 0390), and who may break a human's block there (gates BLD-32 to BLD-35).
