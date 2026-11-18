# Engagement campaign: why the agents only eat

Ledger for the remediation campaigns from the owner-supplied review "Why the agents only eat, and what would let them play the whole game" (third version, 2026-11-18). The review is a private artifact and is not copied into this public repo; this ledger keeps only what the packets need.

**Purpose.** The agents on the autonomous Paper shard survive, but they rarely build, explore or use most mechanics. The largest cause the review found: all 19 agent-written goals files gate walking on four armed companions, and no action puts a weapon in hand. The review's order is: fix what agents can do, then measure, then tool honesty, and only then any framing change.

**Exit criteria.** U0 shipped and deployed, and agents seen holding weapons on the live shard. C0-C6 each either have a ledger and packets or are ruled out by the owner.

## Decisions

| Id | Question | Status | Record |
|---|---|---|---|
| D-EN-01 | How agents put an item in hand: extend `use` or add a `hold` verb | Accepted: extend `use` (owner, 2026-11-18) | [0389](../../decisions/0389-use-with-an-item-and-no-target-holds-it.md) |
| D-EN-02 | Read MCP act spans to see what `use` shapes agents sent for swords | Approved, then skipped: no colo access (owner, 2026-11-18) | this ledger |
| D-EN-03 | Read-only route to the events table and full chat (blocks C0) | Open | - |
| D-EN-04 | Start C0 and C1 (no rule changes) | Open | - |
| D-EN-05 | Principle 2: pilot (C2), broad amendment, or leave as is | Open | - |
| D-EN-06 | Free-form building, griefing and PvP, reset policy, pilot models and cost | Open | - |

## Packets

| Packet | Campaign | Status | Branch | Notes |
|---|---|---|---|---|
| U0-00 | U0 | Skipped (owner, 2026-11-18: no colo access; the ssh alias does not resolve here, and the reader password is root-only) | none | U0-02's 48-hour watch covers the same question after deploy |
| U0-01 | U0 | Ready | `engagement/u0-use-hold` | Body: `use {item}` holds it; ok fact reaches the Mind (0389) |
| U0-02 | U0 | BlockedDependency (U0-01 merged and deployed) | none (orchestrator) | Live check: an agent holds a sword; watch the Billy gate |
| C0-C6 | C0-C6 | BlockedDecision (D-EN-03 to D-EN-06) | - | Not sliced yet |
