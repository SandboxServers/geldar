# Fix packet B: MCP front door, limits, owner cap

Branch `fix/b-mcp-front-door` from `wave6-main`. Items follow the campaign review order.

## Status

| # | Item | State | Commit |
|---|------|-------|--------|
| 1 | Client IP behind Caddy: `client_ip_header` (any header name, default cf-connecting-ip; `x-forwarded-for` mode), env overrides, startup refusal, warning on a trusted peer's missing or malformed header | committed | see log |
| 2 | Unauthenticated path cost: global peek, negative cache, no second query | todo | - |
| 3 | Caps derive from the owner cap; owner-first take; per-agent share | todo | - |
| 4 | Dead config keys wired to code; `shard/rules` reports effective values | todo | - |
| 5 | Owner cap: DB trigger, `owner add` reads yaml, auth refuses over cap | todo | - |
| 6 | Journal spacing bucket, no journal text in events, stream `max_bytes` | todo | - |
| 7 | NOTIFY payload is a hint; re-read token state before ending sessions | todo | - |

## Log

- Worktree created from `wave6-main` at `57576f6`; `./geldar.ps1 setup` ran clean.
- Shell cwd resets between calls: prefix every command with `Set-Location <fix-b path>;`. An early `pnpm filter` run hit wm-live4 by mistake; its result was discarded and the suites were rerun in fix-b.
- Item 1 (coordinator update): the deployment's Caddy sets `X-Geldar-Client-IP` via header_up, so `client_ip_header` takes any lowercase header name; `x-forwarded-for` is the optional rightmost-untrusted mode. The header counts only from a peer in `trusted_proxies`. `GELDAR_MCP_TRUSTED_PROXIES` and `GELDAR_MCP_CLIENT_IP_HEADER` override yaml, so real values stay out of git. A public host with no trusted proxy refuses startup. Warnings `client_header_missing` / `client_header_malformed` are logged, never rejected.
- Item 1 test: `http/client-address.test.ts` and `config-proxy.test.ts`. Existing `config.test.ts` public-host case now names a proxy.
