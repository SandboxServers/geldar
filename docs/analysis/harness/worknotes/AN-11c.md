# AN-11c: the proficiency state reply carries no sheet

Owner rule: the sheet scores are operator-readable only. Settled by geldar-93: the NATS state reply
carries `life_id`, `version` and the seven `levels` (level and xp per domain). Nothing else.

## What changed

- `contract/schemas/proficiency-state.schema.json`: the `sheet` and `sheet_hash` properties are removed
  and the description says the reply carries no sheet or hash. `additionalProperties` stays `false`, the
  file's existing convention, so a reply that still carries `sheet` or `sheet_hash` is refused by the
  validator. `required` is unchanged (`life_id`, `version`, `levels`).
- `contract/src/generated/types.ts` and `validators.js`: regenerated with `node contract/scripts/generate.ts`
  (the generated diff is the removed fields only). `contract/src/index.ts` is unchanged: the export names
  did not change.
- `contract/test/proficiency.test.ts`: the test that accepted a sheet now asserts a reply with `sheet` or
  `sheet_hash` is refused; a new test pins the reply keys to `life_id`, `version`, `levels`.
- `eventsink/src/state/service.ts`: `replyFor` no longer copies a sheet or hash into the reply.
- `eventsink/src/state/pg-state-store.ts`: the store query selects `agent_id` only (existence of the life),
  not `character_sheet` or `sheet_hash`.
- `eventsink/src/state/service.test.ts`: the sheet reply test now asserts no sheet, even when the row holds
  one. The 'reply validates against the contract' test now uses a row with a sheet and asserts the reply
  validates (the old bad-hash refusal no longer exists). The `stored` helper takes extra columns as
  `Record<string, unknown>` so a row can carry a sheet the service must not reply.
- `eventsink/test/state.it.test.ts` (integration, not run here): asserts no `sheet` or `sheet_hash` in the
  reply, and that the hash string does not appear in the reply body. The row still stores the sheet.
- `golem/src/character/proficiency-cache.ts`: the baseline getter, the `#sheet` field, the sheet and hash
  parsing and `normalizeSheet` / `canonicalSheetJson` / `createHash` imports are removed. The cache keeps
  version and per-domain level and xp. `degraded`, push handling, the invalid-reply log and the version
  rule are unchanged.
- `golem/src/character/proficiency-cache.test.ts`: baseline assertions removed. A new test asserts a reply
  that carries a sheet is refused, the cache keeps no sheet and no baseline, and the cache stays degraded.
- `docs/analysis/harness/worknotes/AN-11a.md`: a 'Superseded' note points to this card.

## Callers

A grep of golem (outside the cache files) found no reader of `.baseline` or of a cache sheet, so no caller
needed a change. `audit-events.ts` and `adam-body.ts` hash the config sheet on their own path; they do not
read the cache.

## Merge main

`git merge origin/main` ran once before regeneration: "Already up to date". HEAD was already
`f11f2617` (origin/main), so no merge commit was made.

## Checks

- `node contract/scripts/generate.ts` wrote `src/generated/types.ts`, `validators.js`, `validators.d.ts`,
  `mcp-tools.ts`. `node contract/scripts/generate.ts --check`: "contract/src/generated is up to date."
  (exit 0).
- `node node_modules/vitest/vitest.mjs run --root . contract/test/proficiency.test.ts`: 18 passed.
- `node node_modules/vitest/vitest.mjs run --root . eventsink/src/state/service.test.ts
  golem/src/character/proficiency-cache.test.ts`: 81 passed (30 and 51).
- `tsc --noEmit -p .` for contract, eventsink and golem: exit 0 each (no emit).
- `biome check` on the seven changed TypeScript files: "Checked 7 files ... No fixes applied", exit 0.
- Open PRs (`gh pr list --state open`): #485, #470, #469, #274, #3. None touches `contract/`.

## Mutations (each one line, restored from a backup copy; `git diff --stat` empty after)

- Re-adding the sheet to the service reply (`service.ts` line before `validateProficiencyState(state)`):
  2 failed, 28 passed. Failing: "replies with the life own levels and version, never the sheet" and
  "reply validates against the contract, even when the row holds a sheet".
- The cache accepting a reply that carries a sheet (`proficiency-cache.ts`, `#parseState`, the sheet is
  stripped before validation): 1 failed, 50 passed. Failing: "a reply that carries a sheet is refused: the
  cache keeps no sheet and no baseline".
- The schema making `sheet` required (`required` gains `sheet`, plus a `sheet` property so that ajv's strict
  mode accepts it; two lines, see deviations): 3 failed, 15 passed. Failing: "accepts the zero, mid and max
  fixtures", "refuses a reply that carries the adopted sheet or its hash", "pins the reply to life_id,
  version and levels only".

The first attempt at the schema mutation changed only the `required` line. ajv (strict) refused the schema
with `strictRequired`, so the generator aborted and nothing was tested. The retry is the one above.

## Deviations

- The schema was edited before its test was written. The fail-first proof is the mutation above, not a
  separate run against the old schema. The old schema accepts a sheet, so the new refusal test fails on it.
- The schema mutation is two lines, because ajv strict mode rejects a `required` name with no property.
- `setup` (`./geldar.ps1 setup`) ran in the new worktree before the generator could resolve `ajv`.
- `contract/src/index.ts` is unchanged.

## Not verified

- The integration test `eventsink/test/state.it.test.ts` was edited but not run (needs Postgres; live lane
  pending).
- `./geldar.ps1 check` and `pnpm check:repo` are not run here; see the report for their results.
- Nothing in the live lane was run.
