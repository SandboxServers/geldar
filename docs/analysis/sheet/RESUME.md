# Character sheet and psyche campaign (geldar-sheet) resume
Coordinator: geldar-sheet. Decisions: 0280-0282 used, next 0283-0289 then 0320-0329. SQL: 0050-0052 used, next 0053-0059 (0038-0049 registration, 0060-0069 geldar-3b). Updated 2026-11-15 ~16:00Z.
Plans: docs/analysis/character-sheet/ (AN-00..AN-61, waves W0-W12); cards: docs/analysis/harness/ (ledger.md, work-packets-geldar-a.md).

## Owner ruling (2026-11-15)
- ALL sheet-campaign features stay HELD on the live server until the whole campaign is complete. Each is validated first by agent runs on a test shard (Colo node, worldops' scratch stack, scratch- prefix, caps ~3 CPUs / 7 GB) with evidence of intended use. Inert code still merges. OD-10 adoption waits.
- Test-shard plan draft 2 ($1/life/run, 4 lives/run, 3 h/run, ~$20 total): agreed in principle with geldar-93. Owners: worldops (scratch stack); scriptorium-orchestrator (agent runs 8 and 10, planning only, not before rc22 is rolled and a clean day has passed). The draft exists only in the session scratchpad; geldar-sheet commits it under docs/analysis/sheet/.

## Done (merged on origin/main)
- Contract AN-02a (#372), AN-02b (#386); decisions 0280-0282; ACL #394; SQL 0050-0052 (#395, #403, #455). Psyche AN-03a/b (#401, #409), AN-03c temperament bank INACTIVE (#411), GX-02 tag psyche-v1.0.0 (#413), AN-08a (#458; psyche 1.1.0, tag NOT pushed).
- W1: AN-05 (#439), AN-05b (#467), AN-06a (#426, CI #433), AN-06b (#431), AN-07 (#453, inactive wiring), AN-S0 (#456).
- W2 code complete: AN-08b (#476), AN-09a (#473), AN-09b (#468), AN-10a (#472), AN-10b (#478), AN-11b (#471). AN-11a not merged: PR #480 open, in the queue.
- Since last resume: GX-06 #504 (instinct key and `source` tag, inert, key unset); AN-09c #509 (program on intent events; building XP row enabled in code, inert); step-0 test-shard driver #519 (bench paths only, scratch guard, leak check, snapshot+mine-once; roll trigger and RCON recipe UNVERIFIED); kit HC-18 merged as 4ab4493 on scriptorium/hw0 (instinct package; HC-18b split off).
- Cards merged: harness/work-packets-sheet-w3-w5.md (#457), -w6-w8.md (#463), -w9-w12.md (#464; supersedes older geldar-b W9 and geldar-c W10-W12 cards).

## Next (order)
1. Contract card: drop sheet and sheet_hash from the proficiency state reply. Contract slot third, after geldar-ops 'interrupted' PR and geldar-vitals MH-1, via geldar-3b. Regen serial.
2. AN-12: integration, default off; needs the NATS ACL step.
3. Recapture AN-09a chunk fixtures from AN-09b's real builder.
4. Split tools/repo-checks/src/nats-auth.test.ts (544 lines per brief).
5. W3-W5 kit cards HC-18.. (geldar-scriptorium): message scriptorium-orchestrator before touching shared files. Then W6+. Re-ask the owner for the W3-W12 coding order when W2 closes (its remaining ops evidence moves to the test shard).

## Open
- GX-08 (non-advancing wait `peek` for the instinct; card in harness/work-packets-geldar-a.md) must land before GELDAR_INSTINCT is enabled on any life.
- HC-19 (supervisor instinct step): sliced with scriptorium-orchestrator after hw0 CI and main merge. HC-L1 (key plumbing): after the rc22 roll. x-geldar-instinct-key not sent yet (world.ts has its own connector). psyche-v1.1.0 tag: not pushed (owner approval).

## Kit handoff (scriptorium-orchestrator, confirmed 2026-11-15)
- Mine: HC-17a/b, HC-18..HC-39 except his list (HC-26c: model never sees the sheet; HC-23a/b after his HC-10/11). HC-18 merged (above).
- His: HC-05..HC-16, HC-40, kit text/releases. Message him before editing packages/supervisor/src, mind-loop, chatgpt, launcher/*, messages.d, seams.json, template-src/instructions.md.

## Kept inert
- AN-11a service, AN-10b publisher, AN-11b cache, AN-12 stay inert until the batched NATS ACL step is complete (batch A live: worldops, reloaded 14:31:12Z) and the reply-shape change lands.

## Owner decisions open (parked; geldar-93 holds the list)
- Temperament delivery route and wording; D-CS-05 aggression-5 unarmed rolls:false row; D-CS-04 XP matrix rows, crop list '...', torchflower/pitcher gap.
- Moral hook amending 0164 (OD-1..4); births/lineage (OD-5..7); attribute drift (OD-8,9); adoption (OD-10); cohort, spend, success bars (OD-11).
- AN-28a exception to touch frozen animus/; per-life NATS ACL scoping.

## Follow-ups
- Generate migrate.test.ts migration list (ask geldar-3b; tools/migrate/src/migrate.test.ts); worktree cleanup under .claude/worktrees (keep node_modules junction targets intact); AN-11a open items in docs/analysis/harness/worknotes/AN-11a.md (not on main; check PR #480).
