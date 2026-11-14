# 0260. Body containers are controlled by a root-owned host helper, not by the supervisor

- Status: Decided (owner ruling, 2026-11-14)
- Date: 2026-11-14
- Spec: 5.3 (process model: "a small controller", "does not hold the Docker socket"), v0.7 resolution note (Body supervisor without Docker socket and per-Body NATS credentials)
- Related: 0152 (item 3 is superseded here, the rest stands), 0067 and 0080 (NATS least privilege), 0027 (supervisor package), 0108, 0170
- Packets: [c7f-packets.md](../analysis/phase1/packets/c7f-packets.md) (cards C7-03c1 to c3, C7-03b5, and the adjusted C7-03b2)

## Context

Decision 0152 item 3 says the Colo supervisor "is the only process that holds the Docker socket for bodies". The supervisor is a long-running Node service that takes requests from the register service over NATS. Mounting `/var/run/docker.sock` into it makes a supervisor compromise equal to root on the Colo host. The C7-03b2 card, as first written, also mounted the socket and relied on a `:ro` bind and a `docker` group GID as the only controls. Neither control limits what a socket client can do: a `:ro` bind on a Unix socket does not stop Docker API writes.

The spec (5.3) already names the intended shape: a small controller that spawns processes and does not hold the Docker socket. The owner ruled on 2026-11-14 that this is design (B).

## Decision

1. **Item 3 of 0152 is superseded in one part.** The words "The supervisor is the only process that holds the Docker socket for bodies" no longer hold. Everything else in 0152 stands: the owner API, the two credentials, the narrow `ctl.body.*` surface from the register service, the knowledge boundary, and the roster from the database.
2. **A root-owned host helper controls Body containers.** The helper is a small Node service on the Colo node, run as a systemd unit, not in a container. Only the helper touches the Docker socket. It exposes four fixed verbs (`start`, `stop`, `status`, `logtail`). The Body container is built from a template inside the helper. Callers supply only a verb and a roster name.
3. **The supervisor and the register service never touch the Docker socket.** The supervisor keeps roster ownership, quota, one request in flight, audit and the `ctl.body.*` surface. It asks the helper over NATS for each container action. No Docker socket is mounted into any container, and the supervisor compose service has no host mounts except its secret files.
4. **This reconciles with spec 5.3 without editing the spec.** The spec's "small controller" text is met by the helper. The owner's ruling is that the controller, not the supervisor, controls containers. `docs/spec.md` is not edited (decision 0073).
5. **Proxying the socket is rejected.** A Docker API proxy filters by endpoint, not by content. Allowing `POST /containers/create` lets the caller choose the image, mounts and flags. A fixed-verb helper that builds the container itself is the only control that limits content.

## Threat model

- A **supervisor compromise** yields only the four fixed verbs, applied to names that the helper itself checks against the database. It never yields arbitrary containers, images, mounts or flags.
- A **helper compromise** is root on the Colo node. The helper is therefore kept small, root-owned, with a narrow Postgres role and a NATS user limited to its own subject, and it has no inbound port.
- A **register compromise** gets only the `ctl.body.*` surface it had before (0152).
- Every verb attempt is logged by name, with no secrets.

## What it changes

- The C7-03b2 card no longer mounts the socket or sets `group_add`.
- New cards C7-03c1 (helper), C7-03c2 (install script and runbook), C7-03c3 (supervisor uses the helper) and C7-03b5 (supervisor entry and image). See [c7f-packets.md](../analysis/phase1/packets/c7f-packets.md).
- Nothing is built until the node steps are agreed with geldar-93.

## What it does not change

- The owner API, the register lane and the C7-04 cards.
- The Body container spec (C7-03b4): the same flags, now built by the helper.
- The rule that Bodies get per-Body NATS credentials (spec 5.3).
