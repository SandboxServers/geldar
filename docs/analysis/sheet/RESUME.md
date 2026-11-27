# Character sheet and psyche campaign (geldar-sheet) resume
Coordinator: geldar-sheet. Refreshed 2026-11-21 at `origin/main` = `2aa29c3a` (merge of #864). Card state below was written at `f03ab6e1` (#832, 2026-11-20); the 2026-11-21 changes are the section "Since 2026-11-20". State and evidence: [assessment-2026-11-18.md](assessment-2026-11-18.md) (a 2026-11-18 snapshot; the ledger supersedes its status); NeoForge: [neoforge-delta.md](neoforge-delta.md); cards and order: [../harness/ledger.md](../harness/ledger.md) (regenerated 2026-11-20), [sheet-next-wave-order.md](../harness/sheet-next-wave-order.md), [verification](../harness/sheet-cards-verification-2026-11-18.md).
Numbers (checked on main 2026-11-20). Decisions on main: 0280-0282, 0320-0329, 0343-0345, 0349, 0385-0391 (0391 added 2026-11-21, #851). 0346-0348 are not on main (status unverified). 0283-0285 stay free (released by 0326, 0327; never write 0283 as Accepted); 0286-0288 stay with S12-01, S12-04, S12-05. SQL: 0050-0053 used (0053 is the `turn_records` erase, S9-00a, #778); 0054, 0055 released (0327); 0056, 0057 S12; 0058, 0059 spare.
> **Decision 0390 is Accepted (operator ruling, 2026-11-27, see 0289) and supersedes 0329.** The NeoForge twins stay frozen until their cards are re-dispatched; nothing is activated (held-live stands).

## Since 2026-11-20 (checked against origin/main 2aa29c3a, 2026-11-21)
- [Decision 0391](../../decisions/0391-operator-rulings-2026-11-20.md) merged (#851). It names the next track: the memory spine, the first blocker of the [2026-11-14 autonomy review](../autonomy/review-and-plan-2026-11-14.md) ("a fact learned in session one is used in session three"), with the agent-run test shard after it. Open sheet cards continue alongside. It approves the observation wording (property_broken becomes `Someone broke your <block>.`) and the explore, farm and patrol failure sentences, rules that agents are never told an id, and approves the item-2 live harness (test-only, throwaway shard). It activates nothing.
- AN-45a merged (#864): explore, farm and patrol registered with bounded arguments, inert (no body-api version lists them). AN-45b (body-api v11 and its pins) has no merge in `git log origin/main`; its status is unverified.
- Not done at 2aa29c3a: `contract/src/observation.ts` still has the old property_broken sentence and the "OWNER APPROVAL REQUIRED" comments that 0391 says to change; no memory-spine card exists under `docs/` (grep, 2026-11-21).
- The "Held (operator)" entry below for AN-45a and AN-45b is superseded by 0391 point 3. The sections below were last rewritten at `f03ab6e1` and are otherwise not re-checked.

## Held-live ruling (2026-11-15, unchanged)
Every sheet feature stays held on the live server until the whole campaign is complete; each is validated first by agent runs on a test shard. Inert code still merges. Everything merged so far is inert: no Colo apply, no plugin jar, no NATS conf change, and the `observations` Body option is absent in every production config (the plugin flag `provenance.enabled` defaults false). The test-shard plan (draft 2, about $20) is still not in the repo: commit it under `docs/analysis/sheet/` or rewrite it.
- Colo manual apply (plugin jar and the body NATS rule, per `docs/runbooks/nats-auth-inplace.md`): NOT to be applied until the sheet campaign is validated on a test shard and the operator says so. Why: merges to main auto-deploy only inert code; the Colo gets neither the new plugin jar nor the NATS conf by auto-deploy (`deploy/colo-cd-plan.sh` sets the NATS flag only for `nats/*` and `*nats*.conf`; a plugin change prints "manual plugin jar or plugin config changed (plugin/): not applied").

## Operator rulings (2026-11-18)
- 0320 kit-b is authoritative for HC-19 to HC-26c; in-repo copies retired; OD-C: HC-20 proficiency all zero, degraded, round one.
- 0321 combat XP keyed by encounter: the `kill:` row and AN-47b share one evidence key (built, #814).
- 0322 OD-NF-7: NeoForge included as inert code; twins blocked on P3-LIVE and P4.
- 0323 erasure covers every life-keyed table (S9-00a merged, #778; S9-00 checks both erase functions and is Ready); OD-12 confirmed (0282 as merged).
- 0324 the kit observation carries positions and ids: accepted in principle; agent-visible wording pending OD approval.
- 0325 tag `psyche-v1.1.0` approved on the #458 merge (`4cff991d`). The tag is now on origin, pointing at `194680f6` (the #764 merge); `psyche/` is identical between the two commits (checked 2026-11-20), so only the commit differs from what 0325 names.
- 0326 OD-1 no: mining stays free, no W9 refusal hook (S9-01 to S9-04 retired), does not amend 0164; OD-2 to OD-4 approved only if revisited.
- 0327 no births (OD-5; W10 inactive, OD-6, OD-7 moot), no drift (OD-8; W11 inactive), no persona refresh (OD-9).
- 0328 OD-10: existing agents adopt all-3 first; named sheets one ranger at a time with operator approval; behind held-live.

## Done (merged inactive; the ledger has the PR numbers)
- W0, W1, W2 (see the ledger), GX-08 (#526), nats-auth split (#534).
- W5 world half: AN-24 (#782), AN-25 (#797), AN-26a (#798), AN-26b (#825), AN-27a (#781), AN-27b (#829), AN-28a (#809), AN-28b (#830), AN-28c (#817, #818, #819 v2 redo).
- W6 to W8 world half: AN-44 (#788), AN-39 (#789), AN-40a (#783), AN-40 (#791), AN-41 (#790), AN-46 (#792) and AN-46b (#801), AN-47a (#799, #802, #804), AN-47b (#814), AN-47c (#831), AN-49 (#800), AN-51a (#810), AN-51b (#811), AN-50a (#820), AN-50b (#832).
- W9 and W12: S9-00a (#778), S12-03 (#780, #795), S12-04a (#786).
- Contract split: CS-0 (#805), CS-1 (#813), CS-2 (#806).
- Capture workstream: CAP-1 to CAP-5 done. PRs #821, #822, #824, #827; evidence #823 and #826. Real payloads for the AN-26a, AN-27a, AN-47a and AN-51a fixtures are in their worknotes (captured 2026-11-20 at `73788889`); AN-26b was built from the real toss capture. Procedure: [capture-real-payloads](../../runbooks/capture-real-payloads.md).
- Kit: HC-04 to HC-11, HC-17a, HC-17b, HC-18 on `scriptorium/hw0`.

## Next (order)
1. G13, the kit re-mirror to psyche 1.1.0 (card HC-48): unblocked, the tag `psyche-v1.1.0` is on origin. It runs in the kit repo with the scriptorium orchestrator's go.
2. The W5/W8 serial chain is COMPLETE on main: AN-27b #829, AN-28b #830, AN-47c #831, AN-50b #832 (all inert; `observations` stays absent in every production config). Its live items are pending operator approval and need a shard: real NATS role denial of raw `provenance.>` to the MCP, eventsink and mind roles, observer-to-player-event for every active row, the full `./geldar.ps1 check`, the integration floor and the 20 TPS bench. Do not run them before the operator approves. CI-1 (the Maven `Could not find` retry in `ci.yml`, branch `phase1/ci-1-maven-retry`) is in flight, off the sheet chain.
3. S9-00 (erasure coverage gate): Ready. S12-04b (apply) stays held by 0328 and the held-live ruling.
4. Wave K (kit, kit-b): re-verify HC-19 to HC-26c against hw0, then dispatch with the scriptorium orchestrator's go (not re-checked on 2026-11-20).
5. Recapture AN-09a chunk fixtures from AN-09b's builder (unchecked; check the AN-09a worknote). AN-47b's fixtures are hand-built per its worknote; whether they were refreshed from the #823 `combat_fact` captures is unverified.

## Held (operator)
- AN-45a and AN-45b: held for the operator's approval of the `INTENT_WHY` sentences and the body-api v11 program summaries (note #787). Not dispatched.
- D-CS-06 (activation of every provenance feature), OD-E (observation sentences), OD-11 (cohort, spend, success bars), OD-A, OD-B. (OD-C ruled by 0320; OD-D moot after GX-04a.)
- D-CS-04 (non-combat rows, crop list, torchflower and pitcher gap), D-CS-05 (incl. aggression-5 unarmed row), D-CS-14, D-CS-15.
- Decision 0390 (NeoForge hybrid named equals and nature humans, Accepted) questions (a) to (g): (a) refuse ordinary players whose name contains a marker word; (b) a marker-named account's chat to agents; (c) how marker-named operator accounts connect to Paper and who holds one; (d) the intervention-recording mechanism; (e) whether a name-keyed `PlayerActor` is needed for ordinary named humans; (f) agents may attack ordinary named humans; (g) no Paper switch. All seven were accepted at their proposed defaults on 2026-11-27 (decision 0289); banners updated.
- Colo manual apply of the plugin jar and the body NATS rule per `docs/runbooks/nats-auth-inplace.md`: NOT to be applied until the operator says so.
- Other wording: 0324 position and id text, HC-29 prose bank, AN-46 sentences, AN-28a observation wording. Per-life NATS ACL scoping.

## NeoForge (still open, operator)
- 0329 (Proposed) records NF-1 to NF-6 and is superseded by 0390 (Accepted 2026-11-27). Answered 2026-11-18: Q1 skip provenance on NeoForge for v1, v2 priority (AN-NF-26a, 27a, 28b Deferred to v2; v1 cost: `good` and `law` get no evidence, delta note 3b); Q7 humans hold no marks in this version, agents still earn (0385 item 8 stands; 0387 item 6 cites "items 3 and 4" but the rule is item 8; ruling note #808). Still open: Q2 actor names holding a marker word (AN-28a drop), Q3 and Q4 proximity chat for humans and the chat log line, Q5 telemetry and NF-6, Q6 observer disclosure on NeoForge; OD-NF-8 (progression vs proficiency); NF-BODY (sheet Bodies on `geldar-nf`, and their username shape; a non-agent-player filter plan is in [nf-body-filter-notes.md](nf-body-filter-notes.md), planning only).
- Hand-offs: [neoforge-chat-plan.md](neoforge-chat-plan.md) (NF-CHAT-0 to 3) goes to the NeoForge campaign; NF-CHAT-0 needs its own decision record. A5, A6 and A7 (named human actor) are on hold with 0329; do not fold them into AN-24 or AN-25 (both merged without them).

## Kit handoff (scriptorium-orchestrator, confirmed 2026-11-15)
Mine: HC-17a/b, HC-18 to HC-39 except his list (HC-26c, HC-23a/b after his HC-10/11). His: HC-05 to HC-16, HC-40, kit text and releases. Message him before editing `packages/supervisor/src`, `mind-loop`, `chatgpt`, `launcher/*`, `messages.d`, `seams.json`, `template-src/instructions.md`.

## Since 2026-11-27
- Operator rulings of 2026-11-27 are in decision 0289; 0390 is Accepted. Held-live stands.
- Docs PR #963 is merged.
- Local branches await the colo-images batch window: phase1/s9-00-erasure-gate, phase1/sheet-presenter-rows, phase1/sheet-item2-harness.
- AN-45b is to be re-carded as v13 from v12.
- Kit work is with the scriptorium orchestrator: rc23 contains HC-48, HC-46a, HC-27a, HC-28a, HC-33, HC-47; HC-19 is in progress.
- Cards GX-ROSTER and agents[].pos are unwritten.
