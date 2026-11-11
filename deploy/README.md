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
  - `postgres.txt`, `rcon.txt`, `velocity-forwarding.txt` and `nats-body.txt` each exist, are not empty, and have
    mode `0600` or `0400`.
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
   pulls, and runs `docker compose pull` and `up -d --wait`. The script prints `deployed: project geldar-colo (no
   volume was removed)` on success.
6. **Check.** `deploy/colo-status.sh`. Every service should be healthy.

Run the scripts from the repository root, or set `GELDAR_COLO_ROOT` to the checkout.

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
- **Image publish.** No workflow publishes `geldar-body`, `geldar-mind` or `geldar-eventsink` to a registry. Until one
  exists, the release manifest cannot name a published digest for those images.
- **Node wiring for NATS auth.** `compose/nats-auth.yml` is not wired into the node's deploy. The colo file runs
  without it.

## Owner actions

- Accept BlueMap's Mojang asset download in the deployed `core.conf` only. The repository does not make that choice,
  and the download is not approved by this runbook.
- Choose the deploy path (runner or SSH, decision 0130) and set up the secrets directory and the release manifest on
  the node.
- Run the first deploy with the checklist in `docs/analysis/phase1/worknotes/P1-C1-04.md`.
