# Character sheet and psyche campaign (geldar-sheet) resume

Coordinator: geldar-sheet. Decisions 0280-0289, SQL 0050-0059 (0038-0049 registration, 0060-0069 geldar-3b). Updated 2026-11-15.
Plans: docs/analysis/character-sheet/ (62 candidates AN-00..AN-61, waves W0-W12); cards: docs/analysis/harness/ (ledger.md, work-packets-geldar-a.md).

## Done (merged on origin/main)
- Contract: AN-02a, AN-02b (#386), decisions 0280, 0281 (#399).
- ACL: deny state.*.level to body/paper, eventsink gets state.> (#394). geldar-93 applies the live NATS conf by hand.
- SQL: 0050 sheet/xp/proficiency (#395), 0051 audit tables + sheet_erase_life (#403). Worknotes AN-04a/b hold the export/retention table.
- Engine: psyche/ AN-03a (#401), AN-03b roll/params/proficiency (#409), AN-03c temperament bank, INACTIVE (#411).
- Release: GX-02 (#413); tag psyche-v1.0.0 -> 549e7d07, tree_hash b89848ab... Pushed with owner approval.

## Next (order)
1. AN-05 Body/roster loaders, AN-06a sink audit projection, AN-06b Body audit producer, AN-07 wiring (inactive), then AN-08..AN-12 (W2).
2. GX-06 instinct-key header + sheet record storage (agree with geldar-registration and geldar-3b; key server-side, never visible to the model; no SQL for the header option).
3. Kit cards in geldar-scriptorium: HC-17a (mirror psyche/src byte for byte; now unblocked), HC-17b, HC-18..HC-39 except orchestrator's list. HC-18 needs GX-06.

## Follow-ups
- sql/README.md index lines from AN-04a/b worknotes; ledger row for AN-03c (orchestrator); ask geldar-3b for a card to generate the migrate.test.ts list.
- Move AN-02b block out of contract/src/index.ts (~535 lines). Contract regen is serial: ask geldar-3b for the slot.
- Clean up worktrees in .claude/worktrees (keep node_modules junctions intact).

## Owner decisions open
- Temperament delivery route and wording (any agent-visible content needs approval, 0058/0059/0068).
- Ordering of packets beyond W2; 0171 question on events of retired lives; brief 5.9 morality hooks, drift, lineage.

## Kit handoff (scriptorium-orchestrator, confirmed 2026-11-15)
- Mine: HC-17a/b, HC-18..HC-39 except his list (HC-26c: model never sees the sheet; HC-23a/b in mind-loop after his HC-10/11). His: HC-05..HC-16, HC-40, kit text/releases.
- Message him before editing: packages/supervisor/src, mind-loop, chatgpt, launcher/*, messages.d, seams.json, template-src/instructions.md.
- Branches scriptorium/hc-NN-<slug>, worktrees hc-NN, wave branch scriptorium/hw0.
