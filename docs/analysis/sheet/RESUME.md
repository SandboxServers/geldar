# Character sheet and psyche campaign (geldar-sheet) resume

Coordinator: geldar-sheet. Decision block 0280-0289. Updated 2026-11-14.
Plans: docs/analysis/character-sheet/ (62 candidates AN-00..AN-61, waves W0-W12); cards: docs/analysis/harness/ (ledger.md, work-packets-geldar-a.md).

## State (verified on origin/main 12a3ddce)
- Merged: GX-01a (migration 0037), AN-02a (sheet, roll, decision, adoption contract), GX-04a, GX-07.
- Next: AN-02b (contract, proficiency/chunk_visited/state subjects; card in work-packets-geldar-a.md). Contract chain is serial; ask geldar-3b for the slot.
- GX-06 needs a design agreement with geldar-registration and the kit.
- Kit cards HC-05..HC-16 live in the geldar-scriptorium repo; HC-08b unfinished.
- GX-05/HC-41 gated on decision 0171 (erasure); after the sheet cards.
- SQL: 0038 held by registration; next free to confirm (0039+).
- Sheet-visible content to agents needs owner approval (0058/0059/0068).

## Next
1. Handoffs from geldar-3b and scriptorium-orchestrator; agree the split.
2. Owner choice of first waves (asked).
3. Review AN-02b card, dispatch Haiku coder in worktree.

## Update (handoffs received)
- Owner chose first: foundations + Body/XP (W1-W2).
- Split with geldar-3b: he keeps GX-01b/c, GX-05/HC-41, migration rules, runs contract slots; I take AN-02b onward, AN-03..AN-12, GX-06, content waves.
- AN-02b: coded and reviewed by geldar-3b (branch phase1/an-02b-contract-proficiency); he opens and queues the PR, then it is mine. Do not regenerate contract/ before it merges; ask him for a slot.
- Numbers: SQL 0050-0059 mine (0038-0049 registration, 0060-0069 3b); check origin/main first. Decision 0280-0289 (3b suggests ADR for AN-02b: write mine as 0280).
- Open cards to write: ACL card (deny state.*.level and proficiency push to body/paper roles in Get-NatsUsers, plus nats-auth test); contract/src/index.ts near 500 lines, move AN-02b block to its own file.
- GX-06: not started; thoughts table is append-only and glass-readable, so a new table with its own erasure path.
