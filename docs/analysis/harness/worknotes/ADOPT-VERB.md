# ADOPT-VERB worknote (S12-04b operator verbs)

- Base sha (first pass, HEAD at session start): `96a7b32ad` on `sheet/adopt-verb`.
- Commit: `feat(colo): operator verbs for the sheet adoption plan and apply (ADOPT-VERB)`.
- Scope: the operator verbs only. The plan verb works. The apply verb reaches the CLI, which still refuses `--apply`
  (`tools/mcp-tokens/src/cli.ts`, `runAdoptSheets`, prints `adopt-sheets: --apply is S12-04b`). The CLI is not in this
  packet, so nothing is written by apply yet.

## Design

- `deploy/colo-admin.sh adopt-sheets-plan` takes no arguments. `adopt-sheets-apply --operator-confirm --plan <12 hex>`
  takes exactly those three arguments in that order. Both pass the arguments to the admin one-shot
  (`run --rm --no-deps admin adopt-sheets plan|apply ...`), as the other verbs do. `DEPLOY_DRY_RUN=1` prints the command.
- `tools/admin/admin.sh adopt-sheets` checks its arguments before the password file is read. Then it:
  1. builds the sheets map from the shard file with `readShardLives` (`tools/mcp-tokens/src/convert-sheets.ts`): every
     life gets `standard`. The snippet runs `node --input-type=module -e` and imports the `.ts` file through
     `pathToFileURL`, so it works for Windows and POSIX paths. Node 22.23.2 (the admin image's Node, see
     `tools/admin/Dockerfile`) runs `.ts` without a flag, as the other admin subcommands already do.
  2. runs `player adopt-sheets --shard --sheets` (the dry run) and hashes its output: the verdict lines, sorted with
     `LC_ALL=C`, each with its newline, through sha256; the first 12 hex digits are the plan hash.
  3. `plan` prints the lines and `plan: <hash>`. `apply` compares the hash with the one the operator gave; a difference
     prints `plan changed (expected X, now Y)` and exits 1 before any apply runs.
- The sheets file lives in a `mktemp -d` directory with mode 077; an EXIT trap removes it. No sheet value is printed.

## Revert table

Each row is one mutation of one line, applied to the committed state, run against `deploy/test/colo-admin-adopt.test.ts`.
The failing tests are the names in the file's `describe`/`it` text.

| # | File | Line mutated | Expected failure | Observed |
|---|------|--------------|------------------|----------|
| 1 | deploy/colo-admin.sh | `adopt-sheets-plan) [ $# -eq 0 ]` to `[ $# -ge 0 ]` | plan accepts an argument | FAIL: "refuses an argument to plan before any container starts"; "refuses --operator-confirm to plan before any container starts" (2 failed) |
| 2 | deploy/colo-admin.sh | `[ $# -eq 3 ]` to `[ $# -ge 3 ]` in apply | apply accepts an extra argument | FAIL: "refuses an extra argument to apply before any container starts" (1 failed) |
| 3 | tools/admin/admin.sh | `[ "$2" = --operator-confirm ]` to `[ "$2" = "$2" ]` | apply without --operator-confirm runs the CLI | FAIL: "refuses adopt-sheets with no --operator-confirm before the CLI runs" (1 failed) |
| 4 | tools/admin/admin.sh | `if [ "$hash" != "$want" ]` to `if [ 0 -eq 1 ]` | a changed plan still applies | FAIL: "apply with a different hash refuses, says both hashes, and runs no apply" (1 failed) |
| 5 | tools/admin/admin.sh | `LC_ALL=C sort "$plan"` to `cat "$plan"` | plan hash differs from the sorted hash | FAIL: "plan prints the verdict lines in the CLI order and the sorted plan hash, and runs no apply"; "apply with the hash the operator read runs the apply once, with --operator-confirm"; "apply with a different hash refuses, says both hashes, and runs no apply" (3 failed) |

## Merge note: colo images rebuild on merge

`.github/workflows/colo-images.yml` lists `tools/admin/**` as a path trigger (line 21) and builds `tools/admin/Dockerfile`.
Merging this branch rebuilds the admin image. Hold the merge for the Body window: do not merge while a Body is running on
the colo node, and deploy the rebuilt image only in the same window.
