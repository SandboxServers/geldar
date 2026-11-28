# Card ledger (generated)

Rows AN-45a and AN-45b refreshed 2026-11-21 against `origin/main` = `2aa29c3a` (#864, decision 0391); all other geldar rows are as regenerated 2026-11-20 against `origin/main` = `0e0d795e` (merge of #827) and not re-checked since; rows AN-27b, AN-28b, AN-47c and AN-50b updated for the chain completion at `f03ab6e1` (merge of #832). The geldar rows come from the merged PRs (`gh pr list --state merged`, `git log --first-parent`), the worknotes in [worknotes/](worknotes/), the card files and the origin branches. Kit rows (HC-nn) are carried unchanged from the 2026-11-18 regeneration (kit `origin/scriptorium/hw0` = `673d756`, not re-checked on 2026-11-20: unverified). The 2026-11-18 inputs were [sheet-cards-verification-2026-11-18.md](sheet-cards-verification-2026-11-18.md) (verdicts) and the operator rulings 0320 to 0328. The README ledger summarises these; this file is the exact list. Regenerate it after any card edit.

File column: `geldar A` / `geldar C` / `kit A` / `kit B` / `kit C` / `extra` are the 2026-11-14 card files in this folder; `sheet W3-W5`, `sheet W6-W8`, `sheet W9-W12`, `sheet NF` are `work-packets-sheet-*.md`; `kit-b (kit repo)` is `docs/analysis/harness/work-packets-kit-b.md` in `geldar-scriptorium`, authoritative for HC-19 to HC-26c (0320).

Status: `Done (#n)` merged on geldar main (PR number); `Done (kit hw0)` merged on the kit's `scriptorium/hw0`; `Ready` the card can be dispatched once the global fixes G1 to G13 are in its brief; `FixNeeded` the card must be corrected first (reason given); `Writing` written, not yet verified; `BlockedDependency` / `BlockedDecision` not dispatchable (reason given); `Retired (NNNN)` will not be built, by that decision; `Inactive (NNNN)` not dispatched this campaign, feature stays off, by that decision; `Deferred to v2 (NNNN Qn)` kept in full, not dispatched in v1, revisited for v2, by that answer; `Queued` not started, waiting its place in a strict serial chain; `In revival` work exists on a branch with no PR and is being resumed; `Held` finished or nearly so but not dispatchable until the operator approves wording; `Superseded by X` replaced by another card; `Kit-owned` tracked in the kit's own ledger. Every merged sheet card is inactive by default, and every feature is held on the live server (2026-11-15 ruling).

| Card | Title | File | Depends on | Size | Status |
|---|---|---|---|---|---|
| AN-02a | contract unblocker, part 1: sheet, roll, decision, adoption | geldar A | GX-01a, P0 | 45k | Done (#372) |
| AN-02b | contract unblocker, part 2: proficiency, evidence fact, state subjects | geldar A | AN-02a | 40k | Done (#386) |
| AN-03a | the psyche package skeleton, sheet normalization, RNG | geldar A | AN-02a | 45k | Done (#401) |
| AN-03b | psyche rolls, exact probabilities, step and factor | geldar A | AN-03a, AN-02a | 45k | Done (#409) |
| AN-03c | temperament bank as inactive psyche data | geldar A | | | Done (#411) |
| AN-04a | SQL part 1: adopted sheet, proficiency, unique XP evidence, outbox (0050) | geldar A | AN-02a | 45k | Done (#395) |
| AN-04b | SQL part 2: roll and decision projections, adoption log (0051) | geldar A | AN-04a, AN-02a | 45k | Done (#403) |
| AN-04c | erase comments for dead lives (0052, decision 0282) | geldar A | | | Done (#455) |
| AN-05 | Body and roster loaders: the sheet, config and adoption | geldar A | GX-01b, AN-03a, AN-04b | 50k | Done (#439) |
| AN-05b | roster loader | geldar A | | | Done (#467) |
| AN-06a | sink audit projection (rolls, decisions, adoptions) | geldar A | AN-04b, AN-02a | 45k | Done (#426; CI lane #433) |
| AN-06b | the Body's audit producer | geldar A | AN-03b, AN-02a | 45k | Done (#431) |
| AN-07 | foundation wiring, inactive | geldar A | AN-05, AN-06a, AN-06b | 45k plus ops evidence | Done (#453) |
| AN-S0 | W2 scaffold | geldar A | | | Done (#456) |
| AN-08a | the pure threat policy, in psyche (psyche 1.1.0) | geldar A | AN-07, AN-03b | 40k | Done (#458) |
| AN-08b | the Body reflexes use the policy | geldar A | AN-08a | 50k | Done (#476) |
| AN-09a | the XP evidence matrix and normalizer | geldar A | AN-07, AN-02b | 45k | Done (#473) |
| AN-09b | Body evidence producers (first chunk visit, attack target kind) | geldar A | AN-07, AN-02b | 45k | Done (#468) |
| AN-09c | program on intent events | geldar A | | | Done (#509) |
| AN-10a | exactly-once XP: the evidence ledger and the increment | geldar A | AN-09a, AN-04a | 45k | Done (#472) |
| AN-10b | level publication and reconciliation | geldar A | AN-10a | 40k | Done (#478) |
| AN-11a | the proficiency state service (sink side) | geldar A | AN-10b, AN-02b | 45k | Done (#480) |
| AN-11b | the Body's proficiency cache | geldar A | AN-07, AN-02b, AN-03b | 45k | Done (#471) |
| AN-11c | proficiency state reply without `sheet` and `sheet_hash` (0280 item 3 still describes them; the schema refuses them) | geldar A | AN-11a | | Done (#487) |
| AN-12a | Body integration, inactive by default | geldar A | AN-08b, AN-09b, AN-11b | 50k plus ops | Done (#493) |
| AN-12b | sink integration, inactive by default | geldar A | AN-10b, AN-11a | | Done (#492) |
| GX-01a | the harness and model stamp, contract, SQL column and sink write | geldar A | HC-04, P0 | 35k | Done (#353) |
| GX-01b | the Body stamps its events | geldar A | GX-01a | 40k | Done (#427) |
| GX-01c | the MCP stamps `sovereign_call`; the operator sets the declared model | geldar A | GX-01a | 40k | Done (#437) |
| GX-02 | release the `psyche/` engine so the kit can mirror it (tag `psyche-v1.0.0`) | geldar A | AN-03b | 30k | Done (#413); `psyche-v1.1.0` is on origin (tag object `f4ecf342`, commit `194680f6`; `psyche/` identical to the #458 merge `4cff991d`, checked 2026-11-20) |
| GX-03 | operator read of an owner's own life sheet (for the kit's launcher) | geldar C | AN-04, AN-05 | about 45k | Writing |
| GX-04a | move the `animus/` pieces the live player path imports to `player-core/` | extra | none | about 45k | Done (#347) |
| GX-05a | turn record schema | turn-record | none | | Done (#452) |
| GX-06 | instinct key and `source` tag, inert | geldar A2 | | | Done (#504) |
| GX-08 | non-advancing wait (`peek`) for the instinct | geldar A2 | GX-06, contract slot | 35k | Done (#526); kit side not wired |
| AN-33a, AN-33b | export role, world exporter, kit ledger ingest | geldar C | | | Superseded by S12-01, S12-02 |
| AN-34a, AN-34b | cohort metrics core and report | geldar C | | | Superseded by S12-02 |
| AN-35a, AN-35b | protocol, validator, collection, run evidence | geldar C | | | Superseded by S12-06 |
| AN-36 | campaign review and rollout close | geldar C | | | Superseded by S12-07 |
| AN-42 | pure inherited-sheet factory | geldar C | | | Superseded by S10-02 |
| AN-43 | bounded drift transition | geldar C | | | Superseded by S11-04 |
| AN-54a, AN-54b | lineage contract and SQL | geldar C | | | Superseded by S10-01a, S10-01b |
| AN-55a, AN-55b | birth function, adapter and CLI | geldar C | | | Superseded by S10-03 |
| AN-57 | lineage integration | geldar C | | | Superseded by S10-04 |
| AN-58a, AN-58b | drift contract and SQL | geldar C | | | Superseded by S11-01, S11-02 |
| AN-59a, AN-59b | drift windows, rule and eligibility | geldar C | | | Superseded by S11-03 |
| AN-60a, AN-60b | revision publication and Body cache reload | geldar C | | | Superseded by S11-04, S11-05 |
| HC-00 to HC-03 | decision record, docs, ChatGPT acceptance, token meter | kit A | | | Kit-owned |
| HC-04 | stamp harness and model on supervisor records | kit A | HC-03 | ~22k | Done (kit hw0) |
| HC-05 | extract `packages/mind-loop` from `packages/chatgpt` | kit A | HC-01 | ~28k | Done (kit hw0) |
| HC-06a, HC-06b | transport interface, generic loop, Responses transport | kit A | HC-05 | ~38k | Done (kit hw0) |
| HC-07 | the `chat` transport | kit A | HC-06a, HC-06b | | Done (kit hw0) |
| HC-08a, HC-08b | `harness: "local"`, launchers start a `local` player | kit A | HC-07, HC-04 | ~38k | Done (kit hw0) |
| HC-08c, HC-09 | `local-endpoint`, egress allowlist entry | kit A | HC-08b | ~30k | Kit-owned |
| HC-10 | context budget and trimming | kit A | HC-07, HC-08a | ~30k | Done (kit hw0) |
| HC-11 | tool-call validation and one corrective retry | kit A | HC-06a, HC-08a, HC-10 | ~28k | Done (kit hw0) |
| HC-12 to HC-16 | image flag, conformance probe, workflow, docs, HW1 close | kit A | | | Kit-owned |
| HC-40 | a ChatGPT usage limit is a limited run | extra | HC-06b | about 30k | Kit-owned |
| HC-17a | mirror the roll engine as `packages/psyche` (pinned to 1.0.0) | kit B | AN-03, GX-02 | | Done (kit hw0) |
| HC-17b | kit-owned sheet parser and `check()` | kit B | HC-17a | 30k | Done (kit hw0) |
| HC-18 | `packages/instinct` and `geldar-instinct` | kit-b (kit repo) | HC-17b | | Done (kit hw0, `4ab4493`) |
| HC-18 to HC-26c (copies) | in-repo copies of the W3 and W4 kit cards | sheet W3-W5 | | | Retired (0320) |
| HC-19 | the supervisor runs `geldar-instinct` before each waking | kit-b (kit repo) | HC-18, HC-04 | 40k | Writing (re-verify against hw0; scriptorium orchestrator's go) |
| HC-20 | failure counting, falling insight DC, retry cap | kit-b (kit repo) | HC-18 | 38k | FixNeeded (0320: proficiency all zero, degraded; drop `sheet.proficiency`) |
| HC-21a | idle choice, weighted pick among known means | kit-b (kit repo) | HC-18 | 45k | FixNeeded (recipe and seen-block inputs are not in `Observation`; not covered by 0324) |
| HC-21b | habits | kit-b (kit repo) | HC-21a, HC-20 | 25k | Writing (re-verify) |
| HC-22 | novelty from authorized knowledge | kit-b (kit repo) | HC-18, HC-46 | 35k | FixNeeded (read the 0324 position fields) |
| HC-23a | the sanity veto inside `packages/mind-loop` | kit-b (kit repo) | HC-10, HC-11 (merged), HC-17b | 45k | Writing (unblocked; OD-B approved 2026-11-27, 0289 follow-up; ships inactive) |
| HC-23b | veto parameters on descriptor 4 | kit-b (kit repo) | HC-19, HC-23a, HC-26c | 25k | BlockedDependency (HC-26c; veto sentences approved 2026-11-27, 0289 follow-up; card in `sheet/kit-cards-2026-11-28.md`, ships inactive) |
| HC-24 | HW2 integration against a fake world, wave close | kit-b (kit repo) | HC-17a to HC-23b, HC-25, HC-26c | 45k plus ops | BlockedDependency (last; card in `sheet/kit-cards-2026-11-28.md`: `GELDAR_INSTINCT_SANITY` defaults off, byte-identical when off) |
| HC-25 | sheet-to-persona generator | kit-b (kit repo) | HC-17b | 40k | BlockedDecision (OD-A) |
| HC-26a | host side of sheet delivery | kit-b (kit repo) | HC-25 | 38k | Writing (re-verify; message file naming) |
| HC-26b | deliver the sheet and roster into the supervisor volume | sheet W6-W8 (kit card rewritten 2026-11-28) | HC-26a, HC-18 | 38k | Writing (card `sheet/kit-cards-2026-11-28.md`; adds `roster.json`) |
| HC-26c | supervisor-side sheet reading; the model never sees it | sheet W6-W8 (kit card rewritten 2026-11-28) | HC-26b, HC-19 | 35k | Writing (card `sheet/kit-cards-2026-11-28.md`) |
| HC-46b | agent `pos` and supervisor-side name roster (kit half) | sheet W6-W8 (kit card rewritten 2026-11-28) | HC-46a, HC-26b; geldar `players-cli roster export` (on main, d5eaf9ae) | 22k | Writing (card `sheet/kit-cards-2026-11-28.md`; ships inactive) |
| HC-33 | promises and due wakes (question card) | sheet W3-W5 (kit C copy is history) | none | 15k | Ready (docs only; D-HC-06 deferred) |
| HC-46 | kit observation carries positions and ids (`observe.ts` and the world output it parses), per 0324 | new card (being written; title to confirm) | HC-18 | | Writing |
| AN-24 | observed-actor contract | sheet W5 | AN-12, contract slot 1 | 40k | Done (#782) |
| AN-25 | visible attacker identity | sheet W5 | AN-24 | 40k | Done (#797) |
| AN-26a | pickup provenance in the plugin | sheet W5 | AN-24, AN-27a | 40k | Done (#798; real toss capture 2026-11-20, #823) |
| AN-26b | observed gift in the recipient's Body | sheet W5 | AN-24, AN-25, AN-26a | 40k | Done (#825; built from the real toss capture) |
| AN-27a | break provenance in the plugin | sheet W5 | AN-24 | 40k | Done (#781; real break captures with CoreProtect present and absent, 2026-11-20, #823) |
| AN-27b | observed property break in the owner's Body | sheet W5 | AN-24, AN-25, AN-27a | 35k | Done (#829, merge `d0ae058d`; first link of the serial chain, review 2 ship; revert-checks re-run on current main) |
| AN-28a | delivery path to the player log | sheet W5 | AN-24, AN-25 | 45k | Done (#809) |
| AN-28b | Body subscription and leakage gate (split) | sheet W5 | AN-25, AN-26b, AN-27b, AN-28a | 50k plus ops | Done (#830, merge `6aef7a32`; inert: the Body option `observations` is absent by default; leakage gate runs the Body code; three review rounds) |
| AN-28c | plugin setup, `geldar.ps1` NATS rows, nats-auth tests (split from AN-28b) | sheet W5 | AN-28b | | Done (#817; follow-ups #818; guard redo v2 #819, which supersedes the first guard branch). Merged before AN-28b, so the depends-on order on the card was not enforced |
| HC-27a | social model rules, update arithmetic and store | sheet W6-W8 (supersedes kit C) | HC-18, HC-17b | 30k | Ready |
| HC-27b | observations: scope, dedup, sampling and apply | sheet W6-W8 (supersedes kit C) | HC-27a, AN-28a, HC-46 | 38k | FixNeeded (read the 0324 id and position fields; W5 merged) |
| HC-28a | prediction by interpolation and exact branches | sheet W6-W8 (supersedes kit C) | HC-27a, HC-17b | 28k | Ready |
| HC-28b | stranger policy | sheet W6-W8 (supersedes kit C) | HC-27b, HC-28a | 30k | Ready (after deps) |
| HC-29 | bounded social prose as prompt facts | sheet W6-W8 (supersedes kit C) | HC-27a | 32k | Ready (text inactive; prose bank unapproved) |
| HC-30a | W6 integration, inactive | sheet W6-W8 (supersedes kit C) | HC-27b, HC-28b, HC-29, HC-24, HC-19 | 38k | FixNeeded (S-INSTINCT names) |
| HC-30b | W6 wave close (docs) | sheet W6-W8 (supersedes kit C) | HC-30a | 20k | BlockedDependency |
| HC-27c | kit reader for `fight_seen` and `container_taken` | sheet W6-W8 | HC-27b, AN-46 | 18k | Ready (after deps) |
| AN-44 | program shapes and the body-api contract change | sheet W6-W8 | W5 contract merged, contract slot 2 | 40-50k | Done (#788) |
| AN-39 | explore program | sheet W6-W8 | AN-44 (merge order) | 45-50k | Done (#789; inert, unregistered) |
| AN-40 | farm program | sheet W6-W8 | AN-44 (merge order) | 45-50k | Done (#791; inert, unregistered) |
| AN-41 | patrol program | sheet W6-W8 | AN-44 (merge order) | 35-45k | Done (#790; inert, unregistered) |
| AN-40a | a program mines one exact cell (`mineAt`; decision 0349; no contract slot) | sheet W6-W8 | none | | Done (#783; card #785) |
| AN-45a | register the programs, drift test (split from AN-45) | sheet W6-W8 | AN-39, AN-40, AN-41, AN-44, AN-28b | 45-50k | Done (#864, merge `2aa29c3a`, 2026-11-21; released by decision 0391 point 3; inert: no body-api version lists the programs) |
| AN-45b | body-api v11 and its sha pins (split from AN-45) | sheet W6-W8 | AN-45a | 45-50k plus ops | Ready per decision 0391 (released from Held 2026-11-21); no merge in `git log origin/main` at `2aa29c3a` (status of any branch unverified); the AN-45a worknote says AN-45b needs owner approval of the program summaries and examples wording, which 0391 does not mention (it approves the `INTENT_WHY` sentences only) |
| HC-31 | idle binding for explore, farm and patrol | sheet W6-W8 (supersedes kit C) | HC-21a, AN-44, AN-45 | 25k | BlockedDependency |
| AN-46 | evidence-source contract | sheet W6-W8 | AN-45 (contract order), AN-24, contract slot 3 | 40-50k | Done (#792) |
| AN-46b | optional `player` on the combat-fact event (follow-up to AN-46) | sheet W6-W8 | AN-46 | | Done (#801) |
| AN-47a | combat facts in the plugin | sheet W6-W8 | AN-46, AN-27a | 45-50k | Done (#799, #802, #804; real `combat_fact` captures 2026-11-20, #823) |
| AN-47b | combat award normaliser (0321 shared encounter key; the visible-fight half is AN-47c) | sheet W6-W8 | AN-46, AN-47a, AN-25, AN-09a | 45-50k | Done (#814; its worknote still lists a real-payload capture as owed, and whether the fixtures were refreshed from the #823 captures is unverified) |
| AN-47c | visible-fight observation in the Body (`fight_seen`) | sheet W6-W8 | AN-46, AN-25, AN-28b (subject helpers) | | Done (#831, merge `49868434`; built from the real `engaged` captures in `fixtures/combat-real.json`) |
| AN-47e | eventsink sheet switch through the node env file (`colo.yml` pass-through, default off) | sheet W6-W8 (AN-12b follow-up) | AN-12b | 10-15k | Done on `phase1/eventsink-sheet-env` (local commit, not pushed; worknote `AN-47e-eventsink-sheet-env.md`) |
| AN-49 | conversation exchange and social award keys | sheet W6-W8 | AN-46, AN-09a | 40-50k | Done (#800) |
| AN-51a | container-taking facts in the plugin | sheet W6-W8 | AN-46, AN-27a | 35-45k | Done (#810; captures #823, anvil and enchanting-table re-run #826) |
| AN-51b | observed container taking in the owner's Body | sheet W6-W8 | AN-46, AN-51a, AN-25 | 30-40k | Done (#811) |
| AN-45c | actor basis on ObservedActor (`seen`, `spoke`, `signed`); named sentence only when present (0450 item 6) | sheet W6-W8 | PR #955 merged; AN-46; serial contract slot; `phase1/sheet-presenter-rows` | 30-35k | BlockedDependency (#955; colo-images batch window; inert, held-live) |
| AN-51c | `agents[].pos` for perceived agents, never ids (0391 item 4; 0451 if a record is needed) | sheet W6-W8 | AN-45c (next contract slot); AN-51b | 30-40k | BlockedDependency (AN-45c; owner wording; inert, held-live) |
| GX-ROSTER | operator-only `players-cli` verb exports `roster.json` as flat name-to-life JSON, max 16 KiB, never shown to the model (0289) | sheet W6-W8 | tools/players-cli (colo-images) | 20-25k | Done on geldar main (`roster export --out`, `d5eaf9ae`; 0289 item 7); delivery is kit card HC-26b |
| AN-50a | evidence registration: sink `case` arms and plugin registration behind the default-off gate | sheet W6-W8 | AN-47b, AN-49, AN-51a, AN-28c | 45-50k plus ops | Done (#820; combat and container-take provenance registered, `combat_fact` awards, inert) |
| AN-50b | Body subscription and leakage gate for the evidence observations | sheet W6-W8 | AN-50a, AN-47c, AN-51b, AN-28b | 45-50k plus ops | Done (#832, merge `f03ab6e1`; last link of the chain; take and combat subjects subscribed, `fight_seen` and `container_taken` map but present no line; live items pending operator approval) |
| AN-50b-ops | item-2 scratch stack recipe card: the throwaway-desktop run of the item-2 live harness | work-packets-item2-scratch-stack.md | AN-50b | 10-15k | Held (recipe written; not run; waits for the RCON route in gap G1 and owner approval) |
| S9-00a | `turn_records` joins the account-deletion path (SQL 0053; 0323) | sheet W9-W12 | none | | Done (#778) |
| S9-00 | erasure gate: every life-keyed table is erased | sheet W9-W12 | turn_records erase fix | 20k | Ready (S9-00a merged in #778; no gate PR on main as of 2026-11-20) |
| S9-01 | refusal reason code and decision key | sheet W9-W12 | | 35k | Retired (0326) |
| S9-02a, S9-02b | the property-refusal hook | sheet W9-W12 | | 50k | Retired (0326) |
| S9-03 | bind the hook behind `morality_hooks` | sheet W9-W12 | | 35k | Retired (0326) |
| S9-04 | W9 close (ops) | sheet W9-W12 | | ops | Retired (0326) |
| HC-41 | reflection facts never carry hidden truth | sheet W9-W12 | HC-32, HC-26 | 30k | BlockedDecision (HC-32) |
| HC-32 | day facts for the reflect skill | kit C | HC-29 | about 22k | BlockedDecision |
| S10-01a, S10-01b | lineage contract and SQL | sheet W9-W12 | | 40-45k | Inactive (0327) |
| S10-02 | pure inherited-sheet factory | sheet W9-W12 | | 40k | Inactive (0327) |
| HC-42 | re-mirror psyche with the factory | sheet W9-W12 | | 20k | Inactive (0327) |
| S10-03 | birth transaction and adapters | sheet W9-W12 | | 50k | Inactive (0327) |
| HC-43 | child text approval gate | sheet W9-W12 | | 35k | Inactive (0327) |
| S10-04 | W10 integration and ancestry query | sheet W9-W12 | | 35k plus ops | Inactive (0327) |
| HC-34a to HC-34c, HC-35a to HC-35c | lineage record, `new --parents`, seed synthesis | kit C | | | Inactive (0327) |
| S11-01 to S11-06 | drift contract, SQL, evidence, transition, cache reload, integration | sheet W9-W12 | | | Inactive (0327) |
| HC-44 | persona refresh artifact and review gate | sheet W9-W12 | | 35k | Retired (0327, OD-9) |
| HC-36a, HC-36b | drift trigger, persona-refresh export verb | kit C | | | Retired (0327, OD-9) |
| HC-37a, HC-37b | ledger exporter and `export-ledgers` verb | kit C | HC-19, HC-03 | about 36-38k | Writing |
| HC-38 | cohort arms by harness | kit C | HC-16, HC-26, HC-08, HC-37b | about 40k | Writing |
| HC-39 | campaign close (kit) | kit C | every other card | about 25k | Writing |
| S12-01 | exporter role and world exporter (SQL 0056) | sheet W9-W12 | AN-04b (S11-02 dropped by 0327) | 50k | FixNeeded (dependency; split role/SQL from exporter) |
| S12-02 | cohort metrics core | sheet W9-W12 | S12-01 | 50k | BlockedDependency |
| S12-03 | control equivalence proof (all-3 equals today's bot) | sheet W9-W12 | AN-12 | 35k | Done (#780; silent record when no roll was drawn, S12-03b #795) |
| S12-04a | roster conversion: loader and dry run | sheet W9-W12 | AN-05, AN-04b | | Done (#786; dry-run plan, inactive) |
| S12-04b | roster conversion: write (SQL 0057, CHECK widening only, the card's one non-additive statement), all-3 only | sheet W9-W12 | S12-04a | | Card rewritten 2026-11-28 (`work-packets-sheet-w9-w12.md`); code READY after S12-04a; any apply on a live agent held (0328) |
| GX-NATS | NATS generator: eventsink `life.*.sheet` publish; body and paper deny `life.>`; AN-28c provenance rules kept | sheet W9-W12 | AN-28c (merged #817) | 15k | Writing (card in `work-packets-sheet-w9-w12.md`; apply to live is a separate ops run) |
| HC-45 | per-player sheet and instinct switch, staged enable, rollback | sheet W9-W12 | HC-19, HC-26 | 35k | FixNeeded (no exact file named) |
| S12-05 | staged enable per ranger and rollback | sheet W9-W12 | S12-03, S12-04, HC-45 | 30k docs | BlockedDecision (OD-11; per-ranger approval, 0328) |
| S12-06 | run protocol, fixtures and run evidence | sheet W9-W12 | S12-02, S12-03, HC-38, HC-37b | 45k | BlockedDecision (OD-11) |
| S12-07 | campaign review and rollout close | sheet W9-W12 | S12-06 | 25k | BlockedDependency |
| AN-NF-00 | evidence config, bus, world names, setup skeleton | sheet NF | P3-1 to P3-3 (merged), AN-24 | 35k | BlockedDependency (AN-24; P3-LIVE, P4 for merge) | **Decision 0390 is Accepted (operator ruling, 2026-11-27, see 0289) and supersedes 0329. The NeoForge twins stay frozen until their cards are re-dispatched; nothing is activated (held-live stands).** |
| AN-NF-25 | named player actor, contract and golem, inert on Paper (0329 NF-2; A6, A7) | sheet NF | AN-24, AN-25 | 35k | BlockedDependency (AN-24, AN-25; P3-LIVE, P4 for merge); A6, A7 on hold with 0329 | **Decision 0390 is Accepted (operator ruling, 2026-11-27, see 0289) and supersedes 0329. The NeoForge twins stay frozen until their cards are re-dispatched; nothing is activated (held-live stands).** |
| AN-NF-27a | break provenance on NeoForge, every actor named | sheet NF | 0329 Q1, AN-NF-00, AN-27a with A1, A2, A4, P4 | 35k | Deferred to v2 (0329 Q1: not needed for v1) | **Decision 0390 is Accepted (operator ruling, 2026-11-27, see 0289) and supersedes 0329. The NeoForge twins stay frozen until their cards are re-dispatched; nothing is activated (held-live stands).** |
| AN-NF-26a | pickup provenance on NeoForge, thrower named | sheet NF | 0329 Q1, AN-NF-00, AN-26a with A1, A2, P4 | 35k | Deferred to v2 (0329 Q1: not needed for v1) | **Decision 0390 is Accepted (operator ruling, 2026-11-27, see 0289) and supersedes 0329. The NeoForge twins stay frozen until their cards are re-dispatched; nothing is activated (held-live stands).** |
| AN-NF-28b | W5 wiring on NeoForge (no NATS rows) | sheet NF | 0329 Q1, AN-NF-26a, AN-NF-27a, AN-NF-50, P4 | 30k | Deferred to v2 (0329 Q1: not needed for v1) | **Decision 0390 is Accepted (operator ruling, 2026-11-27, see 0289) and supersedes 0329. The NeoForge twins stay frozen until their cards are re-dispatched; nothing is activated (held-live stands).** |
| AN-NF-47a | combat facts on NeoForge (killing-blow credit, 0329 NF-4; no combat provenance) | sheet NF | AN-NF-00, AN-46, AN-47a with A3, P3-LIVE, P4 | 40k | BlockedDependency (AN-46, AN-47a; P3-LIVE, P4) | **Decision 0390 is Accepted (operator ruling, 2026-11-27, see 0289) and supersedes 0329. The NeoForge twins stay frozen until their cards are re-dispatched; nothing is activated (held-live stands).** |
| AN-NF-51a | container-take provenance on NeoForge | sheet NF | none | | Dropped (0329 NF-3: container-taking inactive on NeoForge) | **Decision 0390 is Accepted (operator ruling, 2026-11-27, see 0289) and supersedes 0329. The NeoForge twins stay frozen until their cards are re-dispatched; nothing is activated (held-live stands).** |
| AN-NF-50 | W8 wiring on NeoForge (combat facts) | sheet NF | AN-NF-47a, AN-NF-00, P3-LIVE, P4 | 25k | BlockedDependency (AN-NF-47a; P3-LIVE, P4) | **Decision 0390 is Accepted (operator ruling, 2026-11-27, see 0289) and supersedes 0329. The NeoForge twins stay frozen until their cards are re-dispatched; nothing is activated (held-live stands).** |
| CS-0 | contract public-surface golden test before the `index.ts` split | contract-index-split-plan | none | | Done (#805) |
| CS-1 | split `contract/src/index.ts` into nine domain files (pure move) | contract-index-split-plan | CS-0 | | Done (#813; rule 9 note #812) |
| CS-2 | split `contract/test/mcp-world.test.ts` into drift tests and fixtures | contract-index-split-plan | CS-0 | | Done (#806) |
| CAP-1 to CAP-5 | provenance capture workstream: capture tool, scratch-shard script and run sheet, ops runs, fresh-session wipe | worknotes CAP-1, CAP-2; runbook `capture-real-payloads` | AN-26a, AN-27a, AN-47a, AN-51a | | Done (PRs #821, #822, #824, #827; evidence #823, #826). The CAP-n split by PR is not recorded in the worknotes: unverified |
| NF-CHAT-0 | guard narrowing: chat event names in `HearingChat.java` only | NF chat plan (NeoForge campaign) | a decision record | | BlockedDecision (record not written) |
| NF-CHAT-1 | `HearingJudge` over `ChatHearing` | NF chat plan (NeoForge campaign) | none | | Ready (NeoForge campaign's to dispatch) |
| NF-CHAT-S | delivery spike, scratch shard | NF chat plan (NeoForge campaign) | NF-CHAT-0, NF-CHAT-1 | ops | BlockedDependency |
| NF-CHAT-2 | proximity chat on NeoForge, off by default; unblocks HC-27b `spoke_first` and AN-49 there | NF chat plan (NeoForge campaign) | NF-CHAT-S | | BlockedDependency (NF-CHAT-S) |
| NF-CHAT-3 | muffled notices, no speech hash | NF chat plan (NeoForge campaign) | NF-CHAT-2, a 0383 amendment, NF-BODY | | BlockedDecision |
| COLO-COMPOSE-RECONCILE | repo compose reconciled to the node's live settings (variables, opt-in overlay), then the operator copy; the card changes nothing on the node | colo compose (`work-packets-colo-compose-reconcile.md`) | none (0342, 0430, 0212 stand) | 40-50k | BlockedDecision (D1 to D5, owner; Paper recreate needs owner approval) |

Work merged without a card id: the state-subject NATS ACL (#394), the step-0 test-shard driver (#519), the nats-auth test split (#534), the card files (#457, #463, #464).

Cards needed and not yet written: the NeoForge Body halves of AN-28b and AN-50 (wait for NF-BODY). The `turn_records` erase fix is written and merged (S9-00a, #778; S9-00 is now Ready). The kit psyche re-mirror to 1.1.0 (G13, card HC-48) is unblocked: the `psyche-v1.1.0` tag is on origin; its kit-side state was not checked.

Open flags (2026-11-20): (1) 0325 approved the tag on the #458 merge `4cff991d`; the tag on origin points at `194680f6` (the #764 merge). `psyche/` is identical between the two, so the content is the same; the record and the tag differ only in commit. (2) Decision 0390 (NeoForge hybrid human model) is Proposed and, if accepted, supersedes 0329; the NF rows keep their operator-revision flag until then. (3) Held-live ruling of 2026-11-15 still applies: every merged card above is inert, with no Colo apply, no plugin jar and no NATS conf change.
