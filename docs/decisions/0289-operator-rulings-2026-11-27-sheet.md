# 0289. Operator rulings of 2026-11-27 for the sheet campaign

- Status: Accepted (operator ruling, 2026-11-27, given in the sheet coordinator session)
- Date: 2026-11-27
- Spec: none edited. Section 2 Principles 1 and 4 are read only.
- Related: 0390, 0329, 0326, 0327, 0328, 0391

## Decision

The owner gave these rulings directly, in the geldar-sheet session, on 2026-11-27.

1. **0390 is accepted, all of Q-a to Q-g at their proposed defaults.** (a) Refuse ordinary NeoForge players whose name contains a marker word. (b) A marker-named account's chat to agents is suppressed entirely. (c) Marker-named operator accounts on Paper are held by the owner and the operator only, on a UUID allow-list through the existing spectator route; acting through one needs a separate Principle 1 ruling. (d) Each intervention is recorded as a labelled session window and acts in operator-only storage, plus an operator note. (e) Keep the name-keyed `PlayerActor` for ordinary named humans as 0329 ruled. (f) Agents may attack ordinary named humans. (g) No Paper switch. 0390 supersedes 0329.
2. **OD-A.** The sheet's temperament may reach an agent only as generated persona text (card HC-25), and the owner reviews and approves the template before anything is delivered. Nothing is delivered until then.
3. **OD-B.** A vetoed act gets a neutral fact sentence. The sentence is NOT approved yet: the coordinator drafts it and the owner approves it before it ships.
4. **OD-10 test shard.** Mixed sheets (some named, some all-3) on the TEST shard only; nothing on the live shard. 0328 is unchanged for live agents.
5. **Memory spine (0391 D0).** The first test-shard run is scripted, then real agents if it passes. The spend ceiling for the test shard is about 50 US dollars (OD-11 spend only; the numeric success bars are still open). The held-live ruling stands.
6. **Agent positions (`agents[].pos`).** Decision 0391 item 4 is sufficient approval. Ids are never told to agents.
7. **Name-to-life-id roster.** It is produced by an operator-run players-cli verb (card GX-ROSTER), operator-only.

## Why

These close the questions the sheet coordinator had parked for the owner, so the NeoForge twin cards can be re-carded and the test-shard run planned.

## Consequences

- 0390 is Accepted and supersedes 0329; banners on 0329, `neoforge-delta.md`, the sheet RESUME and the ledger are updated. The twins stay frozen until their cards are re-dispatched; nothing is activated.
- Cards GX-ROSTER and `agents[].pos` are not yet written.
- The OD-B sentence and the OD-A template need owner approval before they ship.
