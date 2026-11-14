# Character sheet integration plan

The owner has requested planning for every proposal in the brief. The campaign now covers eleven phases, waves W0-W12 and 62 packet candidates, including the programs, evidence, morality, lineage and drift formerly left as follow-ons. Body-first remains the order of early milestones; full delivery requires every product wave and its evidence before final close. The brief's single TM wave is too coupled for Haiku implementation, so contracts, independent features and integration have separate owners.

This is a proposal against `8eac28ba`, not an accepted behavioral decision record. Read [README.md](README.md) for status, [decisions before packets](decisions-before-packets.md) for the owner walkthrough, [work-packets.md](work-packets.md) for candidates and [codex-adapters.md](codex-adapters.md) for optional harness work. Paths in this report are relative to the repository root.

## Review of the brief

### What fits the existing architecture

- A pure shared engine fits the Body/Mind split; a separate `@geldar/psyche` package keeps behavior out of the schema package.
- Moving existing reflex thresholds is immediately useful to sovereign players. Their CLI Minds do not execute Animus heuristics.
- A heuristic result can use the existing thought validator, `buildPlan`, checked submission, receipts and journal. This preserves one execution path.
- Eventsink already receives outcomes for headless and sovereign lives. It is the right place for a durable proficiency projection, with a separate Body cache.
- A default-off treatment fits principle 3. The standard sheet preserves constants, but does not by itself preserve behavior.
- Theory of mind should operate on the observing life's evidence and estimated scores. Actual scores belong only in operator evaluation.

### Changes needed before executable packets

| Finding | Evidence at the inspected revision | Planning consequence |
|---|---|---|
| Proposed thought v6 collides with another campaign | `docs/analysis/phase1/packets/decision-number-registry.md` reserves v6 for C3-03 and v7 for C4-06 | Allocate a free version; v8 is only a candidate, not reserved by this plan. Recheck reflection/body-api versions too. |
| The suggested migration reserve belongs to C7 | Registry and `c7-wave-plan.md` reserve 0024-0033 | Allocate fresh numbers after checking active branches; do not take the remaining C7 spare. |
| The brief contradicts itself about who counts XP | Section 7 says eventsink; draft ADR item 5 says Body; section 3.3 also writes proficiency back into sheet JSON | One canonical proficiency table owned by eventsink. Compose a full sheet on read; do not maintain two writable copies. |
| The probability fixture is rounded, not exact | Score 1 at DC 8 is 121/400 = 30.25%, shown as 30%; score 4 at DC 8 is 351/400 = 87.75%, shown as 88% | Test exact counts/rationals and separately test rounded presentation. Do not assert the displayed integer percentages as exact. |
| Hurt attribution is partly implemented | `golem/src/perception/hurt-trigger.ts` uses the server cause entity, never a nearby guess; `hurt.ts` and its schema emit no player name | Extend the existing causal path with authorized identity. Do not build a competing nearest-player detector. |
| Ownership messages are privileged infrastructure | Decision 0165: four-token subjects are outside the event sink filter; Mind and eventsink have no access | A `cleared_by` field alone cannot teach an observer anything. The Body must create a separate filtered observation with actor, prior owner and provenance. |
| A give receipt is not automatically something the recipient perceived | `golem/src/actions/give.ts` tracks toss/pickup on the giver; recipient knowledge needs its own path | Separate economic completion, pickup attribution and visible-observer evidence; no global receipt lookup in a heuristic. |
| Due commitments cannot schedule future wakes today | `PgMemoryStore.loadDeterministic` returns only due/undated commitments; `MindWakeReason` has no `commitment_due` | Add a bounded next-due query plus timer rescheduling on writes/start/resume, not a timer over the existing due-only list. |
| The loop has another retry besides corrective output | `thinking-loop.ts` can rerun from a fresh snapshot after a stale/expired plan refusal | Define the total call allowance across invalid-output correction, sanity veto and stale-plan rethink. A local two-call assertion is insufficient. |
| No-call recording currently depends on rendering | `recordThought` uses `cycle.render.templateVersion`; current run loads episodic memory and journal before prompt rendering | Give heuristic decisions their own engine/policy version and journal path; an accepted heuristic must not need prompt rendering, an embedder or admission. |
| XP cannot just be incremented for every delivered outcome | `eventsink/src/writer.ts` skips duplicate event inserts but invokes projections for every input event | Use a unique award/evidence ledger in the same transaction as the increment. Plain `xp = xp + 1` doubles on redelivery. |
| Successful actions are not all proof of the proposed XP conditions | Existing outcomes do not by themselves define a hostile kill, distinct conversation, kept promise or first lifetime chunk visit | Freeze a fact-to-award matrix. Add explicit evidence producers where needed; unsupported awards remain inactive. |
| Continuous estimated scores do not match the integer roll API | Estimates are REAL; `Score` is 1-5 integers; stranger behavior has several branches | Freeze how to discretize or integrate estimates. Compute expected action probabilities through the same pure policy; do not insert 10.5 as a die result. |
| `rolls: false` is only defined for the Body band | Idle think checks, weighted choices, insight, novelty, sanity and law still have chance in the brief | Specify each switch's semantics and what is recorded before contracts and cohorts are frozen. |
| Idle routines may invent direction without an adopted goal | Section 5.5 falls from no habit into a weighted task pick, while section 9 says the model owns all goals | Decide whether a goal-less bot may choose work. Recommended: no adopted goal means ask the model; habits/weights only supply means to an existing goal. |
| The shard schema is not a complete runtime config validator | Mind, Adam Body and player Body each have their own loaders; `parsePlayerConfig` currently constructs a replacement identity | Test every loader, roster creation path and supervisor-driven Body path. A schema-only edit is insufficient. |
| New workspace dependencies need image support | Golem, Mind and sink Dockerfiles copy explicit package directories; some callers run in other images | Add COPY/install and ignore-file changes for each actual consumer, plus frozen-lockfile builds. Package-local tests cannot catch a missing image dependency. |
| Full theory of mind has an evidence-identifiability problem | No evidence is specified for common_sense/cleverness; moving toward someone confounds curiosity with travel; trust is separate | Report observed fields and sample counts. Preserve priors for unsupported fields; never call all six fields learned merely because a mean error exists. |
| Source prose/notes do not approve the numbers in appendix A | Decision 0051 requires approval of identity seeds; existing lives and new-owner creation are separate paths | Owner approves initial sheets and adoption semantics. Do not change live ranger personalities as part of a plumbing merge. |

### Full delivery scope

`explore`, `farm` and `patrol` are scheduled in W7, with a contract/API unblocker and real heuristic registration. W8 completes the evidence the brief labels unavailable or later: observed combat, kept/broken promises, observed taking from owned containers and all XP award sources. Unsupported signals may remain inactive in an early milestone, but cannot remain unimplemented at final close.

W9 implements both moral hooks behind their accepted flag and connects social estimates to the existing reflection/trust path. W10 implements sheet inheritance alongside retained prose synthesis and actual child-creation handoffs. W11 implements drift as a separate default-off treatment, including its evidence window, audit, concurrency, live state propagation and prose/cache invalidation. The owner must settle drift's undefined evidence rule before its executable cards are written.

Features described as optional in the brief are included as implemented switches; they are not optional delivery items in this revised plan. Extending MCP `wait` to execute a sovereign player's Mind heuristics remains explicitly outside the brief. The Thinker gateway and general Cradle/birth machinery remain named existing Phase 1 dependencies, with readiness checks and a real end-to-end lineage gate in this campaign; they are not assumed to exist.

### Brief coverage

| Brief section | Scheduled implementation | Final evidence |
|---|---|---|
| 3: sheet, defaults and life storage | W1; W10/W11 add inherited/effective versions | Same validated own-life sheet through every creation/load path |
| 4: shared rolls and recording | W1, extended at each contract unblocker | Exact probabilities, stable draw identities and durable audit |
| 5.1: three decision layers and veto | W3-W4 | No-call execution, normal plan submission and bounded model retries |
| 5.2: threat | W2 | All scores, courage band, unarmed exception, retreat/time limits |
| 5.3-5.5: novelty, insight and idle work | W3-W4; new programs in W7 | Known-only choices, caps, habits, weighted programs and handoff |
| 5.6: property and commitment morality | W9, with W8 outcome evidence | Both law checks, exceptions, priority tiers and false-flag controls |
| 5.7-5.9: strangers, sanity and temperament | W4/W6; W9 trust; W11 changing temperament | Same policy predictions, bounded checks and immutable versioned prose |
| 6: social estimates and every listed evidence source | W5-W6 and W8-W9 | Speech, movement, hits, gifts, property, promises and observed mob combat |
| 7: all seven proficiency domains | W2 and completed sources in W7-W8 | Unique awards, levels, restarts and real producer-to-sink cases |
| 7: optional attribute drift | W11 | Seven-day windows, accepted criterion/margin, per-field cap and audit |
| 8-9: flags, cohorts and constraints | Every wave; W12 comparisons | Exact off path; context/knowledge/goal boundaries; independent switches |
| 10: proposed Body capability packet | W7 | Explore, farm and patrol are all implemented; no budget-contingent extras |
| 11.1: sheet lineage and retained prose synthesis | W10 | Recorded parent mean/mutation, new child, zero XP and clean inherited memory |
| 11.2-11.3: tests and cohort report | Per-wave gates and W12 | All minimum tests reconciled with accepted policies; full-feature report |
| Appendix A: named initial sheets | W1 support; D-CS-10 before activation | Owner-approved values adopted explicitly and recorded |

## Architecture to freeze in packet authoring

These are engineering recommendations. AN-00 records the accepted choices; coders receive exact names, types, invariants and fixtures. None is a permission to improvise during implementation.

1. **Sheet and life identity.** `agents.character_sheet` stores the immutable adopted/birth baseline. W11 adds versioned effective-score changes without rewriting that baseline. A dedicated proficiency projection holds XP and derived levels. If configuration accepts starting proficiency, define it as an initial import only; a child starts at zero. Loads compose the engine input from these sources. Existing lives are backfilled deliberately; changed YAML never silently reseeds an adopted life. Drift, when enabled, is the explicit exception to stable effective attributes.
2. **Pure engine.** `psyche/` exports types, validated normalization, standard defaults, versioned RNG, rolls, parameter maps and temperament rendering. It imports generated contract types only where possible. It has no model, database, NATS or game client runtime. Do not copy heuristic formulas into a second prediction engine.
3. **Audit identities.** Distinguish shard/run/life, producer (`body`/`mind`), body generation or cycle identity, policy/engine version, decision id and draw index. Stable ids deduplicate transport retries; fresh decisions get fresh ids. Persist/recover the counter strategy so restarts cannot replay a draw accidentally. Record raw dice/uniform draws, score/proficiency snapshot, situational inputs, options/weights when relevant and the resulting decision.
4. **Not every decision rolls a die.** Threshold choices, weighted choices, idle think draws and heuristic `pass`/escalation decisions need an inspectable decision record too. A roll event must not claim to know whether a different component later called a model. Link by decision/thought/action ids instead. Keep raw sheet values and roll metadata out of snapshots, MCP output and agent-visible journal summaries.
5. **Control path.** Omitted `character` means off. Off performs no engine draws, temperament append, heuristic veto, changed attention ranking or proficiency bonus use. Preserve the configured released prompt versions and the old execution branch. New passive telemetry must not change plan outcomes or consume thought credits. Test explicit off and omitted configuration, even with a nonstandard stored sheet.
6. **Proficiency.** Exactly-once effects, not assumed exactly-once delivery. A unique `(life, domain, evidence-key)` award ledger and increment occur in one DB transaction. Level is derived from the accepted thresholds. A durable publication/reconciliation mechanism prevents DB-commit/NATS-publish gaps. Request/reply returns a versioned state; level notifications are monotonic and cannot downgrade a reconnected cache.
7. **Body cache and failure.** Golem keeps no Postgres connection. Freeze bootstrap timeout, stale-cache behavior, bounded retries and the cap outcome. Recommendation: use validated zero proficiency until a fresh state arrives, record degraded status, and retain a previously validated newer cache across reconnects; owner accepts its effect on treatment fidelity. Emergency escape/reflex execution does not wait indefinitely on audit or XP services.
8. **Heuristic authority.** Immutable `FxContext` contains only this life's authorized snapshot, memory, adopted goals, commitments and observed estimates. The deterministic pipeline has a written order: speech/urgent commitments and hard escalation guards, failure policy, stranger/novelty, idle. `act` is a discriminated union requiring intent or actions and is validated through the normal thought validator. No heuristic repeats an economic action or writes the goal stack.
9. **No-call execution.** After snapshot and deterministic memory, a settled heuristic writes an auditable thought/decision with null model input/output and zero credits, then uses the same checked submission path. A refusal is recorded as a refusal, not a successful heuristic. Admission/rendering/model calls happen only on escalation/pass-through. Keep abort/timeout/finally settlement behavior and the one-in-flight guarantee.
10. **Retry state.** A decision carries a single explicit allowance through invalid output, veto and stale-plan handling. Recommendation: at most two model calls for a sheet-mode decision; a required third call falls back and records why. Off retains today's retry behavior. Failure keys include the original problem identity; changing arguments/halving counts cannot reset the cap. State survives a restart or the reset is an explicit experimental limitation.
11. **Observation, not infrastructure access.** Preserve server event time, observed time, stable actor-life identity and source evidence id. Resolve a display name only through an authorized sighting; never join a reused name to the wrong life. Giver/breaker names require causal evidence and visibility according to the accepted rule. Missing actor/prior owner/line of sight produces no attributed social evidence. Global block-owner changes never become an omniscient feed.
12. **Social model.** Store per-observer estimates, count and provenance separately from relationships. Deduplicate observations before incrementing counts; define ordering and repeated-position sampling so a standing bot does not produce infinite contact evidence. Prediction consumes estimates, not true sheets. Prose is explicitly an interpretation in quoted world text. W9 feeds it to the existing reflection model, whose validated output may revise trust; no deterministic estimate-to-trust overwrite is introduced. When actual scores drift, offline error uses the truth version at prediction time.
13. **Versions and packaging.** Allocate prompt families independently after checking files, registry and in-flight branches. Keep old versions loadable. Record the heuristic/engine version without faking a model completion or a prompt hash. All consumers/images get the workspace dependency once, under the wave's single lockfile owner.
14. **Lifecycle.** New state is per life: death/retirement stops timers, cancels subscriptions and prevents late writes; a new life starts fresh, subject to any separately accepted inheritance rule. Follow the existing non-permadeath respawn semantics instead of treating every respawn as a new life. Enumerate how new tables appear in exports, deletion and retained world history under decision 0171 before they ship.
15. **Lineage.** Preserve the birth baseline and parent links. The proposed child formula is `clamp(round(mean(parent effective scores) + mutation), 1, 5)` with mutation -1/0/+1 at 20/60/20%; the owner chooses birth versus current effective parental scores explicitly. Record formula version, parental sheet versions, draw ids and final child sheet before publication. Retry/recovery creates the same child once. Prose synthesis and inherited semantic facts retain spec 5.9's separate limits, with no parent journal, relationships, skills or proficiency copy.
16. **Drift.** Window by world ticks, not wall-clock time; seven in-game days are 168000 world ticks. Freeze eligible fields, evidence criterion, minimum samples, margin, evaluation cadence and whether a maximum one-point change applies per field or per whole sheet. Persist a last-covered window/revision so duplicate sleep, overlapping windows and restarts cannot bypass the cap. Changes are atomic, recorded and propagated to Body/Mind caches and future prompt/persona rendering. Every resulting prompt identity remains versioned; old journals retain the version they actually saw.

## Phases and waves

Each implementation wave holds four to six packet candidates. A contract unblocker merges to its integration branch before its dependents start. A subsequent wave branches from the last merged wave. Package manifests/lockfile, shard files, ACL generation and shared wiring each have one named owner per wave. Parallel branches hand requests to that owner through their own worknotes.

| Wave | Sequence and fan-out | Observable exit |
|---|---|---|
| W0 | AN-00; optional AN-01 after process/model choices | Accepted scope recorded, exact authoring decisions enumerated, number collisions avoided; adapters discoverable if chosen |
| W1 | AN-02 first; AN-03/04 in parallel; AN-05 after both; AN-06 after 04; AN-07 integrates | Fresh and upgraded scratch DBs accept the data; all loaders agree; real roll producer-to-sink path; off starts with old behavior |
| W2 | AN-08 and AN-09 in parallel; AN-10 after 09; AN-11 after 10; AN-12 integrates | Adam and one disposable sovereign Body use different approved threat profiles; duplicate/reordered XP and restarts converge |
| W3 | AN-13 unblocks AN-14/15; AN-16 wires them; AN-17 closes | Idle and failure choices execute through receipts with zero model calls when handled; speech, no-goal and cap cases escalate |
| W4 | AN-18/19/20/21 in disjoint modules; AN-22 after 21; AN-23 owns shared wiring | Novelty, sanity and future due commitments work; shared retry cap holds; prompt and persona boundaries pass |
| W5 | AN-24 first; AN-25/26/27 in parallel; AN-28 integrates | A recipient/observer sees only a causal, visible hit/give/break with enough provenance; hidden controls remain unattributed |
| W6 | AN-29 unblocks AN-30/31; AN-32 integrates | Estimates update once per valid observation; same policy predicts; no actual-score access in agents; prose is bounded |
| W7 | AN-44 first; AN-39/40/41 in parallel; AN-45 integrates | Explore/farm/patrol are registered, checkpointed and used by eligible idle choices |
| W8 | AN-46 first; AN-47/48/49/51 in parallel; AN-50 integrates | All proposed combat/promise/conversation/property evidence and XP sources work with causal deduplication |
| W9 | AN-52 first; AN-37/38/61 in parallel; AN-53 integrates | Both moral hooks and reflective trust work; flag false retains the earlier behavior |
| W10 | AN-54 first; AN-42 and AN-55 then AN-56; AN-57 integrates | Actual headless and sovereign child paths inherit sheets, synthesized prose and allowed facts exactly once |
| W11 | AN-58 first; AN-59 then AN-43; AN-60 integrates | Drift uses the accepted seven-day criterion, cannot exceed its cap and reaches Body/Mind/prose coherently |
| W12 | AN-33 then AN-34; AN-35 runs the frozen protocol; AN-36 closes | Full-feature report separates programs, morality, learning, trust, lineage and drift before rollout |

**Earliest useful deployment:** after W2, Body threshold diversity and proficiency can help sovereign players without enabling a local Animus Mind on the Colo. This is a limited milestone, not delivery of the full brief. Exact ranger activation values wait on D-CS-10. Keep the existing Mind profile rule (0134) until a verified Thinker path and its accepted replacement decision exist.

**Second milestone:** W4 proves the Mind treatment on disposable local phase0 lives using the pinned 8B live lane. This does not turn the Mind on in production.

**Intermediate social milestone:** W6 supplies the initial social models. W8 completes every evidence source named by the brief, and W9 connects reflection and morality. W6 is not full-brief completion.

**Full campaign:** W10 proves real lineage after the external birth dependencies; W11 proves default-off and enabled drift. W12 evaluates the entire delivered feature set and its ablations. No product feature can be moved back to an unspecified follow-on merely to call the campaign complete.

## Decisions by time

### Existing campaign dependencies to settle before affected cards

| Dependency | Existing owner/scope | This campaign's explicit obligation |
|---|---|---|
| General birth/Cradle lifecycle | Phase 1 C4-00/C4-05: server-authorized births, ids, parent links, headroom | AN-54 freezes interoperability; AN-55/57 require the real lifecycle. Track as BlockedDependency if unavailable; do not invent a second allocator or claim full lineage from mocks. |
| Prose synthesis and child initialization | Spec 5.9; current scanned sources do not establish an end-to-end implementation | AN-56 explicitly implements/extends the synthesis and limited child memory/export adapter; AN-57 verifies actual child activation. This work is scheduled here rather than assumed. |
| Sovereign fresh-repo/identity refresh | Existing external launcher/Scriptorium workflow | D-CS-17 names its companion implementation owner and versioned handoff; AN-56/57/60 provide artifacts, retries and acceptance. No launch/refresh handoff can remain pending at the full feature's close. |
| Colo Thinker path | Existing C4 gateway; decision 0134 leaves Mind profile off | Local 8B Mind evidence can proceed; production Animus activation waits for a verified gateway and its accepted profile-change decision. The gateway is not rebuilt in this campaign. |

The older C4 cards describe a different life-id shape than the current contract. Their presence is planning evidence, not proof of a deployed prerequisite. AN-00 and D-CS-17 must name the compatible baseline, outstanding prerequisite cards and responsible owner before lineage cards are made executable. If the owner wants these dependencies delivered by this same orchestrator, import/re-slice the existing C4 work under its own ledger rather than duplicate it in the character campaign.

### Before writing dependent executable packets

The owner has already authorized planning every brief proposal. The remaining decisions concern behavior, evidence and execution. Use the ordered [decision walkthrough](decisions-before-packets.md) to settle them before authoring dependent executable cards. No additional scope-permission question is needed. An accepted ADR amends the spec under decision 0073; no packet edits `docs/spec.md`.

| ID | Question for the owner | Recommended answer and dependency |
|---|---|---|
| D-CS-01 | Does a sheet govern Body reflexes and routine Mind choices, while the model retains authority over goals? Can idle work start without an adopted goal? | Accept sheets/heuristics; no new goal from a heuristic. With no goal, escalate. Author W1-W4 only after this boundary is fixed. |
| D-CS-02 | May temperament refuse a deliberate `mine`/`withdraw`, amending 0164 and principle 5? Should law lower a promise wake's priority? | Implement both in W9, false by default. Approve trait-based refusal, the evil/starving exception and one law priority decision per due occurrence. This is a policy ruling, not a proposal to omit the work. |
| D-CS-03 | Are innate scores immutable at adoption? How are existing lives and future self-registered players assigned sheets? Are appendix A values acceptable? | Freeze per life; use approved standard defaults for new owners pending a separate assignment rule; approve or revise named sheets separately. Do not overwrite current lives during deploy. |
| D-CS-04 | Is proficiency a durable eventsink projection, what evidence earns XP, and does it reset only on a new life? | Yes. Approve thresholds and evidence matrix. W8 completes all missing sources; new lives/children start at zero, ordinary respawn preserves the life. |
| D-CS-05 | What does disabling rolls mean outside threat reflexes, and what does an estimated fractional score mean? | Reserve `rolls` for d20 checks, retain separately seeded/audited weighted picks and think draws, and document deterministic outcomes for each disabled check. Use an explicitly chosen integer-estimate mapping and exact expected branch probabilities. The full per-function truth table is required before AN-02/03/14/15/19/30. |
| D-CS-06 | Which perception additions are authorized? Are gifts and broken property inferred only with direct causal proof? | Visible, causal actor evidence only; no global owner-cache evidence. Unknown remains unknown. Initially learn only fields with an accepted observable signal. Approve the attribution matrix before AN-24. |
| D-CS-07 | On audit outage, do actions proceed; how are gaps recorded; how are new private/model data exported or erased? | Emergency reflexes proceed, buffer within a fixed limit and emit recoverable gap evidence. Freeze the ordinary heuristic failure path and lifecycle/export map before storage/audit cards; use existing 0171 rules. |
| D-CS-08 | Should Codex receive mirrors, and which review/budget rule governs this campaign? | Optional mirror. Honor the current AGENTS requirement for a fresh review of each finished packet, plus wave integration review. Use the requested 50-70k packet envelope rather than silently enforcing the old 40k ceiling. |
| D-CS-09 | Which parental sheet version is inherited, with which mutation and child-memory limits? | Implement W10 with recorded 20/60/20 mutation, current effective parental scores snapshotted at birth, retained prose synthesis, limited semantic facts and zero XP. Birth baselines versus current effective scores need an explicit ruling. |
| D-CS-13 | What independent evidence justifies drift, which fields can change and at what sample/margin/cap? | Implement W11 default-off. Seven-day windows; recommend external observed behavior/outcomes rather than treating lucky generated dice as personality evidence. The criterion is a substantive clarification of the brief. |
| D-CS-14 | What exactly do explore, farm and patrol do? | W7: known frontier, observed field and known route; bounded checkpointed motor routines; no wiki coordinates, new goals or automatic player attack. |
| D-CS-15 | When is a promise proven kept/broken, and what is one conversation exchange? | W8: structured matching to this life's observed events; ambiguous stays unknown; one bounded bilateral exchange is one award. Due/overdue alone does not prove betrayal. |
| D-CS-16 | How do estimated traits affect trust? | W9: expose uncertain evidence to the existing reflection model, which can revise trust through normal validated writes; no fixed code delta or extra routine model call. |
| D-CS-17 | How do current life ids, existing C4 births and external sovereign launcher creation fit together? | Freeze an adapter contract and an owner for external prerequisites. The birth gate requires actual headless and sovereign children; a factory unit test alone cannot close W10. |
| D-CS-18 | Does a second valid-plan veto get waived, or does an exhausted allowance fall back? | Recommend fallback after the shared two-model-call allowance. This deliberately resolves the brief's conflicting retry rules before W3/W4. |

Technical choices the orchestrator can settle within those rulings: package boundaries, exact schema field names, SQL keys/grants, the RNG/hash and versioning algorithm, retry state layout, batch handling, next-due query API, lockfile/image ownership and test fixture shapes. Record them before dispatch. If a choice changes owner-visible behavior, return it as an owner question rather than disguising it as plumbing.

### During packet writing and review

- **Number allocation:** inspect the current registry plus active local/remote branches and coordinate with active campaigns before reserving ADRs, migrations or prompt versions. This review did not fetch every remote branch or reserve any number. At this snapshot, ADR 0173-0179 and SQL 0024-0033 are unavailable; do not assume 0180/0034 is still free at dispatch.
- **Fact-to-XP matrix:** author exact success/failure/cancel/duplicate boundaries for every domain. Resolve hostile-kill credit, fight-survived start/end, crop harvest versus seed placement, stone/ore types, partial building, craft batch size, first chunk visit, bilateral conversation and promise completion. This is behavior, not an optional coder interpretation.
- **D20-disabled table:** specify threat, novelty, insight, sanity, law checks, stranger and idle behavior individually. Also specify `tom.enabled: false`, `proficiency.enabled: false`, `morality_hooks: false`, `drift.enabled: false`, lineage off, malformed sheets and missing remote state. A flag whose false case is undefined is not ready.
- **Veto policy:** D-CS-18 settles the conflicting second-veto rules before authoring. The writer then encodes the exact invalid-output/veto/stale-refusal state machine and named cap tests; no coder chooses a fallback or waiver.
- **Timer policy:** future commitments, overdue commitments, resolution, new writes, server pause, reconnect and shutdown must have expected behavior. Avoid repeatedly waking on the same due commitment. Decide how frequently an unresolved promise can be reconsidered.
- **Read/write ownership:** enumerate every touched shared file in the wave owner table before dispatch. Add a preparatory split packet when existing code cannot remain below its cap. No final integration card receives an open-ended "fix all wiring" brief.
- **Readiness:** replace directory-level candidate ownership with exact files and requested index lines; add code shapes, fixtures, named revert-checks, branch/worktree/report paths, commands, commit subject/trailers and cap outcomes. Only then mark `Ready` or `BlockedDependency`.
- **Unexpected scope:** a new program, unobservable evidence source or need for a third model call is a re-slice or ruling. It is not a small deviation a Haiku coder should invent.

### After packets are written, before activation or measurement

**D-CS-10:** approve the concrete Adam/ranger sheets, whether existing lives adopt them, exactly which flags turn on, and the target deploy batch. This approval is about a reviewable configuration diff, not the existence of the feature. Inactive code can merge first. Review the bootstrap/degradation and rollback evidence before the first live ranger uses bonuses.

**D-CS-11:** choose the treatment/measurement design before writing AN-33 to AN-35. Numeric run duration, seed count, cohort sizes, model/quantization, spend ceiling and acceptance bars can be finalized against the reviewable protocol, but must be accepted before any treatment run. Include programs, morality, social evidence, reflective trust, lineage and drift in the registered evidence. Do not choose a survival/cost threshold after seeing results.

### After implementation and the cohort report

**D-CS-12:** choose broader enablement, continued opt-in, a tuning follow-up or stopping a treatment. Lower cost alone is insufficient if survival, useful work or social modeling worsens. Approve defaults and named-life changes as their own configuration diff, including whether the now-implemented morality, lineage and drift switches turn on. Implementation completeness and a positive scientific result are separate verdicts.

## Evidence and experiment design

Use four primary treatments, not the brief's final three-row shorthand:

| Treatment | Purpose |
|---|---|
| A: off | Existing code, prompt versions and behavior |
| B: all 3s, d20 checks disabled under the accepted semantics | Mind/routine-policy treatment relative to A |
| C: all 3s, d20 checks enabled | D20 effect relative to B |
| D: varied sheets, d20 checks enabled | Diversity treatment relative to C |

W12 runs this primary comparison after all implementation waves. Add registered matched on/off comparisons for explore/farm/patrol availability, moral hooks, expanded social-model evidence/reflective trust, proficiency and drift. Pair sheet-inheritance on/off birth scenarios with fixed parental versions; lineage is not meaningfully tested by a cohort with no births. A drift treatment must cover a complete seven-day evidence window plus the accepted evaluation/cooldown boundary; a five-day survival run cannot test it. Choose a bounded staged/fractional design under D-CS-11 rather than assuming the full combinatorial cross-product is affordable.

B-A also includes any prompt-policy changes unless they are held constant. D-C includes temperament prose unless a prose-only or prose-disabled ablation is added. State those confounds; add ablations if the owner wants a causal claim specifically about code parameters. Learning and theory-of-mind flags must be held fixed across the compared treatments, or varied as explicitly named additional factors. A growing proficiency is not an unrecorded nuisance variable.

Each replicate starts from the same cloned initial world for every treatment, with fresh life/state records and reset RNG state. Run treatments serially on independent clones; the same seed in one already-mutated world is not a control. Multiple world seeds and run replicates are needed before claiming an effect; a seed does not make model outputs deterministic. Record code, prompts, model digest/settings, treatment flags, initial sheet hash, simulation tick rate, exposures, exclusions and audit coverage.

| Measure | Required interpretation |
|---|---|
| Program choice by life and pairwise Jensen-Shannon divergence | Compare distributions at similar opportunities; report counts, empty populations and uncertainty |
| Fight/flee health distribution by sheet | Account for weapon state, visible threat, proficiency and exposure; separate floor changes from stochastic band choices |
| Model calls per useful autonomous minute | Count corrective/stale retries and separate chat, reflection and routine calls; retain a fixed definition of useful time |
| Heuristic share and latency | Separate selected, submitted, accepted, refused and completed; zero model calls is not proof of a useful action |
| Deaths, food and shelter by a fixed day | Report both rates and actual denominators; no survival gate inferred from cost savings |
| XP by domain and unique evidence count | Detect duplicated awards and farmable proxies; distinguish domain competence from raw activity |
| Theory-of-mind error by contact | Score predictions before their outcome is observed; report by learned field and sample count; compare to prior/constant-3 baselines |
| Moral behavior and trust revision | Property refusal rate, starvation exception, promise wake latency and trust changes by evidence; separate lack of evidence from lawfulness |
| Explore/farm/patrol completion | Useful yield/coverage, limits, interruptions and XP; do not count a selected program as completed work |
| Parent-child traits and memory | Exact mutation distribution, versioned ancestry, child XP zero and no forbidden parent-state transfer |
| Drift by field and window | Versioned effective truth, sample eligibility, one-point/cooldown adherence, Body/Mind/prose agreement and stable false-flag control |
| Audit completeness and restart recovery | Missing evidence marks a run incomplete; do not drop unaudited decisions and report a clean result |

The existing `tools/progress-metrics` reads files, not live Postgres. Preserve that boundary: a separate operator-only export supplies bounded, versioned event/sheet/evidence files, then the metrics command reads those files. True sheets are exported only for offline scoring and never enter the Mind's estimator port or agent-facing prose.

## Execution and verification rules

The existing `.claude/skills/campaign-packet/SKILL.md` and Phase 1 conventions provide the process, with the conflicts explicitly resolved in AN-00. Current user-supplied AGENTS requires a fresh reviewer of each finished packet; keep that requirement unless the owner changes it. Wave reviews still test interactions. Fresh fix coders apply numbered findings; allow three packet passes or five batch/wave rounds, then re-spec/re-slice or ask for a ruling. An author never reviews its own work.

Use one worktree per packet under `.claude/worktrees/`; use `codex/character-sheet-w<N>` integration branches and `codex/an-<nn>-<slug>` packet branches for Codex execution. A dispatch names the exact absolute path. The orchestrator writes decisions and packets; coders implement; ops merges/runs the exact authorized commands. At most three child agents with this session's four-slot limit, despite older docs allowing six total; never oversubscribe the actual harness. This planning pass dispatches none.

Most feature packets target 50-70k working tokens as requested. Estimate 25-40k for implementation, with the rest for necessary reading, negative tests, checks and the report. A small skeleton/contract need not consume 50k. If a design exceeds roughly 12 steps, touches several independent lifecycles or is expected to exceed 70k, split before dispatch. No planned continuation to rescue an oversized packet. Review/fix and ops costs are additional; estimates are not hard runtime metering.

Each executable card specifies meaningful targeted tests and its faithful revert-check, package typecheck/formatting, `git diff --check`, repo checks, merge-tree check, exact dependency pins if any, and an on-cap report with the base SHA. Do not add tests merely to restate constant data. For new counters/timers/caches, cover first/last/past-cap, cancellation, disconnect, restart and error cleanup. Contract cards regenerate; SQL/grants/NATS cards require real isolated-service integration evidence, including denied-role cases. A mocked transaction is not a durability proof.

At wave close, run the full `./geldar.ps1 check` with the integration case floor, focused real-client scenarios and the appropriate 20 TPS benchmark. Keep live cases serial and 8B-only. Never run `adam up` or its help before them; they own the Mind/Body and port 7410. A 32B run is separately manual, with no concurrent live cases. No production story intervention is part of validation. Use disposable fixtures and preserve live history.

After review: docs sweep, retro, any resulting process packet, ledger/RESUME update and report retention before worktree removal. Ship only through `ship-pr`, with the existing merge authority and CI gates. Feature flags provide behavioral rollback; preserve additive SQL/audit history rather than attempting a destructive schema rollback. A partial wave whose real integration gates did not run remains pending.
