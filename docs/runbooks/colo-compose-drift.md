# Colo compose drift: the node runs a copy of the repo's compose file

Status: finding, read-only, 2026-11-20. Nothing on the node has been changed for it.

Update 2026-11-28: the node's `colo.yml` was hand-patched (file sha256 starts `ebca19fc`), and the CD never copies `compose/`.
The by-hand procedure and the rule not to overwrite the node file with a repo copy are in
[colo-deploy.md](colo-deploy.md) ("Compose on the node"). The card that makes the repo file express the node's live settings,
so the copy is safe, is [work-packets-colo-compose-reconcile.md](../analysis/harness/work-packets-colo-compose-reconcile.md).

## What the deploy reads

- `deploy/common.sh` sets `ROOT` from `GELDAR_COLO_ROOT`, and the compose file is `COMPOSE_FILE` under it. On the node
  that is a node-local copy of the colo source directory, not the repo checkout.
- Only the `DEPLOY_DIR` scripts and `compose.secrets.yml` come from the exported work checkout.
- So a repo change to `compose/colo.yml` does not reach the running stack until the node copy is synced. A green CI
  run proves the repo file, not the running one.

## Divergence, as read on 2026-11-20 (node copy against the repo)

Values are from the node's compose file and the repo's. No secret values, no addresses.

1. Paper limits: node 8 CPUs, 15360m memory, heap 10G; repo 3 CPUs, 8192m, heap 6G. A sync would lower them.
2. Ledger and OTel agent: node-only mounts and env (`JAVA_AGENTS`, `OTEL_JAVAAGENT_CONFIGURATION_FILE`,
   `OTEL_SDK_DISABLED=false`, the `ledger.jar` and agent jar mounts, and the `otel-agent.properties` and
   `ledger.properties` mounts).
3. `RCON_CMDS_STARTUP`, gamerule: the repo carries `gamerule players_sleeping_percentage 10` (decision 0460); the node has no
   such line. The live world value is 10 (set by the owner on 2026-11-27 through RCON). A Paper recreate from the node
   file would leave the gamerule at the default, so the repo line is what keeps the live value.
3b. The node border is `worldborder set 19000`, equal to the repo; there is no border difference.
4. golem-body: the repo has `profiles: ["adam"]` (decision 0212); the node has no profile line.
5. players-host restart policy: node `on-failure:5`, repo `unless-stopped` (decision 0342).
6. players-host: the repo passes `GELDAR_TELEMETRY_URL` through (#840); the node does not. Two C1-07 comments are
   also missing on the node.
7. Names and ports: the node has the literal project name, network name and loopback ports; the repo has
   `${GELDAR_PROJECT}`, `${GELDAR_NETWORK}` and `${GELDAR_PORT_*}`, with the same defaults.

## Sibling compose files, read 2026-11-20

Read on the node by sha comparison against origin/main aa0c19ee. No secret values involved. Of the 18 sibling files
in the repo's `compose/` (all but `colo.yml` and `.env.example`), 14 are on the node:

- 12 are identical to the repo: `colo-kino-session.yml`, `colo-kino.yml`, `colo-notice.yml`, `colo-public.yml`,
  `mcp.yml`, `nats-auth-mcp.yml`, `nats-auth.yml`, `nf-live-telemetry-off.yml`, `nf-live-telemetry.yml`,
  `nf-live.yml`, `phase0.yml`, `rcon-host.yml`.
- 2 differ:
  - `nf-live-human.yml` differs functionally. The repo adds a `velocity-human-init` service, a chown one-shot, a
    `depends_on`, and `restart: unless-stopped`; the node has the older revision.
  - `nf-live-probe.yml` differs only in comments.
- 4 are not on the node: `nf-live-bluemap-web.yml`, `nf-live-mod-bluemap.yml`, `nf-live-mod-chunky.yml`, `signcheck.yml`.

`colo.yml` is the main divergence (items 1 to 7 above). The functional `nf-live-human.yml` divergence belongs in
option c with the `colo.yml` items. `nf-live-probe.yml` is comments only and does not.

## Options

- **a. Node edit.** Edit the node copy by hand to match the repo. Quick, but it is not reviewed and the next sync
  overwrites it.
- **b. The colo-admin.sh fix (this PR).** `player-start` passes `GELDAR_TELEMETRY_URL` as a bare `-e NAME` only when
  it is set and non-empty, so compose copies the value from the calling shell. The value never reaches the command
  line, the logs or the dry run. This is chosen now. It is active only at the next player-host recreate
  (`player-start` after `player-stop`), which restarts the Bodies and needs an owner window.
- **c. Repo as truth.** Port the node-only edits into the repo first; owners decide items 3, 4 and 5; then sync the
  node or point the deploy at the work checkout. Do it in one window, with a render-versus-running proof (render the
  merged config from the repo, compare it with the running containers' config). The `nf-live-human.yml` drift goes
  into this job too.

## Decision

Option b is taken now. Options a and c remain open. Item 1 (limits) and items 2 and 6 (agents, telemetry) need the
owner's call before any sync, because a sync changes running behaviour. The owner window for the next player-host
recreate is not yet set.

## Checks

- `deploy/test/colo-admin-telemetry.test.ts` covers option b: the bare flag when set, no flag when unset or empty,
  and no value in the arguments, the logs or the dry run.
