# Item-2 scratch stack recipe card

Operator recipe for the item-2 live harness (decision 0391 item 5; worknote [AN-50b](worknotes/AN-50b.md), "Ops still to run"). It runs `golem/test/live/item2-observations.live.test.ts` against a throwaway desktop stack, project `scratch-item2`. Status: **not run**. Written from the repo at `origin/main` = `0583a441e`. Items marked **unverified** were not checked, and the reason is given.

## What the run does and does not touch

- Starts one scratch stack (project `scratch-item2`, suffix `item2`): Postgres, NATS, Paper and the scratch overlay services, including the eventsink.
- The test starts one observer Body in-process (life `ag_item2_01`, `observations: true`, `golem/test/live/item2-observations.live.test.ts` line 121). A second scratch life (the chatter bot) acts in the observer's sight. The file runs the **gift** and **fight** rows only (`SETUP_ROWS`, `item2-harness.ts` line 29). **Break** and **take** are not run by this file.
- Then it runs `mine-once` for the observer, and reads the mining XP from Postgres (`proficiency`, `xp_evidence`) to check the sink received it.
- Mutates only: the `scratch-item2` containers, volumes and secrets directory, the Paper world of that project, and one shard file you create (`shards/scratch-item2.yaml`, deleted at teardown).
- Does not start `adam`. The file header says never run it with `adam up` alive: `adam up` holds port 7410 (`item2-observations.live.test.ts` lines 9-10).
- Observations stay **off on the Colo** until this run passes and the owner approves a change. Do not set `GELDAR_OBSERVATIONS` (read at `golem/src/adam/main.ts` lines 245-246) on the Colo or in any shard file before then.

## Model

Not needed by the test, as the code shows:

- `item2-observations.live.test.ts` imports no model or Mind client. It builds the Body with `startAdamBody` and runs one scripted plan through `mine-once`, which the module header describes as "one scripted life over core NATS, with no model" (`golem/src/bench/sheet/life-cli.ts` lines 2-3).
- The run starts no Mind process and no `adam` process.
- **Unverified:** whether `startAdamBody` itself waits for a message from a Mind. Its start path was not read. If the run stalls at the Body start, stop (see the stop list). Do not start a local 8B model as a workaround without owner review.

## Ports, names and the guard

Ports are the scratch defaults for a suffix with no `deploy/scratch/<suffix>.env` (`docs/runbooks/scratch-stack.md`, the project table):

| Service | Host address | Value |
|---|---|---|
| Postgres | `127.0.0.1:15432` | `ITEM2_PG_URL` |
| NATS | `127.0.0.1:14222` | `ITEM2_NATS_URL` |
| NATS monitor | `127.0.0.1:18222` | (not used by the test) |
| Minecraft | `127.0.0.1:35565` | `ITEM2_MC_PORT` |
| RCON | not published by a Paper scratch stack | see gap G1 |

- The guard refuses NATS, Postgres, Minecraft and RCON ports 4222, 5432, 25565 and 25575 (`golem/test/live/item2-harness.ts` line 22). None of the ports above is refused.
- Other scratch projects in the repo: `scratch-telemetry` uses 25432, 24222, 28222, 45565 (`deploy/scratch/telemetry.env`); `scratch-nf` uses 35432, 34222, 38222, 55565, 55575 and 55566 (`deploy/scratch/nf.env`). `scratch-item2` must not run at the same time as `scratch-a` or any other stack that uses the default ports, because they would clash on the same host ports.
- The shard name and compose project must each match `^scratch-[a-z0-9][a-z0-9-]{0,23}$` (`golem/src/bench/sheet/guard.ts`). `scratch-item2` matches.
- The guard refuses any shard or project name containing `colo`, `live` or `prod` (`item2-harness.ts` line 23).
- The observer life must match `^ag_[a-z][a-z0-9]{0,15}_[0-9]{2,}$` and must not start with `ag_adam_` (`item2-harness.ts` lines 24-26). `ag_item2_01` matches.

## Gap G1: RCON is not reachable on a Paper scratch stack

- The test connects RCON to `127.0.0.1:ITEM2_RCON_PORT` (`item2-observations.live.test.ts` lines 99-103).
- The Paper service in `compose/opt-in/scratch.yml` publishes only Postgres, NATS and Minecraft (lines 11-12, 24-26, 68-69). `compose/phase0.yml` publishes no RCON port (line 92). `compose/rcon-host.yml` publishes RCON on the fixed port 25575, which the guard refuses, and it is written for the `phase0` shard.
- RCON is published on loopback only in the NeoForge overlay, `compose/opt-in/scratch-neoforge.yml` line 27, with `SCRATCH_RCON_PORT` (default 35575; `nf.env` gives 55575).
- **Consequence:** as the repo stands, a Paper scratch stack cannot satisfy this test. Do not run it until the owner approves a route: either an RCON overlay for `scratch-item2` on a free non-refused port, or the NeoForge lane. The NeoForge lane is **unverified** for this test: the test was written against Paper, and the NeoForge lane has not been run against it.

## Stop list

Stop, change nothing else, and report if any of these happens:

1. Any refusal from `item2Refusal` or `configRefusal`. Read the message; do not edit the guard or the variables to get past it.
2. A port clash on `docker compose up` (`port is already allocated`), or a listener already on 15432, 14222, 18222 or 35565 before `up` (check in step 1).
3. `scratch.sh up` reports that the project already has containers or secrets. Run `down item2` only after the owner says the leftovers are this run's.
4. Any container, volume or network whose name contains `colo`, `live`, `prod`, `phase0` or `adam`, or any `adam` process, appears in `docker ps` during the run.
5. Gap G1 applies: no RCON port is reachable on the chosen stack.
6. The test reports "skipped". That is not a pass. Check that `GELDAR_IT` and `GELDAR_ITEM2` are both `1` in the same shell.
7. The shard file loads with a different `shard` or `mind.agent.username` than the target names.
8. Any failure of the test that is not one of its own assertions (a `checkRow` or `checkXp` message), such as a connection error to NATS, Postgres or RCON. Stop and report the message.

## Commands, in order

Run from the worktree root. Use the account that owns the desktop stack; do not run as an account that owns a live stack. The scratch script is POSIX `sh`: the runbook is written for a Linux node. Running it from Windows needs Git Bash or WSL. **Unverified** on this desktop.

### 0. Preconditions

```powershell
docker ps --format '{{.Names}}'                       # no adam, no colo, no live, no scratch-a
Get-NetTCPConnection -State Listen -LocalPort 15432,14222,18222,35565 -ErrorAction SilentlyContinue
```

The second command must print nothing. Any row is a port clash: stop (stop list item 2).

### 1. Build the plugin jar

The Paper service mounts `plugin/core/build/libs/geldar-core.jar` (`compose/phase0.yml` line 91).

```powershell
cd plugin
./gradlew build
cd ..
```

**Unverified:** the Windows wrapper (`gradlew.bat build`) was not tried. The runbook text uses `./gradlew build`.

### 2. Make the NATS auth directory (outside the repo, not in a checkout)

`scratch.sh up` requires `SCRATCH_NATS_AUTH_DIR` to be an absolute readable directory with non-empty `nats-auth.conf nats-paper.txt nats-velocity.txt nats-eventsink.txt nats-seed.txt` (`deploy/scratch/scratch.sh`, `NATS_FILES`). The test's observer connection needs `nats-body.txt` as well, which the probe list adds (`PROBE_NATS_FILES`). Generate all six in a clean export, never in the live checkout (`docs/runbooks/scratch-stack.md`, "NATS auth"):

```powershell
$exp = New-Item -ItemType Directory -Path (Join-Path $env:TEMP ('item2-export-' + [guid]::NewGuid()))
git archive HEAD | tar -x -C $exp.FullName     # a clean export with no .git
Push-Location $exp.FullName
./geldar.ps1 shard nats-auth phase0 --scratch
Pop-Location
$authDir = Join-Path $env:TEMP ('item2-nats-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $authDir | Out-Null
Copy-Item (Join-Path $exp.FullName 'nats-auth.conf'),(Join-Path $exp.FullName 'nats-paper.txt'),(Join-Path $exp.FullName 'nats-velocity.txt'),(Join-Path $exp.FullName 'nats-eventsink.txt'),(Join-Path $exp.FullName 'nats-seed.txt'),(Join-Path $exp.FullName 'nats-body.txt') $authDir
```

**Unverified:** the output location of `nats-auth` in an export, and whether `nats-body.txt` is written by the generator. The probe list says it is; the generator was not read. Check with `Get-ChildItem $authDir` before step 4. Keep `$authDir` and the export for teardown.

### 3. Create the shard file (untracked, deleted at teardown)

`loadAdamConfig` reads `shards/<GELDAR_SHARD>.yaml` with no fallback (`golem/src/adam/adam-config.ts` line 132). The file must declare `shard: scratch-item2` and an observer life `ag_item2_01` under `mind.agent.username`. Copy `shards/phase0.yaml` to `shards/scratch-item2.yaml` and edit those two keys only.

**Unverified:** whether a copy of `phase0.yaml` loads with those two edits alone. Check the other keys it reads before the run.

### 4. Bring up the stack

```powershell
$env:SCRATCH_NATS_AUTH_DIR = $authDir                # absolute path, no newline
sh deploy/scratch/scratch.sh config item2            # render the compose file, check the ports
sh deploy/scratch/scratch.sh up item2                # gates, then the stack, with --build
sh deploy/scratch/scratch.sh status item2
```

`up` checks the NATS files, creates the secrets directory under the per-user state root, and starts the stack. Stop at any refusal (stop list item 2 or 3).

**Unverified:** the `up` run on this desktop; the state root path (`$XDG_STATE_HOME` or `$HOME/.local/state`, `docs/runbooks/scratch-stack.md`) on Windows; the uid check the runbook describes for accounts whose uid differs from the image's (`SCRATCH_RUN_UID`).

### 5. Check the migrations and the schema

Postgres applies `sql/` only on a fresh volume, and `up` makes one, so this is the check that nothing is pending (`docs/runbooks/scratch-stack.md`, "Migrations"). The password is read from the secrets file into the environment of one command, never printed:

```powershell
$stateRoot = if ($env:XDG_STATE_HOME) { Join-Path $env:XDG_STATE_HOME 'geldar-scratch' } else { Join-Path $HOME '.local/state/geldar-scratch' }
$pgPass = Get-Content -Raw (Join-Path $stateRoot 'scratch-item2/postgres.txt')
$env:PGHOST = '127.0.0.1'; $env:PGPORT = '15432'; $env:PGUSER = 'geldar'; $env:PGDATABASE = 'geldar'; $env:PGPASSWORD = $pgPass.Trim()
node tools/migrate/src/cli.ts --dry-run
Remove-Item Env:PGPASSWORD
```

The dry run should show no pending migrations. **Unverified:** the state path and the command under Windows; `node` must run `.ts` here (the runbook uses it as written).

### 6. Set the ITEM2 variables for this run

Build the Postgres URL from the same password without printing it. Use only the placeholders below and fill them in the shell, not in a file:

```powershell
$env:GELDAR_IT = '1'
$env:GELDAR_ITEM2 = '1'
$env:ITEM2_SHARD = 'scratch-item2'
$env:ITEM2_PROJECT = 'scratch-item2'
$env:ITEM2_NATS_URL = 'nats://127.0.0.1:14222'
$env:ITEM2_PG_URL = "postgresql://geldar:$([uri]::EscapeDataString($pgPass.Trim()))@127.0.0.1:15432/geldar"
$env:ITEM2_MC_PORT = '35565'
$env:ITEM2_RCON_PORT = '<RCON host port of scratch-item2, see gap G1>'
$env:ITEM2_RCON_PASSWORD_FILE = '<absolute path of scratch-item2/rcon.txt under the state root>'
$env:ITEM2_OBSERVER_LIFE = 'ag_item2_01'
$env:GELDAR_NATS_USER = 'body'
$env:GELDAR_NATS_PASSWORD_FILE = "$authDir\nats-body.txt"
```

Notes:

- `GELDAR_NATS_USER` and `GELDAR_NATS_PASSWORD_FILE` must both be set. The test's own NATS connection reads them through `natsAuth` with `process.env`, and `natsAuth` refuses a password file without a user (`contract/src/nats-connect.ts`; `contract/src/nats-connect.test.ts` lines 136-137).
- `ITEM2_RCON_PORT` cannot be filled until gap G1 is resolved. Leave the run until then.
- `ITEM2_RCON_PASSWORD_FILE` is the file, never its value. It must not be `compose/secrets/rcon.txt` (the guard refuses that, `item2-harness.ts` line 124).

### 7. Run the one file

```powershell
./geldar.ps1 pnpm --filter @geldar/golem test:live -- item2-observations.live.test.ts
```

The `test:live` script runs `vitest run --config vitest.live.config.ts` over `test/live/**/*.live.test.ts` (`golem/package.json`, `golem/vitest.live.config.ts`). The `-- <file>` filter is passed to vitest by pnpm.

**Unverified:** whether `./geldar.ps1 pnpm` passes the `--` and the file filter through unchanged; whether the test timeout (180 s per test, `vitest.live.config.ts`) is enough for the two settle waits (8 s each) plus the Body start. The file's own timeout is the test default; the config sets 180 s.

## What to check afterwards

1. The test passes once. A skip is not a pass (stop list item 6).
2. The gift and fight rows each show the observation kind the row requires (`property_broken` is not in this run; `gift_received` and `fight_seen` are). `checkRow` in `item2-harness.ts` gives the message for each row.
3. The XP check passes: `proficiency` for `ag_item2_01` in domain `mining` rises after `mine-once`, and its `xp_evidence` has a new key (the test's `readXp` queries these two tables). The eventsink is expected to write them; that it does so on this stack is **unverified**.
4. No `ag_adam_` life appears in the output or the database for this run.
5. `docker ps` during the run shows no `adam`, no `colo`, no `live` and no `phase0` container.
6. The Paper log shows the Body joined and left, with no error from `geldar-core`.

## Teardown

Only the scratch project. Do not run any command with `--all`, and do not name the Colo stack.

```powershell
sh deploy/scratch/scratch.sh down item2                # down -v --rmi local, removes the secrets dir, lists leftover volumes
Remove-Item shards/scratch-item2.yaml
Remove-Item -Recurse -Force $authDir
Remove-Item -Recurse -Force $exp.FullName
Get-ChildItem Env:ITEM2_*, Env:GELDAR_IT, Env:GELDAR_ITEM2, Env:GELDAR_NATS_* | Remove-Item
Remove-Item Env:SCRATCH_NATS_AUTH_DIR -ErrorAction SilentlyContinue
```

Then verify each item is gone:

- `docker ps -a --filter label=com.docker.compose.project=scratch-item2` prints nothing.
- `docker volume ls --filter label=com.docker.compose.project=scratch-item2` prints nothing.
- `docker images --filter label=com.docker.compose.project=scratch-item2` prints nothing, or only images the owner expects.
- The secrets directory `scratch-item2` under the state root does not exist.
- `$authDir` and the export directory do not exist.
- `shards/scratch-item2.yaml` does not exist, and `git status` in the worktree shows no file for it.
- `Get-NetTCPConnection -State Listen -LocalPort 15432,14222,18222,35565` prints nothing.

If any item is still there, record it and stop. Do not delete a volume or container that is not labelled `scratch-item2`.

## Unverified items (summary)

- Gap G1: no RCON port on a Paper scratch stack; the NeoForge lane is unverified for this test.
- Whether the Body start (`startAdamBody`) needs any Mind message.
- Whether `nats-body.txt` is written by `shard nats-auth`.
- Whether a copy of `phase0.yaml` loads as `scratch-item2` with only the two keys changed.
- Every Windows-specific step: Git Bash or WSL for `scratch.sh`, the Gradle wrapper, the state root path, the uid check, `node` on `.ts`.
- Whether the eventsink writes `proficiency` and `xp_evidence` on this stack.
- Whether `./geldar.ps1 pnpm ... -- <file>` passes the file filter.
- The whole run: no part of this card has been run.
