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
| `colo-down.sh` | Stops the project. Containers, networks and volumes are kept. |
| `colo-status.sh` | Read-only. Lists the project's containers, ports and one resource sample. |
| `gen-secrets.sh` | Creates the missing secret files from `/dev/urandom`. Never overwrites a file, never prints a value. |
| `compose.secrets.yml` | Overlay that points the secret names at the node's secrets directory. |
| `release.env.example` | The release manifest template. Copy it and fill in digests; it holds no values. |

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
  `postgres-mcp.txt` and `mcp-token-pepper.txt` when they are missing. The NATS files (`nats-mind.txt`,
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
   absent the step is skipped and says so; do not treat that as verified.
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

NATS auth is on by default (decision 0080): every compose call merges `compose/nats-auth.yml`. The overlay names its
files under the checkout's `compose/secrets/`, not `GELDAR_SECRETS_DIR`: put `nats-auth.conf` (the server config,
bind-mounted) and `nats-paper.txt`, `nats-velocity.txt` and `nats-eventsink.txt` there, owned by `GELDAR_SERVICE_UID`
with mode `0600`. The deploy refuses until they exist.

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

Before you start a ranger's host, add `<player>` under `sovereign.players` in `shards/colo-mind.yaml`. Then mint its
token:

```sh
deploy/colo-admin.sh token-mint <player>     # prints the file path and byte length, never the value
```

The token file is `<tokens-dir>/<player>.token`, mode `0600`. Give it to the ranger's desktop by a channel outside
chat. Then start the ranger's host with the secrets overlay:

```sh
GELDAR_PLAYER_ID=<player> docker compose -p geldar-colo -f compose/colo.yml -f deploy/compose.secrets.yml --profile sovereign up -d players-host
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
- BlueMap is not mounted. Accepting its download is the owner's call (`plugins/bluemap/bluemap.lock.json`).
- Postgres service roles are superuser for now (C2).
- NATS auth generation is PowerShell-only; copy its files from the trusted machine.
- The admin service mounts `postgres.txt` and `postgres-mcp.txt` (at `/run/secrets/postgres-mcp.txt`). The
  `migrate --set-role-password` step reads the second one. Both files must exist before the first `up`.
- `token-mint` needs `GELDAR_TOKENS_DIR` writable by uid 1000 (the admin container's user) and readable by the
  operator. The script requires mode `0700` on that directory, so the owner decides how to satisfy both.
- `run --rm` starts the admin service's dependencies (Postgres) if they are not already running. It removes nothing.

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

**Never restart the shared Caddy. Only reload it.** The Colo deploy does not touch Caddy. Site snippets are owned by
C2. Caddy is shared on the node, so a restart is never a deploy step; a reload is the only action allowed there.

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

- Accept BlueMap's Mojang asset download in the deployed `core.conf` only. The repository does not make that choice,
  and the download is not approved by this runbook.
- Choose the deploy path (runner or SSH, decision 0130) and set up the secrets directory and the release manifest on
  the node.
- Run the first deploy with the checklist in `docs/analysis/phase1/worknotes/P1-C1-04.md`.
