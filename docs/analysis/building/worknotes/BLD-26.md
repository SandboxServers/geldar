# BLD-26 worknote

Status: Done (coder pass; review pending)
Branch: phase1/bld-26-delete-build
Worktree: C:\Users\Steve\source\projects\geldar-wt-bld-26
Base sha: 4c07067f (building/integration)
Commit: the single squashed BLD-26 commit on phase1/bld-26-delete-build (see git log)
Checks: `pnpm exec vitest run` on contract/test, golem/src/body/limits*.test.ts, golem/src/body/programs, animus/src/validate: all contract tests pass; 8 animus failures remain (see Notes). lint ok (warnings only, pre-existing count), typecheck contract/golem/animus ok, contract check:generated up to date, check:repo ok, git diff --check clean.
Revert check (test that failed): contract/test/thought.test.ts "refuses the removed inline build action (BLD-26, decision 0427)" failed with "expected true to be false" when contract/src/generated/validators.js was restored to the pre-BLD-26 line; restored, diff empty.
Live: none (not the live user).
Notes:
- Removed: the `do: "build"` Action in contract/schemas/thought.schema.json; regenerated contract/src/generated (types, mcp-tools, validators); the `build` case in golem/src/body/limits.ts blockOperationsOf (now `mine` count, `place`/`break` one).
- Kept: the `build` program (golem/src/body/programs/build.ts, blueprints shelter, wall, pillar), `build` in PHASE0_PROGRAMS and the schema program enum.
- Tests changed: contract/test/thought.test.ts (appendix entry removed; three build-action tests replaced by one refusal test); golem/src/body/limits.test.ts (build cost case removed); animus/src/validate/output.test.ts (the not_allowed case renamed to the removed inline build action; expectations unchanged).
- contract/test/build-plan.test.ts "a different verb" uses do:'build' as a refusal of a break action; left unchanged (still a refusal).
- Not edited: docs/spec.md (owner edits the verb table line), prompts (no new version needed by the packet).
- Eight animus failures remain, none involving build (they concern the `break` and `plan` verbs and prompt token budgets): output.test.ts (3: break is in PHASE0_VERBS but not in the listed verbs or prompts/body-api/v9.json), action-focus.test.ts (3: the valid verb list includes break and plan), prompts/library.test.ts (2: 8808 and 8830 tokens against 8704). Not verified against HEAD in this session; flagged as findings.
