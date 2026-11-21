# 0392. Held-live exception for explore, farm and patrol

- Status: Accepted (owner)
- Date: 2026-11-21
- Spec: section 13, the held-live rule (the ruling of 2026-11-15, referenced in 0391); decision 0344 (explore, farm and patrol). `docs/spec.md` is not touched.
- Related: 0391 (program wording), #864 (PHASE0_PROGRAMS), colo-deploy run #242, PR #880 (closed, unmerged)

## Decision

1. explore, farm and patrol are on `PHASE0_PROGRAMS` (`player-core/src/validate/bounds.ts`, #864) and are live. They went live without test-shard validation. This record is the held-live exception for those three programs. It is an owner ruling of 2026-11-21.
2. The live smoke (step 6) and the 24-hour report (step 8) of the rollout stand in for the test-shard validation the held-live rule asks for.
3. The kill switch is the branch `phase1/an-45a-fix` (PR #880, closed unmerged) together with ACT-3 (the restartBody and checkpoint work, to be specified). Reverting the three programs means applying that branch's change, once ACT-3 is specified.
4. The Mind is told the programs' arguments through the `intent` description in `contract/schemas/mcp-play.schema.json`, and those shapes are enforced through `PROGRAM_ARGS`. This record does not change any program's bounds.

## Why

The three programs were merged to main and deployed before the test shard had run them. Sam ruled on 2026-11-21 that the live smoke and the 24-hour report carry the validation for these three programs, and that the kill switch is the reviewed branch plus ACT-3. PR #880 (which removed the three programs) is closed and is not applied.

## Consequences

- Nothing is removed from `PHASE0_PROGRAMS`. A later change that removes one of the three programs needs its own record.
- The rollout gates on step 6 (live smoke) and step 8 (24-hour report). A failed smoke or report is handled by the kill switch in item 3.
- Test-shard validation for these programs is not required before the next release, and the exception is recorded here so the gap is visible.
