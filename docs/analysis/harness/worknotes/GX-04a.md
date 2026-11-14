# GX-04a worknote: player-core move

Status: DONE in phase1/gx-04a-player-core. Base origin/main 2e5126f7. The earlier STOP (validate/corrective.ts
needs prompts/world-text.ts) is resolved by a verbatim copy of the one helper, not a move. animus/ stays frozen.

## What moved

`git mv` from `animus/src` into the new workspace package `player-core/` (@geldar/player-core). Each old path is
now a deprecated `export *` stub so existing imports keep working. Nothing was deleted.

- Sources: `attention/classify.ts`, `ids.ts`, `link/link.fixtures.ts`, `link/mind-event.ts`,
  `link/nats-body-link.ts`, `link/nats-event-source.ts`, `loop/plan.ts`, `ports/{admission,attention,body,index,memory,model,prompts}.ts`,
  `validate/{action-focus,action-shapes,bounds,corrective,index,json-input,reflection-output,thought-output}.ts`.
- Tests: `ids.test.ts`, `link/nats-body-link.test.ts`, `link/nats-event-source.test.ts`, `loop/plan.test.ts`.
- New in player-core: `package.json`, `README.md`, `src/no-animus.test.ts` (fails if any player-core source imports animus),
  `src/validate/json-string.ts`.

## Closure beyond the brief's list

- `validate/action-focus.ts` and `validate/action-shapes.ts` (imported by `validate/index.ts`).
- `link/nats-event-source.ts` (imported by `link/link.fixtures.ts`).
- All of `ports/` (`ports/index.ts` re-exports every sibling).
- `validate/corrective.ts` imports `jsonString` from `animus/src/prompts/world-text.ts`. That file is frozen
  (`prompts/**` pinned by decision 0181), so player-core carries its own copy: `src/validate/json-string.ts`.
  It is lines 54-92 and 114-131 of world-text.ts plus the `MAX_ITEM_CHARS` line, copied byte for byte by a script.
  `threshold/mcp/src/json-string-parity.test.ts` runs both copies on the same inputs.
- `validate/bounds.ts` exports `PROGRAM_ARGS` (needed by the move).

## Deviations from the brief

- `threshold/mcp/package.json`: `@geldar/player-core` replaced `@geldar/animus` in dependencies; `@geldar/animus`
  (workspace:*) moved to devDependencies for the parity test only. Not a runtime dependency.
- `threshold/mcp/src/container.test.ts`: `'player-core'` added to the `workspaceDirs` list (the closure walk
  failed with "imports an unknown workspace package" without it). Lines 64-65 now name
  `player-core/package.json` and `player-core/src/validate/index.ts`.
- `threshold/mcp/Dockerfile.dockerignore`: `!animus/src` replaced by `!player-core` (threshold runtime no longer
  imports animus; comments only).
- `.github/workflows/colo-images.yml`: `player-core/**` added to the trigger paths (the Mind image now depends on it).
- `tools/admin/Dockerfile`: `COPY player-core ./player-core` (admin closure includes @geldar/mcp).
- `animus/Dockerfile.mind` and `animus/Dockerfile.mind.dockerignore`: COPY and allow `player-core`.
- `threshold/mcp/README.md`: workspace dependencies line and the imports.test.ts description updated.
- `pnpm-workspace.yaml`: `player-core` listed. `pnpm-lock.yaml` regenerated (player-core importer added).
- The first `gx04a-move3.py` script was not run to completion (it had already applied one edit). The remaining
  edits were applied with an idempotent script that checks each exact match.

## Checks (worktree, final state)

- `git diff --check`: clean.
- `pnpm format`: applied 25 files (import order in moved files). `pnpm lint`: exit 0 at error level; 46 warnings and 8 infos
  remain (not compared against the origin/main baseline; unconfirmed).
- Typecheck: `player-core`, `animus`, `threshold/mcp` clean.
- `pnpm test player-core`: 5 files, 38 passed.
- `pnpm test animus`: 42 files passed, 2 skipped; 469 passed, 5 skipped. Baseline 505 passed, 5 skipped; the
  The four moved test files hold 37 tests; animus loses 37 and gains the 1 no-animus test, net 36, which is the
  difference exactly. Animus has 42 files because `no-animus.test.ts` matches the `animus` path filter; the
  expected 41 was a miscount (45 - 4 ignored that file), not an unconfirmed item.
- `pnpm test threshold/mcp`: 147 files passed, 9 skipped; 1423 passed, 55 skipped. Baseline 1407 passed, 55 skipped;
  the +16 is `json-string-parity.test.ts` (16 tests).
- `pnpm check:repo`: repo checks ok.

## Revert-checks

1. `player-core/src/validate/json-string.ts` line 13 `[0x3e, 0x3e]` -> `[0x3f, 0x3f]`: parity test fails
   ("agrees on <tag> and </tag>", the `>` is not escaped). Restored from backup; diff empty.
2. `player-core/src/ids.ts`: prepended `import '../../animus/src/ids.ts';`: no-animus test fails
   (`expected ['ids.ts'] to deeply equal []`). Restored from backup; diff empty.

## Open items

- None blocking. Unconfirmed: the lint warning count against baseline.
- Not run: live lane (not requested).
