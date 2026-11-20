# CS-2 worknote: split the mcp-world drift tests

Plan: `docs/analysis/harness/contract-index-split-plan.md`, section CS-2. Base: origin/main 081cb6d1.

## What changed

- `contract/test/mcp-world-drift.test.ts` (new, 69 lines): the describe "mcp world tools: no drift from the
  Action schema" with its `cases` table and the `longText` helper. Imports `validateThought` and
  `validateToolInput` only.
- `contract/test/mcp-world-fixtures.ts` (new, about 265 lines): the row data read by the rows describe
  (`note`, `outcome`, `event`, `Row`, `INPUT_ROWS`, `RESULT_ROWS`, `ACT_RESULT_WITH_IDS`), moved unchanged
  from `mcp-world.test.ts`. Biome formatted one line in it.
- `contract/test/mcp-world.test.ts` (171 lines): keeps the coverage, rows and descriptions describes, the
  `AllMcpTypes` compile check and `SPEC_TOOLS`/`COVERED_ELSEWHERE`. Imports the three row exports from the
  fixtures file.

## Deviation from the plan

The plan allows a fixtures file only when two files need shared helpers. The drift block alone does not
bring `mcp-world.test.ts` under 400 lines: after moving it the file is about 450 lines. The row tables
(about 250 lines) are the only large block left, so they moved to `mcp-world-fixtures.ts`, which only
`mcp-world.test.ts` imports. The drift file does not use them. Both files are now under 400 lines.

## Test count (exit criterion)

| Run | Files | Tests |
|---|---|---|
| Before | `mcp-world.test.ts` | 39 passed |
| After | `mcp-world.test.ts` (33) + `mcp-world-drift.test.ts` (6) | 39 passed |

The names are unchanged. The six "no drift" names now appear under `mcp-world-drift.test.ts`, and the
other 33 under `mcp-world.test.ts`. No assertion was edited.

## Revert-check

Committed the split first, then in `mcp-world-drift.test.ts` changed the one assertion
`expect(asTool, JSON.stringify(args)).toBe(asAction);` to `.toBe(!asAction);`. `git diff --stat` showed one
line. The drift file then failed 6 of 6 tests with `expected true to be false`. The file was restored by
copying the backup from the scratchpad, `git diff --stat` came back empty, and the file's six tests pass.

## Checks

- Contract tests: `pnpm --filter @geldar/contract test` exit 0.
- Contract typecheck: `tsc -p . --noEmit` clean.
- Biome on the three touched files: clean after `biome check --write`.
- `pnpm check:repo`: exit 0 (its warnings are pre-existing line-count warnings, none for these files).
