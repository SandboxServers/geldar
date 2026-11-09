# P0-04 fix pass 1b: report

Status: done. Fix 2 (scoped errors) is applied through option 1 of the orchestrator ruling in `docs/analysis/phase0/worknotes/p0-04.md`: the generator exports one validator per union member of `$defs`, and `validateThinkerFrame` dispatches on `type`.

## Files changed (uncommitted until the commit below)

- `contract/scripts/generator.ts`: new generic rule. Every `$defs` entry of a titled schema whose `properties.type` has a `const` gets an exported validator named `validate<DefName>`, compiled from the fragment `<$id>#/$defs/<DefName>`. The export list is built once (`validatorExports`) and shared by `validators.js` and `validators.d.ts`. A duplicate export name throws. No thinker-specific code. The snapshot schema has no `$defs`, so its output is unchanged.
- `contract/src/generated/validators.js`, `contract/src/generated/validators.d.ts`: regenerated. The d.ts now declares `validateHelloFrame` through `validateDrainFrame` next to `validateThinkerFrame`.
- `contract/src/generated/types.ts`: unchanged by the regeneration (the named frame and union types are kept).
- `contract/src/index.ts`: `FRAME_VALIDATORS` maps each of the nine `type` values to its per-frame validator, in schema order. `validateThinkerFrame` returns the root validator's ok result when the root accepts. Otherwise it dispatches on `type`: a missing or unknown type returns the single error `/type must be one of hello, heartbeat, completion, error, goodbye, welcome, job, cancel, drain`. A known type returns that frame validator's errors, formatted like the others.
- `contract/test/thinker-frame.test.ts`: new test "reports hello errors first for a hello with a bad thinker_version" (the `hello` example is cast to a record before the spread, since the typecheck rejects spreading `unknown`). The scoped-error test "reports only the job frame errors for a job with a bad deadline" now passes.
- `contract/schemas/thinker-frame.schema.json`: unchanged in this pass. Its changes from fix 1 (`ModelName` and `ThinkerName` bounds, no pattern) were already in the worktree and are kept. Root `oneOf` unchanged.

## Checks

- `./geldar.ps1 pnpm --filter @geldar/contract generate`: wrote types.ts, validators.js, validators.d.ts.
- `check:generated`: `contract/src/generated is up to date.`
- `typecheck`: passes (after the test cast above).
- `./geldar.ps1 pnpm test` (vitest, root): `Tests 66 passed (66)`, including the P0-01 snapshot drift test (`findStale`).
- `./geldar.ps1 check`: `All checks passed.` (biome ci, typecheck, vitest 66/66, repo checks ok, generated code up to date).
- `cargo fmt`: not applicable to this packet.

## Mutation-proof notes (from fix 1, unchanged schema mutations)

In `thinker-frame.schema.json` I changed `hello.models` `maxItems` 16 to 17, `DrainFrame` `maximum` 86400 to 86401 and `ErrorFrame` `message` `maxLength` 200 to 201, regenerated, and ran the suite. Four tests failed: the scoped-error test, "rejects hello with 17 models", "rejects drain with 86401 seconds", "rejects error with a 201-character message". The schema was then restored and regenerated.

## Constraints beyond the packet (for the orchestrator to record)

- `job.max_tokens` maximum 32768 (the packet gives no cap for job; the hello offer range is 1–32768).
- `thinker_version` semver pattern (the packet says only "semver").
- `ThinkerName` is `minLength 1, maxLength 64` with no pattern (relaxed per fix 4 of pass 1).
- The generator's union-member export rule applies to any titled schema, so a future schema with a `$defs` frame gets a validator without generator changes.

## Deviations from the spec

- The packet's `check:generated` and `typecheck` steps were run per package. The `test` step was run at the root (`vitest run`), since the contract package has no `test` script.
- The generator change is the ruling's option 1, which the packet did not name. It is the only change outside `contract/src/`, `contract/test/` and `contract/schemas/`.
