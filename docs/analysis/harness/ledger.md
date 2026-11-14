# Card ledger (generated)

Generated from the card files by `tools-ledger.mjs`, reading each card's heading and its depends-on line. 104 cards: 59 kit (HC), 39 world (AN) and 6 new world (GX). Status is the status when written: `Writing` means the card is written but not yet reviewed or dispatched. The README ledger summarises these; this file is the exact list. Regenerate it after any card edit.

| Card | Title | File | Depends on | Size | Status |
|---|---|---|---|---|---|
| AN-02a | contract unblocker, part 1: sheet, roll, decision, adoption | geldar A | GX-01a (generated-file order), P0 | 45k | Writing |
| AN-02b | contract unblocker, part 2: proficiency, evidence fact, state subjects | geldar A | AN-02a | 40k | Writing |
| AN-03a | the psyche package skeleton, sheet normalization, RNG, dependency and image lines | geldar A | AN-02a | 45k | Writing |
| AN-03b | psyche rolls, exact probabilities, step and factor, temperament bank | geldar A | AN-03a, AN-02a | 45k | Writing |
| AN-04a | SQL part 1: adopted sheet, proficiency, unique XP evidence, publication outbox | geldar A | AN-02a | 45k | Writing |
| AN-04b | SQL part 2: roll and decision projections, adoption log, retention and export map | geldar A | AN-04a, AN-02a | 45k | Writing |
| AN-05 | Body and roster loaders: the sheet, config and adoption (Body paths only) | geldar A | GX-01b, AN-03a, AN-04b | 50k | Writing |
| AN-06a | sink audit projection (rolls, decisions, adoptions) | geldar A | AN-04b, AN-02a | 45k | Writing |
| AN-06b | the Body's audit producer (stable ids, bounded buffer, gap evidence) | geldar A | AN-03b, AN-02a | 45k | Writing |
| AN-07 | foundation wiring, inactive | geldar A | AN-05, AN-06a, AN-06b | 45k plus ops evidence | Writing |
| AN-08a | the pure threat policy, in psyche | geldar A | AN-07, AN-03b | 40k | Writing |
| AN-08b | the Body reflexes use the policy | geldar A | AN-08a | 50k | Writing |
| AN-09a | the XP evidence matrix and normalizer (sink, pure) | geldar A | AN-07, AN-02b | 45k | Writing |
| AN-09b | Body evidence producers (first chunk visit, attack target kind) | geldar A | AN-07, AN-02b | 45k | Writing |
| AN-10a | exactly-once XP: the evidence ledger and the increment, in one transaction | geldar A | AN-09a, AN-04a | 45k | Writing |
| AN-10b | level publication and reconciliation | geldar A | AN-10a | 40k | Writing |
| AN-11a | the proficiency state service (sink side) | geldar A | AN-10b, AN-02b | 45k | Writing |
| AN-11b | the Body's proficiency cache | geldar A | AN-07, AN-02b, AN-03b | 45k | Writing |
| AN-12 | Body and learning integration, inactive by default | geldar A | AN-08b, AN-09b, AN-10b, AN-11a, AN-11b | 50k plus a serial ops ru | Writing |
| AN-33a | export role and world exporter | geldar C | AN-60a, AN-54b, AN-58b (every table exported exists) | about 50k | Writing |
| AN-33b | ingest of the kit's exported ledgers | geldar C | AN-33a, HC-37 | about 40k | BlockedDependency |
| AN-34a | cohort metrics core | geldar C | AN-33a (run folder format) | about 50k | Writing |
| AN-34b | harness and model dimensions, H7 to H9, report | geldar C | AN-34a, AN-33b (formats) | about 50k | Writing |
| AN-35a | protocol, run-set validator and fixtures | geldar C | AN-34a | about 45k | Writing |
| AN-35b | collection scripts, report protocol, run evidence | geldar C | AN-35a, HC-38, AN-60b | about 40k for the coder  | BlockedDependency |
| AN-36 | campaign review and rollout close (world side) | geldar C | AN-35b; HC-39 (kit close) runs alongside | about 30k docs and confi | BlockedDependency |
| AN-42 | pure inherited-sheet factory | geldar C | AN-54a (field list and types), AN-03 (`rngFor` primitives, `normalizeSheet`, `Score`) | about 40k | Writing |
| AN-43 | bounded drift transition and revision record | geldar C | AN-59b | about 45k | Writing |
| AN-54a | lineage contract unblocker | geldar C | AN-02 (sheet shapes, `contract/schemas/character-sheet.schema.json`), AN-53 (wave order). D-CS-09 and D-CS-17 accepted (assumed) | about 40k | Writing |
| AN-54b | lineage SQL (births, handoffs, `effective_sheet()`) | geldar C | AN-54a, AN-04 | about 45k | Writing |
| AN-55a | birth function and handoff transitions (SQL) | geldar C | AN-54b, AN-04, AN-05 | about 50k (split off the | BlockedDependency |
| AN-55b | birth adapter and operator CLI | geldar C | AN-55a, AN-42 | about 45k | BlockedDependency |
| AN-57 | lineage integration (world half), ancestry query, on/off | geldar C | AN-55b, HC-34, HC-35 | about 40k plus ops evide | BlockedDependency |
| AN-58a | drift contract and policy config | geldar C | AN-57 (wave order; hard prerequisites AN-54a, AN-02), D-CS-13 accepted (assumed) | about 40k | Writing |
| AN-58b | drift SQL | geldar C | AN-58a, AN-54b | about 45k | Writing |
| AN-59a | window math and evidence readers | geldar C | AN-58b, AN-09 | about 45k | Writing |
| AN-59b | rule, decision and eligibility | geldar C | AN-59a | about 40k | Writing |
| AN-60a | revision publication, sleep trigger and ACL (eventsink side, world half of AN-60) | geldar C | AN-43, AN-11 (the life-state request handler this card extends) | about 50k | Writing |
| AN-60b | Body cache reload (golem side, world half of AN-60) | geldar C | AN-58a, AN-11, AN-12 | about 45k | Writing |
| GX-01a | the harness and model stamp, contract, SQL column and sink write | geldar A | HC-04 (kit; the names), P0 | 35k | Writing |
| GX-01b | the Body stamps its events | geldar A | GX-01a | 40k | Writing |
| GX-01c | the MCP stamps `sovereign_call`; the operator sets the declared model | geldar A | GX-01a | 40k | Writing |
| GX-02 | release the `psyche/` engine so the kit can mirror it | geldar A | AN-03b | 30k | Writing |
| GX-03 | operator read of an owner's own life sheet (for the kit's launcher) | geldar C | AN-04 (`agents.character_sheet`, `life_proficiency`), AN-05 (adoption), AN-58b if it is merged first (the function reads `effective_sheet()`; AN-54b c | about 45k | Writing |
| GX-04 | Move the pieces of `animus/` that the live player path imports | extra | none (can run in W1) | about 45k, split into GX | Writing |
| HC-00 | Record D-HC-01 to D-HC-11 as a decision (docs only, no code) | kit A | none |  | Writing |
| HC-01 | Docs describe three harnesses (clients, architecture, chatgpt) | kit A | none (HC-00 only for the decision number it cites) | ~12k | Writing |
| HC-02 | Record the ChatGPT harness live acceptance (ops, no code) | kit A | PR #103 (merged) | ~5k | Writing |
| HC-03 | Token and turn meter and daily token cap for every harness | kit A | none |  | Writing |
| HC-04 | Stamp harness and model on supervisor records and the keeper checkpoint | kit A | HC-03 (same files) | ~22k | Writing |
| HC-05 | Extract `packages/mind-loop` from `packages/chatgpt` (no behaviour change) | kit A | HC-01 (ordering only; nothing here needs it) | ~28k | Writing |
| HC-06a | Transport interface and the generic round loop in mind-loop | kit A | HC-05. Splits HC-06 (this half adds the loop and a fake-transport test; HC-06b moves the Responses code behind it) |  | Writing |
| HC-06b | Move the Responses transport behind the interface | kit A | HC-06a | ~38k (at the cap; if the | Writing |
| HC-07 | The `chat` transport (chat completions, function tools) | kit A | HC-06a (the interface), HC-06b (neutral `Block`s) |  | Writing |
| HC-08a | `harness: "local"` in the kit: settings, supervisor, compose, schema, `geldar-local run` | kit A | HC-07, HC-04 (same supervisor file). Per v3 plan ruling 3 the owner closes HC-02 before this is used; the code merges inactive either way (D-HC-11) | ~38k | Writing |
| HC-08b | Launchers read and start a `local` player; `new --cli local` | kit A | HC-08a |  | Writing |
| HC-08c | `local-endpoint`: the endpoint setting outside the workspace | kit A | HC-08b | ~30k | Writing |
| HC-09 | Egress allowlist entry for the configured local endpoint | kit A | HC-08c (it reads `local/base-url`) | ~32k | Writing |
| HC-10 | Context budget and trimming | kit A | HC-07 (the trimming lives in `ChatTransport`; the ledger lists HC-05) and HC-08a (it edits `packages/local/src/cli.ts`) | ~30k | Writing |
| HC-11 | Tool-call validation and one corrective retry | kit A | HC-06a (the loop; the ledger lists HC-05), HC-08a and HC-10 (all three edit `packages/local/src/cli.ts`, so this card runs after HC-10, not beside it) | ~28k | Writing |
| HC-12 | Image flag: text-only worlds for text-only models | kit A | HC-10 (same file `chat.ts`) | ~20k | Writing |
| HC-13a | `runCheck` conformance probe and `geldar-local check` | kit A | HC-08a, HC-10, HC-11, HC-12 (it exercises the real transport) |  | Writing |
| HC-13b | `local-check` verb in both launchers and the start gate | kit A | HC-13a, HC-09 |  | Writing |
| HC-14 | Conformance workflow against Ollama and vLLM with a small model | kit A | HC-13a | ~25k | Writing |
| HC-15 | Docs: `docs/local-models.md`, onboarding, troubleshooting links | kit A | HC-13b (every key it links already has its troubleshooting section from HC-08b, HC-08c and HC-13b; the repo test forces that in the same PR as the key | ~18k | Writing |
| HC-16 | HW1 integration, owner acceptance run (ops) and wave close | kit A | HC-09 to HC-15. Two parts: Part 1 is a coder's docs sweep and retro stub; Part 2 is run by the owner or the session, not by a coder | ~20k for Part 1 | Writing |
| HC-17a | mirror the roll engine as `packages/psyche`, pinned by a tree hash | kit B | AN-03 and GX-02 (geldar), D-HC-02. If the engine is not released yet, write the script, the test and a placeholder-free skeleton, mark the card `Block |  | BlockedDependency |
| HC-17b | kit-owned sheet parser and the `check()` helper in `packages/psyche` | kit B | HC-17a merged (a stub `engine/index.ts` exporting the sketch names is acceptable only for local typechecking and must not be committed) | 30k | Writing |
| HC-18 | `packages/instinct` and `geldar-instinct`: the world link and the result protocol | kit B | HC-17b. If kit A's `packages/mind-loop` (HC-05) already exports a world connector, import it and do not write `world.ts`'s `connectWorld`; otherwise w |  | Writing |
| HC-19 | the supervisor runs `geldar-instinct` before each waking | kit B | HC-18, HC-04 (stamps), and HC-08 if it has merged (it owns the `harness` union in `settings.ts`; add only the new `instinct` member) |  | Writing |
| HC-20 | failure counting, the falling insight DC and the per-agent retry cap | kit B | HC-18 (the `Fx` type, `FxContext`) | 38k | Writing |
| HC-21a | idle choice, the weighted pick among known means (D-CS-01) | kit B | HC-18 |  | Writing |
| HC-21b | habits, the means that worked for a goal | kit B | HC-21a, HC-20 (`last_intent` is recorded there) | 25k | Writing |
| HC-22 | novelty from authorized knowledge | kit B | HC-18 | 30k | Writing |
| HC-23a | the sanity veto inside `packages/mind-loop` (owned-loop harnesses) | kit B | HC-10, HC-11 (the call allowance and the corrective retry; kit A) and HC-17b. If either has not merged, the card is `BlockedDependency` |  | BlockedDependency |
| HC-23b | deliver the veto parameters to the loop on descriptor 4 | kit B | HC-19, HC-23a, HC-26c (`readSheetFile`) | 25k | Writing |
| HC-24 | HW2 integration against a fake world, docs, wave close | kit B | HC-17a to HC-23b merged on `scriptorium/hw2` |  | Writing |
| HC-25 | sheet-to-persona generator for `geldar-play new` (both launchers) | kit B | HC-17b |  | Writing |
| HC-26a | host side of sheet delivery: `new --sheet` and `sheet-set` | kit B | HC-25 (group `sheet`, messages file pattern), D-HC-03 | 38k | Writing |
| HC-26b | deliver the sheet into the supervisor volume at start and restart | kit B | HC-26a, HC-18 (`check-sheet`) | 35k | Writing |
| HC-26c | supervisor-side sheet reading and the proof the model never sees it | kit B | HC-26b, HC-19 | 35k | Writing |
| HC-27a | Social model rules, update arithmetic and store | kit C | HC-18 (package `packages/instinct` exists), HC-17 (type import) | about 30k | Writing |
| HC-27b | Observations: scope, dedup, sampling and apply | kit C | HC-27a, AN-28 (W-1 field names) | about 38k | Writing |
| HC-28a | Prediction by interpolation and exact branches | kit C | HC-27a, HC-17 (B-1, B-2) | about 28k | Writing |
| HC-28b | Stranger policy | kit C | HC-27b, HC-28a | about 30k | Writing |
| HC-29 | Bounded social prose as prompt facts | kit C | HC-27a | about 32k | Writing |
| HC-30a | HW4 integration (observe, stranger, facts) | kit C | HC-27b, HC-28b, HC-29, HC-24, HC-19 | about 38k | Writing |
| HC-30b | HW4 wave close: docs, retro, process | kit C | HC-30a | about 20k (docs only) | Writing |
| HC-31 | Idle binding for explore, farm and patrol | kit C | HC-21 (B-5), AN-44 and AN-45 (W-2, the contract file for program arguments and limits) | about 25k | Writing |
| HC-32 | Day facts for the reflect skill | kit C | HC-29 | about 22k | BlockedDecision |
| HC-33 | Promises in the kit (question card, BlockedDecision D-HC-06) | kit C | (see card) |  | BlockedDecision |
| HC-34a | `geldar-seed` package: lineage record check | kit C | AN-54, AN-55 (W-3) | about 28k | Writing |
| HC-34b | `new --parents`: parse and check (both launchers) | kit C | HC-34a, HC-26 (B-7) | about 40k | Writing |
| HC-34c | `new --parents`: create exactly once (both launchers) | kit C | HC-34b | about 40k | Writing |
| HC-35a | Seed synthesis: inputs, prompt and validation | kit C | HC-34a (the package) | about 30k | Writing |
| HC-35b | Seed synthesis: the supervisor runs it on the parent's harness | kit C | HC-35a, HC-04, HC-08 (A2, A3) | about 40k | Writing |
| HC-35c | `geldar-play seed` verb (both launchers) | kit C | HC-35b, HC-34b | about 40k | BlockedDependency |
| HC-36a | Drift trigger at sleep and the persona refresh artifact | kit C | AN-43, AN-58, AN-59, AN-60, HC-25, HC-26 | about 35k | BlockedDependency |
| HC-36b | `persona-refresh` export verb (both launchers) | kit C | HC-19, HC-03 (A1) | about 30k | BlockedDependency |
| HC-37a | Ledger exporter (library and binary) | kit C | HC-19, HC-03 (A1) | about 36k | Writing |
| HC-37b | `export-ledgers` verb (both launchers) | kit C | HC-37a | about 38k | Writing |
| HC-38 | Cohort arms by harness | kit C | HC-16 (A5), HC-26 (B-7), HC-08 (A4), HC-37b (the export names the arm files) | about 40k | Writing |
| HC-39 | Campaign close: docs sweep, retro, process | kit C | every other card merged and the campaign review done | about 25k (docs only; a  | Writing |
| HC-40 | A ChatGPT usage limit is a limited run, not a failed cycle | extra | HC-06b (the Responses transport sits behind the interface), PR #102 (merged: the Claude limit handling) | about 30k | Writing |
