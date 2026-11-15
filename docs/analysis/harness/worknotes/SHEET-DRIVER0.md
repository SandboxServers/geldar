# SHEET-DRIVER0: step 0 driver for the sheet campaign's scratch shard

Status: helpers and the command path are built and unit-tested in source. The scripted life is NOT run: no
Docker, no scratch stack, and vitest cannot run in this worktree (no node_modules). The roll trigger (hurt) and
the RCON recipe are NOT verified. Nothing here has been shown to produce a roll or an XP row.

## Design chosen

- Target: a scratch shard on the Colo node (Linux). Worldops owns the stack. Every endpoint is an environment
  variable with a loopback default. No hosts, IPs, credentials or account names in the repo.
- Guard: `golem/src/bench/sheet/guard.ts` accepts only a shard id and a compose project that start with
  `scratch-`. `bench/sheet/run.sh` and `golem/src/bench/sheet/life-cli.ts` run it before every action.
- Leak check: `golem/src/bench/sheet/leak-check.ts`. Flags a sheet number as a standalone integer, and the
  words sheet, roll and experiment (case-insensitive, at a word start).
- Evidence: `run.sh evidence` runs three read-only `psql` queries (rolls, xp_evidence, proficiency) in a
  read-only session, filtered to `SHEET_LIFE`, and prints them through `report.ts`.
- Overlay: `bench/sheet/phase0-sheet.yml`, a copy of the mh8a pattern on other ports (26566, 14223, 26576,
  15433). Used only by `run.sh up|down`.
- Shard file: `bench/sheet/scratch-shard.template.yaml` (a template, not a shard). The operator copies it to
  `shards/scratch-sheet0.yaml` in a scratch checkout and never commits the copy.

## The command path (built, not run)

- `life-cli.ts snapshot <life>` sends a SnapshotRequest on `geldar.<shard>.body.<life>.snapshot` (core request
  and reply) and prints the snapshot summary.
- `life-cli.ts mine-once <life> <block> <count>` requests a snapshot, then sends one PlanMessage with one `mine`
  action on `geldar.<shard>.body.<life>.plan`. It subscribes to `geldar.<shard>.plan_result` before the plan goes
  out, waits for the PlanAck (the reply), then waits for the plan_result for its thought id. It prints the ids.
- The Body side is `golem/src/mind-link/server.ts`, started by `golem/src/players/main.ts` through
  `natsRequestServer`. So the scratch player's Body answers both subjects. Not run against a live Body.
- Payload builders and readers are pure (`golem/src/bench/sheet/life-payload.ts`), and validate through the
  contract's `validatePlanMessage`, `validateSnapshot`, `validatePlanAck` and `validateSnapshotRequest`.

## What is still unverified

1. The XP award. `awardsFor` (`eventsink/src/xp/awards.ts`) credits a completed `mine` action with stone collected
   as one `mining` row (`mine:<action_id>`). The plan_result arriving does not prove that row was written; check
   `run.sh evidence` for it. Exploring rows from chunk visits may also appear: filter on domain `mining`.
2. The roll. The threat policy (`lifeThreatPolicy`) is bound in `golem/src/adam/adam-body.ts` (`bindThreat`) and
   the player Body only binds it when the shard file has the character block (mode sheet, rolls true) and the
   life has a `character_sheet`. The trigger needs an armed non-creeper hostile and health 7-10 of 20 (aggression
   3, floor 6). `threatCallFor` in `golem/src/body/reflexes/encounter.ts` is the function to read; it was not run.
   The RCON steps in `run.sh rcon-roll` are CANDIDATES. `summon`, `give` and `damage` have not been checked on the
   scratch server's version, and `damage` (vanilla `/damage`) may not exist there.
3. The leak check uses sheet value 3, which matches any standalone 3 in a capture. It is noisy. Use the real
   values for a real run.

## Open questions

- Does the scratch player Body reach a plan's expiry or source-snapshot check on the first try? Not run. The
  first `mine-once` may get `stale_snapshot` if the revision moved between the snapshot and the plan; rerun.
- `proficiency` table columns (is there a `life_id`?) are unverified. The evidence query assumes it.
- `LIVE_NAMES` in `guard.ts` is unreachable for a `scratch-` name: a scratch name can never equal a live name
  (`geldar`, `geldar-colo`, ...), so the list only ever refuses names the prefix check already refused. The guard
  is effectively the prefix check. Left as is; a fix would need a different live-name rule.
- Does the scratch Body need `GELDAR_XP=1` on the eventsink for the mining row? Assumed from the step brief; not
  checked in the compose files.

## Checks run

- vitest did not run: no `node_modules` in this worktree and `setup` is banned for this packet. The new tests are
  `golem/src/bench/sheet/life-payload.test.ts` and the renamed guard cases in `guard.test.ts`. The operator runs
  `pnpm --filter golem exec vitest run src/bench/sheet`.
- Revert checks: not run here (they need vitest). The planned mutation is in `buildMineOncePlan`: delete the
  `if (!checked.ok) throw ...` line. `checked.value` is then undefined for a refused plan, so the 'Stone',
  count-0 and count-257 cases must fail with "expected function to throw".
- Live: not run.
