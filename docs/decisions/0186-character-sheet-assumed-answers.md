# 0186. Character sheet: the assumed answers to the geldar behavioural questions

- Status: Proposed. The answers are ASSUMED at their recommended values under the owner's delegation (scriptorium decision 78). Geldar accepts them for packet planning only. Nothing is switched on, and no sheet reaches a live player.
- Date: 2026-11-14
- Spec: none. This is a campaign decision; `docs/spec.md` is not edited.
- Related: `docs/analysis/character-sheet/decisions-before-packets.md` (the D-CS questions and their recommendations); `docs/analysis/harness/README.md` (the Mind campaign, D-HC-02, D-HC-14); 0164 (deliberate mining), 0171 (erasure and world history), 0185 (per-turn record)

## Context

The character-sheet brief is delivered through the harness campaign (`docs/analysis/harness/README.md`). Its packets depend on behavioural answers the owner has not ruled on. Under the owner's delegation (decision 78) the orchestrator adopted the recommended answers as assumptions so that packets can be planned. This record writes those assumptions down in one place, names the cards that depend on each, and lists what the source does not answer. It is not an owner ruling.

## Decision

The answers below are planning assumptions at their recommended values. If the owner changes one, the named cards are re-sliced.

**D-CS-03 (immutable adopted baseline; rule R-sheet in `work-packets-geldar-a.md`).** Each life has one immutable birth or adoption baseline. A separate proficiency projection holds XP and levels, and versioned effective-score deltas are kept only if drift is enabled. Rule R-sheet: the database baseline wins. A config sheet is a candidate. The first adoption sets the baseline, and a later different candidate is logged as `conflict` and changes nothing. Config initializes a life; restarting or editing YAML does not reseed it. A normal respawn keeps the life, and a genuinely new life starts with zero XP. Owner-created lives use the standard all-3 sheet. A missing configured sheet normalizes to standard, a malformed sheet is rejected rather than repaired, and a missing XP reader uses the zero or stale-cache policy and marks the run degraded.

**D-CS-04 (eventsink owns XP; thresholds 10/30/70; the evidence matrix).** eventsink is the only durable XP authority. Body and Mind publish typed accomplishment facts. Levels start at 10, 30 and 70 XP, marked unmeasured and shard-configurable. One unit is awarded per unique qualifying accomplishment, never per redelivered message. Failed, duplicate, partial and cancelled attempts award nothing, and each accomplishment has one canonical evidence key. The evidence matrix covers the seven domains (combat, farming, mining, building, crafting, exploring, social). Its rows are proposed, and each award unit needs the owner's approval in the P0 ADR. Structured promise conditions are deferred with AN-48 (D-HC-06). A conversation award needs a directed response pair between two lives inside one exchange window, with one award per participant per exchange.

**D-CS-05 (what `rolls: false` means per function).** `rolls` governs d20 ability checks only. Weighted choices and idle think draws keep their independent seeds and are recorded, so a shard with d20 off is not fully deterministic. Per function, as the source gives them:

- threat: skip the courage band and use the score's floor;
- novelty, insight, sanity and law: a candidate deterministic rule (decide success at an exact success probability of at least 0.5). It changes all-3 behaviour and is not accepted per function;
- stranger: integrate the expected outcome through the branch formula; no die result is fabricated;
- idle: the accepted seeded weighted and think draws, recorded.

Estimated scores are fractional, so the expected results of the two adjacent integer policies are interpolated, and exact branch probabilities are then integrated. Actual execution stays on integer scores. The kit's moral hooks fail open when rolls are off (D-HC-14), because the 0.5 candidate would make law 3 at DC 11 refuse every time.

**D-CS-07 (audit outage rule).** Emergency reflexes proceed. They use a bounded durable or buffered evidence path and emit recoverable gap evidence. Every roll is recorded, and no experiment is reported complete after decisions are lost. Retirement or a new life cancels timers and prevents late state writes; an ordinary respawn is not a new life. Export, owner-link removal and retained world history follow 0171. The rule for ordinary heuristic actions during an outage is not in the source (see Open).

**D-HC-02 (psyche mirrored into the kit, pinned by a tree hash).** Accepted under decision 78. `psyche/` is written once in geldar and released (GX-02), then mirrored into the kit as `packages/psyche` (HC-17). A recorded tree hash pins the mirror, with a CI test. A published package is a later option.

## The other assumed answers

| D-CS | Recommended answer (short form) | Cards that depend on it |
|---|---|---|
| 01 | Heuristics choose bounded means to an adopted goal and handle accepted immediate reactions. They never write the goal stack. With no adopted goal, escalate to the model. Speech goes to the model. | AN-37 (`work-packets-geldar-b.md`, line 449) |
| 06 | Attribution needs causal evidence and the visibility and hearing rule. Unknown stays unknown. An unseen combat, gift or break updates no model. Trust uses the existing reflection model, with no fixed conversion. | AN-46, AN-47a, AN-47b, AN-50 (geldar B, lines 327 to 399) |
| 08 | If Codex runs the campaign, add its adapters, keep one procedure body, keep per-packet and wave review, and resolve commit attribution and the squash policy before dispatch. | None named in the card files |
| 09 | A child's innate scores are the rounded parental mean plus a recorded -1/0/+1 mutation (20/60/20), clamped to 1 to 5, from the parents' effective scores at the request. Child proficiency is zero. Up to two semantic facts per parent. | AN-54a (`work-packets-geldar-c.md`, line 143); AN-55 family (lines 236 to 312) |
| 11 | A bounded staged paired design: off, all-3 with d20 off, all-3 with d20 on, varied with d20 on, extended by harness and model. | AN-33a (line 128); AN-35a and AN-35b (lines 654 and 675) |
| 13 | Behaviour-based drift, default off, from the immutable baseline. Complete seven-day windows, at most one point per eligible field per window, incomplete-audit windows rejected. | AN-58a (line 366); the W11 cards AN-58b to AN-60 (lines 410 to 550) |
| 14 | Explore advances toward a frontier from observed-space history. Farm does a finite harvest or replant pass on an observed field. Patrol follows a known route for a finite budget. No invented goals, hidden terrain or automatic attacks. | AN-44 (`work-packets-geldar-b.md`, line 239); AN-39, AN-40, AN-41, AN-45 (lines 268 to 305) |
| 15 | Structured promise conditions are deferred with AN-48. The exchange rule (directed response pair, one award per participant per exchange) is the one in use. | AN-46 (line 327); AN-49 (line 368) |
| 16 | Trust is revised by the existing reflection model, with provenance. No fixed estimate-to-trust conversion, no truth-sheet access, no extra routine model call. | None names D-CS-16 (AN-46 cites D-CS-06 only) |
| 17 | The lineage id question is reconciled through an accepted adapter contract with the existing birth campaign. No second allocator. Both real child paths must pass; no mocked birth completes it. | AN-54a (line 143); AN-55a (line 262, BlockedDependency) |
| 18 | At most two model calls for one sheet-mode decision across correction, veto and stale-plan handling. An exhausted allowance falls back. The old path is kept when character mode is off. | None names D-CS-18 |

## Not decided here

These stay with the owner. This record does not answer them.

- **D-CS-02** (amend 0164 and principle 5 so a trait can refuse a deliberate `mine` or `withdraw`; implement behind `morality_hooks: false`; never activate). The recommendation exists, but the owner must accept the 0164 amendment and the principle 5 reading. Cards: AN-52, AN-37, AN-53 (geldar B).
- **D-CS-10** (concrete ranger sheets and flags). Activation is a separate reviewed diff and owner gate. Cards: AN-07 (line 430), AN-12 (line 623), AN-53 (line 476), AN-35a (line 658).
- **D-CS-12** (rollout after results). Cards: AN-36 (line 692).

Nothing in this record activates anything. Character mode, morality hooks and named sheets stay off, and the Colo shard is not changed (D-HC-11).

## Why

- Planning needs one written set of assumptions with their dependent cards, so that a change by the owner can re-slice the right packets.
- The owner delegated these answers under decision 78. Writing them down here keeps the delegation visible and separate from owner rulings.

## Consequences

- Cards that name these ids are written against these values. A change re-slices them.
- The harness README's decisions row says D-CS-01 to D-CS-18 are all assumed. D-CS-02, D-CS-10 and D-CS-12 are not decided here. That row is reported to the campaign owner and is not edited by this record.
- This record makes no card Ready. Cards with *to confirm* items stay blocked.

## Open

Not in the source, or the source asks the question without answering it:

- D-CS-01: a finite duration for any goal-less idle work, if the owner wants it at all (the source recommends none).
- D-CS-04: the award rule when a hostile kill and a survived fight share one encounter. AN-47b takes one award per encounter and says the ADR records it; the source gives no recommendation.
- D-CS-04: the exchange window duration (an owner parameter in AN-49).
- D-CS-04: the owner's approval of every evidence-matrix row, in the P0 ADR.
- D-CS-05: the aggression-5 unarmed exception. The source defers it to an accepted rule. AN-08a takes a deterministic fight (70 percent exact chance) and marks it to confirm with the owner.
- D-CS-05: the owner's per-function acceptance of the 0.5 candidate for novelty, insight, sanity and law.
- D-CS-07: the rule for ordinary heuristic actions during an outage (escalate or hold, or proceed with an incomplete-audit marker), and the buffer limit.
- D-CS-08: which Codex adapters, and the attribution policy. The source says only "resolve before dispatch".
- D-CS-09: the synthesis model, budget, input bounds, retry rule, and the rule for a parent with fewer than five eligible memories.
- D-CS-11: cohort sizes, seeds, run lengths, spend ceiling and numeric bars. These belong in `protocol.json`, accepted before any run.
- D-CS-13: eligible fields beyond `curiosity`. The `min_samples` 20 and `margin` 2 values are unmeasured placeholders (AN-60).
- D-CS-14: the time and action limits for each program.
- D-CS-15: the exchange window duration.
- D-CS-16: the sampling rule for approach and avoid evidence.
- D-CS-17: the owner's adapter ruling (owner question 1), which AN-55a needs.
- D-CS-18: no card names it. The cards that need the two-call allowance are not identified.
