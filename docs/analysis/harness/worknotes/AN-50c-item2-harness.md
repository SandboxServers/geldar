# AN-50c: the item-2 live harness (decision 0391 item 5)

Status: written and unit-tested; the live file is still unrun, and nothing here started a stack.

## Files

- `golem/test/live/item2-harness.ts` (pure, test-only): the refusal, the row table, `checkRow`, `checkXp`.
- `golem/test/live/item2-harness.test.ts`: 11 unit tests (run by `check`).
- `golem/test/live/item2-observations.live.test.ts`: the live lane file (`test:live` only; the root config excludes `*.live.test.ts`).

## What it does

It starts a Body through `startAdamBody` with the existing `observations: true` env option (no shard config key;
`adam-body.ts` untouched), keeps the `observation` events the Body publishes, drives the chatter life through
break, gift, take and fight, and checks each row with `checkRow` (kind, observer, key, leakage scan, one event
except gifts). The observer then mines one block (`checkMine`), and the harness reads `proficiency` and `xp_evidence` before and after with `checkXp`.

Refusal (`item2Refusal`): needs `GELDAR_IT=1` and `GELDAR_ITEM2=1`; shard and compose project must pass the
`scratch-` guard of `bench/sheet`; no `colo`, `live` or `prod` in either name; NATS and Postgres URLs must be
loopback with an explicit port that is not 4222 or 5432. The four `ITEM2_*` variables have no defaults.

The worknote AN-50b description matched the code (four channels, `observations` option needing `owners`).

## Unverified

- The whole live file: the Body wiring, the actor moves (dig, toss, open chest, attack) and the settle time.
- The mining step: the observer Body mines one `stone` through `life-cli.ts mine-once` (exit code 0 means the plan
  was accepted and its plan_result arrived), then the XP is read. Whether stone is in reach of the observer, and
  whether the sink awards within the settle time, are not known.
- The scratch stack's ports and the Postgres password source are not set up by this card.

## Revert-checks (run for real)

Each line changed in `item2-harness.ts`, the unit file run, the file restored.

| Mutation | Failing test |
|---|---|
| live-port check replaced by `false` | `refuses a non-loopback host and the live default ports` |
| scratch guard result ignored | `refuses the live shard names` |
| duplicate check replaced by `false` | `fails on a wrong agent, an empty key and a duplicate` |
| mine-step check replaced by `false` (`exitCode === 0` made `true`) | `passes only an exit code of 0` |
| XP delta check replaced by `false` | `fails on no award and on a double award` |
