# Character sheet and psyche campaign (geldar-sheet) resume

Coordinator: geldar-sheet. Decisions: 0280-0282 used, next 0283-0289 then 0320-0329. SQL: 0050-0052 used, next 0053-0059 (0038-0049 registration, 0060-0069 geldar-3b). Updated 2026-11-15.
Plans: docs/analysis/character-sheet/ (62 candidates AN-00..AN-61, waves W0-W12); cards: docs/analysis/harness/ (ledger.md, work-packets-geldar-a.md).

## Done (merged on origin/main)
- Contract AN-02a (#372), AN-02b (#386). Decisions 0280, 0281 (#399), 0282 (in #455).
- ACL #394: state.*.level denied to body/paper, eventsink gets state.>. geldar-93 applies the live NATS conf by hand.
- SQL 0050 (#395), 0051 audit tables and sheet_erase_life (#403), 0052 comments only (#455).
- Psyche AN-03a (#401), AN-03b (#409), AN-03c temperament bank INACTIVE (#411). GX-02 tag psyche-v1.0.0 (#413, pushed with owner approval).
- AN-08a (#458): psyche 1.1.0 merged. Tag psyche-v1.1.0 NOT created or pushed; awaits owner.
- W1: AN-05 loaders (#439), AN-05b (#467), AN-06a (#426, CI lane #433), AN-06b (#431), AN-07 (#453, inactive wiring), AN-S0 scaffold (#456).
- W2: AN-08b (#476), AN-09a (#473), AN-09b (#468), AN-10a (#472), AN-10b (#478), AN-11b (#471).
- AN-11a: not merged; PR #480 open (proficiency state service in the sink), in the queue.
- Cards merged: harness/work-packets-sheet-w3-w5.md (#457), -w6-w8.md (#463), -w9-w12.md (#464). W9-W12 supersedes older geldar-b W9 and geldar-c W10-W12 cards; those are marked superseded (3 in geldar-b, 18 in geldar-c, #464).

## Next (order)
1. Contract card: drop sheet and sheet_hash from the proficiency state reply. Contract slot third, after geldar-ops 'interrupted' PR and geldar-vitals MH-1, via geldar-3b. Regen serial.
2. AN-12: integration, default off; needs the NATS ACL step.
3. AN-09c: carry program on the completed intent event; serial contract slot. Building XP row stays off until then.
4. Recapture AN-09a chunk fixtures from AN-09b's real builder.
5. Split tools/repo-checks/src/nats-auth.test.ts (544 lines per brief).
6. W3-W5 kit cards HC-18.. (geldar-scriptorium). Message scriptorium-orchestrator before touching shared files. Then W6+.

## Kit handoff (scriptorium-orchestrator, confirmed 2026-11-15)
- Mine: HC-17a/b, HC-18..HC-39 except his list (HC-26c: model never sees the sheet; HC-23a/b after his HC-10/11). HC-18 needs GX-06 (card only so far).
- His: HC-05..HC-16, HC-40, kit text/releases. Message him before editing packages/supervisor/src, mind-loop, chatgpt, launcher/*, messages.d, seams.json, template-src/instructions.md.

## Kept inert
Until the batched NATS ACL step (#394 lines plus _INBOX publish scoped for the sink, applied by geldar-93 with the owner's word) AND the reply-shape change: AN-11a service, AN-10b publisher, AN-11b cache, AN-12.

## Owner decisions open (morning list; geldar-93 holds it)
- Temperament delivery route and wording; D-CS-05 aggression-5 unarmed rolls:false row; psyche-v1.1.0 tag approval.
- D-CS-04 XP matrix rows, crop list '...', torchflower/pitcher harvest gap.
- Moral hook amending 0164 (OD-1..4); births/lineage (OD-5..7); attribute drift (OD-8,9).
- Which sheet each existing agent adopts, recommend all-3 first (OD-10); cohort sizes, spend, success bars (OD-11).
- AN-28a needs an exception to touch frozen animus/. Per-life NATS ACL scoping is later hardening.

## Follow-ups
- Generate migrate.test.ts migration list (ask geldar-3b; file tools/migrate/src/migrate.test.ts); worktree cleanup under .claude/worktrees (keep node_modules junction targets intact); AN-11a open items in docs/analysis/harness/worknotes/AN-11a.md (not on main; check PR #480).
