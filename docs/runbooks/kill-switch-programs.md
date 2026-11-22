---
title: "Turn off a Body program (explore, farm or patrol)"
type: how-to
audience: operators
status: draft
last_verified: 2026-11-21 against f03537ee (dry run, 11 tests) and b6bfcfa0 (12th test, read from the ACT-3 merge; a patrol-removal run on the bundle in the PR #916 review failed it)
companions: [README.md, incident-response.md, add-a-contract-schema.md]
sources: [player-core/src/validate/bounds.ts, golem/src/body/programs/index.ts, golem/src/body/restart.ts, player-core/src/validate/thought-output.ts, contract/schemas/mcp-play.schema.json, contract/schemas/program-shapes.schema.json, .github/workflows/colo-images.yml, .github/workflows/colo-deploy.yml]
---

# Runbook: Turn off a Body program (explore, farm or patrol)

A kill switch for one Body program: the Mind may no longer ask for it, and the Body no longer runs it, even
from a saved checkpoint. Phase 0 ships three programs that can be switched off this way: `explore`, `farm` and
`patrol`. This runbook uses `<P>` for the program's name.

## When to use

- A program misbehaves on a live shard (it walks into danger, wastes crops, or loops) and the fix is not
  ready to ship.
- A program must stop until a review is done.

This is a code change, not a runtime setting. Turning a program off means a merge and a deploy.

## The edits (all in ONE PR)

1. `player-core/src/validate/bounds.ts`: remove `'<P>'` from `PHASE0_PROGRAMS`, and remove the `<P>` entry from
   `PROGRAM_ARGS`.
2. `golem/src/body/programs/index.ts`: remove the `registry.register('<P>', ...)` line from
   `createProgramRegistry()`, and fix that function's doc comment (it counts the built-in programs).
3. `contract/schemas/mcp-play.schema.json`: remove the `<P>` sentence from the `ActInput.intent` description,
   then regenerate: `pnpm --filter @geldar/contract generate`, then `pnpm check:generated`.
   Also remove the `<P>` shape from `contract/schemas/program-shapes.schema.json` (found by the dry run, see
   below), and regenerate again.
4. Update the tests that name `<P>`. The list for each program is in the dry run record below. Each test that
   asserted `<P>` is accepted, or that counts the programs, changes to assert that `<P>` is refused or that the
   count is one less.
5. In a separate scriptorium PR: remove `<P>` from line 9 of `template/.claude/skills/intents-and-limits/SKILL.md`.
   The rangers read that file only after a kit tag, so this PR reaches them after the next tag, not at merge.
6. Why both lists: the validator (`player-core`) refuses a new intent that names `<P>`. The Body registry
   (`golem/src/body/restart.ts`, `recover()`) refuses a plan or a checkpoint resume that names `<P>`, because the
   Body's own registry decides, not the validator's allow-list. Both must change, or a program can still run from
   a saved checkpoint.
7. animus is frozen (decision D-HC-01). animus/src/validate/output.test.ts names explore, farm and patrol, so a kill-switch PR must edit it. Get the owner's or the operator's explicit OK in the PR before editing a frozen package. D-HC-01 is the owner's freeze; the operator may approve a kill-switch-only edit when the owner can't be reached. Say in the PR body that the edit is for the kill switch only.

## Merging deploys

Merging deploys. `colo-images` runs on changes under `player-core/**`, `golem/**` and `contract/**`, and
`colo-deploy` deploys once `colo-images` has published the commit's images. So the PR above goes live on merge,
with no separate step.

## Verify after deploy

- Wait for `colo-deploy` to finish for the merged commit.
- Ask the Mind for an act that names `<P>`. The reply is refused with reason `not_allowed` at `/intent/program`.
  Any other reason means the validator change did not reach the shard; check the deployed commit.
- Confirm a checkpoint that names `<P>` does not resume. On restart the Body logs this line to its stderr (the
  Body process's log on the node): `restart: the checkpoint's program "<P>" is not registered; the Body starts idle`.
  The line is written by `recover()` in `golem/src/body/restart.ts`. The checkpoint is discarded and the Body starts
  idle. If the line is absent, the checkpoint did not name `<P>`, or the Body did not restart; check the deployed
  commit before trusting the result.

## Dry run record (patrol)

The dry run applied items 1 to 3 for `patrol` on a scratch branch off `origin/main` (f03537ee, before the ACT-3
merge), then ran `check`. The 11 tests that failed, and so had to change for item 4, were:

- `player-core/src/validate/program-args.test.ts` (7 tests): `names them in the allow-list and in PROGRAM_ARGS`;
  `requires a route of 2 to 8 positions for patrol, and bounds laps`; `checks each route point as a position:
  height, border and unknown keys (a packet-silent choice)`; `accepts only true or false for a bool`; `refuses a
  fourth, unknown argument for each program`; `accepts a valid intent for each program`; `accepts the bound values
  for each program through the whole validator`.
- `golem/src/body/programs/program-shapes-drift.test.ts` (2 tests): `patrol: the same argument names`; `patrol: the
  same bounds, kinds and required flags`. These fail because `contract/schemas/program-shapes.schema.json` still
  names `patrol`. That file is not in the first draft of item 3; it is added above.
- `golem/src/body/programs/index.test.ts` (1 test): `registers the ten programs and the unsupported names`.
- `animus/src/validate/output.test.ts` (1 test): `keeps explore, farm and patrol out of every table until a
  body-api version selects them`.
- `golem/src/body/restart-programs.test.ts` (1 test, the 12th): `restartBody resumes a checkpoint whose program is
  registered > the Body the live code builds registers explore, farm and patrol`. The ACT-3 merge (b6bfcfa0) added
  this file, so the origin/main dry run did not run it. Its `arrayContaining` list names the program; drop `<P>` from
  that list. The 12th test was found by reading the file on the bundle branch, and a patrol-removal run on the bundle
  in the PR #916 review failed it; the dry run itself did not run it.

With the 12th test, the list is 12 tests in 5 files.

The dry run did not edit these tests. The list is the set of tests that failed under the edits, not a set of
edited and re-passing tests.

The same `check` run on an unmodified `origin/main` (the baseline) failed the same `tools/repo-checks` files as the
dry run: `bluemap-web-nf`, `bluemap-web`, `nats-human-grants-nf`, `scratch-human`, `caddy-adapt` and `colo-params`.
Those need Docker volume paths and Caddy, which the Windows host does not provide. The baseline also failed many
`deploy/test` bash suites, as the dry run did. No `player-core`, `golem` or `animus` test failed on the baseline, so
the files listed above are the failures the edits caused. The `deploy/test` and `tools/repo-checks` failures are
environmental on the Windows host; they were not compared test by test.
