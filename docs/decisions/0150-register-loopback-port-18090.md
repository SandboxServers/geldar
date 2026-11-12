# 0150. The register service publishes on loopback port 18090

- Status: Accepted
- Date: 2026-11-11
- Spec: 8.9 (exactly four public ports; loopback publishes are internal to the host), decision 0135 (register service), 0096 (loopback publishes that Caddy reaches)

## Decision

The register service's loopback publish moves from `127.0.0.1:8090` to `127.0.0.1:18090` in `compose/colo.yml`. The container still listens on 8090 inside its network namespace (`REGISTER_PORT`, its healthcheck and its Dockerfile `EXPOSE` are unchanged). The Caddy upstream for register (`GELDAR_REGISTER_UPSTREAM`) is therefore `127.0.0.1:18090` on the Colo node.

## Why

The Colo node is shared. Another tenant's container already holds `127.0.0.1:8090` on that node and has done for weeks, so our publish fails to bind when the `register` profile starts. No other Colo publish moves: the other loopback ports are 8787 (Glass), 8788 (MCP), 8100 (map) and 25567 (Minecraft), and none of them is 8090.

The new port keeps the old last four digits so the change is one digit and easy to find. It sits in the 18xxx range, outside the 81xx and 87xx ports the Colo stack uses, and below the Linux ephemeral range (32768 and up), so the kernel does not hand it out for outgoing connections. We do not know the exact range the other tenant uses; 18090 was chosen because no port documented for this repo or the Colo stack is there.

The conflict is only with another tenant's container. This record names no account, host or address.

## Consequences

- `compose/colo.yml` publishes `127.0.0.1:18090:8090`. The loopback-ports rule still requires a literal, so the port is not interpolated.
- `tools/repo-checks/src/colo-services.test.ts` pins `127.0.0.1:18090:8090` and refuses any `127.0.0.1:8090:` publish, so putting 8090 back fails the check.
- The operator sets `GELDAR_REGISTER_UPSTREAM=127.0.0.1:18090` in the deploy env. `deploy/colo-public.sh` still accepts any loopback `127.0.0.1:<port>` value; no default is written in the repo.
- Any new Colo publish must be checked against the node's loopback ports in use, not only against this repo.
