# Scratch stack

A throwaway copy of the Phase 0 shard stack (`compose/phase0.yml`) for the sheet campaign validation. It runs beside the
live phase0 stack and the Colo stack without clashing: its own compose project (`scratch-<suffix>`), its own volumes,
loopback-only ports on high defaults, and hard caps. Teardown removes everything it created.

## Commands

    sh deploy/scratch/scratch.sh up [suffix]       # gates, then starts the stack (default suffix a)
    sh deploy/scratch/scratch.sh status [suffix]   # compose ps, then CPU and memory per container
    sh deploy/scratch/scratch.sh down [suffix]     # down -v, removes the secrets dir, lists leftover volumes

The suffix is `[a-z0-9]{1,8}`. Anything else exits 2. Exit 3 means a gate failed and nothing was started.
`down` works after a failed `up`: run it to clean up.

## Gates

`up` refuses to start unless both hold:

- free RAM is at least 10 GB (Linux: `MemAvailable` in `/proc/meminfo`; elsewhere PowerShell's `FreePhysicalMemory`);
- free disk on the filesystem holding the repo is at least 20 GB (`df -Pk`).

The script prints both figures before deciding. It also refuses if the project already has containers, or if a
secrets pointer from an earlier `up` still exists. Run `down` first.

## Resource caps

Per-service limits in `compose/opt-in/scratch.yml`:

| Service   | Memory | CPUs |
|-----------|--------|------|
| paper     | 3072m  | 1.5  |
| velocity  | 768m   | 0.5  |
| postgres  | 768m   | 0.5  |
| nats      | 256m   | 0.25 |
| eventsink | 384m   | 0.25 |

The total is about 5 GB of memory and 3.0 CPUs. Keep the stack under the 7 GB ceiling. Paper's heap defaults to 2G
(`PAPER_MEMORY` overrides it). Every container has `restart: "no"`, so nothing comes back after a reboot.

## Shared servers

On a shared Linux server, before `up`, record the load average, free RAM and free disk. Stop the stack with `down`
if other tenants, or the game server's TPS, show strain. The gates are a floor, not a licence to run.

## One stack at a time

Run one scratch stack at a time. Its ports are 15432 (Postgres), 14222 and 18222 (NATS client and monitor) and
35565 (Velocity). Override them with `SCRATCH_PG_PORT`, `SCRATCH_NATS_PORT`, `SCRATCH_NATS_MON_PORT` and `SCRATCH_MC_PORT`.

## Migrations

Postgres applies `sql/` in name order by itself, but only on a fresh volume. `up` always makes one, so every
scratch stack starts from a fresh schema. To confirm nothing is pending, with the stack up:

    PGHOST=127.0.0.1 PGPORT=$SCRATCH_PG_PORT node tools/migrate/src/cli.ts --dry-run

The output should show no pending migrations.

## Turning on the character config

The character fixture is `shards/character-fixture.yaml`. To use it, point the scratch shard file at that path
instead of `shards/phase0.yaml`, using the shard tooling in `geldar.ps1`. Do not copy its values into
`shards/phase0.yaml`, `shards/colo.yaml` or `shards/colo-mind.yaml`.

## Rules

- Loopback only. Every published port is bound to 127.0.0.1. Do not change that, and do not add a bind to another
  address.
- Never run this on the Colo node without the owner's word. geldar-93 is where that is asked.
- Evidence from a scratch run is for operators only. Agents in the run are never told they are being watched.
- The secrets directory is created with `umask 077` under the temp directory, outside the repo. Nothing prints its
  values. `down` removes it.
