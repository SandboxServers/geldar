# Decisions before writing character sheet packets

The owner has requested that every proposal in `animus-character-sheet-brief.md` be planned. That scope decision is settled for planning: all product features now have waves in [the plan](integration-plan.md). The choices below determine what their executable packets must say. Recommendations are proposed answers, not accepted rulings, and these local D-CS ids are not ADR allocations.

Decide the policies once, record accepted amendments, then write each upcoming wave's self-contained cards. There is no need to approve a separate campaign for every subsystem. External birth/launcher/gateway prerequisites have explicit owners and acceptance gates; they cannot be assumed complete.

## 1. How much authority does a heuristic have?

**D-CS-01; needed for W1-W4.** The model owns goals, but the brief also allows weighted idle work. We need to decide whether a bot with no adopted goal can choose a task in code, and whether a curious diversion can interrupt an otherwise valid plan.

**Recommendation:** heuristics choose bounded means to adopted goals and handle accepted immediate reactions; they never write the goal stack. With no adopted goal, escalate to the model. Novelty/stranger detours happen only at accepted wake boundaries, not by cancelling any valid intent whenever something interesting appears. Speech goes to the model; no heuristic writes dialogue.

This is stricter than an unrestricted reading of the brief's idle fallback. If the owner prefers temporary goal-less work, say so explicitly and define its finite duration and return-to-model rule. Neither interpretation should be left to a coder.

**D-CS-18; needed for W3-W4.** The brief both waives a second sanity veto and falls back when a corrective retry has already been used. Existing stale-plan handling adds another possible retry.

**Recommendation:** at most two model calls for one sheet-mode decision across invalid-output correction, veto and stale-plan handling; an exhausted allowance falls back. Keep the exact old retry path when character mode is off. This is an explicit resolution of the brief's conflicting second-veto rules.

## 2. What is fixed at birth, and how do existing lives adopt sheets?

**D-CS-03; needed for W1 and W10/W11 storage.** YAML, a stored sheet, proficiency and later drift must not become competing sources of truth.

**Recommendation:** store one immutable birth/adoption baseline, a separate proficiency projection and versioned effective-score deltas if drift is enabled. Config initializes a life; restarting or editing YAML does not reseed it. A normal non-permadeath respawn preserves that life. A genuinely new life starts with zero XP.

Use the standard all-3 sheet for new owner-created lives until an explicit assignment policy exists. The brief's proposed Adam/ranger sheets can be implemented as a concrete pending configuration, but their exact values and adoption by current lives need D-CS-10 before activation. That value approval can wait until the diff is reviewable; it need not block authoring standard-sheet plumbing.

Also decide whether missing/invalid stored state stops startup or uses a recorded degraded state. Recommended: missing configured sheet normalizes to standard as specified; malformed sheets are rejected rather than silently repaired. A missing XP reader uses the accepted explicit zero/stale-cache policy, with the run marked degraded.

## 3. Do moral traits constrain deliberate actions?

**D-CS-02; needed for W9.** Planning both moral hooks is now required. Their behavior still needs a ruling because decision 0164 leaves deliberate mining free and principle 5 treats misbehavior as data.

**Recommendation:** approve both as explicit character traits, with `morality_hooks: false` by default and auditable on/off treatments:

- Law DC 11 can refuse a deliberate `mine` or `withdraw` on another life's property; a refusal becomes the fixed action_failed reason. Preserve the brief's `good <= 2` and starving exception. Define starving numerically; food at or below 6 is a proposed unmeasured starting value.
- Law DC 8 at a due commitment chooses attention tier one or tier three. A low tier delays reconsideration; it does not delete the commitment or assert that it was broken.

Unknown ownership should not be treated as proof of someone else's property. Automatic goto protection continues to treat unknown as protected under its existing rule; these are different decision paths. Repeated submission must not buy fresh moral rolls until the action succeeds: freeze a bounded action/problem identity and reconsideration rule in the card.

The owner must accept the amendment to 0164 and the interpretation of principle 5. Full planning authorization alone does not make that constitutional ruling.

## 4. What counts as learning and social evidence?

**D-CS-04/15; needed for W1-W2 and W8.** All seven proficiency domains are scheduled. The missing evidence sources now have implementation cards rather than permanent exclusions.

**Recommendation:** eventsink is the sole durable XP authority; Body/Mind publish typed accomplishment facts. Start at the brief's 10/30/70 level thresholds, marked unmeasured and shard-configurable. Award one unit per unique qualifying accomplishment, never per redelivered message.

| Domain | Proposed award unit to approve |
|---|---|
| Combat | One proven hostile kill or one qualifying survived encounter; define whether these can both award within the same encounter |
| Farming | One successfully harvested or sown crop cell; failed/duplicate/partial attempts are distinct from success |
| Mining | One successfully mined qualifying ore/stone block; decide whether player-placed/remine loops count |
| Building | One completed structure intent, not every attempted placement |
| Crafting | One completed craft operation, not one XP per item in its output stack |
| Exploring | First visit to a chunk by this life, persisted across restarts |
| Social | One confirmed give, one proven kept promise or one bounded bilateral conversation exchange |

Recommended anti-duplication details: one accomplishment has one canonical evidence key; same-domain kill/survival credit cannot duplicate the same end event; a repeated chat line is not a new exchange; gifts need actual recipient pickup; failures/cancellations award nothing. Prevent trivial place/remine loops if natural-versus-placed provenance is available; the owner should choose whether that restriction belongs in the research treatment.

Promises need a separate semantic choice. **Recommendation:** an optional structured condition records beneficiary/action/item/count/deadline where the model has supplied a matchable promise; legacy/free-text promises remain valid but may be unmatchable. Both headless memory and the sovereign's memory/MCP path need a narrow declaration adapter, sharing one observer-scoped matcher; sovereign XP must not require an Animus Mind. Match only this observer's actual evidence. A deadline passing is overdue, not proof of betrayal. A proven kept/broken promise can update an estimate; only a kept promise earns XP. Define what observed condition proves a breach rather than guessing from absence.

For conversation, approve a concrete participant/turn/window rule before AN-49; proposed starting rule is a directed response pair between two lives within one accepted exchange window, with one award per participant/exchange. Window duration and how the exchange closes are behavioral parameters, not unnamed coder defaults.

## 5. What exactly does turning dice off mean?

**D-CS-05; needed for W1 and every decision policy.** The Body band is specified, but Mind rolls, weighted task picks and idle think draws are not consistently covered by `rolls: false`.

**Recommendation:** `rolls` controls d20 ability checks. Weighted choices and idle think draws remain independently seeded and recorded; say plainly that d20-off is not an entirely deterministic shard. Freeze an exhaustive function table before authoring:

- Threat: skip the courage band, use the score's floor; use the accepted deterministic rule for the aggression-5 unarmed exception.
- Novelty, insight, sanity and law: use a specified deterministic decision rule. A candidate is exact success probability at least 0.5, but it changes all-3 behavior and must be explicitly accepted per function.
- Stranger: integrate the accepted deterministic/expected outcome through its branch formula; do not manufacture a die result of 10.5.
- Idle: preserve the accepted independently seeded weighted/think draws and record them.

Estimated scores are fractional while actual roll scores are integers. Choose rounding versus interpolation. **Recommendation:** interpolate the expected results of the adjacent integer policies, then integrate exact branch probabilities. Keep actual execution on integer scores. This gives a defined prediction without silently rounding away uncertainty or duplicating policy code.

The RNG/hash implementation and field names are engineering choices. Which decisions remain random and what disabled checks do are owner-visible research choices.

## 6. What may a bot infer about others, and how does that affect trust?

**D-CS-06/16; needed for W5-W6 and W8-W9.** The full scope includes speech/movement, hits, gifts, property taking/breaking, promises and observed fight/flee. It does not authorize an omniscient world feed.

**Recommendation:** actor attribution requires causal evidence plus the accepted visibility/hearing rule. Unknown remains unknown; display names are resolved through an authorized life identity. Property placement data alone is not something a bot saw. An unseen combat/gift/break does not update its model. Keep prior projections for fields with no observation rule; the brief does not supply evidence for common sense or cleverness, so do not invent it to make all six fields appear learned.

Keep the brief's prior-strength 2 and stated observation values as initial, unmeasured parameters unless the owner changes them. Accept a sampling rule for approach/avoid evidence so every stationary snapshot does not create another social observation.

For trust, **recommend using the existing reflection model**: provide bounded uncertain estimates and observed evidence, allow its normal validated output to revise trust, and retain provenance. No fixed estimate-to-trust conversion, truth-sheet access or extra routine model call. This plans the brief's reflective use while preserving the distinction between an estimate, a relationship and an observation.

## 7. What do the three new programs mean?

**D-CS-14; needed for W7.** Explore/farm/patrol now all have scheduled implementation and integration cards. Their boundaries must be narrower than open-ended autonomous occupations.

**Recommendation:** explore advances toward a frontier derived from observed-space history; farm performs a finite harvest/replant pass on an observed field with known available seeds; patrol follows a known route/base/trusted-person context for a finite lap/time budget. None invents a goal, queries hidden terrain, grants recipes or automatically attacks another player. Existing reflexes still handle immediate danger.

Approve completion, checkpoint, target-knowledge, time/action limits and property behavior for each program. Failed candidates escalate rather than silently expanding their search or running forever. These definitions are enough for an author to write prescriptive cards; a Haiku coder should not design a farming system or guard doctrine.

## 8. What exactly passes from parents to a child?

**D-CS-09/17; needed for W10.** The detailed brief retains prose synthesis; its draft decision question could be read as replacing it. Settle that ambiguity.

**Recommendation:** inherit every innate score using rounded parental mean plus a recorded -1/0/+1 mutation at 20/60/20%, clamped to 1-5. Use parental effective scores snapshotted at the birth request, record both source revisions and define half rounding explicitly. If the owner wants inherited birth baselines instead, record that alternative before authoring. Child proficiency/XP is zero.

Retain separate prose seed synthesis and the spec's limited semantic-fact inheritance: up to two facts from each parent, no parent journal/relationships/skills. Approve the synthesis model, budget, input bounds, failure/retry rule and what happens when a parent has fewer than five eligible episodic memories. The child identity/declared model remains its own approved birth configuration.

There is a real dependency: the older C4 birth cards propose `lf_...` ids while current contracts use `ag_...`. **Recommendation:** reconcile this through an accepted adapter contract with the existing birth campaign; do not introduce another allocator. Name who supplies general Cradle/birth support, headless creation and the sovereign launcher/fresh-repo handoff. W10 cannot close on a factory unit test or mock; both actual child paths must pass. This campaign schedules the inheritance/synthesis/adapters and tracks those existing-campaign dependencies explicitly.

## 9. What evidence justifies attribute drift?

**D-CS-13; needed for W11.** This is the least specified proposal. The brief supplies seven in-game days and at most a one-point move, but no precise disagreement measure, sample floor, margin, eligible-field list, cooldown or whole-sheet versus per-field cap.

There are two materially different designs:

- **Literal roll-based drift:** compare recorded success rates with the probability expected from current scores/DC/proficiency. It is straightforward to reproduce, but the rolls were generated from those same scores. A lucky streak is not independent evidence that personality changed.
- **Behavior-based drift:** compare actual observed choices/outcomes with the current trait policy under comparable opportunities. This needs an accepted per-field evidence/direction rule; it must not become a hidden success reward that duplicates proficiency.

**Recommendation:** implement behavior-based drift, default off, with the immutable birth baseline retained. This clarifies/revises the brief and needs an owner ruling. Before card writing, choose the eligible attribute/alignment fields, field-specific evidence/direction, minimum valid observations, disagreement margin, evaluation cadence and one-point cap/cooldown. Do not apply drift to op-mode weights or evidence-free fields merely because they are numbers on the sheet.

Use complete non-overlapping seven-day windows initially, at most one point per eligible field per completed window, and reject incomplete-audit windows. These are proposed defaults, not measured tuning. Headless evaluation can happen at reflection; choose whether sovereign evaluation uses confirmed sleep as the equivalent trigger or requires an explicit external reflection hook. Both paths need a specified result before AN-60 is written.

Also approve how changed temperament reaches sovereign identities. **Recommendation:** version/cache refresh for code and future prompts, plus an explicit reviewed persona-refresh artifact/launcher handoff for sovereign text. Never silently overwrite an approved external persona file. Old journal rows retain the exact effective sheet/prompt identity they used.

## 10. What happens during an audit outage or lifecycle change?

**D-CS-07; needed before W1 storage/audit cards.** Every roll is meant to be recorded, but a fleeing Body must not freeze waiting for a database.

**Recommendation:** emergency reflexes proceed, use bounded durable/buffered evidence where supported, and expose any gap; ordinary heuristic actions follow a separately fixed audit-failure rule. Decide whether they escalate/hold or proceed with an incomplete-audit marker when storage is unavailable. Never silently report a complete experiment after losing decisions.

Freeze queue/backoff/cap outcomes and effective-state bootstrap behavior. Follow existing decision 0171 for export, owner-link removal and retained world history; enumerate new tables before migration. Retirement/new life cancels timers and prevents late state writes; ordinary respawn is not a new life. These choices affect the first contracts, so they cannot wait until the final rollout.

## 11. Which campaign machinery should run it?

**D-CS-08; needed before tooling/dispatch.** The optional Codex adapter remains separate from product scope. The prior [adapter proposal](codex-adapters.md) recommends Luna/high for coding, Luna/medium for ops and Sol/high for review, with explicit role settings and a disposable pilot. The model mapping is a recommendation, not a measured equivalence.

**Recommendation:** add the three agent/four skill adapters if Codex will execute this campaign, retain one canonical procedure body, and keep current AGENTS' fresh per-packet review plus wave integration review. Use the owner's 50-70k working-token envelope; small unblockers stay smaller. Review/fix/ops consumption is additional.

Resolve truthful commit attribution, safe progress-commit/squash policy and the old skill's contradictory read-only/mutation language before dispatch. Respect actual harness concurrency. The orchestrator can choose filenames, RNG implementation, schema layout and exact check commands within the accepted behavioral contract; the owner does not need to design those details.

## 12. What must the final experiments distinguish?

**D-CS-11; strategy before measurement-card writing, numbers before running.** Four primary treatments separate off, all-3/d20-off, all-3/d20-on and varied/d20-on. Additional registered comparisons cover the newly scheduled programs, full social evidence, trust/morality, learning, inheritance and drift.

**Recommendation:** use a bounded staged/paired design rather than the entire combinatorial product. Include actual births for inheritance and a full seven-day evidence window plus its evaluation boundary for drift. Measure cost, useful work, survival, program diversity, social prediction, moral choices/trust revision, ancestry and audit completeness. Keep prose changes explicit as a factor or acknowledge the confound.

Exact cohort sizes, world-seed replicates, run lengths, spend ceiling and numeric success bars can be approved against the concrete protocol before running; no need to invent them while discussing the policy. D-CS-10 covers concrete named-sheet/flag activation after reviewable diffs, and D-CS-12 covers rollout after results. Those later gates do not block writing unrelated implementation packets.

## Recording the answers

Record accepted answers under allocated ADR numbers and update this campaign's decision rows; do not treat this recommendation text as approval. The policy decisions needed for W1-W4 should be settled first, then the W7-W11 decisions before their executable cards are authored. If the owner wants all executable packets written in one batch, settle every behavioral choice above first. Implementation order remains phased either way.

An answer that changes a recommendation updates the candidate slices and checks before dispatch. Full-scope coverage remains required; default-off or a dependency blocker cannot be used to mark a missing feature complete.
