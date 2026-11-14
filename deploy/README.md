# Colo deploy runbook

The Colo shard stack (`compose/colo.yml`) runs on the shared Linux node. This runbook covers the scripts in `deploy/`
that deploy it by pulling digest-pinned images (decision 0084). It is for the owner and for the ops merge step.
Nothing in this file is a host name, an address or an account: those come from the environment at the time of the
deploy and are never committed.

The scripts are POSIX `sh`. The tests (`deploy/test/`) run on the desktop through Vitest. The scripts run on Linux.

## What is in deploy/

| File | What it does |
| --- | --- |
| `common.sh` | Shared checks, sourced by the other scripts. Holds every refusal listed below. |
| `colo-up.sh` | Checks, validates the merged config, verifies the BlueMap jar, records the release, then pulls and starts the project. |
| `colo-rollback.sh` | Re-applies the previous recorded release with `--pull never`, and swaps the two records. |
| `colo-cd-plan.sh` | Read-only. Prints the delta between two releases: changed image digests, sql yes or no, the files to refresh, and the `needs manual` items (plugin/, compose/, deploy/caddy/, NATS). |
| `colo-cd.sh` | CD-2a delta deploy, run on the node as the operator account: `[--dry-run] [<release.env> <sha> <export dir>]`. With no positional args it reads `GELDAR_RELEASE_MANIFEST`, `GELDAR_RELEASE_SHA` and the working directory (the git-less export). Verifies the images, then restarts only the services whose digest changed, in order, with health checks, and rolls back on a failed check. Never restarts Paper, Velocity, Caddy, Postgres or NATS, and never starts the mind. |
| `colo-cd-verify.sh` | Sourced by `colo-cd.sh`. Before anything changes, every `*_IMAGE` must be under `ghcr.io/sandboxservers/geldar-<name>` and its OCI revision label (`org.opencontainers.image.revision`, read with `docker buildx imagetools inspect`) must equal the release sha. A mismatch, a missing label or a foreign prefix stops the run with nothing restarted or refreshed. |
| `colo-down.sh` | Stops the project. Containers, networks and volumes are kept. |
| `colo-status.sh` | Read-only. Lists the project's containers, ports and one resource sample. |
| `gen-secrets.sh` | Creates the missing secret files from `/dev/urandom`. Never overwrites a file, never prints a value. |
| `compose.secrets.yml` | Overlay that points the secret names at the node's secrets directory. |
| `release.env.example` | The release manifest template. Copy it and fill in digests; it holds no values. |

`colo-cd.sh` keeps its own copy of the manifest: `$COLO_CD_RELEASE_FILE`, default `<state dir>/release.env`
(`/var/lib/geldar-colo/release.env` unless `GELDAR_STATE_DIR` is set). The root-owned `/etc/geldar-colo/release.env`
is not readable by the operator account on the node (root, mode 700 directory), so the CD copy lives in the state dir.
`colo-up.sh` and `colo-rollback.sh` still read `$GELDAR_RELEASE_FILE` (the `/etc` copy), so after a CD run keep the two
in step by hand or move the CD copy's path into `GELDAR_RELEASE_FILE` on a node where the operator can read it.
`colo-cd.sh` also needs `<state dir>/release.commit` (the commit the node runs) before its first run; it records the new
one on success, and writes a log to `<state dir>/cd.log` (no secrets, no addresses).

CD-2a inputs on the node (the entrypoint runs `bash deploy/colo-cd.sh` from a read-only, git-less export of a main sha,
with a cleared environment):

- `GELDAR_RELEASE_MANIFEST`: path to a validated copy of the release manifest. `GELDAR_RELEASE_SHA`: the 40-character
  main sha. The working directory is the export. Positional args (`[--dry-run] <release.env> <sha> <repo dir>`) still work.
- `PATH` and `HOME` are set by the script when the environment is empty. `COLO_CD_ENV_FILE` (default
  `/home/claude/colo-env.sh`) is sourced when it exists.
- `GELDAR_COLO_ROOT` is the node's src extract the run refreshes (default `/mnt/nvme/geldar-colo/src`).
- The delta is computed by `cmp` of each exported file against the src extract, not by `git diff`. The previous sha is
  still `<state dir>/release.commit`.
- Before anything changes, `colo-cd-verify.sh` reads each image's revision label through
  `docker buildx imagetools inspect <ref> --format '{{json .}}'` (`COLO_CD_IMAGE_INSPECT` replaces the command in tests).
  The image must be under `ghcr.io/sandboxservers/geldar-<name>` and carry `org.opencontainers.image.revision` equal to
  the release sha. `mind` and `admin` are checked the same way.
- The export has no `.git`, so a file deleted upstream is not detected; it stays in the src extract.

Every compose call names the project `geldar-colo` (`-p`), so the scripts reach only that project's containers,
volumes and networks. No script runs `down`, and no script removes a volume.

## Prerequisites

- Docker Engine with Compose v2 (`docker compose version` must work). The account that runs the scripts must reach the
  daemon (the docker group, or root).
- Free disk on the filesystem that holds the repo checkout: at least `GELDAR_MIN_FREE_KB` KiB (default `10485760`,
  which is 10 GiB). `colo-up.sh` refuses below it.
- Secret files in the secrets directory (`GELDAR_SECRETS_DIR`, default `/etc/geldar-colo/secrets`):
  - the directory is root-only (`gen-secrets.sh` sets mode `0700`);
  - the required list is not kept by hand. The scripts read the secret names and their files from the merged compose
    config (`docker compose config`, read-only), and check each file that config declares. A secret added to
    `compose/colo.yml` or the overlay is checked with no change to the scripts;
  - each such file exists, is not empty, is a regular file inside the secrets directory (a symlink out is refused),
    and has mode `0600` or `0400`.
  `gen-secrets.sh` creates `postgres.txt`, `rcon.txt`, `velocity-forwarding.txt`, `nats-body.txt`,
  `postgres-mcp.txt`, `postgres-glass.txt`, `postgres-register.txt`, `register-pepper.txt`, `mcp-token-pepper.txt` and `register-session-key.txt` (the register and Glass session key, at least 32 characters) when they are missing (an existing node re-runs `gen-secrets.sh` after this change; the admin service mounts `postgres-register.txt`). `register-ms-secret.txt` is the owner's Microsoft (Entra) client secret for the `register` service: gen-secrets never creates it, so create it on the node yourself (mode 0600, owned by GELDAR_SERVICE_UID). Compose declares it, so the deploy refuses to start until the file exists. The register service is Microsoft-only; the GitHub and Discord secrets are gone. The NATS files (`nats-mind.txt`,
  `nats-mcp.txt`, and `nats-auth.conf` when the auth overlay is merged) come from the trusted machine, never from the
  node.
  The scripts check the mode and the size. They never read the contents.
- The release manifest copied to `/etc/geldar-colo/release.env` (`GELDAR_RELEASE_FILE`), owned by root, mode `0600`.
  Every `*_IMAGE` line must be a digest reference (`name@sha256:` followed by 64 lowercase hex characters).
- The state directory `GELDAR_STATE_DIR` (default `/var/lib/geldar-colo`) must be writable by the deploying account.
  It holds the release records and the verified BlueMap jar.

The node also runs a Watchtower container that auto-updates containers it finds. Every service in `compose/colo.yml`
carries the label `com.centurylinklabs.watchtower.enable: "false"`, which keeps Watchtower away from them. The colo
services are pinned by digest and change only through `colo-up.sh`, so an automatic pull would bypass the release
record. The colo rule in `tools/repo-checks` fails a service that lacks the label or sets it to anything but `"false"`.

## First deploy: the order

Run these in order. Stop at the first failure.

1. **Secrets.** `deploy/gen-secrets.sh` creates each missing file. It keeps any file that exists. Check the modes
   afterwards with `stat -c '%a %n'` on the secrets directory. The NATS per-role password files for the auth overlay
   are not made here (see "Not covered yet").
2. **Release manifest.** Copy `deploy/release.env.example` to `/etc/geldar-colo/release.env`, set mode `0600`, and
   replace each placeholder with the digest of the release being deployed. Never use a tag or `latest`.
3. **BlueMap lock.** There is no separate verify command. The dry run in step 4 downloads the jar named by
   `plugins/bluemap/bluemap.lock.json`, checks its sha256 against the lock, and keeps nothing. If the lock file is
   absent the step is skipped and says so; do not treat that as verified. The CoreProtect lock
   (`plugins/coreprotect/coreprotect.lock.json`) is checked the same way; see docs/runbooks/coreprotect.md.
4. **Dry run.** `DEPLOY_DRY_RUN=1 deploy/colo-up.sh`. It runs every read-only check and prints the state-changing
   steps as `dry-run, not run`. Read the plan. Stop if a value is unexpected.
5. **Real deploy.** `deploy/colo-up.sh`. It records the previous and current release in the state directory before it
   pulls. Then it runs in this order: `up -d --wait postgres nats`; `migrate` and `migrate --set-role-password
   geldar_mcp` in the admin container (the MCP role cannot log in until the second one runs); and last the full core,
   `up -d --wait`. The script prints `deployed: project geldar-colo (no volume was removed)` on success.
6. **Check.** `deploy/colo-status.sh`. Every service should be healthy.

Run the scripts from the repository root, or set `GELDAR_COLO_ROOT` to the checkout.

## First-deploy runbook

Work top to bottom. Steps (a) to (e) only read, or dry-run, until the real deploy in (e). Angle brackets are
placeholders: `<node>` is the node's address or name, `<operator>` is the operator account, `<release-commit>` is the
commit the images were built from, `<player>` and `<owner>` are ids you choose. Write your own values in your own
notes, not in this file or the repository.

### (a) Prerequisites

- Docker Engine and Compose v2 on `<node>`. `docker compose version` and `docker info` must both work for
  `<operator>` without sudo (the account is in the `docker` group).
- A root-only state directory: `sudo install -d -m 0700 /etc/geldar-colo` for the release record and the secrets
  directory, or set `GELDAR_STATE_DIR` and `GELDAR_SECRETS_DIR` to directories you create the same way.
- The repository checkout at `<release-commit>`: `git clone --depth 1 <public repository URL> <checkout>`, then
  `git -C <checkout> fetch --depth 1 origin <release-commit>` and `git -C <checkout> checkout <release-commit>`. Or
  `git archive <release-commit> | tar -x -C <checkout>` on a machine with the repository, copied over. The commit is
  named in the release summary of the `colo-images` workflow.
- Free disk above `GELDAR_MIN_FREE_KB` (default 10 GiB). Check with `df -h /`.

### (b) Plugin jars

`compose/colo.yml` mounts `plugin/core/build/libs/geldar-core.jar` and
`plugin/velocity-identity/build/libs/geldar-velocity-identity.jar`. These are Gradle build products and are not
published. For the first deploy, build them on a trusted machine and copy them to the same relative paths on the node:

```sh
# on the trusted machine, from the checkout at <release-commit>
(cd plugin && ./gradlew build --no-daemon)
sha256sum plugin/core/build/libs/geldar-core.jar plugin/velocity-identity/build/libs/geldar-velocity-identity.jar
scp plugin/core/build/libs/geldar-core.jar <operator>@<node>:<checkout>/plugin/core/build/libs/
scp plugin/velocity-identity/build/libs/geldar-velocity-identity.jar <operator>@<node>:<checkout>/plugin/velocity-identity/build/libs/
# on <node>, from <checkout>: the same two sha256sum lines must print the same hashes
```

Record both hashes in the release record. Follow-up: publish the jars as a CI artifact so this copy step goes away.

### (c) Secrets

On the trusted machine, run `./geldar.ps1 shard secrets colo` and `./geldar.ps1 shard nats-auth colo`. Copy the files they
produce for the colo node to `<node>`'s secrets directory. Never send them through a chat or commit them. The
directory is mode `0700` and each file is mode `0600`. Set `GELDAR_SECRETS_DIR` to that directory. Check the modes
read-only with `stat -c '%a %n' <secrets-dir>/*`.

NATS auth is on by default (decision 0080): every compose call merges `compose/nats-auth.yml`. The overlay reads its
files from `GELDAR_SECRETS_DIR`, the same directory as the other secrets, so nothing is copied into the checkout:
`nats-auth.conf` (the server config, a secret mounted at `/etc/nats/nats-auth.conf`), `nats-paper.txt`,
`nats-velocity.txt` and `nats-eventsink.txt` must sit there, owned by `GELDAR_SERVICE_UID` with mode `0600`. The deploy
refuses until they exist. `deploy/compose.secrets.yml` names all four under `GELDAR_SECRETS_DIR`, the way it names the
other secrets, so `compose/nats-auth.yml` keeps no node path and has no interpolated volume (threat model section 1).

The service uid. The containers run as `GELDAR_SERVICE_UID` (default `1000`; compose sets `user:` on the Body, Mind,
MCP, admin, player host and eventsink services, and `UID`/`GID` on Paper). The deploy scripts refuse to run as uid 0,
and refuse unless the secrets directory and every secret file are owned by `GELDAR_SERVICE_UID`. So on the node,
export the uid for the deploy and use the owner the files already have (for example `GELDAR_SERVICE_UID=1001`).
`deploy/gen-secrets.sh` run as root chowns the directory and the generated files to `GELDAR_SERVICE_UID`; run as another
user it refuses unless that user's uid equals `GELDAR_SERVICE_UID`. The pinned `itzg/mc-proxy` (Velocity) image has no UID/GID
handling and runs as root, so it reads its 0600 secret owned by `GELDAR_SERVICE_UID` as root; that is expected and fine.
Paper's data volume (`paper-data`) may keep the ownership it had before this change. So the first `up` must check that the
volume is owned by `GELDAR_SERVICE_UID` or does not exist yet (a fresh volume): run `docker run --rm --entrypoint stat -v geldar-colo_paper-data:/data <paper image digest from compose/colo.yml> -c '%u %n' /data`
before it, and fix a mismatch only inside the project's volume. NATS auth generation is PowerShell-only, so its files are copied
from the trusted machine.

### (d) Release manifest

Copy `release.env` from the `colo-images` run summary or artifact for `<release-commit>` to
`/etc/geldar-colo/release.env`, mode `0600`. Every `*_IMAGE` must be a digest reference (`name@sha256:<64 hex>`).
`latest` and bare tags are refused by the script. The manifest must include `GELDAR_ADMIN_IMAGE`.

### (e) Dry run, then deploy

```sh
cd <checkout>
DEPLOY_DRY_RUN=1 deploy/colo-up.sh   # read the plan; stop if a value is unexpected
deploy/colo-up.sh                    # the real deploy; prints "deployed: project geldar-colo"
```

### (f) Admin steps (one-shot container, decision 0133)

Each step runs in a container started with `run --rm`. Nothing is kept running afterwards. Set the tokens directory
first. It must be outside the checkout and mode `0700`. `colo-up.sh` already runs the first two lines; run them again
only to repair:

```sh
export GELDAR_TOKENS_DIR=<tokens-dir>
deploy/colo-admin.sh migrate                 # SQL migrations (colo-up.sh runs this)
deploy/colo-admin.sh migrate --set-role-password geldar_mcp --password-file /run/secrets/postgres-mcp.txt   # colo-up.sh runs this
deploy/colo-admin.sh owner-add <owner> --cap 20
deploy/colo-admin.sh player-add <player> --owner <owner> --life <life> --name <name> --harness <harness>
```

`colo-up.sh` also runs `whitelist-house-body` after Paper is healthy and before any body starts. It whitelists the house
Body (`mind.agent.username`) and every `sovereign.players[].life_id` from `shards/colo-mind.yaml` over RCON, and nothing
else. It is idempotent, so a new ranger is whitelisted on the next `colo-up.sh` run (or run the step by hand).

Before you start a ranger's host, add `<player>` under `sovereign.players` in `shards/colo-mind.yaml`. Then mint its
token:

```sh
deploy/colo-admin.sh token-mint <player>     # prints the file path and byte length, never the value
```

The token file is `<tokens-dir>/<player>.token`, mode `0600`. Give it to the ranger's desktop by a channel outside
chat. Then start the ranger's host. There is one host per player: a container named `geldar-colo-players-host-<player>`.
Do not start `players-host` with `up`: a second `up` replaces the first player's container.

```sh
deploy/colo-admin.sh player-start <player>   # idempotent: a running host is left alone
deploy/colo-admin.sh player-stop <player>
deploy/colo-admin.sh player-list             # each listed player, running or not
```

`player-start` and `player-stop` refuse an id that is not `^ag-[a-z0-9-]{1,40}$` or not listed under
`sovereign.players` in `shards/colo-mind.yaml`. They touch only containers that carry the `geldar-colo` compose project
label and that exact name. `player-start` runs
`docker compose -p geldar-colo ... run -d --no-deps --name geldar-colo-players-host-<player> -e GELDAR_PLAYER_ID=<player> players-host --player <player>`, then `docker update --restart on-failure:5` on that container (decision 0169). The container is not removed when it exits, so its logs stay (json-file, 10m, 3 files). A crash restarts it up to five times; after the fifth failed restart it stays exited and shows in `docker ps -a`. A clean exit does not restart it. `player-list` reports a stopped host as `exited`.

Migrating Jason's old host (`geldar-colo-players-host-1`, from `up -d players-host`): stop and remove it, then start the
new one.

```sh
docker stop geldar-colo-players-host-1 && docker rm geldar-colo-players-host-1
deploy/colo-admin.sh player-start ag-jason-01
```

### (g) Verification

- `deploy/colo-status.sh` (read-only). Every service should be healthy, and no published port should be 25565 or 25566.
  It also prints one resource sample. Compare it with the budgets in the capacity notes.
- The MCP: its compose healthcheck is a TCP connect to `127.0.0.1:8788`. Its only HTTP route is `/p/<player>`; `/`
  answers 404 without a check, and `/p/<player>` without a bearer token answers 401. On `<node>`,
  `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8788/p/<player>` should print 401, not a connection error.
- From the desktop, open an SSH tunnel: `ssh -L 8788:127.0.0.1:8788 <operator>@<node>`. Point the launcher at the local
  end. Public DNS on ports 80 and 443 is a C2 matter. Then run the first look, one act and one wait for `<player>`.

### (h) Rollback and stop conditions

- Roll back with `deploy/colo-rollback.sh` (see "Rollback" below). It uses the release record in the state directory.
- Stop and roll back if Cimmeria latency rises, if free disk drops below `GELDAR_MIN_FREE_KB`, if anything binds host
  port 25565 or 25566, or if a container outside the `geldar-colo` project is touched.

### (i) Known limits

- The Adam Mind (`animus`) is under the compose profile `mind` (decision 0134). `colo-up.sh` does not start it; it cannot
  think until the C4 gateway exists.
- CoreProtect is mounted read-only into Paper: the verified jar from `state/coreprotect/coreprotect.jar`. Its config is set by hand after the first start (docs/runbooks/coreprotect.md).
- BlueMap is mounted read-only into Paper (C2-07o): the verified jar from `state/bluemap/bluemap.jar` and `plugins/bluemap/config`. The owner accepted BlueMap's download of the Minecraft client resources under Mojang's EULA (2026-11-11), so `core.conf` has `accept-download: true`.
- Postgres service roles are superuser for now (C2).
- NATS auth generation is PowerShell-only; copy its files from the trusted machine.
- The admin service mounts `postgres.txt` and `postgres-mcp.txt` (at `/run/secrets/postgres-mcp.txt`). The
  `migrate --set-role-password` step reads the second one. Both files must exist before the first `up`.
- `token-mint` needs `GELDAR_TOKENS_DIR` writable by uid 1000 (the admin container's user) and readable by the
  operator. The script requires mode `0700` on that directory, so the owner decides how to satisfy both.
- `run --rm` starts the admin service's dependencies (Postgres) if they are not already running. It removes nothing.
- `colo-up.sh` runs `colo-admin.sh ensure-skins-bucket` before the full `up`: the body NATS user creates the `geldar-skins`
  bucket (a no-op when it exists), because Velocity is read-only on it (decision 0087 correction). The admin service
  therefore also mounts `nats-body.txt`.
- `bluemap-web` answers 404 at `/` until BlueMap has rendered; that is expected and not a fault.
- The public map shows every agent player's live position (R38, C2-07m). BlueMap's web server runs in Paper on the colo network (port 8101, never published); `bluemap-web` proxies only `/maps/<map>/live/<file>` to it (GET and HEAD). Spectators and vanished players are hidden in `plugins/bluemap/config/plugin.conf`. `skin-download: true` (owner ruling 2026-11-12): BlueMap may fetch skins from Mojang by player UUID only; agent offline UUIDs are unknown there, so heads may fall back to Steve. Until BlueMap has started, the live path answers 502.

### Replacing `src` on a node

A restarting container whose bind-mount source is missing makes Docker create that path as a root-owned directory (the two
plugin jars did this). So, in this order:

1. Stop the project's containers first: `docker compose -p geldar-colo -f compose/colo.yml stop`.
2. Swap `src` (move the old tree away, put the new one in place, rebuild or copy the two plugin jars).
3. Run `deploy/colo-up.sh`.

`colo-up.sh` refuses when `plugin/core/build/libs/geldar-core.jar` or
`plugin/velocity-identity/build/libs/geldar-velocity-identity.jar` is a directory. It names the path; stop the containers,
`rmdir` it, restore the jar and run it again.

## Maintenance notice (colo-notice.sh, CD-1d)

`deploy/colo-notice.sh` publishes one maintenance notice on `geldar.<shard>.maintenance` before a restart. The shard is
`GELDAR_SHARD` (default `colo`), the same variable the script reads. Usage:

```
deploy/colo-notice.sh [--dry-run] <pause|restart|back> <bodies|world|mcp> [seconds 0-600|-] [update|plugin_update|config]
```

The arguments are checked against `contract/schemas/maintenance-notice.schema.json` before anything runs. `--dry-run`
(or `DEPLOY_DRY_RUN=1`) prints the payload and publishes nothing. The publish runs in the one-shot admin container as
`admin notice <payload>`, which is dispatched before the Postgres password check, as the NATS user `deploy`; the password is
read from `/run/secrets/nats-deploy.txt` inside the container and is never printed. A failed publish is a warning and exit 0,
so a missing notice never fails a deploy; `COLO_NOTICE_STRICT=1` exits 1 instead.

The `deploy` NATS role publishes `geldar.<shard>.maintenance` and nothing else (subscribe `_INBOX.>`; no JetStream API, no
Kino subjects). Its password file `nats-deploy.txt` is written by `./geldar.ps1 shard nats-auth <shard>` next to the other
role files. It reaches the admin service only through the overlay `compose/colo-notice.yml`, which `deploy/colo-notice.sh`
merges only when `${GELDAR_SECRETS_DIR}/nats-deploy.txt` exists. It is not in `gen-secrets.sh` (no NATS file is), not in the
`up` check, and never merged by `up` or the other admin subcommands, so a node without the file keeps working; the notice
warns, names the file and publishes nothing until the file is copied.

**Existing nodes must regenerate `nats-auth.conf`.** The generator writes `nats-auth.conf` only when it is missing, so an
existing node keeps the old config without the `deploy` user. Do this in a maintenance window, after the current notice:

1. On the trusted machine, keep the old `compose/secrets/nats-auth.conf` (move it aside; do not delete it), then run
   `./geldar.ps1 shard nats-auth colo`. It creates `nats-deploy.txt` and writes a new `nats-auth.conf` from the existing role
   password files, so the other roles keep their passwords.
2. Copy `nats-deploy.txt` and the new `nats-auth.conf` to `GELDAR_SECRETS_DIR` on the node, owned by `GELDAR_SERVICE_UID`
   with mode `0600`, as the other NATS files are (the steps in "(c) Secrets").
3. Restart the `nats` service so it reads the new config (`docker compose ... up -d nats`). This drops every NATS client, so
   publish a notice first.

Until step 2 is done, `colo-notice.sh` publishes nothing and warns; `colo-up.sh` and the other admin commands are unaffected.

## What each script refuses

`colo-up.sh` exits 1 and names the failing check. Its refusals, in order:

- docker or compose v2 is missing, or the daemon cannot be reached;
- the compose file or the secrets overlay is missing;
- free disk is below `GELDAR_MIN_FREE_KB`;
- the secrets directory is missing, or a secret file is missing, empty, or not mode `0600`/`0400`;
- the release manifest is missing, has a line that is not `KEY=VALUE`, has a key that does not end in `_IMAGE`,
  uses the `latest` tag, is not a digest reference, or lists no images;
- the merged config does not validate, publishes port 25565 or 25566 (decision 0082), has an image that is not
  digest-pinned, or has a service with a `build:` key and no `image:` (it would be built on the node);
- the BlueMap lock has no URL, a URL that is not https, or a sha256 that is not 64 lowercase hex characters;
- the BlueMap download fails, or its sha256 does not match the lock (nothing is installed);
- the release record cannot be written in the state directory (nothing is deployed without a record).

`colo-rollback.sh` refuses when no previous release is recorded, and when it cannot write the record.

## Runner or SSH (decision 0130)

The scripts run either from the self-hosted runner on the node or over the owner's existing SSH access. No script in
`deploy/` reads a host or a user name. When SSH is used, the operator sets the target host and user in environment
variables for that session; the names and values are not committed. Do not add an address, a key or a password to the
repository or to a script.

## Caddy

**The Colo deploy does not touch Caddy.** Site snippets are owned by C2. The shared production Caddy (`board-proxy`) has
its admin API OFF, so it cannot be reloaded (owner ruling R39): a public-site change is applied by ONE operator restart of
it, never by a deploy step. See GELDAR_PUBLIC_APPLY below.

## Public sites (C2)

`deploy/colo-public.sh` puts the three public sites (`map`, `glass`, `mcp`; files in `deploy/caddy/`) into the shared
Caddy. It runs `caddy validate` (and, in the default `reload` mode, `caddy reload`) through `docker exec`; it never recreates or
starts the container, and restarts it only in `restart` mode with `GELDAR_PUBLIC_RESTART_OK=1`. Run it on the node as the account that can write the Caddyfile and use docker.

Environment (names only; values come from the operator):

| Variable | Meaning |
|---|---|
| `GELDAR_CADDY_CONTAINER` | the Caddy container name |
| `GELDAR_CADDY_CONFIG_DIR` | host directory bind-mounted at `/config` in the container |
| `GELDAR_CADDY_FILE` | the Caddyfile on the host (mounted at `/etc/caddy/Caddyfile`) |
| `GELDAR_PUBLIC_APPLY` | `reload` (default, needs the Caddy admin API), `restart` (the Colo setting: validate only, no reload, then print `colo-public: files installed and validated; RESTART board-proxy once to apply (docker restart board-proxy)`) or `none`. A failed validate restores the Caddyfile and the previous site files byte for byte in every mode |
| `GELDAR_PUBLIC_RESTART_OK` | only with `1` (and `restart` mode) does the script run `docker restart <container>` itself, once, after validate, then waits up to 30 s for the container to run and `caddy validate` to pass. Never restarts otherwise |
| `GELDAR_PUBLIC_ENV` | a root-only `KEY=VALUE` file (install only): `GELDAR_DOMAIN`, `GELDAR_MAP_UPSTREAM`, `GELDAR_GLASS_UPSTREAM`, `GELDAR_MCP_UPSTREAM`; `GELDAR_REGISTER_UPSTREAM` is optional: unset (register not deployed), glass answers 503 on `/register*` and `/roster*` |
| `REGISTER_MCP_PUBLIC_URL` | the register's MCP address for the onboarding page's connect command, passed by `compose/colo.yml` to the register (empty by default). Unset, the page uses `mcp.<domain>` from `REGISTER_PUBLIC_URL` only when that host's first label is `register` or `glass` (for example `register.example.org` gives `mcp.example.org`); any other host, an apex such as `example.co.uk` or an IP literal, gives no command and says why, so set this variable for it. Must be https. The node's compose file is hand-managed, so the value is set on the node, not in this repo |

Each upstream must be `127.0.0.1:<port>` (the Colo services publish on loopback). Caddy fills `{$VAR}` from its own
process environment, which cannot change without a restart, so `install` renders the placeholders into concrete files
under `$GELDAR_CADDY_CONFIG_DIR/geldar/` and leaves the repo files alone. It refuses a missing variable, a leftover
`{$` and a non-loopback upstream.

Order:

Per-site install: `bash deploy/colo-public.sh install mcp` (or any of `map glass mcp`, several allowed) renders and publishes only the named sites. The others keep their state (absent stays absent, off stays off, live stays live); unknown names are refused. Bare `install` (no site) still makes all three live. `status` prints each site as not installed, off or on.

1. `DEPLOY_DRY_RUN=1 bash deploy/colo-public.sh install` (prints every state change, changes nothing).
2. `bash deploy/colo-public.sh install`: renders the sites, backs up the Caddyfile to `<file>.bak-geldar-<time>`, adds
   the single line `import /config/geldar/*.caddy` if absent, validates, then applies per `GELDAR_PUBLIC_APPLY` (reload, or in restart mode no reload and the restart note). If validate fails, the
   Caddyfile is restored byte for byte, the rendered directory is removed, and the script exits non-zero.
3. `bash deploy/colo-public.sh status` shows the import line and whether each site is on or off.
4. Kill switch: `off <site|all>` swaps in the 503 twin, `on <site|all>` swaps the live file back; each validates and
   reloads, and puts the old files back if validate fails.

Rollback: `bash deploy/colo-public.sh remove` backs up the Caddyfile, removes the import line, validates, deletes the
directory and reloads. If validate fails it restores the Caddyfile and removes nothing.

### Public sites on a node: the order

1. Deploy the stack first: `bash deploy/colo-up.sh`. It needs `GELDAR_GLASS_IMAGE` in the release manifest (a digest
   reference; it refuses a missing one), `postgres-glass.txt` in the secrets directory (required like the other
   secrets), and it sets the `geldar_glass` login password after the `geldar_mcp` one, before the full core starts.
2. Then `bash deploy/colo-public.sh install` (steps above). Run it second: the sites proxy to services that must
   already be up.

Node env values (names only; set them in the deploy env on the node, never in the repo):

| Variable | Meaning |
|---|---|
| `GELDAR_MC_BIND` | the node's own interface address for the public Minecraft port. Set together with `GELDAR_MC_PORT`; the scripts merge `compose/colo-public.yml` only when both are set, refuse exactly one, and refuse anything but one strict IPv4 literal (`a.b.c.d`; no `0.0.0.0`, hostname, IPv6 or list). `colo-up.sh` merges the overlay only in its last step, after the whole stack is healthy, and prints `public Minecraft port published on <bind>:<port>` |
| `GELDAR_MC_PORT` | the public Minecraft port: 1-65535, never 25565 or 25566 (decision 0082) |

There is no `state/release.commit` record. The release record is `state/current.env` and `state/previous.env` (copies of the
release manifest); the manifest carries no commit header, so nothing reads a commit from it.
| `GELDAR_GLASS_TRUSTED_PROXIES` | the address Glass sees Caddy as, from inside its container: the .1 gateway of GELDAR_COLO_SUBNET, the colo bridge /24 you pin (a private range inside 172.16/12 private that nothing else on the node uses). colo-up.sh saves the three values in state/node.env and reloads them; colo-public.sh install refuses without the two proxy lists; colo-status.sh prints them |
| `GELDAR_MCP_TRUSTED_PROXIES` | the same for the MCP service |
| `GELDAR_ACT_BUDGET_ENFORCE` | the act budget is suspended by default and every act is metered (decision 0149). Set `1` on the MCP service to refuse acts again (`budget_exhausted`); any other value leaves it off |
| `REGISTER_KILL_SWITCH`, `REGISTER_PUBLIC_URL`, `REGISTER_TRUSTED_PEERS`, `REGISTER_MS_CLIENT_ID` | the `register` service (C2-08c, profile `register`, decision 0135; Microsoft sign-in only). `REGISTER_PUBLIC_URL` is the Glass origin, `https://glass.<domain>`; the Entra redirect URI is that plus `/register/callback`. `REGISTER_MS_CLIENT_ID` is the Entra app id. The client secret is `register-ms-secret.txt` (owner-provided) and the session key `register-session-key.txt` (generated). OFF BY DEFAULT: the kill switch is true unless set to `false` (the sign-in kill switch: leave it true and recreate the register service), no default `up` starts the service, and `colo-public.sh` does not load `register.caddy`. Keep it off until C2-08d and the C2 gates. `colo-up.sh` sets the `geldar_register` login password after the glass one. |
| `GELDAR_MAP_UPSTREAM`, `GELDAR_GLASS_UPSTREAM`, `GELDAR_MCP_UPSTREAM` | the Caddy upstreams, in `GELDAR_PUBLIC_ENV` (each `127.0.0.1:<port>`) |

Live check for the trusted proxies (do it once per node, after `install`): send one request through Caddy to the Glass
site and one to the MCP site, then read each service log (`docker compose -p geldar-colo logs --tail 20 glass`, and
`mcp`). For Glass, read the log line `glass_untrusted_peer_header`: its `peer` value is the address to set in
`GELDAR_GLASS_TRUSTED_PROXIES`. For the MCP service, the address the log shows for the caller must equal the
value you set in `GELDAR_MCP_TRUSTED_PROXIES`. If it differs, set the variable to the logged address, run
`colo-up.sh` again and repeat the request. Until it matches, the service treats Caddy as an ordinary client.

## Performance diagnostics

Paper 26.1.2 build 74 bundles the spark profiler (spark-paper 1.10.152), so no jar is fetched and there is no hash lock to
check; the Paper build pin (`PAPER_BUILD` in `compose/colo.yml`) pins spark with it. Paper's
entrypoint (compose/paper/paper-entrypoint.sh) writes its config, plugins/spark/config.json in the Paper volume, on every start: the always-on background profiler is off
and results are not broadcast to online operators. Run spark from the console or RCON only:

```sh
docker exec geldar-colo-paper-1 rcon-cli spark tps
docker exec geldar-colo-paper-1 rcon-cli spark health
docker exec geldar-colo-paper-1 rcon-cli spark profiler start --timeout 60
```

Output goes to the RCON reply. A finished profile is uploaded to spark's bytebin (`spark-usercontent.lucko.me`) and the
reply is a viewer link on `spark.lucko.me`. That is the only egress, and it happens only when an operator runs a profiler,
heap or health command that uploads. To keep a profile local, add `--save-to-file` (`spark profiler stop --save-to-file`);
it is written under `plugins/spark/` in the Paper volume. Nothing uploads in the background.

Agents cannot run spark: they are offline players without op, and the `spark` permission is op-only. A repo check
(`tools/repo-checks/src/colo-spark.test.ts`) fails if Paper is given ops or a plugin grants the permission.

## Stop conditions

Stop and do not retry in a loop when:

- any refusal above fires, and you have not found out why;
- the dry run prints a value you did not expect (a different project name, a different compose file, a different
  state directory);
- the BlueMap sha256 does not match the lock (a mismatch means the download or the lock is wrong; do not edit the lock
  to match);
- `up -d --wait` fails. Run `deploy/colo-status.sh`, read the container logs, and decide with the owner before any
  change;
- disk runs low during a deploy.

## Rollback

`deploy/colo-rollback.sh` takes no arguments. It re-applies the release recorded as previous, with `--pull never`, so
it cannot fetch anything new, and it swaps the two records. Running it again goes forward to the release it replaced.
It removes no volume, but it does not undo data changes: rolling back the images does not reverse a database change
the newer release made. Decide on that before rolling back a release that changed the schema.

To stop the project without losing data, run `deploy/colo-down.sh`. Start it again with `deploy/colo-up.sh`.

## Not covered yet

- **NATS auth config.** Generating the per-role NATS password files and the auth config is PowerShell-only:
  `./geldar.ps1 shard nats-auth` on the desktop. The secrets set is then copied to the node's secrets directory by
  hand. There is no shell equivalent yet.
- **Image publish.** `colo-images` publishes the five images (`geldar-body`, `geldar-mind`, `geldar-eventsink`,
  `geldar-mcp`, `geldar-admin`) and writes `release.env` for its run. Take the manifest from the run for
  `<release-commit>`; the publish itself is an ops step.

## Owner actions

- Done 2026-11-11: the owner accepted BlueMap's Mojang resource download (`accept-download: true` in the repo's `core.conf`).
- Choose the deploy path (runner or SSH, decision 0130) and set up the secrets directory and the release manifest on
  the node.
- Run the first deploy with the checklist in `docs/analysis/phase1/worknotes/P1-C1-04.md`.
