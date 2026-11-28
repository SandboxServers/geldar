# AN-50d: production switch for the Body's observations option

Status: code and tests written; off by default. Nothing here sets the variable on, starts a stack, or publishes an observation.

## What changed

- `GELDAR_OBSERVATIONS` is read in three places, through one parse (`golem/src/adam/observations-env.ts`):
  - `golem/src/adam/main.ts` (the Adam Body, `golem-body` in `compose/colo.yml`): spreads `observations: true` into the Body env only when on.
  - `golem/src/players/body-host.ts` (`playerBodyEnv`, new optional input `observations`): sets the key only when it is `true`.
  - `golem/src/players/main.ts` (the sovereign player host, `players-host`): passes `observationsFromEnv(env.GELDAR_OBSERVATIONS)` into `playerBodyEnv`.
- `compose/colo.yml`: `GELDAR_OBSERVATIONS: "${GELDAR_OBSERVATIONS:-}"` in `golem-body` and `players-host`. Unset on the host, the container gets an empty string, which is off.
- `adam-body.ts` is untouched. The option is still `env.observations === true`.

## Parse

- On: `'1'` and `'on'`, exact match.
- Off: unset, empty, `'0'`, `'off'`, `'ON'`, `'true'`, `' 1'`, `'1 '`, `'yes'`, and any other value.
- Off adds no key at all to the Body env (the spread is empty), so the env object is the same as before.

## Not wired

- `golem/src/players/managed-main.ts` (the managed player host) is not changed. Its Body containers get their env from `body-helper/src/managed-template.ts`, which lists the variables by hand and does not pass `GELDAR_OBSERVATIONS`. Turning the switch on for managed Bodies needs a change there; this card does not make it.

## Tests

- `golem/src/adam/observations-env.test.ts`: parse (off and on values), the spread, `playerBodyEnv` with absent, false and true, a source check that `adam/main.ts` and `players/main.ts` read the variable through the parse, and a check that `colo.yml` has the pass-through twice and no fixed value.

## Unverified

- The live lane is not run. Nothing here starts a Body with the switch on; the item-2 live file (AN-50c) still sets `observations: true` directly.
- `compose/colo.yml` was checked only by the repo's CI `docker compose config` step, which is not run here.
- `compose/colo.yml` was already over the 700-line cap before this change (712 lines); this card adds two lines and does not split it.
