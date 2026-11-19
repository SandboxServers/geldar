# Character sheet and psyche campaign (geldar-sheet) resume
Coordinator: geldar-sheet. Updated 2026-11-18 at `origin/main` = `a8063b0a`. State and evidence: [assessment-2026-11-18.md](assessment-2026-11-18.md); NeoForge: [neoforge-delta.md](neoforge-delta.md); cards and order: [../harness/ledger.md](../harness/ledger.md), [sheet-next-wave-order.md](../harness/sheet-next-wave-order.md), [verification](../harness/sheet-cards-verification-2026-11-18.md).
Numbers. Decisions used: 0280-0282, 0320-0329. Free: 0283-0285 (released by 0326, 0327; never write 0283 as Accepted), 0289; 0286-0288 stay with S12-01, S12-04, S12-05. W3-W8 need up to six records (AN-24, AN-44, AN-46, HC-23a, HC-24, HC-25): ask the registry for a block. SQL used 0050-0052; 0053 free (proposed for the `turn_records` erase fix), 0054, 0055 released (0327), 0056, 0057 S12, 0058, 0059 spare.

## Held-live ruling (2026-11-15, unchanged)
Every sheet feature stays held on the live server until the whole campaign is complete; each is validated first by agent runs on a test shard. Inert code still merges. The test-shard plan (draft 2, about $20) is still not in the repo: commit it under `docs/analysis/sheet/` or rewrite it.

## Operator rulings (2026-11-18)
- 0320 kit-b is authoritative for HC-19 to HC-26c; in-repo copies retired; OD-C: HC-20 proficiency all zero, degraded, round one.
- 0321 combat XP keyed by encounter: the `kill:` row and AN-47b share one evidence key.
- 0322 OD-NF-7: NeoForge included as inert code; twins blocked on P3-LIVE and P4.
- 0323 erasure covers every life-keyed table (S9-00 checks both erase functions; `turn_records` gap); OD-12 confirmed (0282 as merged).
- 0324 the kit observation carries positions and ids: accepted in principle; agent-visible wording pending OD approval.
- 0325 tag `psyche-v1.1.0` approved on the #458 merge (`4cff991d`); push by a credentialed operator or ops. NOT pushed yet.
- 0326 OD-1 no: mining stays free, no W9 refusal hook (S9-01 to S9-04 retired), does not amend 0164; OD-2 to OD-4 approved only if revisited.
- 0327 no births (OD-5; W10 inactive, OD-6, OD-7 moot), no drift (OD-8; W11 inactive), no persona refresh (OD-9).
- 0328 OD-10: existing agents adopt all-3 first; named sheets one ranger at a time with operator approval; behind held-live.

## Done
W0, W1, W2 all merged inactive, including AN-11a (#480), AN-11c (#487, reply refuses `sheet` and `sheet_hash`; 0280 item 3 is stale on that point, see the ledger note), AN-12a (#493), AN-12b (#492), GX-08 (#526), nats-auth split (#534). Kit: HC-04 to HC-11, HC-17a, HC-17b, HC-18 on `scriptorium/hw0`. Full list in the ledger.

## Next (order)
1. Push tag `psyche-v1.1.0` (ops); then the kit re-mirror card (G13).
2. Card edits before dispatch: A1 to A4 on AN-27a, AN-26a, AN-47a, AN-51a; G1 to G13 fixes; AN-47b to 0321; S9-00 to 0323; kit-b HC-20 to OD-C; HC-22, HC-27b to 0324; splits AN-28b/c, AN-45a/b, AN-50a/b; scrub the user-profile path (G2).
3. Wave A (sheet-next-wave-order section 2): AN-24 (contract slot 1, ask geldar-3b), AN-27a, AN-39, AN-40, AN-41, S12-03, HC-27a, HC-28a, HC-29, HC-33.
4. Wave K (kit, kit-b): re-verify HC-19 to HC-26c against hw0, then dispatch with the scriptorium orchestrator's go.
5. Recapture AN-09a chunk fixtures from AN-09b's builder (unchecked; check the AN-09a worknote).

## Still open (operator)
- NeoForge: accept or edit **0329 (Proposed)**, which records rulings NF-1 to NF-6 (OD-NF-1 to OD-NF-6 ruled pending acceptance; players and agents equals on NeoForge, Paper unchanged). Its open questions: Q1 provenance needed on NeoForge or not (AN-NF-26a, 27a, 28b BlockedDecision; the 0383 widening not written), Q2 actor names holding a marker word (AN-28a drop), Q3 and Q4 proximity chat for humans and the chat log line, Q5 telemetry and NF-6, Q6 observer disclosure on NeoForge, Q7 progression for humans (0385 items 3, 4, 8; 0387 item 6 cites "items 3 and 4" but the rule is item 8). OD-NF-8 still open. NF-BODY (sheet Bodies on `geldar-nf`, and their username shape).
- NeoForge hand-offs: [neoforge-chat-plan.md](neoforge-chat-plan.md) (NF-CHAT-0 to 3) goes to the NeoForge campaign; NF-CHAT-0 needs its own decision record. A6 and A7 (named player actor) should be folded into AN-24 and AN-25 before dispatch, else AN-NF-25 after; A5 withdrawn. The AN-25 row in the ledger still says "A5 waits for OD-NF-2": orchestrator to update it.
- OD-11 (cohort, spend, success bars). OD-A, OD-B, OD-E sentences (OD-C ruled by 0320; OD-D moot after GX-04a).
- D-CS-04 (non-combat rows, crop list, torchflower and pitcher gap), D-CS-05 (incl. aggression-5 unarmed row), D-CS-06, D-CS-14, D-CS-15.
- Other wording: 0324 position and id text, HC-29 prose bank, AN-44/AN-45 summaries and `INTENT_WHY`, AN-46 sentences. Per-life NATS ACL scoping.

## Kit handoff (scriptorium-orchestrator, confirmed 2026-11-15)
Mine: HC-17a/b, HC-18 to HC-39 except his list (HC-26c, HC-23a/b after his HC-10/11). His: HC-05 to HC-16, HC-40, kit text and releases. Message him before editing `packages/supervisor/src`, `mind-loop`, `chatgpt`, `launcher/*`, `messages.d`, `seams.json`, `template-src/instructions.md`.
