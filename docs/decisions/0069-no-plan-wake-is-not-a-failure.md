# 0069. A no_plan wake with no intent is not a failed intent

- Status: Accepted (fix-perception; the contract change below is the only one)
- Date: 2026-11-10
- Spec: 5.3 (wake reasons), 5.15.3 (the mapping table for the player's events)
- Packet: fix-perception, item A; touches the closed vocabulary of decision 0033
- Worknote: docs/analysis/phase0/known-gaps.md (Corrections)

## Context

A restarted Body with nothing to resume raises `wake{reason: 'no_plan', intent_id: null}` after 45 s
when no plan arrives (golem/src/body/restart.ts). The player never submitted an intent. The mapper
turned the wake into `intent_finished` with outcome `failed`, and the player read "Your intent failed:
precondition_failed." in a live run. The agent then reasoned about a failure that never happened.

## Decision

1. A `wake` with reason `no_plan` and a null `intent_id` maps to a neutral player event of type `wake`
   with the fixed text "You wake with nothing underway.". It is not an intent end and it clears no run.
2. The player event type list (`McpPlayerEvent.type` in contract/schemas/mcp-common.schema.json) gains
   `wake`. No closed list already held a neutral entry: `day_night`, `proposal` and `reflex` all carry
   text that would be false here.
3. Unchanged: a `no_plan` wake that names an intent still ends that intent as failed; real intent ends
   (`completed`, `failed`, `limit_reached`, `cancelled`, `interrupted`) map as before.
4. The `wake` wake-reason vocabulary (`McpWakeReason`, which `wait` returns) does not change: the new
   event is not an interest, so `wait` does not return for it. An agent sees it only in the events of
   the next `wait`.

## Consequences

- `wait` results can carry `type: 'wake'`. Agents need no new reason code.
- The Mind side (animus) is unchanged: it already wakes the Mind with `no_plan` and wording
  "you had nothing you were pursuing".
- Sovereign intents still write no rows to the intents table (known-gaps Corrections).
