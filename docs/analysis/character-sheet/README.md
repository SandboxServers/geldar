# Character sheet integration campaign

Status: full-scope planning requested by the owner, 2026-11-13. Code reviewed against `8eac28ba` (PR #329), the same revision named by `animus-character-sheet-brief.md`. Every proposal in the brief now has scheduled work, including pieces originally described as optional/later. Behavioral rulings remain proposed; planning authorization does not authorize activation or deployment.

Read [RESUME.md](RESUME.md), then [integration-plan.md](integration-plan.md). Walk through [decisions before packets](decisions-before-packets.md) before authoring executable cards. The [packet candidates](work-packets.md) are deliberately not dispatch-ready: owner rulings and exact shared interfaces must be written into them first. The [Codex adapter proposal](codex-adapters.md) covers the optional harness work.

## Recommendation

Integrate in eleven phases and thirteen waves. Ship useful Body and Mind milestones early, then complete every capability, evidence source, moral hook, inheritance path and drift treatment before the final campaign report. A feature can be implemented and tested behind a false flag; false by default does not mean deferred or omitted.

| Phase | Waves | Result | Packet slots |
|---|---|---|---:|
| 0. Settle scope and execution | W0 | Accepted amendments and optional Codex adapters | 2 |
| 1. Durable foundations | W1 | Validated sheets, roll engine, persistence and inactive plumbing | 6 |
| 2. Body diversity and learning | W2 | Per-life threat responses and restart-safe proficiency | 5 |
| 3. Mind decisions | W3, W4 | Routine choices, bounded retries, checks, attention and prose | 11 |
| 4. Observed social models | W5, W6 | Authorized evidence and estimated-sheet predictions | 9 |
| 5. Complete Body programs | W7 | Explore, farm and patrol, published APIs and heuristic use | 5 |
| 6. Complete social evidence and XP | W8 | Others' combat, promises, property taking and conversation evidence | 6 |
| 7. Morality and reflective trust | W9 | Theft refusal, law-weighted promise wakes and reflection use of estimates | 5 |
| 8. Lineage | W10 | Inherited scores, retained prose synthesis and actual birth integration | 5 |
| 9. Attribute drift | W11 | Seven-day evidence, bounded recorded changes and default-off behavior | 4 |
| 10. Measurement and rollout | W12 | Full-feature experiments, campaign evidence and rollout ruling | 4 |

There are **62 scheduled packet candidates, AN-00 through AN-61**, including one optional Codex tooling slot and the decision/operations slots; **61 remain if tooling is skipped**. Existing ids are preserved; AN-33 through AN-36 move to the final W12, and AN-37 through AN-43 now belong to scheduled feature waves. Most implementation cards target 50-70k working tokens; smaller unblockers stay smaller. Split a card expected to exceed 70k before dispatch. Estimates exclude independent review/fix/ops costs.

## Decisions

These are local planning identifiers, not allocated ADR numbers. Full planning scope is authorized; the policy choices below remain `BlockedDecision`. Recommendations and proposed numeric values are not accepted rulings. The [walkthrough](decisions-before-packets.md) groups the choices into an order the owner can answer.

| ID | Owner choice | Needed before | Recommendation |
|---|---|---|---|
| D-CS-01 | Heuristic authority and goal-less idle work | W1-W4 packet authoring | Model owns goals; no-goal cycles ask the model; traits choose means |
| D-CS-02 | Morality versus deliberate agent actions and principle 5 | W9 packet authoring | Implement both trait hooks behind a false default; explicit amendment to 0164 |
| D-CS-03 | Assigning birth sheets to existing and future lives | Sheet/birth/config packet authoring | Immutable birth baseline; separately version any enabled drift; no YAML reseeding |
| D-CS-04 | XP authority, creditable evidence and reset rules | Proficiency/evidence packet authoring | Eventsink owns one table; all seven domains completed by W8; unique causal evidence |
| D-CS-05 | Chance semantics and expected prediction | Engine/Mind packet authoring | Seeded/versioned draws; d20-off table; exact probability integration |
| D-CS-06 | Which acts an observer may know and how uncertain evidence is treated | W5 packet authoring | Per-life perception; no raw owner-cache or global event access; unproven acts give no evidence |
| D-CS-07 | Audit failure behavior and lifecycle/export treatment of new data | SQL/audit packet authoring | Preserve evidence without blocking emergency reflexes; bounded buffering; explicit gap records; follow 0171 |
| D-CS-08 | Optional Codex adapters and the campaign's process conflicts | Tooling packet authoring/dispatch | Mirror three roles and four skills; explicit model/effort; obey current AGENTS review rule |
| D-CS-09 | Inheritance formula and child memory boundaries | W10 packet authoring | Parent mean plus recorded 20/60/20 mutation; retain prose synthesis; child XP zero |
| D-CS-10 | Named sheets, treatment flags and live-ranger rollout | W2/W4 activation, after packet drafts are reviewable | Approve values separately from installing inactive code |
| D-CS-11 | Experimental thresholds, run length, budget and cohorts | Experiment/harness freeze, before any treatment run | Four treatments, replicated world seeds; owner sets numerical acceptance bars |
| D-CS-12 | Expand, tune, keep opt-in or stop | After cohort report | Choose from measured cost, diversity and survival results |
| D-CS-13 | Drift evidence, eligible fields, window, margin and cap | W11 packet authoring | Implement default-off; distinguish real outcome evidence from lucky dice |
| D-CS-14 | Exact explore/farm/patrol behavior | W7 packet authoring | Known frontier/field/route only; bounded programs, no new goals or auto-combat |
| D-CS-15 | Promise matching and conversation semantics | W8-W9 packet authoring | Structured observable outcomes; ambiguous promises remain unknown; bounded exchanges |
| D-CS-16 | How reflection uses estimates to revise trust | W9 packet authoring | Existing reflection model can revise trust from uncertain evidence; no fixed trust delta |
| D-CS-17 | Birth/launcher/gateway dependency contract | W10 packet authoring; before related production activation | Reconcile life ids; real headless and sovereign child handoffs; track C4 dependencies explicitly |
| D-CS-18 | Valid-plan veto and total model-call allowance | W3-W4 packet authoring | Two calls per sheet-mode decision; exhausted allowance falls back; off unchanged |

## Ledger

Every candidate starts `BlockedDecision`, including its dependency blockers, until its required rulings are accepted. No packet is `Ready`, in flight, reviewed or done. [work-packets.md](work-packets.md) lists the DAG, ownership boundaries and acceptance evidence; the orchestrator will expand one upcoming wave at a time and update these rows at each boundary.

| Wave | Candidates | Status | Primary gate |
|---|---|---|---|
| W0 | AN-00, AN-01 (optional) | BlockedDecision | Scope/process rulings recorded; allocations checked |
| W1 | AN-02 to AN-07 | BlockedDecision | Cold-start and restart identity agreement; real SQL/NATS audit path |
| W2 | AN-08 to AN-12 | BlockedDecision | Threat boundaries; exactly-once XP effects; cache recovery |
| W3 | AN-13 to AN-17 | BlockedDecision | No-call execution; speech/goal boundaries; failure-cap and restart evidence |
| W4 | AN-18 to AN-23 | BlockedDecision | Shared retry bound; real due wake; prompt fit and version isolation |
| W5 | AN-24 to AN-28 | BlockedDecision | Observed actor attribution without hidden-information leakage |
| W6 | AN-29 to AN-32 | BlockedDecision | Evidence deduplication; simulation accuracy; no truth access in the Mind |
| W7 | AN-44, AN-39, AN-40, AN-41, AN-45 | BlockedDecision | All three programs checkpoint/resume and are selected through their real API |
| W8 | AN-46, AN-47, AN-48, AN-49, AN-51, AN-50 | BlockedDecision | Every proposed evidence row/domain has real positive, negative and deduplication cases |
| W9 | AN-52, AN-37, AN-38, AN-61, AN-53 | BlockedDecision | Both moral hooks, reflective trust and false-flag control paths pass |
| W10 | AN-54, AN-42, AN-55, AN-56, AN-57 | BlockedDecision | Actual child birth, inherited scores, synthesized prose and clean memory/XP |
| W11 | AN-58, AN-59, AN-43, AN-60 | BlockedDecision | Seven-day/cap/restart drift cases; Body, Mind and prose agree on effective version |
| W12 | AN-33 to AN-36 | BlockedDecision | Full-feature ablations, lineage/drift evidence, final review and owner rollout ruling |

Use the existing campaign close procedure: fresh reviews, tests, docs sweep, retro, any needed process packet, ledger/resume update, retained reports and worktree cleanup. No campaign state or other campaign's ledger has been changed by this planning pass.
