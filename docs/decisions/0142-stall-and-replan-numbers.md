# 0142. A stalled move replans after about 60 ticks, up to 6 times, and follows partial paths

- Status: Proposed (owner confirmation pending)
- Date: 2026-11-11
- Spec: section 5.2 (reflexes: path blocked); amends the stall numbers behind decision 0063 (single move settles `blocked` after 600 world ticks under 0.75 blocks)
- Packet: C5-01

## Decision (draft)

When a move covers less than 0.03 blocks over about 60 world ticks, drop the path and replan. At most 6 replans per move; the 7th stall settles `blocked`. A search that finds no full path follows the partial path to the closest node. Every search has a node budget so planning never blocks the tick. The unstick reflex keeps its own backoff and preconditions.

## Orchestrator's recommended default and why

Accept the numbers as starting values, tune with the bench. 600 ticks (30 s) of jitter before the Mind hears anything is the cost the goldar repo review measured against its roughly 2.5 s stall rule; 60 ticks (3 s at 20 tps) with 6 replans bounds the total near 20 s, below the old stall and below the 30-second blocked-path rule. Reverse by setting the constants back; the settle rule is unchanged.

## Consequences

Faster recovery from small obstructions; more path searches per move (bounded by the budget). 0063's trigger to reopen still applies.