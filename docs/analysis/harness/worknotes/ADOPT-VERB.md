# ADOPT-VERB worknote (S12-04b operator verbs)

- Base sha (first pass, HEAD at session start): `96a7b32ad` on `sheet/adopt-verb`.
- Commit: `feat(colo): operator verbs for the sheet adoption plan and apply (ADOPT-VERB)`.
- Scope: the operator verbs only. The plan verb works. The apply verb reaches the CLI, which still refuses `--apply`
  (`tools/mcp-tokens/src/cli.ts`, `runAdoptSheets`, prints `adopt-sheets: --apply is S12-04b`). The CLI is not in this
  packet, so nothing is written by apply yet.

## Design

- `deploy/colo-admin.sh adopt-sheets-plan --lives <list>` takes exactly those two arguments. `adopt-sheets-apply
  --operator-confirm --plan <12 hex> --lives <list>` takes exactly those five arguments in that order (ADOPT-LIVES). `--lives`
  is required on both, so there is no unrestricted form. `<list>` is a comma list of 1 to 120 unique life ids, each matching
  `^ag_[a-z][a-z0-9]{0,15}_[0-9]{2,}$`; a bad id, a duplicate or a count outside 1 to 120 refuses the run before docker
  runs. Both pass the arguments to the admin one-shot (`run --rm --no-deps admin adopt-sheets plan|apply ...`), as the other
  verbs do. `DEPLOY_DRY_RUN=1` prints the command.
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

## Revert table (ADOPT-LIVES)

Each row is one mutation of one line, applied to the WIP state, run against `deploy/test/colo-admin-adopt.test.ts` (57 tests).
Each mutation fails at least one test; the names are the file's `describe`/`it` text.

| # | File | Line mutated | Expected failure | Observed |
|---|------|--------------|------------------|----------|
| 1 | deploy/colo-admin.sh | `[ "$1" = --lives ]` dropped from the plan check | plan accepts a flag other than --lives | FAIL: "refuses a flag other than --lives to plan before any container starts" (1 failed) |
| 2 | deploy/colo-admin.sh | `[ "$4" = --lives ]` dropped from the apply check | apply accepts --apply in place of --lives | FAIL: "refuses --apply in place of --lives before any container starts" (1 failed) |
| 3 | deploy/colo-admin.sh | id regex `_[0-9]{2,}$` loosened to `{1,}` | a one-digit id passes | FAIL: "refuses a bad id to plan before any container starts" (1 failed) |
| 4 | deploy/colo-admin.sh | `die "duplicate life id: $id"` removed | a duplicate id passes | FAIL: "refuses a duplicate to plan before any container starts"; "refuses a duplicate id to apply before any container starts" (2 failed) |
| 5 | deploy/colo-admin.sh | `[ "$n" -le 120 ]` loosened to `121` | 121 ids pass | FAIL: "refuses 121 ids to plan before any container starts" (1 failed) |
| 6 | tools/admin/admin.sh | `if (missing !== undefined)` replaced by `if (false)` | an id not in the shard file passes | FAIL: "refuses a life id that the shard file does not list, names only that id, and runs no CLI"; "refuses an apply with an unlisted id before the CLI runs" (2 failed) |
| 7 | tools/admin/admin.sh | `const wanted = listArg.split(",")` replaced by `const wanted = lives` | the map holds every shard life, not only the listed ones | FAIL: 8 tests, including "the sheets map holds only the listed lives, each standard" and "apply with the hash of a wider list refuses for the restricted list" (8 failed) |
| 8 | tools/admin/admin.sh | `[ "$2" = --lives ]` in the plan check replaced by `[ "$2" = "$2" ]` | plan accepts a flag other than --lives | FAIL: "refuses adopt-sheets with a flag other than --lives before the CLI runs" (1 failed) |
| 9 | tools/admin/admin.sh | `[ "$5" = --lives ]` dropped from the apply check | apply accepts --apply in place of --lives | FAIL: "refuses adopt-sheets with --apply in place of --lives before the CLI runs" (1 failed) |

## Merge note: colo images rebuild on merge

`.github/workflows/colo-images.yml` lists `tools/admin/**` as a path trigger (line 21) and builds `tools/admin/Dockerfile`.
Merging this branch rebuilds the admin image. Hold the merge for the Body window: do not merge while a Body is running on
the colo node, and deploy the rebuilt image only in the same window.
