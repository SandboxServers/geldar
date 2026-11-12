# 0144. Death is a distinct event with a recorded time and cause, and there is no revive

- Status: Proposed (owner confirmation pending)
- Date: 2026-11-11
- Spec: 5.9 (life and death); Principle 1; related 0065, 0138
- Packet: C5-03

## Decision (draft)

A death reaches the Mind as a `death` event with fixed text and a closed cause enum, not as "You took damage." The Record writes `agents.died_at` and `death_cause` once per life (the first write wins). Glass's rule that a dead life's thoughts become public (0138) reads `died_at`. A dead life is not revived by any tool, command or human action.

## Orchestrator's recommended default and why

Accept. `died_at` is never written today, so 0138's dead-life visibility cannot work; the distinct event is the minimum to fix that. No revive keeps Principle 1: a person cannot reach in and undo a death. Reverse the event by mapping it back to damage; the column stays.

## Consequences

One migration (columns if absent); the dead life's wake text changes; the new-life flow is C4's (Shrine), not this record's.