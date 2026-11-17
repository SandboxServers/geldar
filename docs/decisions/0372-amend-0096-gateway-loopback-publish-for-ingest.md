# 0372. Amends 0096: the telemetry gateway's loopback publish and the ingest site file

- Status: Accepted (owner ruling geldar-93, 2026-11-16: the ingest route on the shared Caddy). Each node step still needs the owner's approval at the time.
- Date: 2026-11-16
- Spec: 6.2 and 6.4 (the public edge). Amends 0096 items 1 and 2 by adding one site and one loopback publish. See 0371 for the Caddy recreate exception.

## Decision

1. Caddy reaches the telemetry gateway's OTLP/HTTP receiver on one more loopback publish, written as a literal in the gateway's compose overlay (host port 4320 on loopback, the gateway's 4318 inside). The publish is `127.0.0.1:4320:4318` in `compose.gateway.yml` on the telemetry/t25-gateway branch; it exists on main only after that branch merges (merge dependency: T-26 and T-25). `tools/repo-checks/src/loopback-ports.ts` has no per-entry allowlist for it: it accepts any short-syntax port that starts with `127.0.0.1:` (or long syntax with `host_ip: 127.0.0.1`), rejects any `$` interpolation except the allowlisted `GELDAR_PORT_<NAME>` form (its reserved-port rule, 25565 and 25566, applies to `compose/colo.yml`); a literal `127.0.0.1:4320:4318` passes by that rule. The one-entry allowlist is 0096 item 5 (velocity), a different case.
2. The live ingest file `otel.caddy` goes in the node's `config/geldar/` directory (the Caddyfile's existing top-level `import /config/geldar/*.caddy`), beside `mcp.caddy`. No new `import` line is needed. `otel-off.caddy` is the kill switch. The upstream and the hostname are environment placeholders (`GELDAR_INGEST_UPSTREAM`, `GELDAR_INGEST_HOST`) with no value in the repo.
3. The public ingest hostname stays in this amendment and 0371 until the owner drops it.

## Consequences

- No new public port. `tools/portscan` expected lists are unchanged, confirmed by a scan after the restart.
- The ingest site is not part of `deploy/colo-public.sh`'s site list or `validate.sh` yet; a later packet adds the placeholders to validation with test values.
