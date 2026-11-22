---
title: CLI tools
type: reference
audience: contributors
status: draft
last_verified: 2026-11-16 against 1b114276
companions: [repo-checks.md, ci-workflows.md, shard-config.md, compose-stacks.md, environment-variables.md, repo-layout.md, skills-and-agents.md, ../runbooks/progress-metrics.md, ../runbooks/mcp-tokens.md, ../agents/doc-update-map.md]
sources: [geldar.ps1, package.json, vitest.config.ts, tools, golem/src/bench/cli.ts, golem/package.json, .github/workflows/ci.yml, CLAUDE.md, docs/reference/repo-layout.md, compose/colo.yml, compose/mcp.yml, compose/nats-auth.yml, compose/phase0.yml, compose/rcon-host.yml, deploy/colo-admin.sh, deploy/colo-notice.sh, envs/environment.schema.json, plugin/build.gradle.kts, psyche/README.md, psyche/RELEASE.json, shards/colo.yaml, shards/phase0.yaml, threshold/mcp/test/live/stub-client.live.test.ts]
---

# CLI tools

Every command of the task runner `geldar.ps1`, the root `package.json` scripts, and the fourteen packages under `tools/`: what each runs, its arguments and flags, the environment variables it reads (names only), what it writes, and how it is tested. For the gates inside `tools/repo-checks`, see [repo-checks](repo-checks.md). For the CI jobs that call these commands, see the [ci-workflows](ci-workflows.md).

Environment variables appear by name only. For what each one means across the stack, see the [environment-variables](environment-variables.md) reference. Secret files appear by role, never by path. The Glass, Kino and progress-metrics tools appear as commands and flags only; what those surfaces show is in the `agents-never` pages ([Glass and Kino](glass-and-kino.md), [progress-metrics](../runbooks/progress-metrics.md)).

## How this page was measured

- Commit `1b114276`, read 2026-11-16 (UTC). Every fact comes from reading source; no command on this page was run against a shard, a database, NATS or the network.
- `geldar.ps1` facts cite its line numbers at that commit. Tool facts cite the tool's `src/cli.ts` (or the file named) and its `package.json`.
- Re-derive the lists with these read-only commands from the repo root:

```powershell
# geldar.ps1 commands: the top-level dispatch switch (two-space indent; 15 lines at 1b114276, `help`, `-h` and
# `--help` among them) and the usage text. A `^\s+` pattern also matches the `shard` and `mcp` sub-actions (26 lines).
Select-String -Path geldar.ps1 -Pattern "^\s{2}'[a-z-]+' \{"
./geldar.ps1 help
# Root scripts
(Get-Content package.json | ConvertFrom-Json).scripts
# Tool packages, their descriptions and scripts
foreach ($d in Get-ChildItem tools -Directory) {
  $p = Join-Path $d 'package.json'
  if (Test-Path $p) { $j = Get-Content $p | ConvertFrom-Json; "$($d.Name): $($j.description)"; $j.scripts } else { "$($d.Name): no package.json" }
}
# Tracked files and test files per tool
foreach ($d in Get-ChildItem tools -Directory) {
  $f = git ls-files "tools/$($d.Name)"
  "$($d.Name) files=$($f.Count) tests=$(($f | Where-Object { $_ -match '\.test\.ts$' }).Count)"
}
# Environment variable names a tool's production code reads
git ls-files tools/<name>/src | Where-Object { $_ -notmatch '\.test\.ts$' } |
  ForEach-Object { Select-String -Path $_ -Pattern 'GELDAR_[A-Z0-9_]+|\bPG[A-Z]+\b' -AllMatches } |
  ForEach-Object { $_.Matches.Value } | Sort-Object -Unique
```

`./geldar.ps1 help` only prints text (`Show-Usage`, `geldar.ps1` lines 570 to 599).

## geldar.ps1

The task runner. PowerShell 7 on Windows and Linux (`geldar.ps1` lines 1 to 8). CI runs `pwsh -NoProfile -File ./geldar.ps1 pnpm --version` to prove it runs on Linux (`.github/workflows/ci.yml` line 48).

### Behaviour shared by every command

| Behaviour | Detail | Evidence |
|---|---|---|
| Argument parsing | No `param` block. The first argument is the command; the rest pass through verbatim. A named parameter would make PowerShell read `--out` and `-v` as common parameters. | lines 32 to 36 |
| pnpm shim | When `pnpm` is not on `PATH`, a corepack shim for the version `package.json` pins is created under `node_modules/.corepack-bin` and put on `PATH` for this run, nested calls included. | lines 42 to 54 |
| Steps | `Invoke-Step` prints `==> <name>` and throws `<name> failed (exit N)` on a non-zero exit. | lines 56 to 60 |
| Exit code | The pass-through commands (`pnpm`, `bench`, `adam`, `adam-run`, `glass`, `players`, `mcp-tokens`, `db`) exit with the child's exit code. An unknown command prints the usage to stderr and exits 2. | lines 473 to 474, 484 to 485, 497 to 498, 614, 624, 651, 658 to 662 |
| Environment hygiene | Commands that set variables for a child (`players`, `mcp smoke`, `glass`, `mcp-tokens`, `db`) restore them in `finally`. | lines 505 to 522, 552 to 560, 603 to 613, 634 to 639 |

### Commands

| Command | Arguments | What it runs | Evidence |
|---|---|---|---|
| `help`, `-h`, `--help` | none | Prints the usage text. Also the default when no command is given. | lines 35, 570 to 599, 628 to 630 |
| `setup` | none | `pnpm install --frozen-lockfile` at the repo root. | line 650 |
| `pnpm` | `<args...>` | `pnpm <args>` at the repo root with the pinned pnpm on `PATH`. | line 651 |
| `check` | none | `Invoke-Check`: the steps in [check steps](#check-steps). | lines 143 to 191, 652 |
| `shard` | `<action> <name> [--rcon-host]` | `Invoke-Shard`: see [shard actions](#shard-actions). | lines 429 to 463, 653 |
| `bench` | `[args...]` | `pnpm --dir golem run bench <args>` (the body benchmark, `golem/src/bench/cli.ts`). `--dir`, not `--filter`, keeps the CLI's own exit code. | lines 465 to 477; `golem/package.json` line 8 |
| `adam` | `<subcommand> [args]` | `node tools/adam-cli/src/cli.ts <args>`. See [adam-cli](#adam-cli). | lines 481 to 488, 655 |
| `adam-run` | `<32b\|8b\|smoke> <command> [flags]` | `node tools/adam-run/src/cli.ts <args>`. See [adam-run](#adam-run). | lines 617 to 625, 657 |
| `glass` | `up\|down\|status\|logs` | Sets `GELDAR_GLASS_PG_PASSWORD_FILE` to the Glass database password file (by path; the script never opens it), then `node tools/glass-ctl/src/cli.ts <args>`. See [glass-ctl](#glass-ctl). | lines 601 to 615, 656 |
| `players` | `up\|down\|status\|logs [--player <id>]` | Sets `GELDAR_NATS_URL` to the shard's loopback NATS when unset, then `node tools/players-cli/src/rangers-cli.ts <args>`. See [players-cli](#players-cli). | lines 631 to 640 |
| `mcp` | `up\|down\|status\|logs\|smoke` | `Invoke-Mcp`: see [mcp actions](#mcp-actions). | lines 524 to 565, 649 |
| `mcp-tokens` | `<command...>` | `Invoke-PgNode` with `tools/mcp-tokens/src/cli.ts`. See [mcp-tokens](#mcp-tokens). | lines 641 to 643 |
| `db migrate` | `[args]` | `Invoke-PgNode` with `tools/migrate/src/cli.ts`. Any other `db` action throws. See [migrate](#migrate). | lines 644 to 648 |

`Invoke-PgNode` (lines 505 to 522) sets `PGHOST`, `PGPORT`, `PGUSER` and `PGDATABASE` to the phase0 shard's loopback Postgres defaults when they are unset, and sets `PGPASSWORD` from the shard's Postgres password file when that file exists. It never prints the password and restores all five variables afterwards.

### Check steps

`./geldar.ps1 check` runs these in order and stops at the first failure (`Invoke-Check`, lines 143 to 191).

| # | Step | Command | Evidence |
|---|---|---|---|
| 1 | Colo shard config | `Read-ColoConfig` on `shards/colo.yaml`: known keys only, CPU and memory totals at least the per-service budgets in `compose/colo.yml`, `minecraft_port` exactly 25567, bind address loopback only. Details in the [shard-config](shard-config.md). | lines 69 to 141, 146 to 147 |
| 2 | Lint | `pnpm lint` (`biome ci .`) | line 148; `package.json` |
| 3 | Typecheck | `pnpm typecheck` (`pnpm -r --if-present run typecheck`) | line 149; `package.json` |
| 4 | Test | `pnpm test` (`vitest run`; live tests excluded by `vitest.config.ts`) | line 150 |
| 5 | Repo checks | `pnpm check:repo` ([repo-checks](repo-checks.md)) | line 151 |
| 6 | Generated code | `pnpm check:generated` (each package's `check:generated` script) | line 152 |
| 7 | Compose files alone | `docker compose -f <file> config --quiet` for each `compose/*.yml` except seven overlays (`rcon-host`, `nats-auth`, `nats-auth-mcp`, `colo-public`, `colo-kino`, `colo-kino-session`, `colo-notice`). Not recursive: `compose/opt-in/` is not read here. | lines 153 to 156 |
| 8 | Colo merges | `colo.yml` + `nats-auth.yml`; + `colo-public.yml` with dummy bind and port; `colo.yml` + `colo-kino.yml`; + `colo-kino-session.yml`; `colo.yml` + `nats-auth.yml` + `colo-notice.yml` with a dummy secrets folder in the temp directory. Dummy values are set for the step and removed after. | lines 157 to 179 |
| 9 | Phase0 merges | `phase0.yml` + `rcon-host.yml`; `phase0.yml` + `mcp.yml` + `nats-auth.yml` + `nats-auth-mcp.yml`. | lines 180 to 183 |
| 10 | Plugin build | `./gradlew build --no-daemon` in `plugin/` (`gradlew.bat` on Windows), when `plugin/build.gradle.kts` exists. | lines 184 to 188 |

The compose merges are listed in full in the [compose-stacks](compose-stacks.md).

### Shard actions

`./geldar.ps1 shard <action> <name>` works on `compose/<name>.yml` with the project name `geldar-<name>` (lines 429 to 463). A name with no compose file throws (lines 62 to 67).

| Action | What it does | Evidence |
|---|---|---|
| `secrets` | Creates the shard's three Docker secret files when missing: 32 random URL-safe characters, owner-only (ACL on Windows, mode 600 elsewhere, read back), never overwritten. An empty file is refused. | lines 249 to 298 |
| `nats-auth` | The NATS auth generator: see [below](#nats-auth-generator). | lines 315 to 365 |
| `up` | For `colo`: checks the NATS secret files exist (`Assert-ColoNatsSecrets`) and reads `shards/colo.yaml`. For every shard: refuses unless each plugin jar the compose file mounts is a real file; runs `secrets`; `docker compose build`; `docker compose up -d --wait`; then fails unless Paper logged `Geldar-Core enabled` and Velocity logged `Geldar identity enabled`. `colo` always merges `compose/nats-auth.yml`. | lines 193 to 221, 300 to 313, 440, 445 to 457 |
| `up --rcon-host` | Adds `compose/rcon-host.yml`, which publishes Paper's RCON to the host loopback for host-run tools. Refused for `colo` (decision 0082). | lines 432 to 438 |
| `down` | `docker compose down`; volumes are kept. | line 458 |
| `status` | `docker compose ps`. | line 459 |
| `logs [service]` | `docker compose logs --tail 200 [service]`. | line 460 |

Any other action throws and names the six valid ones (line 461).

### NATS auth generator

`./geldar.ps1 shard nats-auth <name>` writes, when missing and never overwriting: one password file per NATS user, a Thinker hub token file, and the server config `nats-auth.conf`, all in the shard's git-ignored secrets folder and owner-only (lines 315 to 365; decision 0067). The config defines one account, `GELDAR`, with JetStream, and one user per role with publish allow, optional publish deny and subscribe allow lists (lines 345 to 364). For `phase0`, pass `--local` (the local desktop stack, allowed in a git checkout) or `--scratch` (a clean `git archive` export only; refused, with nothing written, when a `.git` entry exists). A checkout run with no flag is refused, also with nothing written; an export with no flag behaves like `--scratch`.

The roles come from `Get-NatsUsers` (lines 367 to 415), the per-user allow lists of decision 0087: `body`, `mind`, `eventsink`, `mcp`, `velocity`, `paper`, `kino`, `deploy`, `supervisor`, `register` and `helper` (the colo table). The phase0 table (scratch stack) adds `seed`, which can only create, inspect and update the two identity KV buckets. Re-derive with:

```powershell
Select-String -Path geldar.ps1 -Pattern '^\s+(\w+) = @\{' | ForEach-Object { $_.Matches.Groups[1].Value }
```

The subject lists are documented in the [nats-subjects](nats-subjects.md) reference and checked by the `nats-auth*` tests in [repo-checks](repo-checks.md#tests-that-check-the-nats-auth-generator). The script's own comment says the lists are untested against a live server (line 318).

### mcp actions

All use `compose/phase0.yml` + `compose/mcp.yml`, project `geldar-phase0`, service `geldar-mcp` (line 492).

| Action | What it does | Evidence |
|---|---|---|
| `up` | Prints a precheck when the MCP's secret files are missing; runs `mcp-tokens init` (never overwrites); builds the image; `up -d --wait geldar-mcp` on 127.0.0.1:8788. On a first start the `geldar_mcp` role stays NOLOGIN until `db migrate --set-role-password` runs; the precheck prints that command. | lines 530 to 542 |
| `down` | `docker compose stop geldar-mcp`; volumes and the shard are kept. | line 543 |
| `status` | Prints `down` when the container is not running, else `ps`. | lines 544 to 547 |
| `logs` | `logs --tail 200 geldar-mcp`. | line 548 |
| `smoke` | Sets `GELDAR_IT=1` and `GELDAR_MCP_LIVE=1`, then runs `threshold/mcp/test/live/stub-client.live.test.ts` with Vitest against the local MCP. | lines 549 to 561 |

### Root package.json scripts

| Script | Command | Run by |
|---|---|---|
| `lint` | `biome ci .` | `check` step 2; CI `typescript` job |
| `format` | `biome check --write .` | By hand only |
| `typecheck` | `pnpm -r --if-present run typecheck` | `check` step 3; CI |
| `test` | `vitest run` | `check` step 4; CI |
| `check:repo` | `node tools/repo-checks/src/cli.ts` | `check` step 5; CI |
| `check:generated` | `pnpm -r --if-present run check:generated` | `check` step 6; CI |

Evidence: `package.json` `scripts`; `.github/workflows/ci.yml` lines 36 to 46.

## Tool packages

Fourteen folders under `tools/`, measured at `1b114276` on 2026-11-16. Thirteen are pnpm workspace packages; `tools/admin` has no `package.json`. "Tests" counts tracked `*.test.ts` files; every package's tests also run in the shared root `pnpm test` (`vitest.config.ts`).

| Tool | Purpose (from `package.json` description unless noted) | Entry | Run with | Files | Tests |
|---|---|---|---|---|---|
| [adam-cli](#adam-cli) | Logic behind `./geldar.ps1 adam`: model pins, digests, life selection, host process control | `src/cli.ts` | `./geldar.ps1 adam` | 19 | 8 |
| [adam-report](#adam-report) | Adam run report from one life in Postgres, read-only | `src/cli.ts` | `node tools/adam-report/src/cli.ts` | 37 | 19 |
| [adam-run](#adam-run) | Adam run protocol: manifest, sampling, abort rules, safe stop | `src/cli.ts` | `./geldar.ps1 adam-run` | 37 | 16 |
| [admin](#admin) | One-shot admin container entrypoint (purpose from `tools/admin/admin.sh` header; decision 0133) | `admin.sh` | The admin image | 3 | 0 |
| [genesis-env](#genesis-env) | Validates `envs/*.yaml` against the schema | `src/cli.ts` | `pnpm --filter @geldar/genesis-env validate` | 7 | 1 |
| [glass-ctl](#glass-ctl) | Logic behind `./geldar.ps1 glass` | `src/cli.ts` | `./geldar.ps1 glass` | 9 | 2 |
| [kino-shot](#kino-shot) | Developer tool: screenshots of a Kino page in headless Chromium | `src/cli.ts` | `pnpm --filter @geldar/kino-shot shot` | 6 | 1 |
| [mcp-tokens](#mcp-tokens) | Owners, sovereign players and their hashed Bearer tokens (spec 5.15.5) | `src/cli.ts` | `./geldar.ps1 mcp-tokens` | 36 | 21 |
| [migrate](#migrate) | Applies `sql/[0-9]*.sql` in order, records them in `schema_migrations` | `src/cli.ts` | `./geldar.ps1 db migrate` | 10 | 5 |
| [players-cli](#players-cli) | Logic behind `./geldar.ps1 players`; also the skin CLI | `src/rangers-cli.ts`, `src/cli.ts` | `./geldar.ps1 players`; `node tools/players-cli/src/cli.ts skin ...` | 31 | 14 |
| [portscan](#portscan) | External TCP port scan against an expected list (0071, 0072) | `src/cli.ts` | `pnpm --filter @geldar/portscan scan` | 14 | 4 |
| [progress-metrics](#progress-metrics) | Operator-only progress metrics per agent and window, from files | `src/cli.ts`, `sample.sh`, `export-glass.ts` | `pnpm --filter @geldar/progress-metrics report` | 22 | 3 |
| [psyche-release](#psyche-release) | The psyche release record (tree hash and `psyche/RELEASE.json`) | `src/cli.ts` | `node tools/psyche-release/src/cli.ts` | 9 | 1 |
| repo-checks | Repo hygiene gates for CI and `check` | `src/cli.ts` | `./geldar.ps1 pnpm check:repo` | 77 | 51 |

`repo-checks` is documented in its own page: [repo-checks](repo-checks.md).

### adam-cli

- **Entry:** `tools/adam-cli/src/cli.ts`; exit 0 done, 1 refusal or failure, 2 bad usage (header, lines 1 to 5).
- **Subcommands** (usage line 45, dispatch lines 289 to 315):

| Subcommand | Flags | What it does |
|---|---|---|
| `up` | `[--model strong\|fast]` | Refuses when Adam already runs. Reads the repo `.env` and the shard file, checks the shard's compose services are healthy, asks Ollama for its models, compares them with the pins and the tier's tags, rewrites the life lines when `--model` is given, then starts the host processes (lines 118 to 150). |
| `select` | `--model strong\|fast\|smoke` | Rewrites the life lines of the shard file only; checks nothing and starts nothing (lines 97 to 101). |
| `down` | none | Stops the services (the Body last), then retires the selected life: its registry key and Paper whitelist entry go (`src/retire.ts` header). |
| `status` | none | Each service's state and the last thought's latency. |
| `logs` | `[body\|animus\|lantern-local] [--follow]` | Tails the logs; `--follow` with one service follows it. |
| `models` | `[--record]` | Lists the pinned models, their presence in Ollama and digests; `--record` writes the digests into the shard file. |
| `restart-body` | none | Ends only the Body (checked by its owner record) and starts a fresh one with the environment `up` gives it; the other services keep running (lines 262 to 285). |

- **Environment (names):** `GELDAR_SHARD` (selects `shards/<name>.yaml`, default `phase0`), `OLLAMA_URL`, `GELDAR_MC_HOST`, `GELDAR_MC_PORT`, `GELDAR_MIND_WS_URL`, `GELDAR_NATS_URL`. Values may come from the repo `.env` (`runEnv`, lines 53 to 60); `loopbackProblems` refuses non-loopback values (`src/env.ts`).
- **Writes:** PID files and logs under `.geldar/adam/` (git-ignored; `src/run.ts` lines 2 and 26); the shard file (`select`, `up --model`, `models --record`).
- **Changes shared state:** yes. `up` starts a Body that joins the shard; `down` removes the life's registry key and whitelist entry.

### adam-report

- **Entry:** `tools/adam-report/src/cli.ts`. Exit 0 when the report is written (verdicts are inside it), 1 read or write failure, 2 usage (line 106).
- **Usage** (line 11): `adam-report --life <id> --from <iso> --to <iso> --manifest <file> --out <dir> [--criteria <file>] [--format md|json|both]`. `--format` defaults to `both`; `--criteria` defaults to `tools/adam-report/criteria.yaml`; an `--out` inside `.git` is a usage error (lines 49 to 84).
- **Environment (names):** `GELDAR_REPORT_DB_USER`, `GELDAR_REPORT_DB_PASSWORD`, `GELDAR_REPORT_DB_PASSWORD_FILE`.
- **Writes:** `run-report.json` and `run-report.md` in `--out`. Reads Postgres in a read-only transaction (`package.json` description).

### adam-run

- **Entry:** `tools/adam-run/src/cli.ts`. Exit 0 done, 1 refused or failed, 2 usage (line 227).
- **Usage** (lines 44 to 46): `adam-run <32b|8b|smoke> <start|status|stop|report|prepare-volume> [--run-id <id>] [--hours <n>] [--restart-at-hours <n>] [--body-kill-after-minutes <n>] [--dry-run]`.

| Argument | Rule (lines 47 to 125) |
|---|---|
| Profile | `32b`, `8b` or `smoke`. Default hours: 3, 3 and 0.5. |
| `start` | Runs the sequence in the foreground (`src/sequence.ts`): precheck, manifest, `adam up`, one sample a minute, the planned restart, one Body kill mid-intent, the end, then the report. An abort rule runs the safe stop. Writes `run.pid.json`. |
| `status`, `report` | Read the run folder. |
| `stop` | Writes a stop request for a live run, or runs the safe stop when no live run owns the folder (header, lines 1 to 5). |
| `prepare-volume` | Creates a new, empty, compose-labelled world volume and records its name in the run manifest; never deletes or reuses one (`src/world-volume.ts`). Refused for `smoke`. |
| `--run-id` | Letters, digits, dot, dash, underscore; up to 81 characters. |
| `--hours`, `--restart-at-hours` | Positive numbers; the restart must fall before the end. |
| `--body-kill-after-minutes` | Zero or more. |
| `--dry-run` | `start` only. |

- **Preconditions** (`src/preconditions.ts`, `src/bench-gate.ts`, `src/shard-edit.ts`): no change to `shards/phase0.yaml` beyond the three keys `adam select` writes; git facts; the newest `bench-results/*.json` is a complete run at HEAD with every 20 TPS row at 100%; the pins; Ollama; a prepared world volume.
- **Environment (names):** `GELDAR_GLASS_PG_DB`, `GELDAR_GLASS_PG_PORT`, `GELDAR_GLASS_PG_PASSWORD_FILE`, `GELDAR_REPORT_DB_USER`, `GELDAR_REPORT_DB_PASSWORD_FILE`, `GELDAR_WORLD_VOLUME`.
- **Writes:** the run folder `.geldar/runs/<run-id>` (header line 2); a Docker volume (`prepare-volume`).
- **Changes shared state:** yes. It starts and stops Adam, restarts the stack and kills the Body during a run.

### admin

- **Entry:** `tools/admin/admin.sh`, the entrypoint of the admin image built from `tools/admin/Dockerfile` (decision 0133). No `package.json`.
- **Subcommands** (usage lines 9 to 18, dispatch lines 24 to 74): `migrate`, `owner-add`, `owner-set-cap`, `owner-admin`, `player-add`, `player-flags`, `token-mint`, `token-revoke`, `players-status`, `roster`, `skin-import`, `ensure-skins-bucket`, `whitelist-house-body`, and `notice <payload-json>`. Each runs one existing CLI (`tools/migrate`, `tools/mcp-tokens`, `tools/players-cli`, or a `golem/src` script) with its arguments passed through. `notice` publishes one maintenance notice as the deploy NATS user and reads no Postgres password.
- **Environment (names):** `GELDAR_ADMIN_PG_PASSWORD_FILE` (the Postgres password file, read into `PGPASSWORD` for this process only), `PGHOST`, `PGUSER`, `PGDATABASE` (lines 7, 54 to 57).
- **Run by:** `deploy/colo-admin.sh` on the node, as a one-shot `docker compose ... --profile admin run --rm --no-deps admin <cmd>` (`deploy/colo-admin.sh` lines 2 to 10 and 316 to 361). See the [admin-service](admin-service.md) and [deploy-scripts](deploy-scripts.md).
- **Tests:** none in the folder; the image closure is checked by `tools/repo-checks/src/admin-image.test.ts`.

### genesis-env

- **Entry:** `tools/genesis-env/src/cli.ts`; script `validate`.
- **What it does:** validates every `envs/*.yaml` against `envs/environment.schema.json`; the rules (`src/validate.ts`, `src/leak-scan.ts`) refuse secret-shaped values, account names and addresses. Exit 0 when all validate; 1 when one fails or no file exists (header, lines 1 to 5).
- **Flags and environment:** none.
- **Also a gate:** the same rules run in `pnpm check:repo` ([env-definitions](repo-checks.md#gates-in-pnpm-checkrepo)).

### glass-ctl

- **Entry:** `tools/glass-ctl/src/cli.ts <up|down|status|logs>`, run by `./geldar.ps1 glass`.
- **What it does:** runs the Glass server (the human viewing surface for thoughts, spec section 3) as one detached Node process bound to 127.0.0.1, with a PID file; `status` probes the thoughts API on loopback (`src/glass-ctl.ts` header; `geldar.ps1` line 27).
- **Environment (names):** `GELDAR_GLASS_PG_PASSWORD_FILE` (set by `geldar.ps1`; the tool passes the path and never opens the file), `GELDAR_GLASS_HOST` (anything but loopback is refused), `GELDAR_GLASS_PORT`.
- **Writes:** logs and the PID file under `.geldar/glass/` (`src/glass-ctl.ts` line 29).

### kino-shot

- **Entry:** `tools/kino-shot/src/cli.ts`; script `shot`. `pnpm --filter @geldar/kino-shot browsers` downloads Chromium as a separate, explicit step (`package.json`).
- **What it does:** one anonymous page load of a Kino page in headless Chromium; saves screenshots and evidence (header). No login and no stored cookies.
- **Flags** (`src/args.ts`): `--url` (https, or http on a local host only; no credentials in the URL), `--agent`, `--mode follow|orbit|free` (default `follow`), `--seconds 1..300` (default 25), `--viewport <W>x<H>` (each side 200 to 4000), `--out` (default `.claude/kino-shots`).
- **Environment (names):** `KINO_URL` (used when `--url` is absent), `INIT_CWD`.

### mcp-tokens

- **Entry:** `tools/mcp-tokens/src/cli.ts`, run by `./geldar.ps1 mcp-tokens` (which sets the `PG*` variables) and by the admin image.
- **Commands** (usage text, lines 62 to 94):

| Command | Arguments and flags |
|---|---|
| `init` | `[--force --i-understand]`: create the token pepper and the Postgres password files; `--force` needs `--i-understand` (lines 131 to 137) |
| `owner add` | `<id> [--cap N]` |
| `owner set-cap` | `<id> <N>` |
| `owner admin` | `set\|unset <id>`, or `list` |
| `identity ban` | `<id>`, or `--provider microsoft\|github\|discord --user-id <id> [--pepper-file <f>]` (decision 0136) |
| `identity unban` | `<id>` |
| `admin grant\|revoke` | `<id>`, or `--provider microsoft --user-id <id> [--pepper-file <f>]` |
| `player add` | `<id> --owner <o> --life <ag_name_NN> --name <n> --harness <h> [--model <text>] [--identity-file <f> [--goals-file <f>]] [--allow-meta] [--sheet-file <f>]` |
| `player set-model` | `<id> --model <text>` |
| `player pause\|resume\|retire` | `<id>` |
| `player flags` | `<id>` with one or both of the player's two public-visibility flags (names in the usage text) |
| `roster add\|remove` | `<name> --owner <o> [--max N]` (N 1 to 4) |
| `roster list` | `[--owner <o>]` |
| `roster seed` | `--owner <o> --from <shard file>` |
| `persona export` | `<character> --out <dir> [--dry-run] [--allow-meta]` |
| `token mint` | `<player> --out <file>` |
| `token list` | `[--player <id>]` |
| `token revoke` | `<tk_id>`, or `--player <id> --all` |
| `token rotate` | `<player> --out <file> [--grace-minutes N]` |

- **Output:** never contains a token (usage text). `token mint` and `token rotate` write the token into a file only the caller can read, as the variable `GELDAR_MCP_TOKEN` (`src/tokens.ts` line 25).
- **Persona lint:** `player add` and `persona export` refuse a persona the lint marks unless `--allow-meta` is given, which keeps it with a warning (`src/players.ts` lines 186 to 189, `src/cli.ts` lines 332 to 336, `src/persona-export.ts` line 6; lint in `src/persona-lint.ts`, decision 0068; see [repo-checks](repo-checks.md#related-gates-outside-toolsrepo-checks)).
- **Environment (names):** `PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE`, `PGPASSWORD`; `GELDAR_SHARD_FILE` (another shard file; a missing named file is refused); `REGISTER_PEPPER_FILE` (default for `--pepper-file`); `USERNAME` (Windows ACL step).
- **Changes shared state:** yes. Writes the database; `init` writes secret files in the shard's git-ignored secrets folder.

### migrate

- **Entry:** `tools/migrate/src/cli.ts`, run by `./geldar.ps1 db migrate` and by the admin image.
- **Usage** (lines 6 to 9): `[--dry-run] [--sql-dir <dir>]`, or `--set-role-password <role> --password-file <file>`. The two password flags need each other (lines 37 to 42). `--sql-dir` defaults to `sql/`.
- **What it does:** applies the `sql/NNNN_*.sql` files not yet in `schema_migrations`; with `--set-role-password`, first tries the role's own login with the file's password and only then decides whether to alter it (lines 50 to 60).
- **Environment (names):** `PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE`, `PGPASSWORD`.
- **Changes shared state:** yes, the database (except with `--dry-run`).

### players-cli

Two entry points.

**`src/rangers-cli.ts`**, run by `./geldar.ps1 players` (usage lines 46 to 54):

| Verb | What it does |
|---|---|
| `up [--player <id>]` | Starts one detached Body process per sovereign ranger (or the one named); a running ranger is left alone. |
| `down [--player <id>]` | Stops the named ranger's Body, or all. |
| `status` | Each ranger's process (PID, resident memory) and its presence record; `down` when none runs. |
| `logs [--player <id>]` | The last 200 lines of each ranger's log. |

PID files and logs live under `.geldar/players/` (git-ignored; header).

**`src/cli.ts`**, the skin CLI (usage lines 32 to 47): `skin set <player-id> <png> [--model classic|slim] [--check-only] [--visibility unlisted|public] [--confirm-public] [--export-json <path>] [--no-store]`, `skin show`, `skin heads --skins-dir <dir> --out-dir <dir> [--map overworld]` (script `heads`), `skin import <player-id> <json>`. `skin set` validates the PNG, signs it with MineSkin and stores the signed texture in the `geldar-skins` bucket; `--check-only` makes no network call.

- **Environment (names):** `GELDAR_NATS_URL`, `GELDAR_SHARD`, `GELDAR_SHARD_FILE`. The MineSkin key is a git-ignored secret file held by the owner, read and never printed (`src/cli.ts`).
- **Changes shared state:** yes. `up` starts Bodies on the shard; `skin set` and `skin import` write the NATS bucket; `skin set` calls MineSkin.

### portscan

- **Entry:** `tools/portscan/src/cli.ts`; script `scan`. Full reference in `tools/portscan/README.md`.
- **Usage:** `--target <host> --expected <file> [--range LOW-HIGH] [--concurrency N] [--per-second N] [--attempts N] [--timeout-ms N]`. `--target` has no default. Defaults: concurrency 64, 200 starts a second, 2 attempts, 1000 ms.
- **Output:** a JSON report on stdout with a `pass` or `fail` verdict: pass only when the open set equals the expected list. Exit 0 pass, 1 fail, 2 usage or I/O error.
- **Network:** opens TCP connections to the target. Its tests use a fake connector and never open a socket (README).

### progress-metrics

- **Entry:** `tools/progress-metrics/src/cli.ts`; script `report`. Reads files only; Markdown to stdout. How to use it: [progress-metrics runbook](../runbooks/progress-metrics.md).
- **Flags** (usage, `src/cli.ts`): `--paper <file|->`, `--date YYYY-MM-DD`, `--body <file|glob>` (repeats), `--outcomes <file|glob>` (repeats), `--agent <id>`, `--since <iso>`, `--until <iso>`, `--windows <json file>`, `--min-events N`, `--positions <csv>`, `--inventory <csv>`, `--thoughts <json>`, `--window-minutes N`, `--csv <out file>`. `--windows` and `--window-minutes` cannot be combined.
- **Helpers:** `sample.sh <pos|inventory> <interval-seconds> <out-file> <agent>...` samples positions or inventory over RCON with read-only `data get` commands and never changes the world; `RCON_CMD` overrides the command. `export-glass.ts --out <file> [--count N] [--base URL] [--agent <life id>]` pages the Glass thoughts API, read only.
- **Audience:** operator-only (`package.json` description).

### psyche-release

- **Entry:** `tools/psyche-release/src/cli.ts --write | --check` (header). `--write` regenerates `psyche/RELEASE.json`; `--check` exits 1 when the committed record differs from the one rendered now.
- **Gate:** `tools/psyche-release/src/release.test.ts` runs the `--check` gate on the committed record (line 69), so `pnpm test` fails when `psyche/src` changes without a new record. See `psyche/README.md` lines 11 to 18 and decision 0281.

### Body benchmark and live tests

Not under `tools/`, but run through the same runner.

- `./geldar.ps1 bench` runs `golem/src/bench/cli.ts`: `[--scenario <name|all>] [--tps <1-20>]... [--runs <1-100>] [--max-minutes <n>] [--record] [--allow-dirty] [--note <text>] [--dry-run] [--list] [--restore]` (lines 29 to 31). Default TPS set is 20, 10 and 5. `--record` refuses a dirty tree unless `--allow-dirty` (lines 116 to 119). Procedure: the `body-bench` skill ([skills-and-agents](skills-and-agents.md)).
- `./geldar.ps1 pnpm --filter @geldar/golem test:live` runs the live tests against a running shard (`CLAUDE.md`).

## Commands that change shared state

`CLAUDE.md` says `bench` and `test:live` mutate the shard (tick rate, whitelist, world) and must run alone, one at a time. From the sources above:

| Changes | Commands |
|---|---|
| Local only (no shard, database or network) | `help`, `check` (writes Gradle build output and a dummy file in the temp folder), `genesis-env`, `psyche-release --check`, `adam-report` (database read-only), `progress-metrics report`, `adam select` (local shard file only), `players-cli skin set --check-only` |
| Shard and world | `bench`, `test:live`, `adam up`, `adam down`, `adam restart-body`, `adam-run start`, `players up`, `players down`, `shard up`, `shard down` |
| Database | `mcp-tokens` commands that add, change, ban, revoke or rotate (the `list` commands only read), `db migrate`, admin `migrate`, admin `owner-*`, `player-*`, `token-*`, `roster` |
| NATS buckets | `players-cli skin set`, `skin import`, admin `ensure-skins-bucket` |
| NATS subjects | admin `notice` (publishes the maintenance notice on a subject, `deploy/colo-notice.sh` lines 2, 87) |
| Local secret files | `shard secrets`, `shard nats-auth`, `mcp-tokens init`, `mcp up` |
| Network beyond loopback | `portscan scan`, `kino-shot` (to its URL), `players-cli skin set` (MineSkin) |

## Conflicts recorded

Recorded, not resolved (persona rule 8).

1. **`adam` subcommands.** The `geldar.ps1` usage (lines 21 and 587) lists `adam select --model strong|fast`. `tools/adam-cli/src/cli.ts` also accepts `--model smoke` (lines 2, 45, 97 to 101) and a `restart-body` subcommand (lines 262 to 285, 312) that the `geldar.ps1` usage does not list.
2. **`db migrate` flags.** The `geldar.ps1` usage (lines 30 and 596) lists `db migrate [--dry-run]`. `tools/migrate/src/cli.ts` also takes `--sql-dir`, `--set-role-password` and `--password-file` (lines 6 to 9), and `geldar.ps1` itself prints a `--set-role-password` command in the `mcp up` precheck (line 536).
3. **"Every check CI runs".** The `geldar.ps1` usage (line 12) and `CLAUDE.md` describe `check` as everything CI runs. `.github/workflows/ci.yml` also has the jobs `sql` (line 136), `images` (line 180) and `integration` (line 210), and the Caddy validate and adapt steps (lines 122 to 134), none of which `Invoke-Check` runs. In the other direction, `Invoke-Check` reads `shards/colo.yaml` first, a step the CI `typescript` job does not have; `tools/repo-checks/src/colo-config.test.ts` runs `Read-ColoConfig` inside `pnpm test` when pwsh is on `PATH`.
4. **Overlay list.** The comment above the compose loop in `Invoke-Check` (line 153) names three overlays; the filter on the next line excludes seven. `tools/repo-checks/src/nats-auth-fixtures.ts` names four as `OVERLAYS`.
5. **Step name.** `Invoke-Check` and `ci.yml` name the repo-check step "repo checks (line caps, line endings, control characters)" (`geldar.ps1` line 151, `ci.yml` line 43); the gate runs 14 gates from 15 modules ([repo-checks](repo-checks.md#gates-in-pnpm-checkrepo)).
6. **Command list in repo layout.** [repo-layout](repo-layout.md#root-files) lists the `geldar.ps1` commands without `help`. The dispatch switch has it (line 628).

## Related

- [repo-checks](repo-checks.md): every gate behind `pnpm check:repo` and the gate tests.
- Other references: [ci-workflows](ci-workflows.md), [shard-config](shard-config.md), [compose-stacks](compose-stacks.md), [environment-variables](environment-variables.md), [nats-subjects](nats-subjects.md), [deploy-scripts](deploy-scripts.md), [admin-service](admin-service.md), [skills-and-agents](skills-and-agents.md).
- How-tos: [progress-metrics](../runbooks/progress-metrics.md), [mcp-tokens](../runbooks/mcp-tokens.md).
- [Doc-update map](../agents/doc-update-map.md): what to update when a tool is added or removed.
