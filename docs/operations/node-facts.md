---
title: Node facts
type: reference
audience: agents-never
status: draft
last_verified: 2026-11-16 against 03c1f5de
companions: [../architecture/deployment-topology-colo.md, ../architecture/network-and-trust-zones.md, ../runbooks/node-only-config.md, ../runbooks/colo-deploy.md, ../runbooks/nats-auth-inplace.md, ../runbooks/body-helper-node-steps.md, ../reference/compose-stacks.md, ../reference/deploy-scripts.md, capacity-and-cost.md, monitoring-and-vitals.md]
sources: [docs/runbooks/node-only-config.md, docs/runbooks/README.md, docs/runbooks/colo-deploy.md, docs/analysis/phase0/bench-results.md, docs/reference/compose-stacks.md, deploy/common.sh, deploy/colo-cd-plan.sh, body-helper/src/helperConfig.ts, ../decisions/0084-colo-deploy-by-pull-with-a-project-scoped-script.md, docs/runbooks/nats-auth-inplace.md, docs/runbooks/body-helper-node-steps.md, docs/runbooks/signcheck-shard.md, docs/architecture/deployment-topology-colo.md, docs/concepts/world-operations-exceptions.md, deploy/README.md, compose/colo.yml, shards/colo.yaml, ../decisions/0002-phase0-host-and-models.md, ../decisions/0078-mind-placement-for-phase1.md, ../decisions/0082-colo-compose-network-and-limits.md, ../decisions/0096-public-topology-as-built.md, ../decisions/0130-phase1-owner-rulings-for-c1.md, ../decisions/0134-mind-is-a-profile-until-a-thinker-exists.md, ../decisions/0260-body-container-control-by-host-helper.md, ../decisions/0350-telemetry-scope-and-full-capture.md, ../decisions/0351-paper-telemetry-plugin-scope.md, ../decisions/0352-telemetry-dedicated-clickhouse-database.md]
---

# Node facts

What the repo's existing documents say about the machines Geldar runs on: their roles, what runs on them, what they hold that the repo does not, and the few measurements that were recorded. This page collects; it does not observe. Nothing here was read from the node, the VM, the database or the world for this page (plan decision D8).

How to read a row:

- Every node fact carries its source document, the date that document gives for it, and the word **unverified**. "Unverified" means only that this page did not re-check it on the node; the source may have checked it at the time.
- Facts about the repo itself (a compose file, a script) were re-read at 03c1f5de on 2026-11-16 and say so.
- No host name, SSH alias, address, account name, path on a node, secret value or secret location is written here. A directory is named by its role. A value the source records on purpose (an image digest, a port the repo already fixes) is left out when this page does not need it.
- Links marked **(a-n)** go to `agents-never` documents.

For how the stack is laid out and why, read [deployment topology](../architecture/deployment-topology-colo.md). For the inventory of node-only configuration and how genesis plans to close it, read the [node-only config runbook](../runbooks/node-only-config.md).

## Roles

| Role | What it is for | Source, date, status |
|---|---|---|
| Colo node | One shared Linux node that runs the Geldar compose project beside other tenants. The spec's separate game, body and record hosts are not built; one node carries them. | [deployment topology](../architecture/deployment-topology-colo.md), "What runs on the node", repo read at 1b114276, 2026-11-16; node unverified |
| Geldar hosts VM | A separate VM whose processes reach the Colo MCP through a firewall policy on the network gateway. | [node-only config](../runbooks/node-only-config.md) item 6, entered 2026-11-14, unverified. What runs on it is not stated in that document. |
| Mind hosts | Hosts that run Mind and kit processes and send their telemetry to the Colo over an authenticated ingest route (planned). The decisions say "Mind hosts" without naming which machine. | decision [0350](../decisions/0350-telemetry-scope-and-full-capture.md) item 9 and card T-13, 2026-11-15; [0352](../decisions/0352-telemetry-dedicated-clickhouse-database.md), 2026-11-16; unverified. Whether these are the Geldar hosts VM is not stated: inferred only from the gateway policy's name. |
| Signcheck VM | A throwaway VM for the sign-fact shard, compose project `geldar-signcheck`, loopback binds only. Not part of the Colo. | [signcheck-shard runbook](../runbooks/signcheck-shard.md); [node-only config](../runbooks/node-only-config.md) item 15, 2026-11-14/15; unverified |
| Owner's desktop | The Phase 0 host (one Windows PC with local models), and the host of every recorded body benchmark. The plugin jar is built there and copied to the node by hand; the NATS auth set is generated there and copied by hand. | decision [0002](../decisions/0002-phase0-host-and-models.md); `docs/analysis/phase0/bench-results.md` notes (2026-11-09); [node-only config](../runbooks/node-only-config.md) item 7; `deploy/README.md`, "Not covered yet" (repo, 03c1f5de); unverified |
| Operator workstation | Holds the telemetry viewer key and reaches the node over the existing SSH access. Never holds anything an agent reads. | decision [0350](../decisions/0350-telemetry-scope-and-full-capture.md) item 6 and its 2026-11-16 clarification; [0352](../decisions/0352-telemetry-dedicated-clickhouse-database.md) "Read path"; unverified |
| Network gateway | Carries the firewall policy from the Geldar hosts VM to the Colo MCP, with a backup of its policy file. | [node-only config](../runbooks/node-only-config.md) item 6, 2026-11-14; unverified |
| Thinker hosts | Home GPUs reached through a gateway, per the Phase 1 placement. On the Colo the project's own Mind stays off until a Thinker path exists. | decisions [0078](../decisions/0078-mind-placement-for-phase1.md) (Accepted) and [0134](../decisions/0134-mind-is-a-profile-until-a-thinker-exists.md); unverified on any host |

## What runs on the Colo node

### Geldar

| Item | Fact | Source, date, status |
|---|---|---|
| Compose project | One project, `geldar-colo`, from `compose/colo.yml` plus the NATS auth and secrets overlays; every script names the project. | `deploy/common.sh` `dc()`; decision [0084](../decisions/0084-colo-deploy-by-pull-with-a-project-scoped-script.md) item 2; repo re-read 2026-11-16 at 03c1f5de |
| Services | The 14 services of `compose/colo.yml`, of which nine run by default; the rest are behind the `adam`, `mind`, `register`, `sovereign` and `admin` profiles. | [compose stacks](../reference/compose-stacks.md#colo-stack-composecoloyml), repo at 1b114276; which profiles are up on the node is unverified |
| Idle Adam Body | The `golem-body` container exists and is stopped on purpose; stopped once by hand at about 20:11Z on 2026-11-14. | [node-only config](../runbooks/node-only-config.md) item 13; unverified |
| Player Bodies | 19 player Bodies ran on 2026-11-15; none started telemetry. | decision [0350](../decisions/0350-telemetry-scope-and-full-capture.md), "Context" (survey of 2026-11-15); unverified |
| Body helper | A root-owned systemd unit, the only holder of the Docker socket, that makes the managed Body containers. Its Body limits come from its node env file, not the repo. | decision [0260](../decisions/0260-body-container-control-by-host-helper.md) item 2; [body-helper-node-steps](../runbooks/body-helper-node-steps.md); `body-helper/src/helperConfig.ts` (repo, 03c1f5de); install state unverified |
| Self-hosted runner and deploy entrypoint | A runner with the label `geldar-colo-deploy`, and a root-owned entrypoint run through sudo, installed by hand. | [colo-deploy runbook](../runbooks/colo-deploy.md) step 6; [node-only config](../runbooks/node-only-config.md) item 14 (2026-11-14/15); unverified |
| Paper | Paper 26.1.2 build 74 with Java 25; heap flags 10 GiB; memory 12.7 of 14 GiB in use; CPU-throttled in about 25% of scheduler periods since its 14:00 UTC start. | decision [0351](../decisions/0351-paper-telemetry-plugin-scope.md), "Context" (survey read 2026-11-15 and 00:58 UTC 2026-11-16); unverified. See [conflict 1](#conflicts-recorded). |
| bStats | Enabled in Paper at the survey; the owner ruled it off as a node step still to apply. | decision [0351](../decisions/0351-paper-telemetry-plugin-scope.md) "Context" and item 13 (2026-11-15); unverified |
| World border | Radius 9500 since the spawn-town cutover. | [world-operations exceptions](../concepts/world-operations-exceptions.md) (2026-11-15), citing `compose/colo.yml` and `shards/colo-mind.yaml`; the live value is unverified |
| Telemetry | Nothing switched on; no Geldar series in the observability stack. | decision [0350](../decisions/0350-telemetry-scope-and-full-capture.md), "Context" (2026-11-15); unverified. See [monitoring and vitals](monitoring-and-vitals.md) **(a-n)**. |

### Other tenants

Geldar shares the node and never changes these (decision [0084](../decisions/0084-colo-deploy-by-pull-with-a-project-scoped-script.md) item 2; [0352](../decisions/0352-telemetry-dedicated-clickhouse-database.md), "Who decides").

| Item | Fact | Source, date, status |
|---|---|---|
| Production game server | Owns the node's standard Minecraft port; the Colo file never publishes 25565 or 25566. | `compose/colo.yml` header (repo, 03c1f5de); decision [0082](../decisions/0082-colo-compose-network-and-limits.md); the node side unverified |
| CI runners | About 1 GiB of memory each. | decision [0352](../decisions/0352-telemetry-dedicated-clickhouse-database.md), fit check (2026-11-15 23:49 UTC); unverified |
| Watchtower | Auto-updates containers it finds; every Geldar service opts out by label. | `deploy/README.md`, "Prerequisites" (repo, 03c1f5de); presence on the node unverified |
| Shared Caddy | A host-network container that Geldar adds per-site files to and reloads, never restarts. | decision [0096](../decisions/0096-public-topology-as-built.md) item 1 (2026-11-11, Proposed); unverified |
| Another tenant's observability stack | Its own ClickHouse (4.7 GiB in use) and ZooKeeper (1.0 GiB), with no CPU or memory limits. Geldar's telemetry goes to a separate Geldar-owned stack instead (0352 option B, not built). | decisions [0350](../decisions/0350-telemetry-scope-and-full-capture.md) "Open items" and [0352](../decisions/0352-telemetry-dedicated-clickhouse-database.md) "Context" and fit check (2026-11-15); unverified |

## Measured capacity

One read-only measurement is recorded, in decision [0352](../decisions/0352-telemetry-dedicated-clickhouse-database.md), "Fit check", at 2026-11-15 23:49 UTC. All figures unverified here.

| Measure | Value | Source, date, status |
|---|---|---|
| CPUs | 16; load average 1.16, 1.12, 0.94; about 95% idle | 0352 fit check, 2026-11-15 23:49 UTC; unverified |
| Memory | 128 GB total; 29 GB used; 98 GB available | 0352 fit check, 2026-11-15 23:49 UTC; unverified |
| Data disk | 1.8 TB; 1.2 TB free (35% used) | 0352 fit check, 2026-11-15 23:49 UTC; unverified |
| Root filesystem | 20 GB free | 0352 fit check, 2026-11-15 23:49 UTC; unverified |
| Sum of container memory limits on the node, all tenants | 185 GB (overcommitted on paper; real use 29 GB) | 0352 fit check, 2026-11-15 23:49 UTC; unverified |

What these mean for Geldar's budget is in [capacity and cost](capacity-and-cost.md).

## What the node holds that the repo does not

A summary by role of the [node-only config](../runbooks/node-only-config.md) inventory (verified there 2026-11-14/15; unverified here). The runbook keeps the detail and the reproduction order; it records some node paths, which this page leaves out.

| Item | In the repo | Who applies it |
|---|---|---|
| Gamerules in the world's level data | Partly: startup lines in `compose/colo.yml`; `compose/phase0.yml` lacks the sleeping-percentage line | Operator by hand, with owner approval |
| CoreProtect config and database | Jar lock yes; config no template; database is data | Operator by hand after first start |
| The node's copy of `compose/colo.yml` | Source yes; the node copy is hand-synced and can drift | Operator by hand |
| Glass alias file | No; never committed | Operator by hand, then a Glass restart |
| NATS auth file and per-user password files | Generator yes; live file differs from it | Owner go; operator edits in place |
| Gateway firewall policy | No | Owner approval; operator enters it |
| Geldar-Core plugin jar | Source yes; the copy step is manual | Operator by hand |
| BlueMap config, aliases and player heads | Config yes; heads and aliases no | Operator by hand |
| Skins in the NATS skins bucket | No; signed files are held by the owner | Owner supplies; operator imports |
| MCP token files and secret files | Verbs yes; values no | Operator through the admin verbs |
| Roster and player rows | Verbs yes; data no | Operator through the admin verbs |
| World data, whitelist, spawn | House Body whitelist scripted; the rest no | Operator |
| Deploy wrapper, its work copies, the CD env file | Entrypoint call yes; wrapper and env file no | Operator; cleanup needs the owner |

Two more node-only items appear in other documents:

- **The release manifest and records.** A root-owned copy of the release manifest, and previous and current release records in the state directory. `colo-cd.sh` keeps its own manifest copy; `deploy/README.md` says to keep the two in step by hand ([deployment topology](../architecture/deployment-topology-colo.md#conflicts-recorded), item 5; repo at 1b114276).
- **The secrets directory.** Root-only; the scripts check each file's mode and size and never read contents. Which files it must hold is read from the merged compose config. The register service's identity-provider secret is created on the node by hand (`deploy/README.md`, "Prerequisites", repo at 03c1f5de).

## How changes reach the node

Repo facts, re-read 2026-11-16 at 03c1f5de:

- Images are built in CI and pulled by digest; nothing is built on the node (decision [0084](../decisions/0084-colo-deploy-by-pull-with-a-project-scoped-script.md) item 1).
- Deploys go through the self-hosted runner or the owner's SSH access; no deploy account exists (decision [0130](../decisions/0130-phase1-owner-rulings-for-c1.md) ruling 1).
- `deploy/colo-cd.sh` never restarts Paper, Velocity, Caddy, Postgres or NATS. `colo-cd.sh` prints `needs manual` for `plugin/`, `compose/`, `deploy/caddy/` and NATS config only while the export's hash of that folder differs from the record that `colo-cd.sh --record-applied` wrote (`deploy/colo-cd-plan.sh` folder hashes; [colo-deploy](../runbooks/colo-deploy.md#needs-manual)).
- A change to the live NATS file is made in place, never by replacing the file, and must land in the generator in the same change ([nats-auth-inplace](../runbooks/nats-auth-inplace.md), "Facts the procedure depends on" and "Drift to resolve first").

## Recorded drift

| Drift | Source, date, status |
|---|---|
| NATS users: on 2026-11-14 the live file had 8 users; the generator on `main` defines 11 users for the colo table (`Get-NatsUsers` in `geldar.ps1`, counted 2026-11-16 at 02e9ee34). | [nats-auth-inplace](../runbooks/nats-auth-inplace.md) (as of 2026-11-14); unverified. The [runbooks index](../runbooks/README.md#what-could-not-be-checked) **(a-n)** notes PR #415 has since merged, so the generator side has moved. |
| Deploy work copies: 111 old copies, never cleaned. | [node-only config](../runbooks/node-only-config.md) item 14 (2026-11-14/15); unverified |
| Glass alias directory: the runbook's default differs from the directory in use on the node. | [node-only config](../runbooks/node-only-config.md) item 4; unverified |
| The node's compose file: hand-synced, no sync check exists. | [node-only config](../runbooks/node-only-config.md) item 3; unverified |

## Conflicts recorded

None is resolved here.

1. **Paper's memory.** `compose/colo.yml` (repo, 03c1f5de): Paper's limit defaults to 8192m and its heap to 6G (lines 99 and 117). Decision [0351](../decisions/0351-paper-telemetry-plugin-scope.md), "Context", and [0352](../decisions/0352-telemetry-dedicated-clickhouse-database.md), fit check (node surveys, 2026-11-15): 14 GiB limit, 10 GiB heap. 0351 item 13 proposes 15 GiB and asks which file holds the limit. Decision [0082](../decisions/0082-colo-compose-network-and-limits.md) (Proposed) says every limit comes from `shards/colo.yaml`. The node's compose file is hand-synced (node-only config item 3), so the node may run values the repo does not hold.
2. **The NATS auth path.** [nats-auth-inplace](../runbooks/nats-auth-inplace.md) forbids regenerating the live file; the kino and skins runbooks tell the reader to regenerate it. Recorded in the [runbooks index](../runbooks/README.md#what-could-not-be-checked) **(a-n)**.

## Not written here

- Host names, SSH aliases, addresses, the gateway's identity and the DNS names (decision [0096](../decisions/0096-public-topology-as-built.md) item 8 keeps them owner-held).
- Paths on any node, secret file names beyond what `deploy/README.md` already publishes, and every secret value.
- Anything read live. A read-only fact pass on the node and the VM waits for the owner (plan decision D8).

## Related

- Why the stack is laid out this way: [deployment topology](../architecture/deployment-topology-colo.md), [network and trust zones](../architecture/network-and-trust-zones.md).
- Budgets and cost: [capacity and cost](capacity-and-cost.md).
- What watches the node: [monitoring and vitals](monitoring-and-vitals.md) **(a-n)** (operators only).
- Failure modes per component: [failure modes](failure-modes.md).
