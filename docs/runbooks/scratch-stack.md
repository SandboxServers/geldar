# Scratch stack

A throwaway copy of the Phase 0 shard stack (`compose/phase0.yml`) for the sheet campaign validation. It runs beside the
live phase0 stack and the Colo stack without clashing: its own compose project (`scratch-<suffix>`), its own volumes,
loopback-only ports on high defaults, and hard caps. `down` removes its containers, its volumes, its eventsink image
and its secrets directory. The Docker build cache is not removed (prune it by hand if the disk needs it).

The sheet sink is not enabled. The overlay does not include `compose/opt-in/sheet-sink.yml` and `GELDAR_SHEET_SHARD` is
unset, so a scratch run does not write to the sheet.

Not approved for any run on the shared node: open NATS (see NATS auth below).

## Before up

1. Build the two plugin jars on the machine that runs the stack: `cd plugin; ./gradlew build`. The stack bind-mounts
   `plugin/core/build/libs/geldar-core.jar` and `plugin/velocity-identity/build/libs/geldar-velocity-identity.jar`.
   `up` refuses (exit 1) if either is missing, and does not create anything.
2. Run as the account whose uid is `GELDAR_SERVICE_UID` (default 1000), or as any non-root account when
   `SCRATCH_CONTAINER_UID` is set. `up` refuses (exit 1) under any other uid, including root.
   `SCRATCH_CONTAINER_UID` is the uid the containers run as (the Paper, NATS and eventsink images use 1000). Set it when
   the account uid is not 1000, for example `SCRATCH_CONTAINER_UID=1000` on a node account of uid 1001. Digits only, not
   0; anything else exits 2. Without a value the containers run as 1000. Why: the containers read the secret files as
   their own uid, and a file owned by another account at mode 0600 gives `cat: /run/secrets/rcon: Permission denied`.
   When the uids are equal the secret files stay 0600. When they differ, `up` makes the secrets dir 0711 (traverse
   only) and the three secret files 0644, but only inside the 0700 per-user state dir; if that dir is not 0700 `up`
   exits 1. The NATS files in `SCRATCH_NATS_AUTH_DIR` are not changed by the script. When the uids differ they must
   give `SCRATCH_CONTAINER_UID` read on the files and traverse on the dir by ACL, and `other` nothing, or `up` exits 2
   and prints the `setfacl` commands. Run as the caller: `setfacl -m u:1000:x DIR` and `setfacl -m u:1000:r DIR/nats-*`.
3. Compose 2.24.4 or newer (the `!override` tag). `up` checks.
4. Set up NATS auth (next section).

## Commands

    sh deploy/scratch/scratch.sh up [suffix]       # gates, then starts the stack (default suffix a)
    sh deploy/scratch/scratch.sh status [suffix]   # compose ps, CPU and memory per container, NATS warning if open
    sh deploy/scratch/scratch.sh down [suffix]     # down -v --rmi local, removes the secrets directory, lists leftover volumes

The suffix is `[a-z0-9]{1,8}`. Anything else exits 2. Exit codes: 2 usage or NATS auth refused, 3 a gate failed,
1 anything else. On 2 and 3 nothing is started. `down` works after a failed `up`: run it to clean up. If `down` fails
the secrets directory is kept, and `up` refuses until `down` succeeds.

## NATS auth (fail closed)

`up` needs `SCRATCH_NATS_AUTH_DIR`: a readable directory holding non-empty `nats-auth.conf`, `nats-paper.txt`,
`nats-velocity.txt` and `nats-eventsink.txt`. Without it `up` exits 2 and prints why:

    scratch: NATS auth is required. Set SCRATCH_NATS_AUTH_DIR to a directory holding the four files made by ...

The files come from the generator on the desktop, `./geldar.ps1 shard nats-auth <shard>` (`Initialize-NatsAuth` in
`geldar.ps1`). It writes into the repo's `compose/secrets/` (git-ignored).

`SCRATCH_NATS_OPEN=1` is the only other way to start, and it runs open NATS with no role ACLs. It prints a multi-line
WARNING, and `status` repeats it. Open NATS lets every local user on the node connect to `127.0.0.1:14222`, publish to
the subjects Paper consumes and read JetStream. Open NATS is not approved for any run on the shared node. It is for a
run that does not test the NATS roles, and such a run cannot test item 5. If `SCRATCH_NATS_AUTH_DIR` is set but
invalid, `up` exits 2 even with `SCRATCH_NATS_OPEN=1`.

The flow, in order:

1. On the desktop, from the repo root: `./geldar.ps1 shard nats-auth <shard>`. It never overwrites a file that exists,
   so a file that was already there belongs to someone else's stack.
2. Make a temp dir outside the repo. Copy only `nats-auth.conf`, `nats-paper.txt`, `nats-velocity.txt` and
   `nats-eventsink.txt` into it. Those are the four files `compose/nats-auth.yml` mounts. Do not copy anything else.
3. Delete the repo-side copies that step 1 created (the lines `created compose/secrets/...` in its output name them).
   Leave alone any file that was already there.
4. After the review passes and the start gates are met, copy the temp dir to a node temp dir. Do not copy it
   anywhere else.
5. On the node: `SCRATCH_NATS_AUTH_DIR=<absolute path of the node temp dir> sh deploy/scratch/scratch.sh up [suffix]`.
   The path must be absolute and on one line; a relative path or a newline exits 2 with nothing started. The script
   checks the four files, then points the `nats-auth.yml` secrets at that dir. It does not read, print or copy the files.
6. At teardown run `sh deploy/scratch/scratch.sh down [suffix]`, then delete both copies: the desktop temp dir (if
   it still exists) and the node temp dir. `down` never removes `SCRATCH_NATS_AUTH_DIR`.

The conf and the passwords never go in the repo, in logs or in messages. Do not paste their contents into a
terminal, a chat or a report.

## Gates

`up` refuses to start unless both hold, and exits 3 when a figure cannot be read as a number:

- free RAM is at least 10 GB (Linux: `MemAvailable` in `/proc/meminfo`; elsewhere PowerShell's `FreePhysicalMemory`);
- free disk is at least 20 GB on both the repo filesystem and Docker's data root (`docker info`, `DockerRootDir`).
  The smaller of the two figures counts.

The script prints the figures before deciding. It also refuses (exit 1) if the project already has containers or if a
secrets directory from an earlier `up` still exists. Run `down` first.

## Resource caps

Per-service limits in `compose/opt-in/scratch.yml`, with `memswap_limit` equal to the memory cap:

| Service   | Memory | CPUs |
|-----------|--------|------|
| paper     | 3072m  | 1.5  |
| velocity  | 768m   | 0.5  |
| postgres  | 768m   | 0.5  |
| nats      | 256m   | 0.25 |
| eventsink | 384m   | 0.25 |

The total is 5248 MiB (about 5.1 GiB) and 3.0 CPUs. The gate's 10 GB RAM floor is the margin for the rest of the node.
Paper's heap defaults to 2G (`PAPER_MEMORY` overrides it). Every container has `restart: "no"`, so nothing comes back
after a reboot. The image build (`--build`) runs outside these caps.

## Shared servers

On a shared Linux server, before `up`, record the load average, free RAM and free disk. Stop the stack with `down`
if other tenants, or the game server's TPS, show strain. The gates are a floor, not a licence to run.

## One stack at a time

Run one scratch stack at a time. Its ports are 15432 (Postgres), 14222 and 18222 (NATS client and monitor) and
35565 (Velocity). Override them with `SCRATCH_PG_PORT`, `SCRATCH_NATS_PORT`, `SCRATCH_NATS_MON_PORT` and `SCRATCH_MC_PORT`.
The secrets directory is `${XDG_STATE_HOME:-$HOME/.local/state}/geldar-scratch/scratch-<suffix>`, mode 0700.
`SCRATCH_NATS_AUTH_DIR` and `XDG_STATE_HOME` must be absolute paths on one line (`/...` on the node); the script exits 2
on a relative path or a newline and starts nothing.

## Migrations

Postgres applies `sql/` in name order by itself, but only on a fresh volume. `up` always makes one, so every
scratch stack starts from a fresh schema. To confirm nothing is pending, with the stack up, from the repo root:

    STATE=${XDG_STATE_HOME:-$HOME/.local/state}/geldar-scratch
    PGHOST=127.0.0.1 PGPORT=${SCRATCH_PG_PORT:-15432} PGUSER=geldar PGDATABASE=geldar \
      PGPASSWORD="$(cat "$STATE/scratch-<suffix>/postgres.txt")" node tools/migrate/src/cli.ts --dry-run

The output should show no pending migrations. The password is read into the environment of that one command and
never printed.

## Turning on the character config

The character fixture is `shards/character-fixture.yaml`. To use it, point the scratch shard file at that path
instead of `shards/phase0.yaml`, using the shard tooling in `geldar.ps1`. Do not copy its values into
`shards/phase0.yaml`, `shards/colo.yaml` or `shards/colo-mind.yaml`.

## Rules

- Loopback only. Every published port is bound to 127.0.0.1. Do not change that, and do not add a bind to another
  address.
- Never run this on the Colo node without the owner's word. geldar-93 is where that is asked.
- Evidence from a scratch run is for operators only. Agents in the run are never told they are being watched.
- The secrets directory is created under the caller's state directory, never in the repo or in a shared temp
  directory. Nothing prints its values. `down` removes it, and only when it is a real directory the caller owns.
