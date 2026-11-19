# AN-47a schema test: the real combat_fact payload

`aRealShapedKillEmitsOneSchemaValidFactWithFiveKeys` (CombatFactListenerTest) validates the emitted
payload, which EventExporter.emit gives five keys (life_id, kind, mob, encounter_key, player), against
contract/schemas/combat-fact-event.schema.json. A package-private helper loads that schema the same way
EventSchemaCheck loads the envelope schema, resolving common.schema.json from geldar.schemas.
It also asserts the key set is exactly those five and that the life part of encounter_key (between
`enc:` and the last `:`) equals life_id and player.

## Revert-checks

Each mutation was one line (or one property) in the working tree, restored from a scratchpad backup
afterwards. `git diff --stat` was empty after every restore.

| Mutation | Result |
|---|---|
| (a) listener puts `"Zombie"` as `mob` (CombatFactListener.java) | new test fails: `/mob: does not match the regex pattern ^[a-z_]{1,64}$` |
| (b) schema copy without the `player` property | new test fails: `property 'player' is not defined in the schema and the schema does not allow additional properties` |
| (c) listener builds encounter_key with `ag_other_01` as the life | new test fails, but on the existing full-key assertion (`expected enc:ag_wren_02:... but was enc:ag_other_01:...`), which runs before the life-part assertion. The life-part assertion is not the first to fail for this mutant, because the full-key check already pins the life. |

The life-part assertion is therefore a second guard, not the one that catches mutant (c).
