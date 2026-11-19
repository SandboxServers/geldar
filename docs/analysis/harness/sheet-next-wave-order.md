# Sheet campaign: dispatch order from W3 onward (2026-11-18)

Built from [sheet-cards-verification-2026-11-18.md](sheet-cards-verification-2026-11-18.md) (verdicts, mismatches and the global fixes G1 to G13). Base: geldar `origin/main` = `a8063b0a`, kit `origin/scriptorium/hw0` = `673d756`. All sheet features stay held on the live server (owner ruling 2026-11-15): every card merges inactive, and evidence runs go to the test shard only.

Rules for this order:

- One Haiku `packet-coder` per card, in its own worktree, with a brief that pastes the card text, its shapes and the global fixes. Never hand a coder a whole card file (each is 20k to 25k tokens).
- A card marked FIX-NEEDED is dispatched only after the planner edits the card (or writes the fix into the brief). A BLOCKED card is not dispatched.
- Cards in one parallel set touch disjoint files. A shared file has one owner per set (tables below).
- The merge order inside a set is the card's depends-on column, even when coding ran in parallel.

## 1. Serial slots (one at a time, in this order)

### Contract regeneration (`contract/`, generated output)

| Slot | Card | Precondition |
|---|---|---|
| 1 | AN-24 observed-actor contract | none (AN-12 merged) |
| 2 | AN-44 program shapes | slot 1 merged |
| 3 | AN-46 evidence-source contract | slot 2 merged |
| 4 | S9-01 refusal reason and key | slot 3 merged; OD-1, OD-2 answered before merge to a wave branch |
| 5 | S10-01a lineage contract | slot 4 merged; OD-5, OD-7, decision Accepted |
| 6 | S11-01 drift contract | slot 5 merged; OD-8, decision Accepted |

Other campaigns share the regen slot: ask the contract slot holder (geldar-3b) before each one.

AN-40a (a program's `mine` digs one exact cell, decision 0349) takes **no** slot: it changes no `contract/` file (the cell is a program-only run option, not an `Action` field), so it can merge before or after AN-44; it merges before AN-40.

### Decision numbers (free on main and every remote branch: 0283 to 0289, 0320 to 0329)

Proposal (the orchestrator confirms in the registry before each dispatch):

| Number | Card | Record |
|---|---|---|
| 0283 | S9-01 | property refusal by trait (as W9 to W12 planned) |
| 0284 | S10-01a | lineage and child sheets |
| 0285 | S11-01 | attribute drift policy |
| 0286 | S12-01 | cohort export and protocol |
| 0287 | S12-04 | adopting existing agents |
| 0288 | S12-05 | rollout and rollback |
| 0289 | spare | |
| 0320 | AN-24 | observed evidence (W5) |
| 0321 | AN-44 | explore, farm and patrol |
| 0322 | AN-46 | evidence sources |
| 0323 | HC-24 | instinct step (D-CS-01, D-CS-05, D-CS-18, OD-C interim), if the kit records it in geldar's register |
| 0324 | HC-23a | sanity veto, same condition |
| 0325 | HC-25 | temperament route and wording, after OD-A |
| 0326 to 0329 | spare | |
| 0349 | AN-40a | a program mines one exact cell (the spare of the 0343 to 0349 sheet allocation in the registry on `main`, where its row still reads `spare`) |

Owner or orchestrator choice: keep W9 to W12 on 0283 to 0288 (as written) and put W3 to W8 in the overflow block (above), or renumber in wave order. Either way, one list, allocated serially.

### SQL numbers (0053 to 0059 free)

| Number | Card |
|---|---|
| 0053 | unused (S9-00 needs no migration); leave free or give back |
| 0054 | S10-01b lineage |
| 0055 | S11-02 drift |
| 0056 | S12-01 exporter role |
| 0057 | S12-04 conversion source (dropped if the owner prefers `config`) |
| 0058, 0059 | spare |

Each SQL card and S9-00 append one ` -f sql/test/<file>.sql` to the single psql command in `.github/workflows/ci.yml`: serial, in the order S9-00, S10-01b, S11-02, S12-01, S12-04.

### Other single-owner files (sequence of owners)

| File | Owners in order |
|---|---|
| `golem/src/adam/adam-body.ts` (413 lines) | AN-28b, then AN-45 (its `setVisitedChunks` pair, likely BlockedDependency), then S9-03, then S11-05 |
| `golem/src/character/character-config.ts` | S9-03, then S10-03, then S11-01, then S11-05 |
| `geldar.ps1` `Get-NatsUsers`, `tools/repo-checks/src/nats-auth.test.ts`, `threshold/mcp/test/nats-auth.it.test.ts` | AN-28c (the AN-28b split) only |
| `plugin/core/.../blockowner/BlockOwnerSetup.java` | AN-28c, then AN-50a |
| `plugin/core-common/.../blockowner/NatsBlockOwnerLink.java`, `plugin/core/.../blockowner/BlockChangeListener.java` | AN-27a only |
| `player-core/src/link/mind-event.ts`, `player-core/src/ports/body.ts`, `threshold/mcp/src/events/handlers/index.ts`, `present-handlers/index.ts` | AN-28a, then AN-50b (only if a presenter row is needed) |
| `golem/src/body/programs/index.ts`, `player-core/src/validate/bounds.ts`, `prompts/body-api/v11.json` | AN-45 only |
| `golem/src/actions/mine.ts`, `golem/src/actions/registry.ts`, `golem/src/body/program.ts`, `golem/src/body/runtime.ts`, `golem/src/body/executor-intent.ts`, `golem/src/body/programs/action-step.ts` | AN-40a only |
| `eventsink/src/xp/awards.ts` (registration `case` arms) | AN-50a only; AN-47b and AN-49 hand "index line to add" |
| `eventsink/src/writer.ts`, `eventsink/src/main.ts` | S10-03, then S11-04 |
| `psyche/**` and tags | S10-02 only; tag `psyche-v1.1.0` (owner approval) before it |
| `tools/mcp-tokens/src/cli.ts` (545 lines) | S12-04 only (one dispatch line) |
| kit `packages/instinct/src/run.ts` `DEFAULT_FXS` | orchestrator merges the fx registration lines by hand, then HC-24 |
| kit `packages/supervisor/src/**` | HC-19, then HC-26c, then HC-23b, then HC-45 (scriptorium orchestrator's go each time) |
| kit `launcher/geldar-play`, `launcher/geldar-play.ps1`, `launcher/messages.d/` | HC-25, then HC-26a, then HC-26b (launcher owner's go) |
| kit `packages/mind-loop/src/loop.ts` | HC-23a only |

## 2. Waves

### Wave A: start now (no owner decision, no unmerged dependency)

Parallel-safe set (disjoint files; geldar cards from a fresh `phase1/sheet-w5` wave branch, kit cards from `scriptorium/hw0`):

| Card | Repo | Files it owns | Note |
|---|---|---|---|
| AN-24 | geldar | contract slot 1 | READY |
| AN-27a | geldar (plugin) | `ProvenanceSink.java` (core-common), `NatsBlockOwnerLink.java`, `BlockChangeListener.java`, new test | fix first: core-common paths and Gradle tasks |
| AN-39 | geldar | new `explore.ts`, `observed-chunks.ts` | READY; merge after AN-44 |
| AN-40a | geldar | new `mine-cell.ts`; `mine.ts`, `registry.ts`, `program.ts`, `runtime.ts`, `executor-intent.ts`, `action-step.ts` | READY; no contract slot; merge before AN-40 |
| AN-40 | geldar | new `farm.ts`, `farm-field.ts` | amendment after AN-40a merges (exact cell, owner prefetch); merge after AN-44 and AN-40a |
| AN-41 | geldar | new `patrol.ts` | READY; merge after AN-44 |
| S12-03 | geldar | new `golem/test/character-control/*` | READY; test-only |
| HC-27a | kit | new `packages/instinct/src/social/{rules,model,store}.ts` | READY |
| HC-28a | kit | new `social/{branch,predict}.ts` | READY |
| HC-29 | kit | new `social/{prose,facts}.ts`, new template test | READY; text inactive |
| HC-33 | kit | new docs file | READY |

Ops in this wave (serial, test shard only): none required to merge; AN-27a's real-payload capture runs when the scratch stack is free.

Needs from the owner: nothing to merge. To plan the kit track (wave K below): the choice in section 3, item 1.

### Wave B: after AN-24 merges

| Card | Files | Note |
|---|---|---|
| AN-25 | `hurt.ts`, `hurt-trigger.ts`, new `perception/provenance/visible-actor.ts` | READY |
| AN-26a | new `PickupProvenanceListener.java` | after AN-27a merges; fix the Paper API lines first |
| AN-28a | `player-core` link files, MCP handlers and presenters | fix first: `player-core` paths |
| AN-44 | contract slot 2 | READY; runs beside the code cards since AN-24 left the contract |

Then, once AN-25 and the payload captures exist: AN-26b and AN-27b (new golem files, parallel). Then AN-28b and AN-28c (split now), serial and last; W5 close ops (one real hit, give and break on the test shard; NATS role denial; full check; 20 TPS bench).

Needs from the owner: D-CS-06 confirmed (assumed so far). OD-E wording stays unapproved; nothing is activated.

### Wave C: W7 close and W8 code

| Card | Precondition | Note |
|---|---|---|
| AN-45a, AN-45b | AN-39, AN-40, AN-41, AN-44 merged; AN-28b merged (adam-body owner) | fix first: body-api v11, pin v1 to v10, real default-version source |
| AN-46 | contract slot 3 | READY |
| AN-47a | AN-46 merged (merge order), AN-27a merged | fix first |
| AN-49 | AN-46 (ADR) | fix first: `eventsink/src/xp/` and `XpAward` |
| AN-51a | AN-46, AN-27a | fix first: Paper API |
| AN-51b | AN-46, AN-51a, AN-25 | READY |

AN-47a, AN-49 and AN-51a touch disjoint new files and can run in parallel. AN-47b waits for the owner ruling below. AN-50a/AN-50b come last, serial.

Needs from the owner: OWNER APPROVAL wording for body-api v11 summaries and AN-46 sentences (they merge unselected and off either way); **ruling on combat XP double counting** (section 3, item 3); D-CS-14 and D-CS-15 confirmed; the unmeasured parameters (`FIGHT_END_TICKS` 200, encounter cap 512, `EXCHANGE_WINDOW_TICKS` 600).

### Wave K: the kit track (W3, W4, W6 kit halves)

Blocked until section 3 item 1 is decided. If the kit's own `work-packets-kit-b.md` cards are adopted (they match the merged HC-18), the order is:

1. HC-19 (supervisor; scriptorium orchestrator's go). After correcting kit-b HC-20's `sheet.proficiency` read (OD-C).
2. HC-20, HC-21a, HC-22 in parallel (new `fx/` files); the orchestrator merges their `DEFAULT_FXS` lines; then HC-21b.
3. HC-23a (unblocked: HC-10 and HC-11 are on hw0), beside step 2.
4. HC-26a, then HC-26b, then HC-26c (launchers, then supervisor), then HC-23b.
5. HC-24 integration and the wave close on the test shard (instinct never enabled on a live life; the kit side of GX-08's non-advancing wait must be wired first).
6. W6 kit: HC-27b after W5 merges and after an `observe.ts` decision (actor ids, positions); HC-28b; HC-30a after HC-24; HC-30b. HC-27c after AN-46 and HC-27b. HC-31 after HC-21a and AN-45.

HC-25 stays out until OD-A names the temperament route.

### Wave D: W9 onward (all owner-gated)

Can be written now and held: S9-00 (after the scoping ruling below), S9-01 (contract slot 4, merge held for OD-1 and OD-2), S10-01a and S11-01 (write only, merge held), the S12-04 dry-run half (S12-04a). Everything else waits on its owner decision or on C4 (S10-03): see the verdict table.

Needs from the owner: OD-1 to OD-4 (W9), OD-5 to OD-7 and OD-12 (W10), OD-8, OD-9 (W11), OD-10, OD-11 (W12); and the tag `psyche-v1.1.0` before S10-02.

## 3. Decisions the next waves need

1. **Which kit card set is authoritative for HC-19 to HC-26c and HC-30a.** The merged HC-18 follows the kit repo's `work-packets-kit-b.md`; the copies in this repo's `work-packets-sheet-w3-w5.md` (and the S-INSTINCT names in W6 to W8) do not match it. Recommendation: retire the W3 and W4 kit cards here, point the ledger at kit-b, and re-verify kit-b HC-19 to HC-26c against hw0 before dispatch (kit-b HC-20 still reads `sheet.proficiency`).
2. **S9-00 scope.** A catalog-wide `life_id` coverage check fails today: ten `life_id` tables are erased by the account-deletion function (0040) or not at all (`turn_records`), not by `sheet_erase_life`. Choose sheet-tables-only, or the union of both erase functions (and decide whether `turn_records` is a gap to fix elsewhere).
3. **Combat XP.** A mob kill already awards `combat` `kill:<action_id>` from the Body's attack record; AN-47b's encounter key would award the same kill again. Choose: replace the attack award with the encounter award, keep both, or key both by encounter.
4. **HC-22 and HC-27b inputs.** The instinct observation carries distances only (no coordinates, no actor ids, no block or recipe lists). Either extend the kit's `observe.ts` (and the world output it parses), or rewrite novelty, variation and position sampling as distance-only rules.
5. **Decision-number list** (section 1) and whether kit ADRs take geldar numbers.
6. **The law check's proficiency** in S9-02 (no `Domain` is law): proposal `prof = 0`, recorded.
7. Housekeeping the orchestrator can do without the owner: update `sheet/RESUME.md` and regenerate `ledger.md` (G10, G11); scrub the local user-profile path from the three card files (G2).
