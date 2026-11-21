# 0391. Operator rulings of 2026-11-20: next track, observation wording, program wording, positions and ids

- Status: Accepted (operator ruling, 2026-11-20)
- Date: 2026-11-20
- Spec: OD-E (observation wording), D-CS-14 (program wording), the pending wording of 0324. Amends 0324, 0343, 0344 and 0345 only where each point below says so. `docs/spec.md` is not touched.
- Related: 0058 (character knowledge boundary), 0059 (agents are never told they are watched), 0281 (the sheet never in an agent context), the held-live ruling of 2026-11-15.

## Decision

1. **Next track (D0).** The Body side of W5 and W8 is closed (AN-27b, AN-28b, AN-47c and AN-50b merged as #829 to #832). The next track is the memory spine: the 2026-11-14 autonomy review's first blocker, with the exit test "a fact learned in session one is used in session three". The agent-run test shard follows memory. Sheet cards still open (AN-45a and AN-45b, the item-2 harness, the kit cards) continue alongside it.

2. **Observation wording (D3, OD-E).** The wording in `contract/src/observation.ts` is approved, with one change:
   - `You received <count> <item>.` (gift_received): approved.
   - `Someone broke one of your blocks (<block>).` becomes `Someone broke your <block>.` (property_broken).
   - `Someone fought <a|an> <mob> nearby.` (fight_seen): approved.
   - `Someone took <count> <item> from your container.` (container_taken): approved.
   - `Something happened.` (the generic sentence): approved.
   - The sentences stay actor-free, as 0343 says. Naming a visible actor in the agent's text is the intended next version, not this one. It needs its own record: a contract change, the visible-name rules, and a check against the marker-word scan.

3. **Program failure wording (D4, D-CS-14).** The `INTENT_WHY` sentences for explore, farm and patrol in `contract/src/outcome-words.ts` are approved as written:
   - explore: `You found no new direction to explore nearby.` / `You could not explore: the way was blocked.` / `You ran out of time exploring.`
   - farm: `You found no crop ready to harvest nearby.` / `You have no seeds to plant.` / `The way to the crops was blocked.` / `You ran out of time farming.`
   - patrol: `The way along the route was blocked.` / `You ran out of time on the patrol.`
   - This releases AN-45a and AN-45b (registration, drift test, body-api v11).

4. **Positions and ids (D5, the pending wording of 0324).** An agent may be told positions its own Body perceived. An agent is never told an id: no `ag_` life id, no player UUID, no entity id. Agents know each other by name, as they do today. Ids stay supervisor-side, inside the instinct step. The leakage scan's bar on `ag_` ids in agent text stands unchanged.

5. **Approved work.**
   - The item-2 live harness (AN-50b worknote, "Ops still to run"): a test-only card that sets `observations: true` on a throwaway Body through the existing option in `golem/src/adam/adam-body.ts` and checks observer-to-player events for break, gift, take and fight, plus producer-to-sink XP. It adds no shard config key and runs on a throwaway shard only.
   - The AN-50b worknote update recording the 2026-11-20 live session (items 1, 3, 4 and 5; item 2 not run; the bench against the 2026-11-09 baseline).

## Why

- The Body now gathers evidence that no Mind reads across sessions. Without memory, the effects the sheet is for (trust, reputation, promises) cannot show, so a behavioural test before memory would measure the wrong thing.
- The approved sentences are facts the Body perceived, with no coaching and no reference to the system, consistent with 0058 and 0059. "Someone broke your <block>." drops a parenthetical that read like a log line.
- Ids are system artefacts. An agent reading one would learn it lives in a system, which 0059 rules out. Positions are what a player perceives anyway.

## Consequences

- Nothing is activated. Approving wording does not select it. Publishing observations, selecting the sentences and turning on any producer stay under the held-live ruling and D-CS-06.
- One code change follows: the property_broken sentence in `contract/src/observation.ts`, with its tests. Remove the "OWNER APPROVAL REQUIRED" comments for fight_seen and container_taken in the same change.
- 0343 point (4), 0344's placeholder note and 0345 point (3) are settled for wording only. 0324's wording is settled by point 4 above.
- AN-50b finding 3 still stands: `container_taken` and `fight_seen` present no line to the agent today. Wiring their presenter rows is a separate card.
- The ledger moves AN-45a and AN-45b from Held to Ready.
