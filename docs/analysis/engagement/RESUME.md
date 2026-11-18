# RESUME: engagement campaign

Source: owner-supplied review "Why the agents only eat" (v3, 2026-11-18). It is a private artifact and is not in the repo. Ledger: `README.md`. Packets: `work-packets.md`.

## Current wave: U0 (unblock the gate)

- Decision 0389 is accepted: `use { item }` with no target holds the item. No new verb, no contract shape change, agents not told.
- U0-00 (span read, orchestrator or ops): Ready. Read-only MCP act spans only (D-EN-02).
- U0-01 (Body): Ready. Branch `engagement/u0-use-hold`, worktree `D:\Source\geldar-wt\u0-use-hold`. Not dispatched.
- U0-02 (live check plus a 48-hour watch): waits for U0-01 to merge and deploy.

## Next action

Dispatch U0-01 to a packet-coder and U0-00 to ops, in parallel, once the owner says go.

## Open for the owner

- D-EN-03 to D-EN-06 in the ledger (DB route, C0/C1 start, Principle 2, scope rulings).
- Whether the review's temporary Alpine image on the VM is removed (asked in the review, unanswered).

## Facts settled while scoping (2026-11-18)

- `held_item` is in the snapshot for the agent itself and for visible agents, and MCP passes both through (`threshold/mcp/src/play-view/self.ts`, `surroundings.ts`). Perception is not the gap.
- `attack` already equips the best weapon and leaves it in hand (`golem/src/actions/attack.ts`).
- The review's "decision 71" (Haiku for cost) is scriptorium's numbering. Geldar's 0071 is about public endpoints and ports.
