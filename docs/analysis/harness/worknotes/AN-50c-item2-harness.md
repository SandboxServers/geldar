# AN-50c: the item-2 live harness (decision 0391 item 5)

Status: written and unit-tested (20 tests); the live file is still unrun, and nothing here started a stack.

## Files

- `golem/test/live/item2-harness.ts` (pure, test-only): the target, the refusal, the row checks, the mine and XP checks.
- `golem/test/live/item2-harness.test.ts`: 20 unit tests (run by `check`).
- `golem/test/live/item2-observations.live.test.ts`: the live lane file (`test:live` only; the root config excludes `*.live.test.ts`).

## What it does

It starts a Body through `startAdamBody` with the existing `observations: true` env option (no shard config key;
`adam-body.ts` untouched), keeps the `observation` events the Body publishes, and checks the rows it can set up
with `checkRow` (kind, observer, key, leakage scan, one event except gifts). The observer then mines one `stone`
through `life-cli.ts mine-once` (`checkMine`: exit code 0 means the plan was accepted and its plan_result
arrived), and `checkXp` compares `proficiency` and `xp_evidence` before and after.

## Target: nothing from the defaults

The live file never calls `loadStackConfig` and never reads the default shard file. Everything comes from
`ITEM2_*` variables with no defaults (`item2Target`; unset is the empty string, which refuses):
`ITEM2_SHARD`, `ITEM2_PROJECT`, `ITEM2_NATS_URL`, `ITEM2_PG_URL`, `ITEM2_MC_PORT`, `ITEM2_RCON_PORT`,
`ITEM2_RCON_PASSWORD_FILE`, `ITEM2_OBSERVER_LIFE`. The Golem config is built by `item2StackConfig` (loopback hosts,
those ports, that NATS URL); the shard file is `shards/<ITEM2_SHARD>.yaml` through `loadAdamConfig({GELDAR_SHARD})`,
and `configRefusal` then requires its shard and Body life to equal the target's.

`item2Refusal` refuses: `GELDAR_IT` or `GELDAR_ITEM2` not 1; a shard or project without the `scratch-` guard, or with
colo, live or prod in either; a NATS or Postgres URL that is not loopback, has no explicit port, uses 4222 or 5432,
or has any query string or fragment; a Minecraft or RCON port that is empty, invalid, 25565 or 25575; an empty RCON
password file or the stack's `compose/secrets/rcon.txt`; an observer life that is not a life id or starts `ag_adam_`.
With `GELDAR_ITEM2` unset the live suite is skipped whole; with it set and a refusal, the test throws the refusal text.

## Rows: only gift and fight are set up

The arena has no dirt, chest, hostile mob or observer-owned block. Gift and fight can be set up through RCON on
the scratch shard (the observer and actor are teleported one block apart; `give` and a toss; `summon zombie` and an
attack), so `SETUP_ROWS` is `gift` and `fight`. Break and take need a block the observer owns, which the Body's
block-owner record gets only from the observer placing it. They are NOT set up and not asserted.

Question for the owner: should the harness have the observer Body `place` a block and a chest through a scripted
plan (as `mine-once` does for mining) so break and take become reachable? That adds a second scripted-plan helper
or an extension of `life-cli.ts`; I did not decide it.

## Leak scan

`checkRow` runs `leaksIn` (provenance word, coordinates, life ids outside the allow-list). The live run does NOT
create a hidden actor, so the hidden-name and hidden-life checks of that scan have nothing to catch live; the
hidden-actor leakage is covered only by the AN-50b unit tests.

## Unverified

- The whole live file: the Body wiring, the toss, the zombie attack, the settle times, and that `loadAdamConfig` finds
  a scratch shard file whose Body life is the scratch observer (the operator must create it; this card adds none).
- The mining step: the harness sets one `stone` block beside the observer's arena spot by RCON; whether the Body
  reaches it, and whether the sink awards within the settle time, are not known.
- The scratch stack's ports and the Postgres password source are not set up by this card.

## Revert-checks (run for real)

Each line changed in `item2-harness.ts`, the unit file run, the file restored; each failed the named test.

| Mutation | Failing test |
|---|---|
| query-string check replaced by `false` | `refuses any query string or fragment on the Postgres and NATS URLs` |
| live-word test reads the shard only (`scratch-prod` project) | `refuses the live shard names, including a scratch project with a live word` |
| `localhost` dropped from the host check | `accepts a scratch target ... and localhost` and `refuses a non-loopback host ...` |
| Minecraft port check fed a fixed good port | `refuses the live Minecraft and RCON ports ...` |
| RCON port check fed a fixed good port | the same test |
| 25565 and 25575 removed from the live ports | the same test |
| RCON password-file check replaced by `false` | `refuses an empty or default RCON password file, with either slash` |
| Adam-life check removed | `refuses an observer life that is empty, malformed or an Adam life` |
| shard check in `configRefusal` removed | `refuses a shard file that is not the target shard or observer life` |
| Body-life check in `configRefusal` removed | the same test |
| stack config uses the default MC port | `builds the stack config from the target ports and NATS only` |
| `SETUP_ROWS` gains `break` | `can set up only gift and fight` |
| scratch guard result ignored (earlier run) | `refuses the live shard names ...` |
| duplicate check, XP delta check, mine check replaced (earlier run) | their `checkRow`, `checkXp`, `checkMine` tests |
