# 0094. BlueMap, Glass and the public MCP are read-only Caddy sites with kill switches, and core Caddy has no rate limit

- Status: Proposed (orchestrator, 2026-11-11; owner to confirm)
- Date: 2026-11-11
- Spec: 6.2 and 6.4 (the public edge), 8.9 (the external port scan). Decisions 0054, 0071, 0072. This record is the Caddy-side detail of 0072 items 2, 3 and 6.

## Decision

1. **Three sites, each in its own file under `deploy/caddy/`:** `map` (BlueMap), `glass` (the Thought Stream viewer) and `mcp` (the public MCP, `/p/<player_id>` only). Each is loaded with `caddy validate` and then `caddy reload`, never restarted (0071 item 6).
2. **Methods.** BlueMap and Glass accept GET and HEAD. The MCP accepts POST, GET and DELETE, which the MCP HTTP transport needs. Every other method gets 405 at Caddy.
3. **Address headers.** Each site strips `x-geldar-client-ip`, `X-Forwarded-For` and `CF-Connecting-IP` from the request, then sets `x-geldar-client-ip` to `{remote_host}`. Caddy is the only trusted proxy.
4. **Kill switch.** Each site has a `*-off.caddy` file that answers 503 for the same host. Loading it in place of the live file and reloading turns that site off without touching other sites.
5. **Upstreams and domain are placeholders** (`{$GELDAR_*_UPSTREAM}`, `{$GELDAR_DOMAIN}`). Real values are set by the integration packet C2-07 and never written into the repo.
6. **Gap: no Caddy rate limit.** Core Caddy has no rate-limit directive. This record does not add a third-party or unpinned Caddy module, because that would be a supply-chain dependency that needs owner approval. Rate limits live in Glass (C2-03) and in the public MCP (C2-01). The owner may later approve a pinned module, which would need its own record.
7. **Exception: the BlueMap inline style.** BlueMap's web UI may need an inline style under the strict CSP of 0072. If it does, the exception is recorded here and nowhere else. The snippet sets no CSP of its own in this version; the BlueMap host's CSP is checked in C2-07.

## Why

- Caddy's job is method, header and path control and the kill switch. Rate limits and response hygiene sit in the services, which can count requests per player or per address with more context than a reverse proxy.
- A file per site lets one reload turn off one site, which 0071 and 0072 require.
- Pinning the Caddy image by digest keeps `caddy validate` reproducible.

## Consequences

- The sites are not live until C2-07 wires the reload and the owner confirms this record.
- The public port scan (C2-06) checks only the ports; the methods and paths are checked by the repo test `tools/repo-checks/src/caddy-snippets.test.ts`.
- Open for the owner: whether to approve a pinned Caddy rate-limit module; whether BlueMap needs an inline-style exception.
