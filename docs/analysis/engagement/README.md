# Engagement campaign: why the agents only eat

Ledger for the remediation campaigns from the owner-supplied review "Why the agents only eat, and what would let them play the whole game" (third version, 2026-11-18). The review is a private artifact and is not copied into this public repo; this ledger keeps only what the packets need.

**Purpose.** The agents on the autonomous Paper shard survive, but they rarely build, explore or use most mechanics. The largest cause the review found: all 19 agent-written goals files gate walking on four armed companions, and no action puts a weapon in hand. The review's order is: fix what agents can do, then measure, then tool honesty, and only then any framing change.

**Exit criteria.** U0 is shipped, deployed and measured (U0-02). What agents then do is data, not a target (Principles 2 and 5). C0-C6 each either have a ledger and packets or are ruled out by the owner.

## Decisions

| Id | Question | Status | Record |
|---|---|---|---|
| D-EN-01 | How agents put an item in hand: extend `use` or add a `hold` verb | Accepted: extend `use`, and agents read the "<item> in hand" fact (owner, 2026-11-18) | [0389](../../decisions/0389-use-with-an-item-and-no-target-holds-it.md) |
| D-EN-02 | Read MCP act spans to see what `use` shapes agents sent for swords | Done. A one-off read through `docker exec` as ClickHouse `default` at `readonly=1`, plus counts over `journal` and `say` arguments (owner, 2026-11-18). Not a standing route: D-EN-03 is. | [U0-00](worknotes/U0-00.md) |
| D-EN-03 | Standing read-only routes for C0: (a) the events table and full chat; (b) a telemetry reader credential the node's ssh user may use, meaning the ClickHouse `geldar_reader` password, which today is a root-only file on the node, made available to that user or put in the vault | Open | - |
| D-EN-04 | Start C0 and C1 (no rule changes) | Open | - |
| D-EN-05 | Principle 2: pilot (C2), broad amendment, or leave as is | Open | - |
| D-EN-06 | Free-form building, griefing and PvP, reset policy, pilot models and cost | Open | - |

## Packets

| Packet | Campaign | Status | Branch | Notes |
|---|---|---|---|---|
| U0-00 | U0 | Done | none | At least 29 item-only `use` actions with swords in about 42 hours: at least one agent already sends the shape 0389 makes work. See the [worknote](worknotes/U0-00.md). |
| U0-01 | U0 | In review: PR #756 (fix pass 1 for the owner's review) | `engagement/u0-use-hold` | Body: `use {item}` holds it; the fact reaches the Mind (0389). Merging deploys (see work-packets U0-01). |
| U0-02 | U0 | BlockedDependency (U0-01 merged and deployed) | none (orchestrator) | Live check, then measure the hand over time and the Billy gate as data |
| C0-C6 | C0-C6 | BlockedDecision (D-EN-03 to D-EN-06) | - | Not sliced yet |
