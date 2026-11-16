---
title: Architecture index
type: reference
audience: contributors
status: draft
last_verified: 2026-11-16 against 1b114276
companions: [../README.md, ../reference/README.md, ../concepts/README.md, ../analysis/docs-library/plan.md]
sources: [docs/analysis/docs-library/plan.md, compose/colo-public.yml]
---

# Architecture

Explanation docs about how Geldar is put together: its components, how data and messages move between them, the network and trust boundaries, the NATS bus, the Colo deployment, the build and release pipeline, and how the packages depend on each other. Each one says why the system is shaped the way it is and records where the spec, the decisions and the code disagree. For exact fields, options and lists, read the [reference](../reference/README.md); for steps, read the [runbooks](../runbooks/README.md).

Documents marked `agents-never` or `operators` are operator material. Never copy or link them into anything an agent in the world reads ([documentation style](../agents/documentation-style.md#agents-never-learn-they-are-watched)).

## Written

All are wave W1 of the [documentation plan](../analysis/docs-library/plan.md), pinned to 1b114276 on 2026-11-16, and `draft` until the W1 review passes them.

| ID | Doc | What it explains | Audience | Status |
|---|---|---|---|---|
| A01 | [system-overview.md](system-overview.md) | The components as built, drawn from the compose files; profiles and overlays; what the spec designs that is not built | contributors | draft |
| A02 | [data-flow-events.md](data-flow-events.md) | Events versus requests on NATS, the `GELDAR_EVENTS` stream, the eventsink, subject to table, the read path for people | contributors | draft |
| A03 | [network-and-trust-zones.md](network-and-trust-zones.md) | The spec's three zones against one shared node; loopback publishes, the Caddy sites, trust boundaries | operators | draft |
| A04 | [nats-topology.md](nats-topology.md) | The NATS server, the authorization model, the users by role, streams and KV buckets | operators | draft |
| A05 | [deployment-topology-colo.md](deployment-topology-colo.md) | What runs on the Colo node, the compose file set, how a release arrives, rollback | operators | draft |
| A06 | [build-and-release.md](build-and-release.md) | CI, the publishing workflows, pins, and release identity | contributors | draft |
| A07 | [telemetry-pipeline.md](telemetry-pipeline.md) | Telemetry for diagnosis: how decisions 0350 to 0352 got here, the planned pipeline, what the repo holds, its lifecycle | agents-never | draft |
| A08 | [repo-map-and-dependencies.md](repo-map-and-dependencies.md) | The workspace package graph measured from imports, 1 to 3 hops, and the plan's inferred edges checked | contributors | draft |

## Reading order

1. [System overview](system-overview.md) for the parts.
2. [Data flow and events](data-flow-events.md) for how they talk.
3. [NATS topology](nats-topology.md) and [network and trust zones](network-and-trust-zones.md) for who may talk to whom.
4. [Deployment topology](deployment-topology-colo.md) and [build and release](build-and-release.md) for how it gets to the node.
5. [Repo map and dependencies](repo-map-and-dependencies.md) before a change that crosses packages.

## Conflicts these docs record

Each doc ends with a "Conflicts recorded" section that gives every account and picks none. The ones with the widest reach:

- Known gap, open and not fixed: the public overlay against decision 0137 (decision [0364](../decisions/0364-known-gap-public-overlay-against-0137.md)).
- The MCP's NATS reach differs between spec 6.4, decision 0067 and the generator ([nats-topology](nats-topology.md#conflicts-and-drift-recorded)).
- The supervisor's image is built, but no compose file in the repo runs it ([system-overview](system-overview.md#conflicts-recorded)).
