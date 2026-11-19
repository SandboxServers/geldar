# AN-40a worknote: a program's mine digs one exact cell

- Card: AN-40a (branch `origin/docs/an-40a-card`, section "AN-40a"). Decision: 0349, status Proposed.
- Branch: `phase1/sheet-an-40a-mine-at`.
- Base SHA of the implementation: `7df3a568` (feat(golem): a program's mine digs one exact cell). The review fix
  (this note, the guard change, the unbreakable-cell test, the decision status) is one commit on top of it.

## Files

- `golem/src/actions/mine.ts`: exact-cell path (`mineAt`), reach check, one changed-cell guard.
- `golem/src/actions/mine-cell.ts`: cell validation and the fixed failure texts.
- `golem/src/actions/mine-cell.test.ts`: eleven tests, including the unbreakable-cell refusal.
- `golem/src/actions/registry.ts`, `golem/src/body/executor-intent.ts`, `golem/src/body/runtime.ts`: program-only
  run option. A cell on any verb but `mine` is refused as `invalid_args`.
- `docs/decisions/0349-a-program-mines-one-exact-cell.md` and its row in `docs/decisions/README.md`: status Proposed.

## Review fix (AN-40a-review-1)

- Two guards for the same behaviour were in `mine.ts`: the `!at` branch returning `cellFailure` (line 108) and a
  copy inside the changed-cell check. The copy was dead code, so the changed-cell check is back to the single
  `continue` and the `!at` branch is the one guard.
- New test: a cell holding bedrock is refused with `not_possible` and `bedrock cannot be broken by anyone, with
  any tool`, and nothing is dug.

## Revert-checks

Each was one edit, run on the named test, then restored by copying a saved file back (no `git checkout`).
`git diff --stat` was empty after each restore.

1. `nextCandidate` ignores `cell`: fails `digs exactly the named cell, never a nearer block of the same name`.
2. Reach check (step 3(e)) disabled: fails `fails out_of_reach when the walk ends with the cell still out of dig reach`.
3. Changed-cell guard: with the duplicate copy removed, the `!at` branch (line 108) is the one guard. Deleting line
   108 fails `fails not_found when the cell changed during the walk, and digs nothing`.
4. Registry check for a cell on any verb but `mine` disabled: fails `refuses an exact cell on any verb but mine`.
5. `executor-intent.ts` drops the signal and the cell option: the executor test fails.
6. `runtime.ts` drops the `mineAt` spread: the executor test fails.

Added with this fix: swapping the refusal check and the cell-failure check in the `!at` branch fails
`fails not_possible with the refusal text when the cell holds an unbreakable block` (and `fails would drop you`).

## Checks

- Narrow suites: `pnpm exec vitest run golem/src/actions` and the body suites, run with node on the PATH (see below).
- Environment note: `pwsh ./geldar.ps1 check` fails in the deploy/test and repo-checks shell-stub suites on this
  Windows host (42 files on clean main, 41 on this branch, none in golem). This is a Windows-only environment
  problem, not a regression; the full check passes in WSL.
- On this host `node` is not on the PATH of a new shell; `C:\Program Files\nodejs` must be prepended before
  `geldar.ps1 setup` or `pnpm` will run.

## Index line (for ops to add to the ledger)

- AN-40a | phase1/sheet-an-40a-mine-at | review fix on 7df3a568 | decision 0349 Proposed | worknote AN-40a.md
