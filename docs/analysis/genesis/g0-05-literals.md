# G0-05 literal sweep: what changed, what stays fixed, what lives in workflows

Scope: `deploy/*.sh` and `deploy/common.sh`. Behaviour with no `GELDAR_*` or `COLO_CD_*` value set is unchanged; the
colo deploy uses the same values as before. Tests: `deploy/test/literal-sweep.test.ts`.

## Changed

| File | Was | Now | Default |
| --- | --- | --- | --- |
| `deploy/common.sh` | `PROJECT=geldar-colo` | `PROJECT=${GELDAR_PROJECT:-geldar-colo}` | `geldar-colo` (compose `-p`, label filter, volume prefix) |
| `deploy/colo-admin.sh` | player host `geldar-colo-players-host-…` in 6 places (`hname`, `player-list` lookups and messages) | `$PROJECT-players-host-…` | `geldar-colo-players-host-…` |
| `deploy/colo-cd-players.sh` | `host_name` echoes `geldar-colo-players-host-$1` | `${PROJECT:-${GELDAR_PROJECT:-geldar-colo}}-players-host-$1` (colo-cd-plan.sh sources this file without common.sh) | `geldar-colo-players-host-` |
| `deploy/colo-cd-verify.sh` | `COLO_CD_IMAGE_PREFIX=ghcr.io/sandboxservers` | `${COLO_CD_IMAGE_PREFIX:-ghcr.io/sandboxservers}` | `ghcr.io/sandboxservers` |
| `deploy/colo-cd.sh` | header comment named `/mnt/nvme/geldar-colo/src` | comment points at the `GELDAR_COLO_ROOT` line (comment only) | n/a |

New variable: `GELDAR_PROJECT` (compose project name for one environment). The compose file's own `name:` is
overridden by `-p`, so G0-03 owns only the compose-side names.

## Already environment-driven (default kept, nothing to change)

These were `${VAR:-default}` before this packet; the literal is the default and stays.

- `GELDAR_STATE_DIR` default `/var/lib/geldar-colo` (common.sh)
- `GELDAR_COLO_ROOT` default `/mnt/nvme/geldar-colo/src` (colo-cd.sh)
- `GELDAR_SECRETS_DIR` default `/etc/geldar-colo/secrets`, `GELDAR_RELEASE_FILE` default `/etc/geldar-colo/release.env` (common.sh)
- `COLO_CD_ENV_FILE` default `/home/claude/colo-env.sh` (colo-cd.sh)
- `GELDAR_COLO_COMPOSE` default `$ROOT/compose/colo.yml`, `GELDAR_COLO_SHARD` default `$ROOT/shards/colo-mind.yaml` (colo-admin.sh)
- `GELDAR_SHARD` default `colo` (colo-notice.sh; the maintenance subject is `geldar.$SHARD.maintenance`)
- `GELDAR_SERVICE_UID` default `1000`, `GELDAR_MIN_FREE_KB`, the lock paths, `GELDAR_PUBLIC_SRC`

`SEED` does not appear in `deploy/*.sh` (nothing to sweep here).

## Stays fixed on purpose

- Container paths: `/etc/caddy/Caddyfile` (colo-public.sh), `/run/secrets/*.txt` (colo-up.sh), `/data` in the paper-data
  volume. They are inside the image, not on the host.
- GHCR package names `geldar-body`, `geldar-mind`, `geldar-eventsink`, `geldar-mcp`, `geldar-admin`, `geldar-glass`,
  `geldar-register` (colo-cd-verify.sh `image_name_of`, colo-cd-plan.sh). They are the product image names that
  `colo-images.yml` pushes. A second environment that runs the same release keeps them; changing them is a workflow change.
- Compose file, overlay and service names (`colo.yml`, `nats-auth.yml`, `colo-notice.yml`, `players-host`, `admin`,
  profiles `admin` and `sovereign`). G0-03 owns compose.
- The `colo:` log prefix and the `colo-*.sh` script names (cosmetic; renaming is not needed for a second environment).
- The docker command `docker buildx imagetools inspect` and the PATH defaults in colo-cd.sh.

## Lives in workflows (not touched; for the G4 owner)

Not changed here: `.github/` is owner-approved separately.

- `.github/workflows/colo-deploy.yml`:
  - `runs-on: [self-hosted, geldar-colo-deploy]`: the runner label.
  - `INBOX: /var/lib/geldar-deploy/inbox`: the deploy inbox path.
  - `sudo -n /usr/local/libexec/geldar-deploy/run plan|deploy "$SHA"` (two lines, the plan and deploy steps): the sudo
    path to the root-owned entrypoint.
  - The header comment names the unprivileged user `ghdeploy`.
- `.github/workflows/colo-images.yml`:
  - `if: github.repository == 'SandboxServers/geldar'` on each of the seven image jobs: the repo gate.
  - `ghcr.io/sandboxservers/geldar-<name>` tags and the `GELDAR_*_IMAGE=ghcr.io/sandboxservers/…@$DIGEST` lines
    written to the release manifest: the image org and names.
  - `runs-on: ubuntu-24.04`: the runner image (not environment-specific).

A second environment that uses another runner, inbox, sudo path, repo or GHCR org needs these in the workflows, not in
`deploy/`.
