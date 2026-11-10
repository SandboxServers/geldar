# 0064. The exit runs use fresh lives and fresh volumes; the smoke run has its own life

- Status: Accepted provisionally (orchestrator, owner may revise)
- Date: 2026-11-10
- Spec: 5.3.1 (intents), the operations section on the world volume and the life; decisions 0051 (8B life), 0061 (exit readings), 0063
- Packet: W6-19 (fixtures moved to the lives the shard selects; `select --model smoke`; the exit runs' fresh lives in `adam-run`)

## Context

Before W6-19 the test life `ag_adam_02` served both the 8B live cases and the 8B run's protocol, and `ag_adam_01` was the 32B life. Both persist between runs on the same world volume. The live cases clear the 8B test life's journal before each case (`golem/test/live/adam-reset.ts`), so a run that reused `ag_adam_02` would start with rows written by earlier tests, and the reset would delete them. A run's evidence must not depend on what a test did before it.

Decision 0061 asks each run to be its own record. A reused life or a reused volume breaks that: the Mind reads its own journal into every prompt, and a whitelist entry or a volume carries state from one run to the next.

W6-19 makes three changes in code:

1. `adam select --model smoke` writes the smoke life `ag_smoke_01` on the fast tier (`tools/adam-cli/src/cli.ts`, `pins.ts`).
2. The exit runs use fresh lives: `32b` is `ag_adam_03` and `8b` is `ag_adam_04` (`tools/adam-run/src/manifest.ts`). The fixtures in `animus/` and `golem/` moved to the lives the shard now selects.
3. `adam-run start` refuses a Mind whose username or tier does not match the run profile (`tools/adam-run/src/preconditions.ts`).

Nothing in the repo whitelists the new lives on the server. The `rcon-cli whitelist add` step is manual, for ops.

## Decision

1. **Lives.** Each exit run has its own life id, and it is never reused:
   - 32B exit run: `ag_adam_03` (strong).
   - 8B exit run: `ag_adam_04` (fast).
   - Smoke: `ag_smoke_01` (fast). The smoke run uses no world volume, and its life is for the smoke only.
2. **Volumes.** Each exit run gets a fresh world volume from `./geldar.ps1 adam-run <profile> prepare-volume --run-id <run-id>`. A run never reuses a volume made for another run. The smoke run has no volume of its own.
3. **Whitelist.** Ops whitelists each new life by hand, with `rcon-cli whitelist add <id>`, before the run. Nothing in the repo does it. For the smoke run, ops whitelists `ag_smoke_01` the same way.
4. **Clean journal.** Before start, the run's life has zero `thoughts`, zero `intents` and zero `agents` rows in the dev database. Ops checks this with a `SELECT` (checklist P12). A non-zero count stops the run. P12 also confirms that each id is unused in the dev database, before each run.
5. **Journals are append-only evidence.** No journal rows are deleted for a run, including the smoke run's. A reset that deletes rows of a life used by a live test is an owner decision (see the owner items in `docs/analysis/phase0/adam-run-owner-decisions.md`).
6. **Test lives.** The live test cases keep their own life ids (`ag_adam_02` in the golem live cases). They are not the exit-run lives and are not used for a run.

## Consequences

- The protocols (`adam-run-32b.md`, `adam-run-8b.md`, `adam-run-ops-checklist.md`) name the new ids, the new order of steps, and the manual whitelist step.
- `ag_adam_01` and `ag_adam_02` are retired as exit-run lives. Their journals stay as they are.
- The golem live cases still hard-code `ag_adam_02`, and `adam-reset.ts` still deletes that life's journal rows. This conflicts with item 5. The owner decides (owner items).
- Decision 0061 and the W6-14 run documents are not edited by this record. Their life ids are updated by the protocol files named above.
- Any further exit run needs a new life id, a new volume and a manual whitelist entry. Re-running a finished life is not allowed.
