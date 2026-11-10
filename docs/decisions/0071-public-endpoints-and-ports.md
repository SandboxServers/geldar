# 0071. The public Minecraft endpoint is a new TCP port with an SRV record; HTTPS ingress is the shared Caddy, reloaded and never restarted

- Status: Accepted (owner, 2026-11-10)
- Date: 2026-11-10
- Spec: 6.2 and 6.4 (the spectator proxy on TCP 25565 at `play.<domain>`; the Geldar MCP and Observatory names; Envoy as ingress), 8.4 (Cloudflare or self-hosted edge), 8.9 (the external port scan). Decisions 0053, 0054, 0070. This record amends the spec's port and ingress lines for the Colo.

## Decision

1. **Minecraft Java edition is TCP only.** UDP does not carry it, so the public Minecraft endpoint is a **new TCP port** on the Colo's gateway. It is not the standard 25565, because another service on the node already uses that port.
2. **An SRV record `_minecraft._tcp.<name>`** points Minecraft clients at that port, so players connect with the bare project name.
3. **The exact port number is chosen at build time** and written into the ops runbook. It must avoid every port range already forwarded at the edge. No range is recorded here.
4. **The existing TCP 18443 forward stays as it is:** it serves the placeholder page and HTTPS. It is not reused for Minecraft or for MCP.
5. **DNS for the project domain is in Azure DNS.** Records are changed with the `az` CLI, by the owner or by an ops agent the owner has authorised for that purpose. Subscription identifiers and account names do not go in the repo.
6. **HTTPS ingress uses the shared Caddy on the node.** The owner has ruled that the shared Caddy may be used, because nothing else important depends on it, but a restart interrupts its other sites. So geldar gets **its own Caddyfile snippet or site file**, is loaded with `caddy reload`, and is **never restarted**. A config change is `caddy validate` then `caddy reload`.
7. **Public MCP stays on the static bearer tokens of decision 0054.** Caddy sits in front of it and is the only trusted proxy. Caddy sets the client-address header, and the MCP service reads that header only when the request comes from Caddy. OAuth 2.1 (spec 6.2) remains the later answer.

## Why

- The Minecraft protocol is TCP. A UDP forward would carry nothing.
- Port 25565 is in use on the node by another service, so the spec's spectator port cannot be used there.
- The project's DNS already belongs in Azure DNS, so records go where the zone lives.
- The owner has ruled on the shared Caddy. Cloudflare (spec 8.4) is not used for the Colo, which is recorded in decision 0073.
- A reload changes one site; a restart would interrupt every site on the node.

## Consequences

- Spec 6.2 and 6.4 name TCP 25565 for the spectator proxy. For the Colo, the port is the one this record's runbook sets. The spec is not edited (decision 0073).
- The external port scan in wave C2 must show exactly the open public ports the runbook lists: the HTTPS ingress, the new Minecraft port, and the owner's decision on 18443. Spec 8.9 says "exactly four ports"; the list is settled in C2 and the owner decides whether 18443 counts (see decision 0073).
- The UniFi TCP forward for the new Minecraft port is an owner action (see the Phase 1 plan, section f).
- The MCP service does not listen on a public address until its trusted-proxy handling is in place and tested (wave C2). Decision 0053 still holds for the Phase 0 loopback shard, where `trusted_proxies` stays empty. The Colo shard lists only the Caddy address.
- Azure DNS changes are recorded in the runbook with the `az` command used, not with account or subscription identifiers.
