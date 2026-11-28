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

## Managed Bodies (the 100 per-agent Body containers)

A managed Body is created by the body helper, not by compose, so its env does not come from `compose/colo.yml`. The path from the host env to the Body container env:

1. The helper process env: `GELDAR_OBSERVATIONS` set on the body helper's host (its process env; the helper is not a compose service).
2. `body-helper/src/helperConfig.ts`, `managedConfig()` and `observationsOf()`: `managed.observations` is `'1'` or `'on'` when the helper's value is one of those, and `undefined` otherwise (unset, empty, `0`, anything else).
3. `body-helper/src/service.ts`, the start path: `managedBodyConfig({ ..., observations: deps.template.managed?.observations })`.
4. `body-helper/src/managed-template.ts`, `observationsEnv()`: appends `GELDAR_OBSERVATIONS=<1 or on>` to the Body's `Env` only when set. Unset, the `Env` list is the same 13 entries as before, with no key.
5. The Body container runs `golem/src/players/managed-main.ts` (`runManagedBody`, env from the container): `playerBodyEnv({ ..., observations: observationsFromEnv(env.GELDAR_OBSERVATIONS) })`, the same parse as the other two entry points.

Only `'1'` and `'on'` reach a container; the golem parse turns on the same two values. `GELDAR_OBSERVATIONS` is off by default on the helper, so the managed Body containers are byte-identical to before when it is unset.

Not in this card: the helper's own deployment env (its systemd unit or `deploy/body-helper-node.env`) does not set the variable. An operator sets it on the helper host to turn the switch on for managed Bodies; no default is set here.

## Tests

- `golem/src/adam/observations-env.test.ts`: parse (off and on values), the spread, `playerBodyEnv` with absent, false and true, a source check that `adam/main.ts` and `players/main.ts` read the variable through the parse, and a check that `colo.yml` has the pass-through twice and no fixed value.
- `body-helper/src/managed-template.test.ts` and `body-helper/src/helperConfig.test.ts`: unset adds no `GELDAR_OBSERVATIONS` key to a managed Body's env; `1` and `on` are forwarded; other values are refused (template) or not forwarded (helper config). The golem source check also covers `players/managed-main.ts`.
- Revert-checked: removing the forward line, forwarding an empty key when unset, forwarding any helper value, and dropping the managed host's `observations` each fail their test.

## Unverified

- The live lane is not run. Nothing here starts a Body with the switch on; the item-2 live file (AN-50c) still sets `observations: true` directly.
- `compose/colo.yml` was checked only by the repo's CI `docker compose config` step, which is not run here.
- `compose/colo.yml` was already over the 700-line cap before this change (712 lines); this card adds two lines and does not split it.
