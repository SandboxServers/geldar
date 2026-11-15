# SHEET-DRIVER0: step 0 driver for the sheet campaign's scratch shard

Status: partial. The helpers are built and unit-tested. The scripted life (the one roll and the one XP award)
is NOT built. Reason below.

## Design chosen

- Target: a scratch shard on the Colo node (Linux). Worldops owns the stack. Every endpoint is an environment
  variable with a loopback default. No hosts, IPs, credentials or account names in the repo.
- Guard: `golem/src/bench/sheet/guard.ts` accepts only a shard id and a compose project that start with
  `scratch-` and are not a live name. `bench/sheet/run.sh` runs it before every action.
- Leak check: `golem/src/bench/sheet/leak-check.ts`. Flags a sheet number as a standalone integer, and the
  words sheet, roll and experiment (case-insensitive, at a word start).
- Evidence: `run.sh evidence` runs three read-only `psql` queries (rolls, xp_evidence, proficiency) in a
  read-only session, filtered to `SHEET_LIFE`, and prints them through `report.ts`.
- Overlay: `bench/sheet/phase0-sheet.yml`, a copy of the mh8a pattern on other ports (26566, 14223, 26576,
  15433). Used only by `run.sh up|down`.

## What is missing for the scripted life (not forged)

1. The roll. The threat policy (`lifeThreatPolicy`) is bound only in `golem/src/adam/adam-body.ts`
   (`bindThreat`), and only when the shard file has a `character` block with mode sheet and rolls on, and the
   mind agent has a `character_sheet`. The bench `ConnectionManager` path (`golem/src/bench/cli.ts`) does not bind
   it. So the life must run the Adam Body (`golem/src/adam/main.ts`) against a scratch shard file. The hostile
   would come from an RCON `summon` on the scratch shard. Not verified that a roll always follows.
2. The XP award. `awardsFor` (`eventsink/src/xp/awards.ts`) credits `action` records with `state: completed`.
   Those records come from the Body's own executor, which acts on intents from the Mind over NATS. A Body-only
   life needs a real command path into the Body for one action (for example one mine). I did not find that
   subject and payload in the code read so far, so I did not guess it.
3. The shard file for the scratch life (a copy of `shards/character-fixture.yaml` shape, with a scratch shard
   id, one life, all-3 sheet, character mode sheet, rolls true).

## Open questions

- Does `golem/src/adam/main.ts` run a Body without the Mind (a no-model life)? `main()` reads the adam config
  and starts the Body; the Mind process is separate. Not verified by running.
- The `proficiency` table's columns (is there a `life_id`?) are unverified. The evidence query assumes it.
- Leak check with all-3 sheets: the number 3 matches any standalone 3 in a capture, so the check is noisy.
  Use the real sheet values for a real run.

## Checks run

- No `node_modules` in this worktree and `setup` is banned for this packet, so vitest did not run here. A
  scratchpad script re-checked the same expectations against the modules (19 cases, all pass). The vitest
  files are written but not run. The operator must run `pnpm --filter golem exec vitest run src/bench/sheet`.
- Live: not run. No Docker, no shard.
