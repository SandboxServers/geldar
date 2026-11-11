# 0134: The Mind is a compose profile until a Thinker path exists

Status: Accepted (orchestrator, 2026-11-11)

## Context

The Mind (`animus`, the Record/Mind host, decision 0078) needs a model endpoint: the Thinker gateway on a home GPU.
That gateway is not built. On the Colo, `animus` starts with `GELDAR_IN_NETWORK_HOSTS` and Ollama at
`127.0.0.1:11434`, which does not exist on the node, so the Mind exits at boot and crash-loops. The rangers are
sovereign players with no Mind of ours (decisions 0052 to 0055), so the core services need no Mind to serve them.

## Decision

On the Colo, `animus` is under the compose profile `mind` in `compose/colo.yml`. `shard up colo` and
`deploy/colo-up.sh` start the core services only (Postgres, NATS, Paper, Velocity, eventsink, the Body, the MCP).
The service keeps its image, budget and wiring; it starts only with `docker compose --profile mind up`.

The profile comes off when a Thinker path exists (the C4 gateway, decision 0078). The change is the profile line
in `compose/colo.yml`, and a new decision that names the gateway.

## Consequences

- A plain Colo deploy waits on no Mind, so `up --wait` no longer fails on `animus`.
- `deploy/colo-status.sh` and its tests do not expect `animus` to be healthy by default.
- The Mind's budget stays in the compose file, so the shard's total cap still counts it.
