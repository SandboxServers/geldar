# Scratch Paper RCON on loopback (item-2 harness)

## What changed

- `compose/opt-in/scratch.yml`: the `paper` service gets a `ports: !override` block that publishes only RCON, on loopback:
  `127.0.0.1:${SCRATCH_RCON_PORT:-35575}:25575`. The game port (25565) is never published.
- `deploy/scratch/telemetry.env`: adds `SCRATCH_RCON_PORT=45575` to the five `SCRATCH_*_PORT` keys of the scratch-telemetry project.
- `deploy/scratch/scratch.sh`: a one-line change in the WIP commit (`git show f09487851 -- deploy/scratch/scratch.sh`).
- `docs/runbooks/scratch-stack.md`: updated in the WIP commit (14 lines changed).
- Tests: `tools/repo-checks/src/scratch-overlay.test.ts`, `scratch-neoforge-overlay.test.ts`, and the new `scratch-paper-rcon-render.test.ts` (rendered with `docker compose config`, skipped without Docker).

## Variable and defaults

| Project | Variable | Default | Host port |
|---|---|---|---|
| scratch-a (overlay default) | `SCRATCH_RCON_PORT` | 35575 | 127.0.0.1:35575 |
| scratch-neoforge (`nf.env`) | `SCRATCH_RCON_PORT` | 55575 | 127.0.0.1:55575 |
| scratch-telemetry (`telemetry.env`) | `SCRATCH_RCON_PORT` | 45575 | 127.0.0.1:45575 |

A `SCRATCH_RCON_PORT` already set in the operator's environment wins over `telemetry.env`. The three defaults differ from each other and from every phase0 and live host port.

## Revert table

Each row mutates one line, runs the named test file singly, and restores the file from a scratchpad backup.

| Revert | File run | Failing tests |
|---|---|---|
| (a) remove the paper `ports` block from `compose/opt-in/scratch.yml` | `scratch-overlay.test.ts` | 5: replaces the ports of postgres, nats, paper and velocity; publishes only RCON from paper; gives RCON a scratch port; uses the five defaults; gives scratch-telemetry its own port block |
| (a) | `scratch-paper-rcon-render.test.ts` | 2: binds RCON on paper to 127.0.0.1 on the default port; takes the published port from SCRATCH_RCON_PORT |
| (b) default `35575` to `25575` | `scratch-overlay.test.ts` | 3: replaces the ports of postgres, nats, paper and velocity; gives RCON a scratch port (not 25575); uses the five defaults |
| (b) | `scratch-neoforge-overlay.test.ts` | 1: keeps the NeoForge RCON default equal to the base overlay default |
| (b) | `scratch-paper-rcon-render.test.ts` | 1: binds RCON on paper to 127.0.0.1 ... never to 25575 |
| (c) `127.0.0.1` to `0.0.0.0` | `scratch-overlay.test.ts` | 2: replaces the ports of postgres, nats, paper and velocity; binds every overlay mapping to 127.0.0.1 and no other address |
| (c) | `scratch-paper-rcon-render.test.ts` | 2: both tests |
| (d) drop `SCRATCH_RCON_PORT` from `deploy/scratch/telemetry.env` | `scratch-overlay.test.ts` | 1: gives scratch-telemetry its own port block; every telemetry.env port differs from every overlay default |
| (d) | `scratch-telemetry.test.ts` | none (this file has no key-set assertion) |

The telemetry key-set assertion lives in `scratch-overlay.test.ts`, not in `scratch-telemetry.test.ts`.

## Unverified

- Nothing was started: no container, no `up`, no live run. The live lane is pending.
- The stub-guard tests fail on this Windows machine and are not verified here. With Git's `bin` first on PATH, `scratch-script.test.ts` gives 51 failures and `scratch-telemetry.test.ts` gives 3. Each fails in `assertStubsFirst` with `stub guard: sh resolves id to '/usr/bin/id'`. The helper in `tools/repo-checks/src/scratch-harness.ts` is unchanged from `origin/main`, so the failure is environmental. Linux CI decides these tests.
- Without `sh` on PATH, `scratch-script.test.ts` and the `sh`-gated parts of `scratch-config-dry-run.test.ts` are skipped.
