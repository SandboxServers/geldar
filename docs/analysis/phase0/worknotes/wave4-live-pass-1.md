# Wave 4 live pass 1 (orchestrator, merged `phase0/wave4` at d066bff, stack rebuilt from wave4)

`./geldar.ps1 check` green; plugin builds on a clean Gradle home; stack healthy. Live lane: 67 of 72 pass, 5 fail.

- L1 `reflex-basic.live.test.ts` hazard_escape and fall_stop: `TestControl.tp` throws `RangeError: x or z must be an integer ... got 1061.5`. Test bug: fractional coordinates passed to a server command (use `Math.floor` or integer block coordinates).
- L2 `restart.live.test.ts`: the restart returned `{ kind: 'idle', reason: 'no_checkpoint' }`. With `GELDAR_NATS_URL` unset the test uses an in-memory KV per Body, so the second Body gets a new empty one. Test bug: the two Bodies in the test must share one fake KV (or the test must use the real NATS KV and unique life ids).
- L3 `reflex-shelter.live.test.ts` panic burrow: `sink.reflexes[0].outcome.result` is `failed`, expected `handled`. The reason is not printed. Needs the outcome detail in the assertion message to diagnose (real finding or geometry).
- L4 `bench-scenarios-a.live.test.ts` wood-to-stone-tools: `step 6 (craft wooden_pickaxe) failed (missing_materials: missing oak_planks)`. Reproduces alone, at wave4 head AND at the wave 3 base commit (d402b33), so it is NOT a wave 4 regression: something in the environment changed since the 60/60 passes (world time 1007340 ticks, near dawn; stack recreated from the wave4 worktree). Actions: 1 mine, 4 crafts (3 ok, 1 missing_materials), 1 place. The failure note carries no inventory. Needs the inventory (and the mine drops) in the failure detail to diagnose.
