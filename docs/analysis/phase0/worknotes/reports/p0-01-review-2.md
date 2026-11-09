# P0-01 review 2

Verdict: decision

The code is shippable. The only open item is the Haiku trailer on 8f17621, which only the orchestrator can resolve (reword or accept).

## Commit trailers, verbatim

8f17621:
```
Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015Wz3WivzkDVS6r65y6RFEk
```

c0d6495:
```
Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015Wz3WivzkDVS6r65y6RFEk
```

## Fix notes from review 1

1. formatError substring bug: fixed. `contract/src/index.ts` now tests the quoted form `'<name>'` against the Ajv message and appends it when absent. Ajv's additionalProperties message never contains a quoted name, so `'a'` is always appended. Ajv's required message contains `'revision'`, so it is not doubled. The new test "names a short unknown property..." (`value.a = 1`, expects `'a'`) would fail on the old code, because "a" is a substring of "must NOT have additional properties". It is not theatre.
2. Trailer on 8f17621: NOT applied (decision, see below).
3. Revision-required test: added, and it asserts `'revision'` with quotes. It fails if `revision` is dropped from `required`, because validation would pass and `ok` would be true. Not theatre.
4. ValidationResult doc comment: now `/** ... */`. Applied.

## Runs (my own, in the worktree via geldar.ps1)

- `pnpm --filter @geldar/contract check:generated`: exit 0, "up to date".
- `pnpm test`: exit 0, 3 files, 15 tests.
- Not rerun: mutation checks (read-only). `git status` is clean.

## Regressions and drift

None found. The fix commit touches only `contract/src/index.ts` and `contract/test/snapshot.test.ts` (+24/-3). Generated files and schemas are unchanged, so the generated output is current. The docs/threat-model.md deletion in the range is the branch being behind wave1, as the brief said.

## Decision for the orchestrator

8f17621 still carries `Claude Haiku 5.5` where the brief required `Claude Sonnet 5.5`. Options:
- (a) Reword 8f17621 before the merge (`git rebase` with reword, or `git commit --amend` after squash). This breaks the "commit once, no amend" rule, but only on an unmerged local branch.
- (b) Merge as is and accept the one-off trailer drift. The fix commit and the session line are correct.
- (c) Squash both commits at merge with the Sonnet trailer.

Smallest fix: (c) or (a). Nothing else is outstanding.
