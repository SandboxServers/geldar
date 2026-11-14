# Character sheet packet candidates

Status: full-brief planning authorized; proposed slices, not executable briefs. Scope and contracts are in [integration-plan.md](integration-plan.md), with an ordered [decision walkthrough](decisions-before-packets.md). **No candidate is Ready.** Every feature is now scheduled in W0-W12; false-default features still require implementation and enabled/disabled tests. Required behavioral rulings are `BlockedDecision`; after acceptance the orchestrator marks remaining prerequisites `BlockedDependency` and expands the next wave into prescriptive cards. Do not dispatch this document as an implementation spec.

## Card authoring and size

Each entry below names a responsibility, provisional ownership, dependencies and proof. The final card uses every field in `docs/analysis/phase1/packet-conventions.md`: id, wave, depends-on, may-edit, must-not-edit, decisions, checks, size, worknote, commit and on-cap. It also supplies code shapes, fixtures, explicit cap/failure outcomes, exact commands, a branch and an absolute worktree path.

Common fields to expand into every executable card:

- **Size:** estimates below are working-token envelopes for one Haiku-level coder, including reading, checks and report. 50-70k is the feature-packet target, not a minimum spend. Tiny unblockers stay smaller. Reviewer/fix/ops usage is separate. Split a likely over-70k card before dispatch.
- **May-edit:** candidate paths below are ownership boundaries, not permission to edit whole packages. Resolve to exact files when writing the final card. Own test files are included only once explicitly named.
- **Must-not-edit:** `docs/spec.md`, accepted ADRs, merged migrations/prompts/generated output by hand, other packet worknotes and all shared files not assigned to this card. No hidden lockfile or root-index ownership.
- **Decisions:** local D-CS ids identify pending choices only. Reserve actual ADR numbers before authoring; a coder cannot allocate its own. Contracts receive accepted truth tables, including every disabled-flag case.
- **Checks:** named behavior tests and a faithful revert-check; touched-package typecheck and formatting; `git diff --check`; `./geldar.ps1 pnpm check:repo`; merge-tree against the integration branch. Contract cards add `./geldar.ps1 pnpm --filter @geldar/contract generate` and `./geldar.ps1 pnpm check:generated`. Real SQL/NATS/plugin cases are separately recorded by ops.
- **Worknote:** `docs/analysis/character-sheet/worknotes/<id>.md`; one per packet. Preserve reports under `worknotes/reports/` at wave close.
- **Branch/worktree:** `codex/an-<nn>-<slug>`, `.claude/worktrees/an-<nn>` from the named `codex/character-sheet-w<N>` integration branch after prerequisites merge. Give the actual absolute path in dispatch.
- **Commit:** `feat(character): <one concrete result>` or `docs(character): <result>`; final subject and truthful campaign attribution supplied verbatim in the dispatch. Commit passing groups as progress; do not rewrite reviewed history.
- **On-cap:** commit passing work, record base SHA/tests/unfinished steps, leave a clean branch and stop. Do not push, deploy, weaken a test or invent a design to finish. Re-slice if the card needs repeated finishers.

Every wave's final integration card owns only an enumerated wiring list and its own tests. If that list grows beyond its envelope, add a distinct preparatory/wiring card. A retro-generated process card is added when findings require it; it is not concealed inside a feature estimate.

## Shared owners

| Wave | Contract/generated owner | Shared wiring owner | Manifest/lockfile owner | Shard/ACL/image owner |
|---|---|---|---|---|
| W0 | None | AN-00 campaign docs; AN-01 adapters only | None | None |
| W1 | AN-02 | AN-07 | AN-03, serial updates after dependent requests | AN-07 |
| W2 | None; request an unblocker if AN-02 missed a required fact | AN-12 | AN-12, only if needed | AN-12 |
| W3 | None | AN-16 loop; AN-17 startup wiring | AN-17, only if needed | AN-17 |
| W4 | None | AN-23; other cards add independent modules | AN-23, only if needed | AN-23 |
| W5 | AN-24 | AN-28 | AN-28, only if needed | AN-28 |
| W6 | None unless an explicit new unblocker is added | AN-32 | AN-32, only if needed | AN-32 |
| W7 | AN-44 | AN-45 | AN-45, only if needed | AN-45 |
| W8 | AN-46 | AN-50 | AN-50, only if needed | AN-50 |
| W9 | AN-52 | AN-53 | AN-53, only if needed | AN-53 |
| W10 | AN-54 | AN-57 | AN-57, only if needed | AN-57 |
| W11 | AN-58 | AN-60 | AN-60, only if needed | AN-60 |
| W12 | None | AN-36 report/rollout wiring only | AN-33 for exporter dependencies, if any | AN-36; activation requires owner ruling |

The orchestrator owns campaign ledger/RESUME and number reservations; ops applies approved index lines. SQL owners are AN-04 for core state, AN-29 for initial social state, AN-46/52/54/58 for their waves' needed schema additions and AN-33 for final exporter grants. Freeze exact migrations in each unblocker; do not introduce a surprise migration during fan-out. SQL/grants are tested against a fresh scratch DB and a scratch upgrade from the baseline and preceding waves.

## W0: scope and harness

### AN-00: settle and freeze the campaign

- **Depends:** none; owner behavioral rulings from the walkthrough as relevant. Full planning scope is already authorized. **Size:** 20-40k, planning role rather than feature coder.
- **Deliver:** accepted/proposed ADRs with explicit status, idea entry, amendments by reference to 0073, source/XP/chance/evidence/retry truth tables, approved phase boundaries and registry reservations. Record review-policy precedence and the 50-70k budget exception. Reconcile the draft ADR's incorrect Body-owned XP statement.
- **Ownership:** this campaign's docs; newly allocated `docs/decisions/<allocated>*.md`; requested index rows; `docs/ideas.md`; reserved entries in the existing registry only after checking active work. No spec edits.
- **Proof:** every proposed behavior has either an accepted ruling or a named blocked candidate; no occupied ADR/migration/prompt number is claimed. No feature starts just because a draft ADR exists.

### AN-01: optional Codex campaign adapters

- **Depends:** AN-00's D-CS-08/process decisions; independent of product code. **Size:** 30-50k.
- **Deliver:** three project TOML agents and four discoverable skill entry points from [codex-adapters.md](codex-adapters.md), retaining Claude support. Pin role model/effort choices explicitly and keep one maintained procedure body where practical.
- **Ownership:** `.codex/agents/packet-coder.toml`, `packet-reviewer.toml`, `ops.toml`; `.agents/skills/{campaign-packet,ship-pr,run-shard,body-bench}/`; `AGENTS.md` harness routing if approved; precisely named shared procedure files if selected.
- **Proof:** TOML/YAML parse; a fresh disposable Codex session discovers all roles/skills, uses each role's model/effort, reads the correct repo brief and refuses an out-of-scope edit by instruction. Verify reviewer and ops behavior with a harmless scratch task; do not claim a separate sandbox exists. No remote message, PR or live stack is needed.

## W1: durable foundations

### AN-02: core contract unblocker

- **Depends:** AN-00; D-CS-01/03/04/05/07 fixed. **Size:** 45-65k.
- **Deliver:** sheet/config shapes; roll/decision audit payloads; proficiency query/state/level-change and any required typed outcome facts; heuristic thought outcome and decision links; generated exports/validators and subject helpers. Versioned payloads distinguish d20, uniform and deterministic decisions.
- **Ownership:** exact new schemas and existing shard/thought/receipt/outcome schemas that actually need extension; `contract/src/subjects.ts`, export surface, generation registry and generated artifacts. No runtime consumers, package lock or perception-attribution changes.
- **Proof:** standard sheet/default normalization; out-of-range/unknown fields; all event discriminants; bad ids/subjects; backward-compatible old fixtures; actual generated validators. Optional fields do not make preexisting producer payloads invalid.

### AN-03: pure psyche engine and workspace dependency

- **Depends:** AN-02. **Size:** 50-65k.
- **Deliver:** engine skeleton, immutable standard sheet, exact roll probabilities, RNG with specified identity/version seed, `step`/`factor`, alignment-label derivation and fixed temperament bank. Accept injected draws for tests; no I/O.
- **Ownership:** new `psyche/`; `pnpm-workspace.yaml`; named consumer manifests and `pnpm-lock.yaml` as W1's sole dependency owner. Use existing pinned tooling; no new third-party runtime needed.
- **Proof:** exact exhaustive 20/400-outcome counts, edge DCs and all proficiency levels; known seed vectors and producer/restart identity distinctions; floor values 10/8/6/4/2; all alignment cells; marker scan of every sentence. Module import cannot initiate network/DB/model work.

### AN-04: core persistence and grants

- **Depends:** AN-02; accepted lifecycle/audit/XP rules. **Size:** 55-70k.
- **Deliver:** fresh numbered migrations for innate sheet adoption, roll/decision projections, unique XP evidence, canonical proficiency and required durable notification/heuristic state. Add constraints, indexes, role grants and an explicit export/retention map. Keep social models for AN-29.
- **Ownership:** only allocated new `sql/NNNN_*.sql`; exact new `sql/test/` checks and migration fixtures; `sql/README.md` index request. No rewriting old migrations or application implementation.
- **Proof:** real fresh/upgrade/reapply cases; malformed JSON, score ranges, level/XP constraints, unique awards, forbidden-role writes, deletion/retirement behavior and migration ledger registration. No additive table grants implicit PUBLIC access.

### AN-05: sheet adoption and config loaders

- **Depends:** AN-03, AN-04. **Size:** 55-70k.
- **Deliver:** identical normalization through Mind, Adam, sovereign roster and current creation/supervisor paths; explicit initial adoption, no reseed on restart, composed own-life sheet/proficiency reads. Missing config means standard/off under the accepted rule.
- **Ownership:** `animus/src/config.ts`, named agent row/store/fake and birth initialization files; `golem/src/adam/adam-config.ts`, `golem/src/players/player-config.ts`; relevant player-creation adapters in `tools/mcp-tokens/` and the already-landed management path, enumerated before dispatch. No shard values or policy consumers.
- **Proof:** parse real YAML in all paths, reject malformed sheets, round-trip an existing life, distinguish new life from respawn and config mutation, preserve fields in `parsePlayerConfig`'s replacement identity. If creation spans too many adapters, split adoption from creation before dispatch.

### AN-06: durable roll and decision projection

- **Depends:** AN-04; AN-03 if pure normalization is reused. **Size:** 50-65k.
- **Deliver:** eventsink validates and projects audit events transactionally; a shared producer adapter uses stable event ids; malformed records follow the existing poison-event behavior. Handle audit backlog/failure using the accepted bounded policy.
- **Ownership:** new focused `eventsink/src/` audit projection modules, named dispatch/writer hooks and tests; shared producer adapter in an explicitly named existing/new module. No XP increments yet, runtime decisions or ACL-generator changes.
- **Proof:** real JetStream redelivery and rollback produce one audit record; a malformed event is rejected/DLQed as specified; full/closed buffer and reconnect are exercised; audit-gap counts remain visible. Never test durability only with a Map.

### AN-07: foundation wiring and inactive deployment

- **Depends:** AN-05, AN-06. **Size:** 50-70k, with ops evidence separate.
- **Deliver:** runtime profile injection, minimal producer event subscriptions/ACLs, package copies in actual consumer Dockerfiles/ignore files, baseline off config and scratch-service integration wiring. Enumerate `view.ts`, reflex context and startup files before dispatch.
- **Ownership:** named Golem/Animus/eventsink startup wiring, `geldar.ps1` auth generation, relevant auth tests, Dockerfiles/ignore files, checked sample shard config and repo check registrations. AN-03 applies any dependency requests serially.
- **Proof:** frozen-lockfile images load psyche; actual role credentials allow roll publication and deny unrelated subjects; Body and Mind load the same adopted sheet; startup off retains the existing prompts and thresholds. Ops runs DB/NATS integration before the wave is done.

## W2: Body diversity and proficiency

### AN-08: per-life threat policy

- **Depends:** AN-07. **Size:** 55-70k.
- **Deliver:** pure threat policy plus Body fight/retreat integration: shared floor, one courage decision per accepted encounter, unarmed exception, time limit and combat proficiency input. Keep hiss/suicide-mob/arrow mechanics and sight constraints intact.
- **Ownership:** named new `psyche/src/` threat policy; `golem/src/body/reflexes/fight-or-flee.ts`, `retreat.ts` and dedicated tests. Shared profile/cache wiring is AN-12's handoff, using W1 ports.
- **Proof:** armed/unarmed across all floors/band edges; all-3s/off/d20-disabled distinctions; same floor during a fight; no repeated per-tick reroll; two simultaneous lives keep separate profiles; abort/timer cleanup and existing hazard tests. Split an over-cap existing module first if necessary.

### AN-09: proficiency evidence normalization

- **Depends:** AN-07; accepted domain evidence matrix. **Size:** 50-65k.
- **Deliver:** a pure mapping from typed, verified outcomes to zero or more unique domain awards; add the explicitly missing Body fact producers. Persist first-visit evidence for exploring, distinguish committed transfers from tosses and never count failures/cancellations as successes.
- **Ownership:** new focused Body evidence producer modules and own tests; new pure `eventsink/src/` award normalization module. No XP database writes or shared startup files.
- **Proof:** each enabled domain has positive/negative/cancel evidence fixtures; duplicate action/intent/receipt views share one award key; chunk revisits after restart earn no new first-visit XP. Signals awaiting W8 emit no speculative award; their completion remains a named campaign requirement.

### AN-10: exactly-once XP effects and level publication

- **Depends:** AN-09. **Size:** 55-70k.
- **Deliver:** award ledger/increment transaction; derived levels; durable notification/reconciliation after commit. Use an explicit event discriminator so level publications cannot feed back into XP awards.
- **Ownership:** new focused eventsink XP/store/publication modules and enumerated writer hooks. No Body cache or broad schema edits; request a new contract/migration unblocker if a frozen shape is missing.
- **Proof:** real duplicate/reordered delivery, two source records for the same accomplishment, concurrent awards, transaction rollback and crash between DB commit and publish; correct first/last/past-threshold behavior; one monotonic state after recovery; poison and transient failures follow policy.

### AN-11: proficiency query service and Body cache

- **Depends:** AN-10. **Size:** 55-70k.
- **Deliver:** eventsink/read-adapter request handler and Golem cache using the frozen NATS state contract; startup request, bounded recovery and monotonic versions. No Golem Postgres access.
- **Ownership:** new named eventsink query handler and Golem cache/link modules with tests. Shared lifecycle/config/ACL registrations are handed to AN-12.
- **Proof:** cold start, missing reader, stale response after a newer push, level-up during reconnect, timeout/cap, stop/unsubscribe and cross-life/shard request denial with real NATS roles. Report when a cache uses the accepted degraded default.

### AN-12: Body and learning integration milestone

- **Depends:** AN-08, AN-11. **Size:** 50-70k plus serial ops run.
- **Deliver:** bind evidence/query/cache ports to all Body hosts, minimal ACL additions and own-life profile lifecycle; frozen treatment fixtures and a reviewable ranger activation proposal. Initially ship inactive unless D-CS-10 approves actual values.
- **Ownership:** enumerated Golem/player/supervisor startup files, eventsink main wiring, W2 shared ACL/image/config files and focused live tests. Never turn on the Colo Mind.
- **Proof:** disposable Adam and sovereign clients earn/reload the same domain level; different sheets change nerve; restart during a fight and XP update loses no evidence; off keeps the old behavior. Full wave checks/live/20 TPS gate before deployment consideration.

## W3: Mind heuristic core

### AN-13: heuristic ports and durable state

- **Depends:** AN-12. **Size:** 50-65k.
- **Deliver:** discriminated `FxResult`, immutable authorized context, registry/order skeleton and per-life failure/habit/consecutive-pick state APIs with durable implementation. Keep original problem identity independent of varied intent arguments.
- **Ownership:** new `animus/src/heuristics/` types/registry/state modules, named new memory-store methods/fakes/tests and port exports. Do not alter the running loop yet.
- **Proof:** cross-life isolation, duplicate observation, stop/new-life cleanup, state reload and goal/problem identity rules; no context field supplies hidden facts or actual other-life sheets. Use the accepted persistence layout from AN-04.

### AN-14: idle habits and weighted candidate selection

- **Depends:** AN-13. **Size:** 50-65k.
- **Deliver:** pure idle function with speech/commitment/no-goal guards; exact goal-string habit reuse; eligible known-argument candidates and weights; think probability and maximum consecutive picks. Use current Body programs at this milestone; AN-45 adds all three scheduled new programs.
- **Ownership:** independent idle/candidate modules under `animus/src/heuristics/` and own tests. No loop, prompt, shared registry or Body-program edits.
- **Proof:** unavailable/unknown/locked recipes never become candidates; no goal creation or economic repeats; zero/all-invalid options escalate; deterministic draw boundary and weight fixtures; forced model handoff after the accepted pick cap.

### AN-15: failure variations and insight

- **Depends:** AN-13. **Size:** 55-70k.
- **Deliver:** failure counting, falling insight DC, one valid program variation, unchanged-problem cap and minimal/high escalation rule. Make stuck and existing repeated-failure signals explicit in the accepted sheet-mode precedence.
- **Ownership:** independent failure/variation modules under `animus/src/heuristics/` and focused effort policy helper/tests. Shared loop binding belongs to AN-16.
- **Proof:** first/last/past-cap; no reset through changed arguments; exact increment/DC order; known-only travel/craft alternatives; count one and unavailable alternatives; economic replay forbidden; resume preserves attempts and goal completion resets the intended key.

### AN-16: no-call execution and honest journaling

- **Depends:** AN-14, AN-15. **Size:** 55-70k; split before dispatch if the journal seam exceeds this.
- **Deliver:** heuristic branch after deterministic memory and before episodic embedding/rendering; normal thought validation/plan/submission; zero-credit synthetic thought audit with policy version; handled/escalated/refused outcomes and existing abort settlement. Only this card changes W3's thinking-loop control flow.
- **Ownership:** enumerated loop/cycle/env/plan/journal/port files and focused new tests. No general prompt changes, attention policy or database schema edits.
- **Proof:** handled cycle never calls render/embedder/admission/model; same checked submission and receipts; rejected/stale plans do not count as success; economic actions are not replayed; stop/hung memory/journal/publish/submit and one-in-flight cleanup; off retains existing tests unchanged.

### AN-17: Mind core integration

- **Depends:** AN-16. **Size:** 45-65k plus ops evidence.
- **Deliver:** inject registry/state/engine in Mind construction; explicit off bypass; activate only disposable phase0 treatment fixtures. Add an operator run protocol and accepted heuristic counters to exported evidence.
- **Ownership:** named `animus/src/mind.ts`/startup/options wiring, fixture configs, audit ACL/image changes if needed and focused live tests. Does not edit released prompts or Colo Mind profile.
- **Proof:** real 8B speech wakes still use the model; an eligible idle/failure wake can complete with no call; forced handoff and unavailable-model fallback; restart does not reset anti-loop state. Full W3 close checks and fresh review.

## W4: checks, attention and prose

### AN-18: novelty from authorized knowledge

- **Depends:** AN-17. **Size:** 50-65k.
- **Deliver:** curiosity radius, new-to-this-life detection, known travel targets and default wake interest; newly met agents route to a stranger policy only when available, otherwise the accepted fallback.
- **Ownership:** separate novelty/known-target modules under `animus/src/heuristics/`; explicit new Body wake helper only if required by the accepted perception contract. Shared wake registry/loop binding is AN-23.
- **Proof:** radius edges and every geometric axis/sign; an unseen structure/block is not a target; known memory suppresses novelty; no duplicate/over-limit `wake_on`; an existing agent-authored wake interest remains intact.

### AN-19: sanity policy and shared retry allowance

- **Depends:** AN-17; D-CS-05 and the veto/stale retry truth table fixed. **Size:** 55-70k.
- **Deliver:** four accepted sanity predicates, d20/deterministic catch policy and a reusable retry allowance for invalid output, veto and stale-plan resnapshot. No second-veto waiver unless explicitly selected instead of fallback.
- **Ownership:** independent sanity/retry policy modules and focused loop-seam tests using W3's hooks. Shared production loop hook changes are requested from AN-23, not edited in parallel.
- **Proof:** each predicate catches/misses at its boundary; valid output then veto, invalid output then veto, veto then stale refusal, admission denial and cancellation never exceed the sheet-mode decision allowance. Off retains the old retry behavior.

### AN-20: future commitment scheduling

- **Depends:** AN-17. **Size:** 55-70k.
- **Deliver:** bounded next-due query, Mind-side `commitment_due` reason, injected world-time scheduling, rescheduling on commitment writes/resolution and exactly-once due candidate emission under the accepted reconsideration rule. This milestone uses normal priority; AN-38 adds the scheduled law-based priority treatment.
- **Ownership:** new scheduling module, named commitment query/write hooks and memory/attention port additions, own fake-clock tests. Shared attention policy/controller construction is AN-23's wiring request.
- **Proof:** future/overdue/undated commitments, earlier new promise, resolved promise, long pause/reconnect, restart, death/stop cleanup, no model-in-flight overlap and no repeated due-wake storm. Show the due wake on a real client at the wave gate.

### AN-21: versioned Mind temperament prompts

- **Depends:** AN-17 and AN-03; prompt allocation rechecked in AN-00. **Size:** 45-65k.
- **Deliver:** free new thought/reflection template versions, identity temperament slot, backward-compatible old template loading and own-life temperament injection interface. Add budget and marker scans; do not render numeric scores or alignment labels.
- **Ownership:** only allocated new `prompts/thought/vN.md`, `prompts/reflection/vM.md`; prompt library/ports/tests and prompt index. Shared config activation is AN-23.
- **Proof:** maximal accepted seed plus maximal temperament plus bounded social prose fits 8192 context/2048 output reserve; all old released hashes/load paths stay valid; off never appends temperament or switches versions. Failure to fit is a ruling, not a silent truncation/cap change.

### AN-22: sovereign persona export

- **Depends:** AN-21. **Size:** 35-55k.
- **Deliver:** append the same approved temperament during a newly requested persona export, with no numeric/alignment metadata; validate combined text using the existing export rules. Export is a file-generation action, not automatic live host mutation.
- **Ownership:** `tools/mcp-tokens/src/persona-export.ts`, exact associated parser/CLI tests and docs as needed. No rewriting an existing external identity file or altering approved persona text in place.
- **Proof:** dry run/new output matches the engine bank; no overflow or marker leakage; standard/off output unchanged; existing files are not overwritten; directory/ACL/no-secret protections still pass. Oversize combined persona requests a decision rather than truncating the seed.

### AN-23: checks and prose integration

- **Depends:** AN-18 to AN-22. **Size:** 50-70k plus ops evidence.
- **Deliver:** apply the named W4 loop/attention/registry/query hooks, feature flags and prompt selection; record the exact selected policy and template versions. Keep morality disabled and production sheet values unchanged absent D-CS-10.
- **Ownership:** enumerated loop/attention/controller/mind wiring and test fixtures; W4 shared shard/image/manifest files only if needed. No new feature logic beyond the handed-off hooks.
- **Proof:** real due wake; sanity correction within allowance; known-only novelty; model and heuristic branches share receipts; maximal prompt fits; disabled checks/omitted/off configurations pass. Full W4 close review and live lane.

## W5: evidence an observer can actually know

### AN-24: observed-actor contract unblocker

- **Depends:** AN-23; D-CS-06 accepted. **Size:** 35-55k.
- **Deliver:** typed visible attacker/giver/breaker observations with causal ids, observer/actor life identity and relevant observed prior ownership; extend privileged block-owner transport only as needed. Preserve unknown/absent actors and old event compatibility.
- **Ownership:** exactly named `contract/` schemas, subject helpers, generation registry/exports and generated output. No broad subscriber permissions or raw cache access in Animus.
- **Proof:** absent/hidden actor is valid but unattributed; wrong/reused ids cannot be normalized into a known life; observed and infrastructure messages are separate; recipients of old payloads remain compatible.

### AN-25: visible attacker identity

- **Depends:** AN-24. **Size:** 45-65k.
- **Deliver:** extend the existing server-cause hurt pipeline with authorized player identity and stable observation ids, through both event and snapshot paths. Reuse existing causal entity detection.
- **Ownership:** `golem/src/perception/hurt.ts`, `hurt-trigger.ts`, visible-agent helper seam and focused tests; Paper damage adapter only if inspection proves the client lacks causal identity. Shared registration belongs to AN-28.
- **Proof:** real melee/projectile causes, hidden player, neutral mob, no cause, nearby innocent player and reused display name. Never guess an attacker by proximity; a true cause without a visible identity remains anonymous.

### AN-26: observed gift provenance

- **Depends:** AN-24. **Size:** 55-70k.
- **Deliver:** recipient/authorized-observer evidence linking a proven give to actual pickup, distinguishing intended gift from dropped loot and third-party pickup. Correlation has a bounded lifetime and a defined unknown case.
- **Ownership:** new focused Golem give/pickup observation modules, named give action seam and plugin pickup adapter if needed; own tests. Shared Body/plugin registration is AN-28.
- **Proof:** live giver/recipient plus third-party control; partial pickup, merged stacks, toss timeout, unrelated loot, invisible giver, disconnect and repeated delivery never create a false or duplicate good-evidence row.

### AN-27: observed property break provenance

- **Depends:** AN-24. **Size:** 55-70k.
- **Deliver:** causal breaker metadata from the plugin and a Body observation filter that retains prior owner only when the accepted knowledge rule allows it. Distinguish placement/cache invalidation from observed theft/breaking.
- **Ownership:** named `plugin/core/.../blockowner/BlockChangeListener.java`, publisher message seam and separate Golem property-observation module/tests. No change to goto/mining permission decisions.
- **Proof:** visible owner/actor, hidden break, unknown prior ownership, replacement, explosion and missing CoreProtect; global change alone teaches no fact. Capture real plugin payloads before writing parser fixtures.

### AN-28: attribution integration and leakage gate

- **Depends:** AN-25 to AN-27. **Size:** 45-65k plus serial ops evidence.
- **Deliver:** register producers/filters and authorized observation subscriptions without giving Mind/eventsink global block-owner access; record source ids and replay/digest behavior.
- **Ownership:** enumerated Body/plugin startup files, W5 ACL/image wiring and real-client test fixtures. No social inference code yet.
- **Proof:** one real hit/gift/break reaches an eligible observer, hidden controls do not, and NATS roles deny raw access. The same observation through wake and digest has one identity. Full wave checks and captured live evidence.

## W6: estimated sheets and prediction

### AN-29: social model persistence and evidence updates

- **Depends:** AN-28; D-CS-05/06/07 fixed. **Size:** 55-70k.
- **Deliver:** new allocated migration for mind-model rows/evidence keys; prior projection, bounded evidence update, dedup/order rules and observer-scoped store. Preserve unsupported fields as priors. Do not store actual other-life sheets in the model reader.
- **Ownership:** new SQL migration/checks; separate Animus social-model store/update/port modules and fakes. Named lifecycle/export hooks are handed to AN-32.
- **Proof:** real store transaction with repeated wake/digest/restart evidence; first observation and n=0/prior-strength arithmetic, bounds, forged cross-observer updates and death/new-life handling. Correlated position samples do not increment indefinitely.

### AN-30: prediction and stranger choices

- **Depends:** AN-29. **Size:** 50-65k.
- **Deliver:** run the same pure policy against an estimated sheet and integrate branch probabilities; use it for approach/avoid/ignore under the accepted stranger formula. Follow/approach ends by escalation before speech; prediction does not call the model.
- **Ownership:** new `psyche/` expectation adapter/policy helper and independent `animus/src/heuristics/stranger*.ts` modules. Shared registry wiring is AN-32.
- **Proof:** exhaustive predicted probabilities match policy enumeration; fractional estimates use the accepted mapping; priors and absent models behave explicitly; geometry covers every axis/sign; no true-score/database lookup or autonomous speech occurs.

### AN-31: bounded social-model prose

- **Depends:** AN-29 and AN-21. **Size:** 45-60k.
- **Deliver:** select at most two supported estimated traits, render explicitly uncertain prose in quoted person text, and expose an interpretation input for reflection. AN-61 completes the model-mediated trust path; no fixed automatic trust overwrite or claim of observed certainty.
- **Ownership:** separate social-prose rendering modules and named prompt data-building seams/tests. If AN-21's templates cannot accommodate this without editing a released version, allocate another new version before dispatch.
- **Proof:** marker scan, worst-case combined context fit, deterministic tie order, malicious names/world text remain quoted, unsupported estimates are not presented as learned, and agent text contains no scores/labels/actual truth.

### AN-32: theory-of-mind integration

- **Depends:** AN-30, AN-31. **Size:** 50-65k plus ops evidence.
- **Deliver:** bind observation/store/predictor/person rendering; apply tom-enabled guard; lifecycle cleanup and approved export/erasure integration. Keep actual-score scoring in operator code only.
- **Ownership:** enumerated Mind/heuristic/person-line wiring; relevant retirement/export adapters and W6 flags/images. No new trait formula or trust policy at integration time.
- **Proof:** two disposable lives observe and update a model; unseen acts never update it; duplicate/restart converges; tom disabled stays out of the path; new life cannot inherit an old estimate by display name. Full wave review/live evidence.

## W7: explore, farm and patrol

### AN-44: program contract and API unblocker

- **Depends:** AN-32; D-CS-14 accepted. **Size:** 40-60k.
- **Deliver:** exact argument/checkpoint/result and finite-limit shapes for all three programs; capability metadata; reserve a free new body-api version and register the future prompt compatibility requirements. No new goals are encoded in the program definitions.
- **Ownership:** named contract schemas/exports/generated output and contract tests; API reservation in campaign docs. Program implementation/registration belongs to the three feature cards and AN-45; the actual body-api prompt is owned by AN-45.
- **Proof:** valid/invalid/oversize routes and targets; old thought/intent fixtures remain valid; every program has a timeout/operation-cap outcome and no arbitrary hidden-coordinate lookup.

### AN-39: explore program

- **Depends:** AN-44. **Size:** 50-70k.
- **Deliver:** a checkpointed exploration routine using an unvisited direction/frontier inferred from this life's observed-space history. Advance in bounded legs, remember observed coverage and stop/escalate at limits or unresolved danger. First-visit XP uses the existing canonical evidence key.
- **Ownership:** new named `golem/src/body/programs/explore*.ts` and own tests; focused observed-frontier helper. Shared registry, Body API and idle selection changes go to AN-45.
- **Proof:** known-only frontier, opaque/unloaded terrain, all axis/sign choices, no valid candidate, operation/time limits, duplicate chunk visits, interruption/cancel/restart and no invented goal or map knowledge.

### AN-40: farm program

- **Depends:** AN-44. **Size:** 50-70k.
- **Deliver:** one checkpointed known-field harvest/replant pass, with an explicit crop/stage/seed knowledge rule and ownership behavior. Bound cells/actions; distinguish actual harvest/sow from an attempted action and publish evidence for the existing farming award.
- **Ownership:** new named `golem/src/body/programs/farm*.ts`, its field/crop helper and own tests. Shared registry/API/idle binding belongs to AN-45.
- **Proof:** observed ripe/unripe crops, available/missing seeds, owned/other/unknown cells, partial work, refusal/failure/cancel, limit boundary, resumed checkpoint and one XP award per accepted evidence unit. No wiki recipe or hidden-field discovery.

### AN-41: patrol program

- **Depends:** AN-44. **Size:** 50-70k.
- **Deliver:** one checkpointed bounded traversal of a known route/base supplied from memory or a known trusted person's last authorized position. Define endpoint/loop count, danger interests and completion without selecting an attack goal.
- **Ownership:** new named `golem/src/body/programs/patrol*.ts` and route validation/tests. Shared registry/API/idle binding belongs to AN-45.
- **Proof:** invalid/empty/unknown route, finite lap/time/action caps, stale person position, sight loss, interrupted/cancelled/restarted patrol and no automatic PvP or permanent guard goal.

### AN-45: program publication and idle integration

- **Depends:** AN-39, AN-40, AN-41. **Size:** 50-70k plus ops evidence.
- **Deliver:** register all programs, publish the allocated immutable Body API version, wire explorer/farmer/warrior candidate selection to eligible programs and retain older API/template combinations. Connect XP and refusal evidence through normal execution.
- **Ownership:** named program registry, idle-candidate and startup seams; new body-api file and prompt capability binding; W7 shared manifests/images/config and dedicated live fixtures.
- **Proof:** a real client starts/completes/resumes each program through a validated plan and receipts; missing knowledge disables the candidate; all three are available to sovereign Body callers; old API and off controls pass. Full W7 close.

## W8: complete evidence and proficiency sources

### AN-46: complete evidence contract unblocker

- **Depends:** AN-45; D-CS-04/06/15 accepted. **Size:** 45-65k.
- **Deliver:** typed own-combat/observed-combat outcomes; structured commitment declaration/reference/outcome evidence for both headless and sovereign lives; bilateral exchange ids; observed owned-container taking. Freeze the narrow memory/MCP declaration adapter so sovereign social XP does not silently depend on an Animus Mind. Add necessary memory/provenance/index extensions with explicit unknown states and cross-life rules.
- **Ownership:** exact contract/generated files and allocated new SQL/check fixtures for W8. Freeze award units and actor/observer knowledge rules before fan-out; no producer implementation here.
- **Proof:** causal ids validate, malformed/ambiguous/hidden inputs cannot become proven evidence, promise state distinguishes overdue from broken, and old unstructured commitments remain loadable as unknown rather than retrospectively misclassified.

### AN-47: own and observed combat evidence

- **Depends:** AN-46. **Size:** 55-70k; split before dispatch if server capture and Body filtering cannot fit.
- **Deliver:** causal hostile-kill/fight-survived facts for combat XP and visible fight/flee observations for others' aggression estimates. Specify encounter identity and end criteria so per-tick events cannot farm awards. Never expose another agent's unseen health, sheet or hidden target.
- **Ownership:** new focused plugin combat fact adapter, Golem encounter/observed-combat filter and eventsink normalization modules/tests; shared listener registration is AN-50.
- **Proof:** real kill/survived/aborted/died encounters, multiple attackers, stolen kill, sight loss, innocent nearby agent, repeated ticks/restart and one award per accepted accomplishment. Observing a visible fight/flee updates an estimate once; an unseen one does not.

### AN-48: observed promise outcomes

- **Depends:** AN-46. **Size:** 55-70k.
- **Deliver:** accept structured promises through the frozen headless-memory/sovereign-MCP adapters and match conditions to that life's observed give/property/other accepted facts. Use one observer-scoped pure matcher and approved state owner, rather than requiring sovereign lives to run Animus. Emit proven kept/broken/unknown with causal ids; kept promises award social XP and kept/broken promises feed estimates. Unmatchable free text remains unknown.
- **Ownership:** focused pure promise matcher, exact commitment metadata/store and existing memory/MCP adapter seams, Animus digest seam and own tests. `animus/src/reflection/digest.ts` currently labels overdue as broken; amend only under D-CS-15. Shared registration is AN-50; split the adapters before dispatch if their exact file list exceeds the token envelope.
- **Proof:** actual fulfillment for headless and sovereign declarations, partial delivery, wrong beneficiary/item, duplicate evidence, due-without-observed-outcome, genuine observed breach, undated/legacy promise, cancel/restart and no automatic accusation just because a timer elapsed. No inferred promise is mined from global chat or another life’s private memory.

### AN-49: conversation exchange and complete social XP

- **Depends:** AN-46. **Size:** 50-65k.
- **Deliver:** define one genuine bilateral exchange under the accepted participants/turn/window rules; project conversation, confirmed give and proven-kept-promise awards without counting the same exchange or transfer twice. Apply the same observable facts to sovereign and headless lives.
- **Ownership:** new focused exchange detector/evidence producer and eventsink social-award normalization modules/tests. No new LLM call, global speech access or automatic trust write.
- **Proof:** two-way exchange versus monologue/overheard speech, repeated greeting spam, wrong recipient, overlapping windows, echoed/replayed events, restart and one social award per qualifying event. Previously supported give awards remain identical.

### AN-51: observed taking from owned containers

- **Depends:** AN-46. **Size:** 50-70k.
- **Deliver:** add causal taking/withdrawal observations alongside W5's block-break observation, retaining the prior owner and permitted actor visibility. Distinguish a container visit from a proven take, gifts from taking and unknown ownership from someone else's property.
- **Ownership:** new named container-taking observation adapter/filter, exact withdrawal receipt/plugin seams and own tests. Infrastructure ownership remains privileged; shared wiring is AN-50.
- **Proof:** real own/other-owned/unknown container, open without take, failed/partial take, actor hidden from the owner, same receipt redelivery and ownership changing mid-operation. Only eligible observers update law/good estimates.

### AN-50: complete evidence integration

- **Depends:** AN-47, AN-48, AN-49, AN-51. **Size:** 50-70k plus ops evidence.
- **Deliver:** register producers, authorized filters, memory/estimator readers and award projections; complete all seven domains and every evidence row in brief 6.3. Freeze source-to-award provenance and real-client fixture coverage.
- **Ownership:** enumerated plugin/Body/Mind/eventsink startup and dispatch seams; W8 ACL/image/config changes; dedicated live/SQL tests. No widening of global facts into agent perception.
- **Proof:** producer-to-sink-to-cache XP and observer-to-estimate paths work for every listed source, with positive/hidden/duplicate/restart controls. Unsupported common_sense/cleverness evidence remains a prior because the brief supplies no such observation rule; do not fabricate one to improve metrics. Full W8 close.

## W9: moral hooks and reflective trust

### AN-52: moral decision and reflection contract unblocker

- **Depends:** AN-50; D-CS-02/16/18 accepted. **Size:** 35-55k.
- **Deliver:** fixed agent-safe property-refusal reason code, law-decision metadata and bounded uncertain social-evidence input for reflection. Define persistent action/due-occurrence decision identities and false-flag semantics; allocate fresh prompt versions only where required.
- **Ownership:** named contract/generated/reason-vocabulary files, needed allocated decision-state SQL additions and own tests. Reflection prompt changes are AN-61's responsibility.
- **Proof:** old action outcomes still validate; refusal text carries no owner name/score/operator metadata; repeated delivery preserves decision identity; undefined uncertain evidence is not treated as observed fact.

### AN-37: trait-based deliberate property refusal

- **Depends:** AN-52. **Size:** 50-70k.
- **Deliver:** law DC 11 hook for deliberate `mine`/`withdraw` on another life's property, with the accepted `good <= 2` and starving exception, action_failed outcome and recorded decision. Reuse a decision within an accomplishment attempt so repeated submission cannot reroll until success; define retry identity explicitly.
- **Ownership:** named Body mine/withdraw action hook modules, pure law helper and own tests. Shared registration/config is AN-53. Automatic goto protection is unchanged.
- **Proof:** self/other/unknown ownership, every score and d20-disabled case, starving exception, action cancellation and retry/restart deduplication; no information-leaking refusal. Both morality false and mode off retain deliberate-action behavior under 0164.

### AN-38: law-weighted due commitment wakes

- **Depends:** AN-52; AN-20 is already merged. **Size:** 50-65k.
- **Deliver:** at a due occurrence, law DC 8 selects tier one or tier three using the accepted timer/reconsideration rule. A lower rank delays attention; it does not rewrite or delete the commitment. Use one recorded law decision per accepted occurrence.
- **Ownership:** new commitment-law priority module and focused attention seam tests; shared policy/controller/config registration is AN-53.
- **Proof:** exact due tick and both tiers, competing urgent speech/damage, repeated overdue cycles, resolved/replaced promise, in-flight thought, stop/restart, d20 disabled and morality false retaining normal scheduling. No wake storm or reroll loop.

### AN-61: reflection uses estimated traits to revise trust

- **Depends:** AN-52; AN-31 supplies the interpretation renderer. **Size:** 50-70k.
- **Deliver:** feed bounded estimates, prediction evidence and observed promise/gift/property outcomes into the existing reflection digest; allow its validated model output to revise relationships/trust. Keep uncertainty/provenance and the once-per-day/reflection-budget rules. No second model or fixed trust delta.
- **Ownership:** named reflection digest/input/apply tests, allocated new reflection template and prompt-version binding; new focused social-reflection renderer. Shared startup/default selection is AN-53.
- **Proof:** same uncertain evidence reaches reflection and supports a valid trust update; fabricated/hidden truth does not; unsupported fields remain uncertain; degraded reflection and duplicate sleep preserve existing limits; context/marker/old-template tests pass.

### AN-53: morality and reflective trust integration

- **Depends:** AN-37, AN-38, AN-61. **Size:** 45-65k plus ops evidence.
- **Deliver:** bind both hooks and the reflection input under the accepted independent switches, update versioned templates/config and capture observed refusals/wakes/trust changes. Keep production default false until D-CS-10 approves an actual treatment.
- **Ownership:** enumerated action/attention/Mind/reflection startup seams; W9 ACL/image/config/version selection and live fixtures. No unreviewed general morality engine.
- **Proof:** one real refused property action and exception, one due occurrence in each priority tier, one recorded model-mediated trust revision, and control runs with morality/ToM disabled independently. Full W9 close.

## W10: inherited character sheets and actual births

### AN-54: lineage contract and storage unblocker

- **Depends:** AN-53; D-CS-09/17 accepted and external C4 adapter contract frozen. **Size:** 45-65k.
- **Deliver:** versioned two-parent/birth-request/result/sheet-inheritance audit shapes and allocated SQL lineage/sheet-version records, with unique birth identity and zero learned proficiency. Reconcile current `ag_...` ids with C4's proposed `lf_...` scheme explicitly; do not silently replace the current common LifeId pattern.
- **Ownership:** exact contract/generated and newly allocated SQL/check files plus subject helpers. General Cradle/population/server-allocation implementation remains the named C4 prerequisite; no second life allocator is added here.
- **Proof:** valid parent/current-version references, duplicate birth id, missing/dead/ineligible parents, mismatched legacy ids, failed grants and round-trip ancestry. Contract is usable by the actual existing-campaign birth interface before dispatching its consumers.

### AN-42: pure inherited-sheet factory

- **Depends:** AN-54. **Size:** 45-65k.
- **Deliver:** for every innate attribute/alignment/op-mode field, snapshot the selected parental versions, calculate rounded mean plus seeded -1/0/+1 mutation at 20/60/20 and clamp to 1-5. Return a complete child birth baseline and recorded draw lineage, with all proficiency zero.
- **Ownership:** new named `psyche/src/` inheritance factory/audit helpers and own tests. No model, child creation, DB mutation or parent-state mutation in the pure factory.
- **Proof:** exact mutation distribution, positive half rounding rule, clamp extremes, all fields, repeat birth identity, distinct child identities and drifted-parent version selection. Proficiency, learned skills and relationships cannot enter the child's generated sheet.

### AN-55: birth transaction and creation adapters

- **Depends:** AN-54, AN-42; real C4 birth lifecycle available under D-CS-17. **Size:** 55-70k.
- **Deliver:** connect server-authorized birth to one durable child sheet/ancestry record and pending headless/sovereign creation handoffs. Restart/retry reuses the committed child and does not reroll or reuse a parent's game account. A pending model/launcher does not invent another birth.
- **Ownership:** new named Animus/Golem lifecycle creation adapters and allocated child-store modules/tests; precise creation-API integration seam. No new Cradle recognition or alternate population manager.
- **Proof:** real authorized child, duplicate event, crash before/after commit/publication, failed launcher/model handoff, distinct account/life and fresh XP. If C4 is unavailable, record BlockedDependency; a mocked birth is not sufficient completion evidence.

### AN-56: child prose synthesis and limited memory handoff

- **Depends:** AN-55; D-CS-09/17 synthesis/model/budget and external repo-creation rules accepted. **Size:** 55-70k.
- **Deliver:** retain the separate versioned seed-synthesis prompt over both parents' prose and permitted episodic inputs. Prepare exactly the allowed up-to-two semantic facts per parent, a fresh identity/goals artifact and a new child creation request, never a parent-history fork. Define retry/failure before first child activation.
- **Ownership:** allocated new `prompts/seed-synthesis/` template/library adapter, focused child memory/export modules and named existing creation handoff tests. External launcher/repo changes have an explicit companion owner under D-CS-17; no unauthorized remote repo creation in a coder run.
- **Proof:** parent contributions/limits, missing memories, forbidden journals/relationships/skills/XP, failed/invalid model output, retry idempotency, fresh sovereign artifact and headless memory; model/prompt/input versions and admission costs recorded. The synthesis model is explicitly approved and never silently substitutes a parent's lifelong model.

### AN-57: end-to-end lineage integration

- **Depends:** AN-55, AN-56 and completed external birth/launcher prerequisites. **Size:** 45-65k plus ops evidence.
- **Deliver:** bind child factory, durable birth, prose/memory handoff and actual headless/sovereign activation; publish operator ancestry queries and explicit lineage on/off behavior. Preserve the existing Cradle population/headroom rules supplied by C4.
- **Ownership:** enumerated birth/Mind/player creation/startup seams; W10 ACL/image/config and real-client fixture/runbook files. No wholesale rewrite of Phase 1 birth machinery or human-directed in-world intervention.
- **Proof:** two disposable parent lives produce actual distinct headless and sovereign children with correct recorded scores/prose/facts and zero XP; duplicate/restart does not create twins accidentally; lineage off follows its accepted birth behavior. W10 remains pending until both actual handoffs are verified.

## W11: default-off attribute drift

### AN-58: drift contract, policy config and history unblocker

- **Depends:** AN-57; D-CS-13 accepted. **Size:** 40-60k.
- **Deliver:** effective-sheet version/history/drift-event schemas, eligible-field/window/sample/margin/cap configuration, update/reconcile subjects and allocated SQL for evaluation decisions and score deltas. Preserve immutable birth baseline and prior journal provenance.
- **Ownership:** exact contract/generated/config/subject files, allocated new SQL/check fixtures and policy-shape tests. No drift formula chosen by the coder.
- **Proof:** bounded fields/scores, explicit false default, seven-day tick conversion, version conflicts, duplicate evaluation key, denied roles, baseline immutability and old config loading unchanged.

### AN-59: seven-day evidence and drift eligibility

- **Depends:** AN-58. **Size:** 50-70k.
- **Deliver:** bounded deterministic per-life/field evidence windows and accepted expected-versus-observed criterion, conditioning on policy/DC/proficiency where required. Return eligible direction/no-change with sample coverage, not an unconditional score update. Missing/gapped audit data makes evaluation ineligible.
- **Ownership:** new focused evidence-query/statistic modules in the accepted reader/Animus boundary and own SQL/unit tests. No actual-score read for another agent and no lifecycle-trigger wiring.
- **Proof:** exact window boundaries, sample/margin threshold just below/at/above, mixed DCs/proficiency, missing data, repeated/overlapping windows and no valid evidence for an unsupported field. A random roll surplus is not silently relabelled real observed behavior.

### AN-43: bounded drift transition and publication

- **Depends:** AN-59. **Size:** 50-70k.
- **Deliver:** atomically record an evaluation and at most the accepted one-point change/cap, publish a monotonic effective-sheet revision and retain the previous version for audit. Respect the accepted cooldown/window reuse rule; proficiency remains in its separate table.
- **Ownership:** new focused effective-sheet transition/store/publication modules and own tests in the accepted state owner; no formula/config redesign or broad startup changes.
- **Proof:** min/max clamp, same-window duplicate, concurrent reflection/restart, per-field versus whole-sheet cap as ruled, publication failure after commit, stale revision refusal and birth/proficiency immutability. False flag performs no change or RNG consumption.

### AN-60: drift triggers, cache and prose coherence

- **Depends:** AN-43; headless/sovereign trigger and persona-refresh policy accepted under D-CS-13. **Size:** 55-70k plus ops evidence.
- **Deliver:** bind the accepted reflection/sleep evaluation trigger, reload versioned own-life effective scores in Body/Mind caches and render subsequent temperament from the same revision. Record prompt-content/version changes; expose a reviewed refresh artifact for sovereign persona delivery rather than silently overwriting its approved external identity file.
- **Ownership:** enumerated reflection/sleep/store/cache/startup and prompt identity seams; W11 image/config/ACL changes; focused persona-refresh adapter and long-window fixtures. External persona/launcher companion work has the owner named by D-CS-17.
- **Proof:** simulated seven-day boundary and real confirmation trigger, restart/cooldown, stale notification, disabled drift, two components seeing the same revision, old journals unchanged and correct subsequent prose. Include real headless and the accepted sovereign behavior; pending external refresh is visible and cannot be labelled full success.

## W12: measurement and rollout

### AN-33: operator evidence export

- **Depends:** AN-60; D-CS-11 protocol fields fixed. **Size:** 50-70k.
- **Deliver:** bounded versioned exports of decisions, outcomes, XP/contact evidence, birth/ancestry, drift records and initial/effective sheet versions for offline scoring. Read-only DB role/path, no agent/MCP exposure. Supply files to progress-metrics rather than adding DB access to it.
- **Ownership:** named new operator exporter under `tools/`; its manifest/lockfile updates if necessary; exact read-role migration only through an explicitly allocated migration addition; fixtures and docs. No writes to world or life state.
- **Proof:** exporter cannot mutate DB, restricts run/life scope and row bounds, separates public/owner/private fields, includes audit coverage and does not join owner identity into published data. Real read-role denial tests.

### AN-34: cohort metrics and comparison report

- **Depends:** AN-33. **Size:** 50-65k.
- **Deliver:** file-based program distributions/Jensen-Shannon divergence, call cost/useful time, outcomes/survival, all-domain XP and field/contact-specific ToM error with baseline comparisons. Add program yields, moral choices/trust revision, parent-child inheritance and drift-window/version scoring. Preserve uncertainty and insufficient-data states.
- **Ownership:** new focused modules/tests under `tools/progress-metrics/`, explicit CLI options and report fixtures/docs. No DB connection or agent-facing output.
- **Proof:** hand-calculable distributions, empty samples, equal/disjoint choices, every model retry counted, incomplete audits, unsupported trait estimates and pre-outcome prediction scoring. Existing metrics inputs/results remain supported.

### AN-35: cohort fixtures and run evidence

- **Depends:** AN-34; owner accepts D-CS-10/11 and numerical gates before the first run. **Size:** 50-70k for harness/protocol; actual ops runs are separate.
- **Deliver:** four primary treatments plus the accepted program/morality/learning/ToM/trust/lineage/drift comparisons, immutable world-clone/run manifests, fresh lives/state/RNG setup, collection scripts and a fixed report protocol. Include actual births and at least a full seven-day drift window plus its evaluation boundary. Implement fixtures first; ops runs serial cases and records raw results.
- **Ownership:** named test/harness modules, non-live fixture shard files and `worknotes/` protocol/results. No production shard edits or journal truncation. Never rerun failures away.
- **Proof:** each treatment has identical initial world/config except declared factors, distinct life/run ids and full version provenance; model-call counters agree with journal; no data from one treatment leaks into the next. A missing run is incomplete, not a pass.

### AN-36: campaign review and rollout close

- **Depends:** AN-35, fresh campaign review and owner D-CS-12. **Size:** 20-40k docs/config work plus reviews/ops, not a feature implementation packet.
- **Deliver:** reconcile feature claims against evidence, docs sweep, campaign retro/process actions, final ledger/RESUME and an explicit enable/opt-in/tune/stop ruling. Any activation is a concrete reviewed configuration diff naming approved lives and flags.
- **Ownership:** this campaign's ledger/worknotes/retro; named runbooks; only the owner-approved shard/default changes. Separate feature fixes into new coder cards.
- **Proof:** every brief coverage row has working code and its named evidence, including false-default features; no skipped gate is labelled done. Off rollback works without deleting schema/history; real restart/soak and required Phase 1 boundary gates are recorded. Mind profile removal is a separate accepted gateway decision, not this rollout's side effect.

## Wave close

Apply the repo's campaign close in order: targeted/whole-wave evidence and fresh reviews; fresh docs sweep from findings; retro with owned/sized actions; explicit process packet when needed; ledger and at-most-40-line RESUME update; retain reports before removing only the completed worktrees. Database/NATS cases require actual service evidence before their gate is complete. Product activation and experimentation occur only at the named decision gates, without re-asking for actions already authorized.
