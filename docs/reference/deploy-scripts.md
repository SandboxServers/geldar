---
title: Deploy scripts
type: reference
audience: operators
status: draft
last_verified: 2026-11-16 against 1b114276
companions: [../runbooks/colo-deploy.md, ../runbooks/node-only-config.md, ../runbooks/body-helper-node-steps.md, ../runbooks/scratch-stack.md, ../runbooks/maintenance-notice.md, ../../deploy/README.md, ci-workflows.md, compose-stacks.md, environment-variables.md, admin-service.md, ../architecture/deployment-topology-colo.md, ../security/secrets-by-role.md]
sources: [deploy/common.sh, deploy/colo-up.sh, deploy/colo-rollback.sh, deploy/colo-down.sh, deploy/colo-status.sh, deploy/colo-cd.sh, deploy/colo-cd-plan.sh, deploy/colo-cd-verify.sh, deploy/colo-cd-players.sh, deploy/colo-notice.sh, deploy/colo-admin.sh, deploy/colo-public.sh, deploy/gen-secrets.sh, deploy/install-body-helper.sh, deploy/caddy, deploy/genesis, deploy/scratch/scratch.sh, deploy/release.env.example, deploy/compose.secrets.yml, deploy/body-helper-node.env, deploy/test, deploy/README.md, compose/colo.yml, .github/workflows/colo-deploy.yml, .github/workflows/colo-images.yml, .github/workflows/plugin-jars.yml, .github/workflows/body-helper-bundle.yml, .github/workflows/ci.yml, docs/runbooks/colo-deploy.md, ../decisions/0084-colo-deploy-by-pull-with-a-project-scoped-script.md, ../decisions/0071-public-endpoints-and-ports.md, compose/colo-notice.yml, compose/colo-public.yml, compose/nats-auth.yml, compose/opt-in/scratch.yml, compose/phase0.yml, contract/schemas/maintenance-notice.schema.json, docs/runbooks/kino.md, shards/colo-mind.yaml, sql/0034_operator_player_flags.sql, tools/admin/admin.sh, tools/repo-checks/src/caddy-adapt.test.ts, tools/repo-checks/src/colo-images.test.ts, tools/repo-checks/src/scratch-overlay.test.ts]
---

# Deploy scripts

Every script and data file under `deploy/`: what it does, how you call it, what it reads, what it changes on the node, how it fails and how you undo it. For the steps of a deploy, read the [Colo deploy runbook](../runbooks/colo-deploy.md) and [`deploy/README.md`](../../deploy/README.md). For the workflows that call these scripts, read [CI workflows](ci-workflows.md). For the compose files they merge, read the [compose stacks](compose-stacks.md) reference; for every environment variable by name, the [environment variables](environment-variables.md) reference.

All facts below were read from the files at commit `1b114276` on 2026-11-16. No script was run. Node state (what is installed, which files exist, which release runs) is not checked here (plan decision D8).

Secrets appear by role only. Where a script has a default path for a secret or state directory, this page names the variable and the line that sets the default, not the path.

## Common rules

These hold for every Colo script that sources `deploy/common.sh` (`colo-up`, `colo-rollback`, `colo-down`, `colo-status`, `colo-cd`, `colo-notice`, `colo-admin`, `colo-public`, `gen-secrets`).

| Rule | Evidence |
|---|---|
| POSIX `sh` (dash on Debian 12, bash in tests). `colo-public.sh` is bash. | `common.sh` line 3; `colo-public.sh` line 1 |
| Every compose call names the project, default `geldar-colo` (`GELDAR_PROJECT`), so it reaches only that project's containers, networks and volumes. | `common.sh` lines 6, 56 to 70; decision [0084](../decisions/0084-colo-deploy-by-pull-with-a-project-scoped-script.md) item 2 |
| Every compose call merges `compose/colo.yml`, then `compose/nats-auth.yml`, then `deploy/compose.secrets.yml`; then `compose/colo-public.yml` when the public port is set, then `GELDAR_COLO_EXTRA_OVERLAY` when set. The secrets overlay comes after the NATS overlay so its paths win. | `common.sh` lines 10 to 15, 57 to 70 |
| `DEPLOY_DRY_RUN=1` runs the read-only checks and prints each state-changing step as `dry-run, not run: ...`. | `common.sh` lines 25, 47 to 54 |
| A refusal prints `colo: error: <reason>` and exits 1. | `common.sh` `die`, lines 34 to 37 |
| Not every script checks the uid. `colo-up.sh`, `colo-rollback.sh`, `colo-cd.sh` and `colo-admin.sh` call `check_prereqs`, which refuses to run as uid 0 and refuses `GELDAR_SERVICE_UID` 0 or non-numeric. `colo-down.sh`, `colo-status.sh`, `colo-notice.sh` and `colo-public.sh` make no uid check. `gen-secrets.sh` has its own check: it runs as root or as the `GELDAR_SERVICE_UID` account and refuses any other. | `common.sh` `check_service_uid`, lines 115 to 122, called by `check_prereqs` (line 125); callers: `colo-up.sh` line 14, `colo-rollback.sh` line 12, `colo-cd.sh` line 300, `colo-admin.sh` line 278 (`grep -n check_prereqs deploy/*.sh`, 2026-11-16); `gen-secrets.sh` lines 18 to 26 |
| No Colo script removes a volume or runs `down`. | decision 0084 item 3; `colo-down.sh` line 9 runs `stop`. `deploy/scratch/scratch.sh` does run `down -v`, on its own `scratch-<suffix>` project only (see [scratch stack](#scratch-stack)). |

## Script index

Re-derive with `git ls-files 'deploy/*.sh'` (18 scripts at 1b114276; a git pathspec `*` also matches across `/`).

| Script | One line | Runs where | Called by |
|---|---|---|---|
| `deploy/common.sh` | Shared settings and checks; sourced, never run alone | node | every `colo-*.sh`, `gen-secrets.sh` |
| `deploy/colo-up.sh` | Full deploy by pull of the recorded release | node, operator account | operator; `deploy/README.md` "First deploy" |
| `deploy/colo-rollback.sh` | Re-applies the previous recorded release, no pull | node | operator; [colo-deploy runbook](../runbooks/colo-deploy.md#rollback) |
| `deploy/colo-down.sh` | Stops the project; keeps everything | node | operator |
| `deploy/colo-status.sh` | Read-only status: containers, ports, one stats sample | node | operator |
| `deploy/colo-cd.sh` | Delta deploy of one main commit (CD-2a) | node, operator account, via the deploy entrypoint | `colo-deploy.yml` through the node's root-owned entrypoint |
| `deploy/colo-cd-plan.sh` | Read-only delta between two releases | node | `colo-cd.sh` line 319 |
| `deploy/colo-cd-verify.sh` | Image prefix and revision-label check; functions only | node | sourced by `colo-cd.sh` line 28 |
| `deploy/colo-cd-players.sh` | Per-player host helpers; functions only | node | sourced by `colo-cd.sh` line 29 and `colo-cd-plan.sh` line 57 |
| `deploy/colo-notice.sh` | Publishes one maintenance notice | node | `colo-cd.sh` `notice`; operator |
| `deploy/colo-admin.sh` | One admin subcommand in the one-shot admin container | node | `colo-up.sh`, `colo-cd.sh`, `colo-cd-players.sh`; operator |
| `deploy/colo-public.sh` | Installs, switches and removes the public Caddy sites | node, account that can write the Caddyfile | operator |
| `deploy/gen-secrets.sh` | Creates missing generated secret files | node, root or the service uid | operator |
| `deploy/install-body-helper.sh` | Installs the body helper as a systemd unit (dry run by default) | node, root for `--apply` | operator; [body-helper node steps](../runbooks/body-helper-node-steps.md) |
| `deploy/caddy/validate.sh` | Validates the Caddy site files in the pinned Caddy image | desktop or CI | `ci.yml` job `compose` line 124 |
| `deploy/genesis/build-config-bundle.sh` | Builds the deterministic Colo config bundle | desktop or CI | operator; `deploy/test/genesis-config-bundle.test.ts` |
| `deploy/genesis/verify-plugin-jars.sh` | Checks the two plugin jars against `plugin-jars.sha256` | CI or node | `plugin-jars.yml` line 53 |
| `deploy/scratch/scratch.sh` | Throwaway scratch stack for the sheet campaign | desktop or node | operator; [scratch stack runbook](../runbooks/scratch-stack.md) |

## Data files

Re-derive with `git ls-files deploy ':!deploy/*.sh' ':!deploy/test'` (12 files at 1b114276).

| File | What it is | Read by |
|---|---|---|
| `deploy/release.env.example` | Template of the release manifest: seven `*_IMAGE=` lines with placeholder digest references. Only `KEY=VALUE` lines are read; nothing is sourced. | Copied by hand on a first deploy (`deploy/README.md` (d)); the CI test `tools/repo-checks/src/colo-images.test.ts` keeps it in step with the seven keys `colo-images.yml` writes |
| `deploy/compose.secrets.yml` | Overlay that points each compose secret name at a file in `GELDAR_SECRETS_DIR` instead of the repo's git-ignored dev secrets folder. Not used by the local stack. | `common.sh` `dc`, line 9 |
| `deploy/body-helper-node.env` | The pinned Node runtime for the body helper: `BODY_HELPER_NODE_VERSION`, `BODY_HELPER_NODE_TARBALL`, `BODY_HELPER_NODE_SHA256_LINUX_X64` (public digest). | `install-body-helper.sh`; `body-helper-bundle.yml` line 104; `deploy/test/body-helper-artifacts.test.ts` |
| `deploy/genesis/config-bundle.list` | Allowlist of repo paths packed into the config bundle, one per line. Lists no secret, `*.env`, `*.pem`, `nats-auth.conf` or `node.env` (its header, lines 11 to 13). | `build-config-bundle.sh`; `deploy/test/genesis-config-bundle.test.ts` compares the archive names with it |
| `deploy/caddy/<site>.caddy`, `<site>-off.caddy` | Live and kill-switch Caddy site files for `map`, `glass`, `mcp`, with `{$GELDAR_*}` placeholders. | `colo-public.sh` renders them; `validate.sh`; `tools/repo-checks/src/caddy-adapt.test.ts`, `caddy-snippets.test.ts` |
| `deploy/caddy/README.md` | Rules each site keeps and the reload and kill procedures. | Operators |
| `deploy/README.md` | The deploy runbook for the scripts. Not metadata-tagged. | Operators |

## Tests outside one script

`deploy/test/` holds 37 tracked files at `1b114276` (`git ls-files deploy/test`): Vitest tests, four fixture modules (`colo-admin-fixture.ts`, `colo-cd-fixture.ts`, `colo-deploy-fixture.ts`, `install-body-helper-fixture.ts`) and two fixture configs under `fixtures/`. They run in `pnpm test` on the desktop and in CI; the scripts themselves run on Linux (`deploy/README.md` line 8). Each script section below names its tests. Three test files cover something other than a `deploy/` script:

| Test | Covers |
|---|---|
| `deploy/test/colo-fetch-manifest.test.ts` | The "download the release manifest" step of `.github/workflows/colo-deploy.yml`, run under bash with a fake `curl` |
| `deploy/test/admin-entrypoint.test.ts` | `tools/admin/admin.sh`, the admin image entrypoint |
| `deploy/test/kino-deploy.test.ts` | Kino wiring across `compose/colo.yml`, its overlays and `deploy/caddy/glass.caddy`, and the secret-value gate on `docs/runbooks/kino.md` |

## common.sh functions

Re-derive with `git grep -nE '^[a-z_0-9]+\(\) \{' -- deploy/common.sh` (26 functions at `1b114276`; the digit class matters for `check_lock_sha512`).

| Function | What it does | Side effects |
|---|---|---|
| `die`, `say`, `need` | Print an error and exit 1; print a line; refuse a missing command | none |
| `act` | Run a command, or print it in dry-run mode | the wrapped command |
| `dc` | `docker compose -p <project>` with the overlay chain above | the compose call |
| `public_overlay` | Sets `PUBLIC_OVERLAY` to `compose/colo-public.yml` when both `GELDAR_MC_BIND` and `GELDAR_MC_PORT` are set. Refuses exactly one set, a wildcard or non-IPv4 bind, a port outside 1 to 65535, and 25565 or 25566 (decision [0082](../decisions/0082-colo-compose-network-and-limits.md)). | none |
| `plan_header` | Prints the project, compose chain, and the role of each directory | none |
| `check_service_uid`, `check_prereqs` | Uid rules; docker and Compose v2 present, daemon reachable; compose, secrets and NATS overlays present; free disk on the checkout above `GELDAR_MIN_FREE_KB` (default 10 GiB, line 21) | none |
| `merged_config` | Writes `docker compose config` once to a temp file | temp file only |
| `secret_sources`, `inside_secrets_dir`, `check_secret`, `check_secrets` | Reads every top-level secret the merged config declares and checks each file: exists, resolves inside the secrets directory (or the repo's git-ignored dev secrets folder, `inside_secrets_dir`), regular, non-empty, mode 0600 or 0400, owned by `GELDAR_SERVICE_UID`. Also checks a bind-mounted NATS auth config. Never reads contents. | none |
| `check_jar_sources` | Refuses when a plugin jar bind-mount source is a directory (Docker creates one when the jar was missing) | none |
| `load_release` | Reads a manifest as data; each line must be `*_IMAGE=<name>@sha256:<64 hex>`; refuses `latest`, tags and an empty manifest; exports each key | environment only |
| `check_merged_config` | Refuses a merged config that publishes 25565 or 25566, has an image not pinned by digest, or has a service with `build:` and no `image:` | none |
| `fetch_bluemap`, `fetch_chunky`, `fetch_coreprotect` | Download the jar named in `plugins/<name>/<name>.lock.json` (https only; `file://` only with `GELDAR_DEPLOY_ALLOW_FILE_URL=1` in tests), check sha256 (and sha512 when the lock has one), store it under the state directory. A missing lock is skipped with a message. | writes `<state dir>/<name>/<name>.jar` (not in dry run) |
| `check_lock_sha512` | Optional sha512 check of a downloaded jar | none |
| `load_node_env`, `save_node_env`, `say_node_env`, `proxies_set` | Load, save (mode 0600, as data, never sourced) and print `GELDAR_GLASS_TRUSTED_PROXIES`, `GELDAR_MCP_TRUSTED_PROXIES`, `GELDAR_COLO_SUBNET`, `REGISTER_TRUSTED_PEERS`, `REGISTER_KILL_SWITCH` in `<state dir>/node.env`. `REGISTER_KILL_SWITCH` must be exactly `true` or `false` (file or shell), otherwise the script dies before anything changes; a shell value wins over the file, and `save_node_env` writes the value in force, so a shell value is persisted too. `colo-status.sh` and `colo-public.sh` also load it and die on an invalid value; `colo-rollback.sh` does not load `node.env`. | writes `node.env` |
| `record_release` | Copies the current record to `previous.env` (when it differs) and the manifest to `current.env` before any pull. Refuses to deploy without a record. | writes `previous.env`, `current.env` |

## colo-up.sh

Full deploy by pull (decision 0084). Idempotent: the same release twice changes nothing (header, line 2).

- **Invocation:** `deploy/colo-up.sh`, no arguments. `DEPLOY_DRY_RUN=1` prints the plan.
- **Inputs:** the release manifest at `GELDAR_RELEASE_FILE`; must include `GELDAR_GLASS_IMAGE` and `GELDAR_ADMIN_IMAGE` (lines 19 to 20). The secrets directory `GELDAR_SECRETS_DIR`. The state directory `GELDAR_STATE_DIR`. Optional `GELDAR_MC_BIND` and `GELDAR_MC_PORT`, the node env values above, `GELDAR_SERVICE_UID`.
- **Order** (lines 13 to 79): prerequisite checks; load the manifest and node env; validate the merged config; check secrets and jar sources; fetch and verify BlueMap, Chunky and CoreProtect; record the release; save node env; `pull`; pull `admin`; make `bluemap/web` in the Paper volume with a one-shot admin run (as root with three added capabilities, project volume only); `up -d --wait postgres nats` (with `--force-recreate` when a project container sits on a removed network); `colo-admin.sh migrate`; set the `geldar_mcp`, `geldar_glass` and `geldar_register` login passwords; `ensure-skins-bucket`; `up -d --wait paper`; `whitelist-house-body`; full `up -d --wait`; then, only if the public port is set, a second `up -d --wait velocity` with `compose/colo-public.yml` merged.
- **Side effects:** pulls images, starts or recreates `geldar-colo` containers, applies SQL migrations, sets three role passwords, creates the skins bucket, whitelists names over RCON, writes the release records, `node.env` and verified jars in the state directory. Removes no volume.
- **Success line:** `colo: deployed: project geldar-colo (no volume was removed)` (line 83).
- **Exit codes:** 0 success; 1 on any refusal (the list is in `deploy/README.md` "What each script refuses").
- **Does not start:** the Mind (`animus`, profile `mind`, decision [0134](../decisions/0134-mind-is-a-profile-until-a-thinker-exists.md)) and the idle Adam Body (`golem-body`, profile `adam`, decision [0212](../decisions/0212-golem-body-is-a-profile-adam.md)). The full `up` names no profile, so `register` (profile `register`), `players-host` (profile `sovereign`, started per player by `colo-admin.sh`) and `admin` (profile `admin`, pulled and run only as a one-shot) are not started as services either ([Colo stack](compose-stacks.md#colo-stack-composecoloyml)).
- **Rollback:** `colo-rollback.sh`.
- **Tests:** `deploy/test/colo-deploy.test.ts`, `colo-deploy-secrets.test.ts`, `colo-up-order.test.ts`, `colo-up-stale-network.test.ts`, `colo-up-webroot.test.ts`, `colo-public-wiring.test.ts`, `colo-secret-parse.test.ts`, `colo-chunky.test.ts`, `colo-coreprotect.test.ts`, `colo-lock-sha512.test.ts`, `colo-nats-secret-paths.test.ts`.

## colo-rollback.sh

- **Invocation:** `deploy/colo-rollback.sh`, no arguments. Dry run supported.
- **What it does:** loads `<state dir>/previous.env`, runs the prerequisite, config and secret checks, swaps `previous.env` and `current.env`, copies the new current record over `GELDAR_RELEASE_FILE`, then `up -d --wait --pull never` (lines 10 to 28). Running it twice goes forward again (line 3).
- **Refuses:** no `previous.env` (line 11); the record cannot be written (line 24).
- **Does not undo:** database migrations. Rolling back images does not reverse a schema change (`deploy/README.md` "Rollback").
- **Tests:** `deploy/test/colo-deploy.test.ts`.

## colo-down.sh and colo-status.sh

| Script | Invocation | What it does | Side effects |
|---|---|---|---|
| `colo-down.sh` | no arguments; dry run supported | `docker compose ... stop` (line 9) | Stops containers; keeps containers, networks and volumes |
| `colo-status.sh` | no arguments | Prints the node env values, then `docker ps -a` and `docker stats --no-stream` filtered by the compose project label (lines 10 to 20) | none |

Tests: `deploy/test/colo-deploy.test.ts`, `colo-up-order.test.ts`.

## colo-cd.sh (delta deploy, CD-2a)

Applies only what changed between the installed release and a new one. Runs on the node as the operator account, never root (header, line 2).

- **Invocation:** `colo-cd.sh [--dry-run] [<release.env path> <release sha> <export dir>]` (line 10). With no positional arguments it reads `GELDAR_RELEASE_MANIFEST`, `GELDAR_RELEASE_SHA` and the working directory, which is the git-less export the entrypoint made (lines 39 to 52).
- **Environment (names only):** `COLO_CD_RELEASE_FILE` (the node's own manifest copy; default inside the state directory, line 32), `COLO_CD_ENV_FILE` (an operator env file sourced when present; default set at line 23), `GELDAR_COLO_ROOT` (the node's src extract; default at line 25), `COLO_CD_NOTICE_SECONDS` (default 30), `COLO_CD_PLAYER_WAIT` (default 60), `COLO_CD_PLAYER_SETTLE` (default 5), `COLO_CD_IMAGE_INSPECT` (test shim). It sets `PATH` and `HOME` when the environment is empty (lines 19 to 22).
- **Preconditions:** an installed manifest at `COLO_CD_RELEASE_FILE`, and `<state dir>/release.commit` naming the commit the node runs (lines 303, 310 to 311). The sha must be 40 lowercase hex.
- **Order:**
  1. `verify_images` from `colo-cd-verify.sh`: before anything changes (line 315).
  2. The delta from `colo-cd-plan.sh` (line 319). In dry run it prints the plan and exits 0 (lines 355 to 358).
  3. Take the lock `<state dir>/cd.lock` (a second run is refused), re-run the config, secret and jar checks.
  4. Back up the installed manifest as `.bak-<UTC>`, record `previous.env` and `current.env`, install the new manifest (lines 370 to 377).
  5. Copy each changed file into the src extract, keeping `.bak-<UTC>` copies (`refresh_src`).
  6. Pull each changed image in `admin eventsink register glass geldar-mcp golem-body` (line 70).
  7. When `sql/` changed: write a `pg_dump` to `<state dir>/backups/pre-cd-<UTC>.sql`, then `colo-admin.sh migrate` (lines 389 to 398).
  8. Restart each changed service in the order `eventsink register glass geldar-mcp golem-body` (line 69), one at a time with `up -d --no-deps --wait` and a health check. A `pause` maintenance notice and a wait of `COLO_CD_NOTICE_SECONDS` come before `golem-body` and `geldar-mcp`, a `back` notice after. `golem-body` is restarted only if it is already running (decision 0212). A body digest change recreates the running player hosts.
  9. Refresh each player host that is not current (`refresh_hosts`), one at a time.
  10. Write `<state dir>/release.commit`.
- **Never restarts** Paper, Velocity, Caddy, Postgres or NATS; never starts the Mind. `REGISTER_KILL_SWITCH` is read from `node.env` (or the shell, which wins) and printed in every run, dry run included, but never written here; an invalid value stops the run before anything changes. A persisted `false` takes effect only once a release with this change is deployed; before that the CD ignores the file line.
- **Needs manual:** changes under `plugin/`, `compose/`, `deploy/caddy/` and NATS config are printed as `needs manual: ...` and not applied (`colo-cd-plan.sh` lines 76 to 93). `colo-deploy.yml` copies those lines into the job summary.
- **Failure handling:** a failed pull, src refresh, dump or migration before any restart restores the previous manifest and exits 1 with nothing restarted (`abort_untouched`). A failed health check re-applies the previous release to every service already restarted with `--pull never`, recreates the player hosts when the body changed, and exits 1 (`rollback`, lines 233 to 258). Migrations are forward-only and not reversed. A failed player host refresh stops the loop, restores that host on its previous image when known, records the new commit, and exits 1 "needs manual" (lines 420 to 426).
- **Log:** `<state dir>/cd.log`, UTC-stamped lines, no secrets or addresses (lines 79 to 84).
- **Tests:** `deploy/test/colo-cd.test.ts`, `colo-cd-players.test.ts`, `colo-cd-verify.test.ts`, `literal-sweep.test.ts`.

### colo-cd-plan.sh

- **Invocation:** `colo-cd-plan.sh <installed manifest> <new manifest> <export dir> <src extract dir>` (line 5). Read-only.
- **Output lines:** `image <service> changed|same`, `player-host <id> stale|current`, `refresh <path>`, `skip <path>`, `sql yes|no`, `plugin changed`, `manual <what>` (lines 6 to 7).
- **Delta method:** `cmp` of each exported file against the src extract; there is no `git diff`, so a file deleted upstream is not seen (lines 8 to 9).
- **Path rules** (lines 76 to 84): the dev secrets folder under `compose/` and `skins/*` skipped; `plugin/*`, `compose/*`, `deploy/caddy/*`, `nats/*` and `*/nats*.conf` skipped and flagged manual; `sql/*.sql` refreshed and sets `sql yes`; anything else refreshed.
- **Exit codes:** 1 on a usage error, a missing directory or a key missing from the new manifest; otherwise 0.

### colo-cd-verify.sh

Defines `verify_images` and `check_revision`; changes nothing. Each `*_IMAGE` key must be one of seven known keys, its reference must sit under `COLO_CD_IMAGE_PREFIX/<name>@sha256:` (the default prefix is the project's GHCR namespace, line 9), and every platform's `org.opencontainers.image.revision` label must equal the release sha, read with `docker buildx imagetools inspect` (lines 29 to 46). A refusal exits 1 before any restart or copy. Tests: `deploy/test/colo-cd-verify.test.ts`, `literal-sweep.test.ts`.

### colo-cd-players.sh

Defines `host_admin`, `host_name`, `host_image`, `host_revision`, `host_status`, `host_restarts`, `running_hosts`, `acted_hosts`, `host_current`, `host_states`. A player host is the container `<project>-players-host-<player-id>`. Only hosts that `colo-admin.sh player-list` reports as running, or as stopped with a non-zero exit code, are acted on; a cleanly stopped or hibernating host is left alone (lines 2 to 6, 43 to 57). `host_admin` runs `colo-admin.sh` with `GELDAR_RELEASE_FILE` pointed at the node's CD manifest copy so the new body image is used (lines 8 to 12). Tests: `deploy/test/colo-cd-players.test.ts`.

## colo-notice.sh

Publishes one maintenance notice on `geldar.<shard>.maintenance`.

- **Invocation:** `deploy/colo-notice.sh [--dry-run] <pause|restart|back> <bodies|world|mcp> [seconds 0-600|-] [update|plugin_update|config]` (line 3). Arguments are checked against `contract/schemas/maintenance-notice.schema.json` enums and range.
- **Environment:** `GELDAR_SHARD` (default `colo`), `COLO_NOTICE_STRICT`, `DEPLOY_DRY_RUN`.
- **What it does:** builds a JSON payload with a generated id, then runs the admin container once as the NATS user `deploy` with the overlay `compose/colo-notice.yml`, which is merged only when the deploy NATS password file exists in the secrets directory (lines 75 to 88).
- **Exit codes:** 0 on publish; 0 with a warning when the publish fails or the password file is missing; 1 in that case only with `COLO_NOTICE_STRICT=1`; 1 on bad arguments.
- **Runbook:** [maintenance notice](../runbooks/maintenance-notice.md). **Tests:** `deploy/test/colo-notice.test.ts`.

## colo-admin.sh

Runs one administration subcommand in the one-shot admin container (`run --rm`, profile `admin`, decision [0133](../decisions/0133-colo-admin-by-one-shot-container.md)). Nothing is brought up, stopped or removed except the per-player hosts. The [admin service](admin-service.md) reference covers the container's own commands.

Re-derive the subcommand list with `git grep -n 'migrate | owner-add' -- deploy/colo-admin.sh`.

| Subcommand | Arguments | Notes |
|---|---|---|
| `migrate` | `[--set-role-password <role> --password-file <path in container>]` | Runs the SQL migrations, or sets one role's login password |
| `owner-add` | passed through | Adds an owner |
| `owner-set-cap` | `<owner id> <N>` | N 0 to 50 (decision [0052](../decisions/0052-per-owner-sovereign-player-cap-raised-to-20.md)) |
| `owner-admin` | `set\|unset <owner id>` or `list` | The owner admin flag |
| `player-add` | passed through | Refused for a name not on the roster |
| `roster-add` | `<name> --owner <owner>` | Minecraft name, 1 to 16 characters (decision [0108](../decisions/0108-mcp-roster-source-of-truth.md)) |
| `roster-list` | `[--owner <owner>]` | Read-only |
| `token-mint` | `<player> [--out /run/tokens/<name>.token]` | Needs `GELDAR_TOKENS_DIR`: outside the checkout, mode 0700. Writes a temporary overlay (mode 0600) in the state directory to mount it, removed on exit. Prints the path and byte length, never the value. |
| `token-revoke`, `players-status` | passed through | |
| `ensure-skins-bucket` | none | Creates the skins key-value bucket as the body NATS user; no-op when it exists |
| `whitelist-house-body` | none | Whitelists the house Body and every sovereign player's life id from `shards/colo-mind.yaml` over RCON |
| `skin-import` | `<player-id> --file /run/skins/<name>.json` | Needs `GELDAR_SKINS_DIR` (outside the checkout, mode 0700), mounted read-only |
| `player-flags` | `<player-id> ...` | Per-player operator flags (`sql/0034_operator_player_flags.sql`) |
| `player-start` | `<player-id>` | `run -d --no-deps --name <project>-players-host-<id>` under profile `sovereign`, then `docker update --restart unless-stopped` (decision [0342](../decisions/0342-body-hosts-unless-stopped.md), which supersedes the policy of [0169](../decisions/0169-players-host-restart-policy.md)). Idempotent. The id must match `^ag-[a-z0-9-]{1,40}$` and be listed under `sovereign.players` in the shard file (`GELDAR_COLO_SHARD`, default `shards/colo-mind.yaml`). |
| `player-stop` | `<player-id>` | `docker stop` and `docker rm` of that exact container |
| `player-list` | none | State of each listed player's host |

Exit: 1 on a refusal or a failed admin run; `player-start` exits 0 with a warning when `docker update` fails (lines 228 to 234). Tests: `deploy/test/colo-admin.test.ts`, `colo-admin-flags.test.ts`, `colo-admin-skin.test.ts`, `colo-nats-secret-paths.test.ts`, `literal-sweep.test.ts`.

## colo-public.sh

Installs, switches and removes the public sites (`map`, `glass`, `mcp`) in the shared Caddy on the node (decisions [0071](../decisions/0071-public-endpoints-and-ports.md), [0094](../decisions/0094-public-sites-read-only-through-caddy.md)).

- **Invocation:** `colo-public.sh install [site...] | off <site|all> | on <site|all> | remove | status` (line 3). `install` with no site makes all three live; with names it touches only those.
- **Environment (names only):** `GELDAR_CADDY_CONTAINER`, `GELDAR_CADDY_CONFIG_DIR`, `GELDAR_CADDY_FILE`, `GELDAR_PUBLIC_ENV` (install only: a root-only `KEY=VALUE` file read as data), `GELDAR_PUBLIC_APPLY` (`reload`, `restart` or `none`), `GELDAR_PUBLIC_RESTART_OK`, `GELDAR_PUBLIC_SRC` (tests). The env file supplies `GELDAR_DOMAIN`, `GELDAR_MAP_UPSTREAM`, `GELDAR_GLASS_UPSTREAM`, `GELDAR_MCP_UPSTREAM`, optional `GELDAR_REGISTER_UPSTREAM` and `GELDAR_KINO_ENABLED` (lines 10 to 13, 47 to 90).
- **install:** refuses unless both trusted-proxy lists are set and not loopback; renders each site's live and off file into concrete files (each upstream must be `127.0.0.1:<port>`; no `{$` may remain); backs up the Caddyfile as `<file>.bak-geldar-<stamp>`; installs files under `<config dir>/geldar/` (a site that was off stays off); appends `import /config/geldar/*.caddy` if absent; `caddy validate`; then applies per `GELDAR_PUBLIC_APPLY`. A failed validate restores the Caddyfile and the previous site files byte for byte and exits non-zero (lines 197 to 223).
- **off, on:** swap a site's top-level file for its stored off or live twin, validate, apply; restore on failure.
- **remove:** back up, drop the import line, validate, delete the rendered directory, apply. Validate failure restores and removes nothing.
- **status:** prints the import line and each site as not installed, on or off. It reads files only; it does not prove what Caddy has loaded (line 277).
- **Apply modes:** `reload` runs `caddy reload` in the container. `restart` never reloads; it restarts the container itself once only with `GELDAR_PUBLIC_RESTART_OK=1`, then waits up to 30 s, otherwise prints a note to restart it by hand. `none` does neither (lines 100 to 129).
- **Rollback:** `off <site>` (kill switch) or `remove`. Every Caddyfile change leaves a timestamped backup.
- **Tests:** `deploy/test/colo-public.test.ts`, `colo-public-sites.test.ts`, `colo-public-restart.test.ts`, `colo-public-wiring.test.ts`.

## gen-secrets.sh

- **Invocation:** `sudo sh deploy/gen-secrets.sh` on the node, or run as the `GELDAR_SERVICE_UID` account. `GELDAR_SECRETS_LIST` names another list; the default is `deploy/genesis/secret-names.list`.
- **The list:** one bare file name per line (`#` starts a comment). A name that is not a bare `*.txt` file name, a name listed twice, an empty list, and a CRLF line each stop the script before anything is created, and the message names the file and the line.
- **What it does:** creates the secrets directory with mode 0700 and each missing file in the list (12 names by default: `postgres.txt`, `rcon.txt`, `velocity-forwarding.txt`, `nats-body.txt`, `postgres-mcp.txt`, `postgres-glass.txt`, `postgres-register.txt`, `register-pepper.txt`, `mcp-token-pepper.txt`, `register-session-key.txt`, `postgres-supervisor.txt`, `nats-supervisor.txt`) with 32 random bytes as hex. Never overwrites (`set -C`), never prints or changes a value.
- **Owner and mode report:** prints one line per name, names only: `created: <name>`, `kept (exists): <name>`, `kept (exists), owner fixed: <name>` or `kept (exists), mode fixed to 0600: <name>` (root only), and `wrong-owner: <name>` or `wrong-mode: <name>` (any other account, which cannot change them). As root it gives the directory and the created files to `GELDAR_SERVICE_UID` and sets an existing file's owner and mode.
- **Symlinks:** a symlink at the directory or at a listed file is refused before any stat, chown or chmod (`refusing a symlink (not followed): <name>`), so root never changes a file outside the directory.
- **Never creates:** the owner-provided names, which a list may not name: `register-ms-secret.txt` (the Microsoft/Entra client secret, placed by the owner) and the stale `register-github-secret.txt` and `register-discord-secret.txt`. A list that names one is refused. Also any NATS file other than the Body password and `nats-supervisor.txt`, and `nats-auth.conf`: the other NATS per-role passwords are card G2-02 (decision 0080), and the NATS files come from `./geldar.ps1 shard nats-auth <shard>` on a trusted machine.
- **Exit:** 1 on a uid refusal, a list refusal, a symlink refusal, a failed create or a wrong owner or mode that this account cannot fix (the last names the files; no value is printed or changed). 0 otherwise.
- **Tests:** `deploy/test/gen-secrets.test.ts`, `colo-deploy-secrets.test.ts`.

## install-body-helper.sh

Installs the body helper (decision [0260](../decisions/0260-body-container-control-by-host-helper.md)) as a systemd unit on the node.

- **Invocation:** `deploy/install-body-helper.sh [--dry-run | --apply]`; `-h` prints usage. Dry run is the default. Any other argument exits 2 (lines 21 to 48).
- **Environment:** `BODY_HELPER_PREFIX`, `BODY_HELPER_REPO`, `BODY_HELPER_NODE_ENV`, `BODY_HELPER_TEST` (test settings; a prefix is refused for root unless `BODY_HELPER_TEST=1`), and `PGHOST`, `PGUSER`, `PGDATABASE` for the password step under `--apply`.
- **Steps** (numbered in the script): 1 the helper build `dist/main.js` must exist and match `main.js.sha256`; 1c the pinned Node runtime is extracted from a staged tarball only after its sha256 matches `deploy/body-helper-node.env`; 1b the unit's env file must exist (names only); 2 write the systemd unit `geldar-body-helper.service` (root, 0644) when its content changes; 3 create the helper's secret directory (0700) and its Postgres and NATS password files (0600, 64 hex characters) when absent, never reading or overwriting an existing one; 4 set the `geldar_helper` role password through `tools/migrate` only when a login with the file's password fails; 5 `systemctl daemon-reload`, then `enable --now` or `restart` only when the build and env file both exist; 6 a summary of changes made or planned.
- **Exit codes:** 0 success or dry run; 1 on a refusal; 2 on an unknown argument.
- **Does not:** fetch or copy the helper build, touch `nats-auth.conf`, or run `shard nats-auth` (lines 6 to 11).
- **Rollback:** in the [body-helper node steps runbook](../runbooks/body-helper-node-steps.md) (gated by `deploy/test/install-body-helper-runbook.test.ts`).
- **Tests:** `deploy/test/install-body-helper.test.ts`, `install-body-helper-node.test.ts`, `install-body-helper-runbook.test.ts`, `body-helper-artifacts.test.ts`.

## caddy/validate.sh

`bash deploy/caddy/validate.sh` from the repo root. Runs `docker run --rm` of the digest-pinned Caddy image (line 9) twice: once over the three live files, once over the three `-off` files, each as one Caddyfile with placeholder `example.test` values (lines 14 to 39). Touches no other container. CI runs it in the `compose` job of `ci.yml`. `tools/repo-checks/src/caddy-adapt.test.ts` uses the same pinned image.

## genesis scripts

| Script | Invocation | What it does | Exit codes | Tests |
|---|---|---|---|---|
| `build-config-bundle.sh` | `sh deploy/genesis/build-config-bundle.sh <out-dir>` | Packs every path in `config-bundle.list` into `config-bundle.tar.gz` (sorted names, mtime 0, owner 0, `gzip -n`), writes `config-bundle.manifest` (sha256 per file) and `config-bundle.sha256`, prints the archive digest. A listed file that is missing, absolute, or holds `..`, spaces or globs fails. | 0, or 1 on any failure | `deploy/test/genesis-config-bundle.test.ts` |
| `verify-plugin-jars.sh` | `sh deploy/genesis/verify-plugin-jars.sh <dir>` | Checks `geldar-core.jar` and `geldar-velocity-identity.jar` in `<dir>` against `<dir>/plugin-jars.sha256` | 0 match; 1 mismatch or missing jar; 2 usage or format error (line 6) | `deploy/test/plugin-jars-verify.test.ts` |

## Scratch stack

`sh deploy/scratch/scratch.sh up|status|down [suffix]` runs a throwaway stack named `scratch-<suffix>` (suffix `[a-z0-9]{1,9}`, default `a`; the script parses `deploy/scratch/<suffix>.env` itself for the four `SCRATCH_*_PORT` host ports, never sourcing it, an operator-set variable wins, and the file is required for `telemetry` (25432, 24222, 28222, 45565) and optional otherwise (defaults 15432, 14222, 18222, 35565)) from `compose/phase0.yml` and `compose/opt-in/scratch.yml`, plus `compose/nats-auth.yml` when NATS auth is given (lines 2 to 10, 122 to 129; the port loader is `load_ports`, lines 44 to 81).

- **Environment:** `SCRATCH_NATS_AUTH_DIR` (a directory holding the five NATS auth files from `./geldar.ps1 shard nats-auth <shard>`: `nats-auth.conf`, `nats-paper.txt`, `nats-velocity.txt`, `nats-eventsink.txt` and `nats-seed.txt`, the last for the identity seed). `SCRATCH_NATS_OPEN=1` is refused: `up` exits 2 and starts nothing, because the identity seed needs the auth dir; `SCRATCH_NATS_PORT`; `XDG_STATE_HOME` or `HOME` for the per-user state directory.
- **up:** NATS gate, Compose 2.24.4 or newer, resource gate (10 GB free RAM, 20 GB free disk), both plugin jars present, uid check; refuses leftover containers or secrets; generates the scratch secrets in a per-user 0700 directory; `up -d --wait --build`.
- **down:** `down -v --rmi local --remove-orphans` on that project only, removes its secrets directory, and lists any volumes left.
- **Exit codes:** 2 usage or NATS refused, 3 resource gate failed (nothing started on 2 or 3), 1 anything else (line 4).
- **Runbook:** [scratch stack](../runbooks/scratch-stack.md). **Tests:** `tools/repo-checks/src/scratch-overlay.test.ts`.

## Node state these scripts write

All under the state directory (`GELDAR_STATE_DIR`, default at `common.sh` line 19) unless noted.

| Path (relative) | Written by | Holds |
|---|---|---|
| `current.env`, `previous.env` | `record_release`, `colo-rollback.sh`, `colo-cd.sh` | The applied and the replaced release manifests |
| `release.env` | `colo-cd.sh` (default `COLO_CD_RELEASE_FILE`) | The CD's own manifest copy |
| `release.commit` | `colo-cd.sh` | The commit the node runs; must exist before the first CD run |
| `cd.lock`, `cd.log` | `colo-cd.sh` | The run lock and the CD log |
| `backups/pre-cd-<UTC>.sql` | `colo-cd.sh` | A database dump before migrations |
| `node.env` | `save_node_env` | Trusted proxies, colo subnet, register peers, `REGISTER_KILL_SWITCH` when a valid value is in force (mode 0600) |
| `bluemap/`, `chunky/`, `coreprotect/` | `fetch_*` | Verified plugin jars |
| `admin-tokens.override.yml`, `admin-skins.override.yml` | `colo-admin.sh` | Temporary mount overlays, removed on exit |
| `<src extract>/<path>.bak-<UTC>` | `colo-cd.sh` | Copies of files the CD replaced (in `GELDAR_COLO_ROOT`) |
| `<Caddyfile>.bak-geldar-<stamp>` | `colo-public.sh` | Caddyfile backups (next to `GELDAR_CADDY_FILE`) |

## Conflicts recorded

Each conflict is recorded, not resolved.

1. **How many images the release holds.** `colo-images.yml` (manifest job, lines 383 to 452), `deploy/release.env.example` (seven keys) and `colo-cd-verify.sh` line 3 say seven. The `release.env.example` header (line 4) lists six names (no register). `deploy/README.md` "Not covered yet" says `colo-images` publishes five images.
2. **The `release.commit` record.** `colo-cd.sh` lines 310 to 311 require `<state dir>/release.commit`, and `deploy/README.md` line 31 says so. `deploy/README.md` line 406 says "There is no `state/release.commit` record".
3. **Is `colo-cd.sh` in the repo?** `docs/runbooks/colo-deploy.md` ("needs manual" section) says `deploy/colo-cd.sh` "is not in this repository yet" and its wording is unverified. The script is tracked at `1b114276` and prints `needs manual: ...` (line 336).
4. **Register secrets in the node overlay.** `deploy/compose.secrets.yml` lines 24 to 27 still name `register-github-secret` and `register-discord-secret`, which `compose/colo.yml` no longer declares; it names neither `register-ms-secret` nor `register-session-key` (`compose/colo.yml` sets their path from `GELDAR_SECRETS_DIR` itself, lines 735 to 738). `deploy/README.md` says the GitHub and Discord secrets are gone. Whether the merged config then lists the two stale names, and so whether `check_secrets` demands their files, is unverified: `docker compose config` was not run.
5. **Restarting the shared Caddy.** Decision 0071 item 6 and `deploy/caddy/README.md` ("Never ... restart the container") say the shared Caddy is reloaded, never restarted. `colo-public.sh` has a `restart` mode that restarts it once with `GELDAR_PUBLIC_RESTART_OK=1`, citing an owner ruling (R39, admin API off) that is not a decision record.
6. **Two manifest copies.** `colo-up.sh` and `colo-rollback.sh` read and write `GELDAR_RELEASE_FILE`; `colo-cd.sh` reads and writes `COLO_CD_RELEASE_FILE` in the state directory, because the operator account cannot read the root-owned one (`colo-cd.sh` lines 30 to 32). `deploy/README.md` lines 26 to 30 say to keep them in step by hand. All three scripts share `current.env` and `previous.env`, so a rollback after a CD run uses the CD's records.

## Documentation debt

- `deploy/README.md`, `deploy/body-helper-node.env`, `deploy/install-body-helper.sh` and `deploy/colo-cd.sh` contain an operator account handle, a node host name or an account home path in comments and defaults. This page does not copy them. Removing them is a code-side change for a coder packet.
- `deploy/README.md` names a person in the "Migrating ... old host" step; persona rule 3 forbids personal names.
- The deploy entrypoint that `colo-deploy.yml` calls lives on the node, outside the repo; its behaviour here comes from the workflow header and `docs/runbooks/colo-deploy.md` and is unverified.
- `deploy/README.md` has no metadata block; under plan decision D10 it stays in place.
