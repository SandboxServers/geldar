# CAP-1: capture prep (overlay, NATS subscriber, payload validator)

Part 1 of 2 of the provenance capture. Nothing is run against a server here; the ops run is CAP-2.

## What is new (files)

- `compose/opt-in/coreprotect.yml`: the CoreProtect jar into the phase0 `paper` service, read-only, `create_host_path: false`. Host path `GELDAR_COREPROTECT_JAR`, default `.data/coreprotect/coreprotect.jar`. `compose/phase0.yml` is untouched.
- `tools/repo-checks/src/coreprotect-overlay.test.ts`: four tests on the overlay (mount, source default, phase0 untouched, paper only, no ports).
- `tools/capture/`: `package.json` (`@geldar/capture`, workspace), `tsconfig.json`, `README.md`, and `src/`:
  - `capture-files.ts`: file naming, sidecar, `index.jsonl`, the raw write, argument parsing.
  - `nats-capture.ts`: the subscriber CLI. It subscribes, flushes, then prints `READY`.
  - `capture-checks.ts`: pure per-message checks (`validateProvenance`, `validateWorldEvent` + `validateCombatFactPayload`) and the claim rows.
  - `validate-captures.ts`: the directory CLI and `runValidateCli` (exit codes 0, 1, 2).
  - `capture-checks.test.ts`, `capture-files.test.ts`, `validate-captures.test.ts`.
- `tools/capture/fixtures-synthetic/`: three hand-built captures (break, take, combat_fact) with sidecars. They are not captures.
- `.gitignore`: `.capture/` (the subscriber's default output).
- `pnpm-lock.yaml`: the importer for `tools/capture` (`pnpm install --lockfile-only`; no new external package).

## Contract wiring

- `validateProvenance` is the generated ajv function (boolean result; errors on `.errors`). The other two return `ValidationResult`.
- All three are exported from `@geldar/contract` (the index re-exports `perception-events.ts` and `core-records.ts`); no contract change.
- The stream message for `combat_fact` is the WorldEvent (`contract/schemas/event.schema.json`); its `payload` is the combat fact.

## Claims the capture settles (printed, see README)

- AN-47a: the `player` key. The schema accepts it (optional); the claim row fails if it is absent.
- Decision 0321: `encounter_key` life part = `life_id`. The schema accepts a differing pair, so only the claim row catches it.
- AN-27a: `prior_owner` (printed only). AN-51a: `item`, `count` (printed only).

## Commands and results

Run from the worktree root, in order (exit codes as recorded in the report):

```
./geldar.ps1 pnpm install --lockfile-only
./geldar.ps1 setup
./geldar.ps1 pnpm --filter @geldar/capture typecheck
./geldar.ps1 pnpm --filter @geldar/repo-checks typecheck
./geldar.ps1 pnpm exec biome ci tools/capture tools/repo-checks/src/coreprotect-overlay.test.ts
./geldar.ps1 pnpm exec vitest run tools/capture/src tools/repo-checks/src/coreprotect-overlay.test.ts
./geldar.ps1 pnpm check:repo
```

## Revert-checks (validator)

Each mutation changes one validation call in `tools/capture/src/capture-checks.ts` to always-true, runs
`./geldar.ps1 pnpm exec vitest run tools/capture/src/capture-checks.test.ts`, then restores the file from a backup.
`git diff --stat` showed the one-line mutation each time, and an empty diff after the restore.

| Mutation (one line) | Tests that failed | Count |
|---|---|---|
| `if (!validateProvenance(json)) {` becomes `if (false) {` | break missing a field; pickup count 0; take count 99999; combat kind `hit` | 4 of 17 |
| `if (!envelope.ok) return` becomes `if (false) return` | envelope missing `shard` | 1 of 17 |
| `if (!payload.ok) return` becomes `if (false) return` | payload with an unknown key | 1 of 17 |

## Not run here

- Docker and the live lane: not touched. `docker compose -f compose/phase0.yml -f compose/opt-in/coreprotect.yml config` was not run; Docker is not part of this packet's checks. The overlay is validated only by its YAML shape test.
- The NATS subscriber was not run against a server (no connection in any test). Its `connectNats` use follows `contract/src/nats-connect.ts`; that the core-NATS subscription also receives the JetStream `combat_fact` publish is the runbook's claim, not re-checked here.
- The `bytes` field of a sidecar is informational and not checked by the validator.
