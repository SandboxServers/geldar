# 0191: Cancel everything from the previous life on death; position and oxygen log lines (part 1)

Status: Accepted
Date: 2026-11-14

## Context

Billy died three times in 118 seconds on 2026-11-14 (07:05 to 07:07 UTC). After each respawn his walk toward the old target kept running: a travel intent accepted two seconds after the first death ran its 800 ticks back to the skeleton area, and a goto planned from the pre-death snapshot walked the new body 133 blocks back. Nothing in the Body ended the intent or cancelled the action on death. Lives share the agent id, so the life check (`wrong_life`) never refuses a plan made before a death.

The reflex rows carry no position, so a `reflex_fired` row cannot say where the Body was. The lake box also logged 292 `hazard_escape` firings at air 8 on a sandbar that nothing explains from the rows alone.

## Decision

Part 1 covers three changes:

1. **Cancel on death.** The bot's `death` event (not the respawn) calls `cancelForDeath`, which ends the running intent through the executor's end path, aborts the running action, and sets a revision floor at the snapshot revision read at the death. A plan at or below that floor is refused as `stale_snapshot` with the fact-only detail "plan revision N was made before the Body died at revision M". A plan from a snapshot taken after the death is accepted. The mind link checks the floor at the plan gate, so the Mind gets the refusal in the ack (`accepted: false`, `stale_snapshot`) and rethinks from a fresh snapshot; the executor checks it again before each action.
2. **Position in the Body's log lines.** Each `reflex_fired` firing and each hurt writes one JSON log line to the Body's log (`event: 'reflex_fired'` or `'hurt'`). The line carries the feet position at full precision, rounded to one decimal (x, y, z), and the dimension. A position or dimension that is not known is null. The `reflex_fired` event schema and the hurt schema (decision 0143: "carries no coordinates") forbid the fields in the event payload, so the events are unchanged and the contract is not changed here.
3. **Oxygen trace.** `hazard_escape` writes two lines per run: one with `phase: 'start'` and `air_before`, and one with `phase: 'end'`, `result`, `air_before`, `air_after`, `in_water` and `head_liquid` (the cell above the feet holds water or lava), plus the position. There is no periodic line.

Parts 2 and later (cover and line-of-sight flee, shield, retreat target) are separate decisions.

Implementation status: all three changes are in this branch. To keep `executor.ts` under its 500-line soft cap, the checkpoint helpers moved to `executor-checkpoint.ts` and the batch failure text to `executor-batch.ts`; behaviour is unchanged.

## Consequences

- A respawned Body starts with no intent and no action from its previous life. The Mind must plan again from a new snapshot.
- The Body's log lines (`reflex_fired`, `hurt`, `hazard_escape`) are JSON on stdout, read with `docker logs`. They answer "where" until the contract carries it.
- Contract option, for geldar-93: if the Mind should see position, `reflex-fired-event.schema.json` and the hurt schema need optional coordinate fields, and decision 0143 would need to change for hurt. This decision does not make that change.
- The `IntentExecutor` gains `endForDeath`; the executor is near its size cap, so the death logic lives in `death-cancel.ts`.
- The hurt line is written through the reflex diagnostic sink (`DEFAULT_DIAG_SINK`, stdout) as its own JSON line, so `docker logs` shows `event: 'hurt'` at the top level, as it does for `reflex_fired` and `hazard_escape`.
- Known limits, not changed here: a reflex running at the death is not cancelled (only the intent and the action are); the `death` and `respawn` listeners are never removed when the Body stops; the death floor is lost when the Body restarts (a new executor starts with none); a hurt line is written per health loss (no throttle), so burning or drowning gives about one line a second.
