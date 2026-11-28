# GX-ROSTER worknote: operator-only roster export through `players-cli`

## What changed

- `players-cli roster export --out <path>` (commit `921d7b85`) writes every sovereign player as a flat `{"<name>": "<life_id>"}` JSON object, two-space indented, mode 0600, to a new file outside the repo.
- `tools/players-cli/src/roster-export.ts` builds the object through `findPlayer`, so the existing player-id and life-id rules apply. It refuses non-string names, duplicate names (a flat object would drop one silently) and nested values.
- The file is capped at 16384 bytes. A larger roster is refused before anything is written.
- The write goes to a temp file beside the target and is renamed into place. A failed write removes the temp file and leaves no target.
- `cli.ts` gets the dispatch, a usage line, and `runRosterExport`, which reuses `checkExportTarget` (path outside the repo, target does not exist yet).
- `roster.ts` is untouched. No shard config, `contract/`, `threshold/` or `golem/src/` file is changed.
- The verb is operator-only: no MCP tool, prompt or Body reads `roster.json`.

## Checks

- `pnpm exec vitest run tools/players-cli`: 190 passed (190) across 17 files.
- `pnpm --filter @geldar/players-cli typecheck`: clean.
- `pnpm exec biome check tools/players-cli/src`: clean.
- `git diff --check`: clean. `./geldar.ps1 pnpm check:repo`: exit 0.
- Live lane: not run; no Docker touched.

## Revert-checks

Each mutation changed one line of `roster-export.ts`, was restored from a scratchpad backup, and left `git diff` empty.

- Cap removed (`> MAX_ROSTER_BYTES` changed to `< 0`): "oversize roster is refused" fails, in both the unit and the CLI form.
- Write in place (the `moveFile(temp, target)` line replaced by a direct write to the target): "failed write leaves no file" fails.
- Model-facing probe (a temporary `golem/src/zz-roster-probe.ts` naming `roster.json`, then deleted): "no model-facing source names roster.json" fails.

## Deviations

- The card's branch was `phase1/sheet-gx-roster-export`. The branch is `phase1/gx-roster`, as the brief asked.
- The module and its tests were written together, so there was no red run before the implementation. The three revert-checks are the evidence that the tests catch regressions.
- A first test run failed on a wrong expectation in my own test (a `repo` directory that is never created). The expectation was corrected to an empty directory; the assertion still proves no file is written.

## Unverified

- The card's G4 and G7 gates are not defined in the work-packets sheet section searched, so they were not run.
- The card's exit criterion for this worknote was outstanding until this commit.
