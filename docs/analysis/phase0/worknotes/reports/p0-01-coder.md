# P0-01 coder report: contract package, generator and snapshot schema

Worktree: `C:\Users\Steve\source\projects\geldar\.claude\worktrees\p0-01` (branch `phase0/p0-01-contract`).
Continuation 2: the previous coder left the work uncommitted; this session reviewed it against the packet, ran the checks, and committed.

## Files changed (committed)

- `contract/package.json`, `contract/tsconfig.json`
- `contract/schemas/common.schema.json`, `contract/schemas/snapshot.schema.json`
- `contract/scripts/generator.ts`, `contract/scripts/generate.ts`
- `contract/src/index.ts` (P0-01 block filled; P0-02/03/04 marker blocks left empty)
- `contract/src/generated/types.ts`, `contract/src/generated/validators.js`, `contract/src/generated/validators.d.ts`
- `contract/test/snapshot.test.ts`
- `pnpm-lock.yaml` (new `contract` importer)

No other file changed. `docs/spec.md` and the packet file are untouched.

## Checks (final status)

- `./geldar.ps1 pnpm --filter @geldar/contract generate`: exit 0, wrote the three generated files.
- `./geldar.ps1 pnpm --filter @geldar/contract typecheck`: exit 0 (`tsc -p . --noEmit`).
- `./geldar.ps1 pnpm test`: exit 0, 3 files, 13 tests passed (the contract package has no `test` script; the root `vitest run` covers `contract/test`).
- `./geldar.ps1 pnpm --filter @geldar/contract check:generated`: exit 0, "up to date".
- `./geldar.ps1 check`: "All checks passed." (biome ci, typecheck, vitest, repo checks, generated check; no compose files exist yet).

## Mutation checks (dispatch rule 7 and packet check)

- Edited the description of `snapshot.schema.json` without regenerating: `check:generated` exit 1 (stale). Restored; check passes again.
- Changed `self.health` maximum 20 to 21, regenerated: test "rejects health above 20 and names the path" failed (1 failed, 12 passed). Restored and regenerated; 13 pass.
- The `findStale` drift test shares the same comparison as `check:generated`, so it fails under the first mutation too (not run separately).

## Review of the prior coder's work against the packet

- Snapshot required list includes `revision` (integer, min 0). Bounds: health 0-20 (number), hunger 0-20 and armor 0-20 (integers), `budget_remaining_thoughts` integer min 0, `time_of_day` and `weather` enums, `heard` maxItems 50, `heard[].text` maxLength 256, `events_since_last_thought` maxItems 100 with `type` pattern `^[a-z][a-z_]{0,47}$` and `additionalProperties: true` (with a description, as the packet allows).
- `index.ts`: four marked blocks present; P0-01 block holds `validateSnapshot` and `ValidationResult`; `formatError` appends the property name from `additionalProperty`/`missingProperty` when Ajv's message omits it.
- Deps: `json-schema-to-typescript@16.0.0` (dev), `ajv@8.20.0` and `ajv-formats@3.0.1` (runtime), all exact (no caret), lockfile has all three.
- Generator: sorted schema load, `addSchema` before compile, `cwd` set to the schemas folder, no network refs (`$ref`s resolve locally), LF output, no timestamps.

## Deviations and justifications (prior coder's choices, reviewed)

1. **`createRequire` line prepended to `validators.js`.** Ajv standalone output in ESM mode calls `require("ajv/dist/runtime/ucs2length")` (needed by `minLength`/`maxLength`). Without a `require` binding the ESM module throws at load. The prelude is generated from `esmRequirePrelude` in `generator.ts`. Justified; the generated file is verified to load through the tests.
2. **`.default` on CJS modules** (`ajv/dist/2020.js`, `ajv/dist/standalone/index.js`, `ajv-formats`). These are CommonJS with `exports.default`; a default import under Node ESM yields `module.exports`, so `.default` is the constructor/function. Justified.
3. **Types emitted only for titled roots and common `$defs`.** The packet asks for one exported type per schema. `common.schema.json` has no title, so its `$defs` are emitted (only names that are defined there, de-duplicated). Justified by the packet's "shared definitions" rule; unreferenced definitions are not emitted.
4. **`book_id` is a plain 1-64 string.** The spec example shows `bk_3a...`, but section 7 defines no `BookId` prefix, so no prefixed pattern is invented. Guess: the prefixed form may be added later with a `BookId` identifier.
5. **`stuck` is `null` or `{action, repeat_count}`.** Appendix A shows `"stuck": null` only. The shape comes from the spec sentence "the watchdog injects a stuck event with the repeat count". Guess; field names are not specified elsewhere.
6. **`effects` is an array of lowercase strings matching `^[a-z_]{1,64}$`.** Appendix A shows `[]` only. Guess, aligned with other lowercase identifiers in the schema.
7. **Numeric types.** Appendix A shows `health: 14` (Minecraft health is half-hearts, so `number` is kept; the packet only says 0-20). `hunger: 9` and `armor: 2` are integers. Spec gives no fractional form for them, so integer is the choice.

## Not verified

- The packet's "Watch for" item (`import { validateSnapshot } from '@geldar/contract'` from another workspace package): no other package exists yet in this worktree, so this was not exercised.
- The lane rule in the brief (`tools/build-lane/lane.ps1 cargo ...`) does not apply: this repo has no `tools/build-lane`, no Cargo; the runner is `./geldar.ps1`, used throughout.

## Attribution

The commit ends with `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>` and the session line. The brief named Sonnet 5.5; the system attribution instruction for this session names Haiku 5.5, which is the model actually running, so that line was used instead.
