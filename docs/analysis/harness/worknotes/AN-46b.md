# AN-46b worknote: combat_fact accepts the exporter's player field

## What changed

- `contract/schemas/combat-fact-event.schema.json`: an optional `player` property (`string`, 1 to 64 characters, the same shape as `death-event.schema.json`). It is not in `required`. The schema description says `player` is the exporter's uniform envelope-convention field (the agent name on Paper), a duplicate of `life_id`'s subject, and never agent-visible.
- Generated output in `contract/src/generated/types.ts` and `contract/src/generated/validators.js` (generator only).
- `contract/test/evidence-sources.test.ts`: four new tests. The plugin's real five-key payload validates; a four-key payload without `player` still validates; an empty or 65-character `player` is rejected; an unknown extra key is still rejected. The existing extra-key test is unchanged.
- `docs/decisions/0345-evidence-sources.md`: one amendment line (What (2a)). Status stays Proposed. `README.md` is unchanged, since its row text does not need it.

## Why

The Paper plugin's `EventExporter.emit` adds `player` to every event payload (`plugin/core/src/main/java/dev/geldar/core/EventExporter.java:47`). The schema had `additionalProperties: false` and no `player`, so `validateCombatFactPayload` rejected the plugin's real five-key `combat_fact` payload.

## Contract regen slot

This is a small follow-up to slot 3. No other open PR touches `contract/`.

## Revert-check

1. The new test was run before the regen: `accepts the plugin's real five-key payload` failed (and the 64-character player test failed too), as expected on the old generated code.
2. The fix and its tests were committed as WIP.
3. The schema was backed up to the scratchpad.
4. The `player` property line was removed from the schema, and the generator was run.
5. `test/evidence-sources.test.ts -t "accepts the plugin"` failed with `AssertionError: expected false to be true`.
6. The schema was restored from the backup; `check:generated` is clean and `git diff --stat` was empty.

## Follow-up

AN-47b fixture `combat_fact_kill` must carry `player` so it matches the wire.
