# Colo compose drift: the node runs a copy of the repo's compose file

Status: finding, read-only, 2026-11-20. Nothing on the node has been changed for it.

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
3. `RCON_CMDS_STARTUP`: the repo adds `gamerule players_sleeping_percentage 50`; the node lacks it.
4. golem-body: the repo has `profiles: ["adam"]` (decision 0212); the node has no profile line.
5. players-host restart policy: node `on-failure:5`, repo `unless-stopped` (decision 0342).
6. players-host: the repo passes `GELDAR_TELEMETRY_URL` through (#840); the node does not. Two C1-07 comments are
   also missing on the node.
7. Names and ports: the node has the literal project name, network name and loopback ports; the repo has
   `${GELDAR_PROJECT}`, `${GELDAR_NETWORK}` and `${GELDAR_PORT_*}`, with the same defaults.

## Not yet checked

- `compose/nats-auth.yml`, `compose/colo-public.yml` and the kino overlays. A read-only diff by ops is pending.

## Options

- **a. Node edit.** Edit the node copy by hand to match the repo. Quick, but it is not reviewed and the next sync
  overwrites it.
- **b. The colo-admin.sh fix (this PR).** `player-start` passes `GELDAR_TELEMETRY_URL` as a bare `-e NAME` only when
  it is set and non-empty, so compose copies the value from the calling shell. The value never reaches the command
  line, the logs or the dry run. This is chosen now. It is active only at the next player-host recreate
  (`player-start` after `player-stop`), which restarts the Bodies and needs an owner window.
- **c. Repo as truth.** Port the node-only edits into the repo first; owners decide items 3, 4 and 5; then sync the
  node or point the deploy at the work checkout. Do it in one window, with a render-versus-running proof (render the
  merged config from the repo, compare it with the running containers' config).

## Decision

Option b is taken now. Options a and c remain open. Item 1 (limits) and items 2 and 6 (agents, telemetry) need the
owner's call before any sync, because a sync changes running behaviour. The owner window for the next player-host
recreate is not yet set.

## Checks

- `deploy/test/colo-admin-telemetry.test.ts` covers option b: the bare flag when set, no flag when unset or empty,
  and no value in the arguments, the logs or the dry run.
