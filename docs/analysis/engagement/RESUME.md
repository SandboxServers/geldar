# RESUME: engagement campaign

Source: owner-supplied review "Why the agents only eat" (v3, 2026-11-18). It is a private artifact and is not in the repo. Ledger: `README.md`. Packets: `work-packets.md`. Worknotes: `docs/analysis/engagement/worknotes/`.

## Current wave: U0 (unblock the gate)

- Decision 0389 is accepted (owner and the operator): `use { item }` with no target holds the item, and agents read "<item> in hand". It amends 0218's no-target clause. No new verb, no contract shape change, agents not told.
- U0-00: Done. At least 29 item-only sword `use` actions, 178 item+at and 11 item+entity, from at least one agent (spans do not name agents). This was a one-off read through `docker exec` as ClickHouse `default` at `readonly=1`, by owner ruling on 2026-11-18. It is not a standing route: D-EN-03 is.
- U0-01 (Body): In review on PR #756. The owner asked for changes on 2026-11-18. Fix pass 1: a packet-coder takes items 1, 7 and 8; the orchestrator takes the docs and the PR body.
- U0-02 (live check plus a 48-hour watch): waits for U0-01 to merge. Merging deploys: new images, a service restart, each Body in turn.

## Next action

After fix pass 1: merge `origin/main`, push, wait for `ci gate`, answer the review point by point, and ask the owner to review again.

## Open for the owner

- D-EN-03 to D-EN-06 in the ledger (routes, C0/C1 start, Principle 2, scope rulings).
- Whether the review's temporary Alpine image on the VM is removed (asked in the review, unanswered).

## Facts settled while scoping (2026-11-18)

- `held_item` is in the snapshot for the agent itself and for visible agents, and MCP passes both through (`threshold/mcp/src/play-view/self.ts`, `surroundings.ts`). Perception is not the gap.
- `attack` already equips the best weapon and leaves it in hand (`golem/src/actions/attack.ts`).
- A successful outcome's fact reaches the Mind only for verbs in `PLAIN_FACT_VERBS` (`contract/src/outcome-words.ts`). The first U0-01 packet missed this, and the review caught it.
- The review's "decision 71" (Haiku for cost) is scriptorium's numbering. Geldar's 0071 is about public endpoints and ports.
