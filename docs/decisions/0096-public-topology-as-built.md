# 0096. Public topology as built on the Colo node

- Status: Proposed (orchestrator, 2026-11-11)
- Date: 2026-11-11
- Spec: 6.2 and 6.4 (the public edge). Decisions 0071, 0072, 0080, 0082, 0090, 0091, 0093, 0094. Ruling R19 and R20 of the C2 orchestrator note.
- Packet: C2-07a2 (compose and config). The deploy script is C2-07b.

## Decision

1. **Caddy.** The node's shared Caddy is a host-network container with one Caddyfile and a bind-mounted config directory. Geldar adds per-site files (`deploy/caddy/`, 0094) to that directory plus one `import` line, then runs `caddy validate` and `caddy reload` through `docker exec`. It never restarts or recreates Caddy (0071 item 6).
2. **Loopback publishes.** Caddy reaches Geldar services only on `127.0.0.1` publishes written as literals in `compose/colo.yml`: the MCP on 8788, Glass on 8787. The loopback rule still rejects interpolation there.
3. **BlueMap.** It has no publish. Its web server is off (C1-09; 5.29 has no bind-address key), and Caddy's map site serves the rendered webroot from the Paper data volume, read only.
4. **Glass.** A `glass` service in the Colo stack, image `GELDAR_GLASS_IMAGE` from the release manifest, hardened like `geldar-mcp` (read-only root, no capability, no new privileges, 0.5 CPU, 256m, 128 pids). It reads Postgres as `geldar_glass` with the password from a file secret and has no NATS access.
5. **Public Minecraft.** The overlay `compose/colo-public.yml` adds one publish to `velocity`: `"${GELDAR_MC_BIND:?}:${GELDAR_MC_PORT:?}:25565"`. The bind address and the port are owner-held values in the deploy env, not in the repo. The loopback-ports check allows exactly that entry on `velocity` in that file; any other service, entry or file still fails.
6. **NATS auth** is already on in the Colo stack through the C1-06c overlay (0080), so there is no flip (R20).
7. **Client address.** The `public:` block in `shards/colo-mind.yaml` names `127.0.0.1` as the trusted proxy and the header `x-geldar-client-ip`, with 120 per minute and burst 40 and the kill switch off. Whether Docker presents Caddy to a service as `127.0.0.1` or as the bridge gateway is checked live (worknote); until then an unmatched peer is charged by its own address, which fails safe.
8. **Outside the repo.** DNS names and the router port forward exist and are owner-held values. No host name, domain or public address is written in the repo.

## Consequences

- `geldar.ps1 check` and CI validate `colo-public.yml` only merged with `colo.yml` and `nats-auth.yml`, with dummy bind and port set for that command alone.
- The shard total grows to 10 CPUs and 19712m (Glass).
- The deploy adds the overlay to its file list only when the owner has set the two env values (C2-07b).