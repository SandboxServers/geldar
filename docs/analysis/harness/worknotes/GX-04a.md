# GX-04a worknote: player-core move

Status: STOPPED before any move (stop condition in the brief: the closure pulls in `animus/src/prompts/**`).
Branch: phase1/gx-04a-player-core, base origin/main 2e5126f7.

## Baseline (origin/main, before any edit)

- `pnpm test animus`: 45 files passed, 2 skipped; 505 tests passed, 5 skipped (510 total).
- `pnpm test threshold/mcp`: 146 files passed, 9 skipped; 1407 tests passed, 55 skipped (1462 total).

## Closure of the brief's move list

Relative imports checked file by file:

- `validate/index.ts` imports `action-focus.ts` (not in the list) and `corrective.ts`, `bounds.ts`, `json-input.ts`, `reflection-output.ts`, `thought-output.ts`.
- `validate/action-focus.ts` imports `action-shapes.ts` (not in the list) and `bounds.ts`.
- `validate/corrective.ts` imports `../prompts/world-text.ts` (`jsonString`). That is under `animus/src/prompts/**`. STOP condition. `world-text.ts` is 243 lines and has no imports of its own, but the brief forbids touching `prompts/**`, and player-core cannot import from animus (`no-animus.test.ts`).
- `link/link.fixtures.ts` imports `link/nats-event-source.ts` (not in the list). `nats-event-source.ts` imports `../ports/index.ts` and `mind-event.ts`.
- `ports/index.ts` re-exports every file in `ports/` (`admission`, `attention`, `body`, `memory`, `model`, `prompts`). The `ports/` directory is self-contained: `memory.ts`, `prompts.ts` and `attention.ts` import only sibling ports files.
- `loop/plan.ts` imports `ids.ts` (`node:crypto` only). `attention/classify.ts` has no relative imports. `link/mind-event.ts`, `link/nats-body-link.ts` import only `ports/index.ts`.

Files outside the brief's list that the move would also need: `validate/action-focus.ts`, `validate/action-shapes.ts`, `link/nats-event-source.ts`, and all of `ports/` (`admission.ts`, `attention.ts`, `memory.ts`, `model.ts`, `prompts.ts`).

Blocking file: `animus/src/validate/corrective.ts` (line 2). Moving `validate/index.ts` requires moving `corrective.ts`, which requires `prompts/world-text.ts`.

## Decision needed from the orchestrator

Options, none taken here:

1. Owner ruling that `prompts/world-text.ts` (the single `jsonString` helper) may move or be duplicated. Conflicts with "everything under animus/src/prompts/** stay untouched" unless the helper is copied, which duplicates code.
2. Drop `validate/index.ts` and its validate closure from the GX-04a move set; move the rest and handle the validate tree in a separate packet.

No file was moved, no import was changed, and no animus or threshold/mcp test was edited.

## Checks

Not run: the move did not happen, so there is nothing to format, lint, typecheck or test beyond the baseline above.
