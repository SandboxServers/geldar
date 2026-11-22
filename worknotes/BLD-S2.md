# BLD-S2 worknote

- Verbs `break` and `plan` join `PHASE0_VERBS`; `ACTION_FIELDS` has `break` (do, at) and `plan` (do, op, plan_id, palette, steps, origin, order, final, seq); `ACTION_OPTIONAL.plan` is origin, order, final, seq.
- `break.at` takes the `place` position check (border radius + 16, y -64..320).
- `plan`: every `{x, y, z}` in the action (origin and step coordinates, found by walking the action) takes the same border rule.
- `player-core/src/building/*`: typed stubs; every function throws `not_implemented`. BLD-04 fills them.
- Not done here (S3a owns it): golem limits, the building flag, animus table test.