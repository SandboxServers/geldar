# 0053. The sovereign MCP is loopback-only now; a public name through an outbound tunnel waits for the colo move

- Status: Accepted (owner ruling, 2026-11-09: loopback first; owner may revise)
- Date: 2026-11-10
- Spec: 5.15 (the sovereign MCP that the harnesses reach); decision 0052; Wave M packet WM-10 and its correction 1

## Context

The first draft of Wave M planned a public hostname behind a Cloudflare tunnel. The owner ruled that the stack moves to a colo later, so the MCP is built and tested on loopback first. The public name and any off-host exposure are deferred. Two questions sit open with the owner (Q1 public name, Q2 off-host exposure).

## Decision

1. The MCP serves plain HTTP on a configurable port (Phase 0 uses 8788) and a configurable bind address. Outside a container it binds `127.0.0.1` (`threshold/mcp/src/config.ts`).
2. Inside the container it binds `0.0.0.0` only when `GELDAR_MCP_IN_CONTAINER=1`. The compose overlay (`compose/mcp.yml`) publishes `127.0.0.1:8788:8788` and nothing else.
3. `Host` validation accepts `host.docker.internal`, `127.0.0.1` and `localhost` on the dev port, so the Scriptorium launcher can reach the host's loopback through Docker Desktop.
4. The tunnel is example config and a README section only. Nothing runs it. `trusted_proxies` stays empty in `shards/phase0.yaml`, so no forwarded client header is read.

## Consequences

- The loopback rule holds for Phase 0: nothing published beyond the host.
- The effective client address (`clientAddress` in `threshold/mcp/src/http/auth.ts`) reads `CF-Connecting-IP` only from a peer on `trusted_proxies`. That is safe with the list empty.
- Moving to the colo changes three things together: the public name, the tunnel run, and the `trusted_proxies` value.

## Open

- **Q1, public name:** not chosen. The owner sets it at the colo move.
- **Q2, off-host exposure:** not decided. Requires an owner ruling before any tunnel runs.
- **`trusted_proxies` value** once the tunnel is live: the cloudflared container address as an IP or CIDR. Not known yet.
