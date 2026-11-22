# BLD fix7b: review-code-5 F3, F7, F8

Branch `phase1/bld-fix7b-nats-docs`, base `a5082ec4` (building/integration). Source: `.claude/reports/building/review-code-5.md`.

## F3: the Body NATS role has no subjects for the building buckets

- `geldar.ps1` `Get-NatsUsers`, the `body` Pub list, now also grants `$KV.geldar-plans.>` and `$KV.geldar-seen.>`.
- `tools/repo-checks/src/nats-auth-fixtures.ts` (`expectedTable`) and `threshold/mcp/test/nats-auth.it.test.ts` (`roleAllows`) carry the same two subjects.
- The seed role (`SEED_ROLE`, phase0 only) does not gain them. The colo table is unchanged in shape.
- Test: `tools/repo-checks/src/nats-auth.test.ts`, "gives the body the plan and seen bucket subjects in the generated config (BLD fix7b)". It renders the generator and checks the body Pub list and the expected table. Revert-check: removing the two generator entries fails it.
- Runbook: `docs/runbooks/nats-auth-inplace.md` now says the repo change exists and that the live conf is changed by the owner on the node. The building flag must stay off in a scoped-auth stack until that step is done.
- Not done: no live config was touched and nothing was run against a node.

## F7: survey cap repeated in the MCP message

- `SURVEY_MAX_CELLS` (golem, `survey-reply.ts`) stays the single source in code. `threshold/mcp` does not import golem, so the number is checked by a text test, not a shared constant. No contract change.
- `threshold/mcp/src/world.ts` message: "A box of over 32768 cells after the layers clamp is refused." The line count of `world.ts` is unchanged.
- Test: `tools/repo-checks/src/survey-cap.test.ts` reads both files and fails if the message number differs from the Body constant or the layers-clamp wording is missing. Revert-check: the old wording fails it.

## F8: erasure does not check the Body is stopped

- `docs/runbooks/building.md` (erasure bullet) now says: stop the life's Body before erasing. The runbook gives the reason (a running Body's seen writer re-creates keys after the purge).
- The tool itself still does not check the Body is down. That is left to the operator, as the review suggests.
- Owner decision, not changed here: the bare `<life_id>` key in `geldar-checkpoints` (the body's intent checkpoint) is still left by erasure. Keep it, or erase it and say why. Recorded as an owner call; this packet does not change `erase-building.ts`.

## Verification

- Biome check on the touched TypeScript files: clean after `biome check --write`.
- `tsc --noEmit` for `threshold/mcp` and `tools/repo-checks`: clean.
- `vitest run tools/repo-checks threshold/mcp`: see the report for the environment failures (no `sh` on PATH in this Windows session).
