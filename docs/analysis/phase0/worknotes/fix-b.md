# Fix packet B: MCP front door, limits, owner cap

Branch `fix/b-mcp-front-door` from `wave6-main`. Items follow the campaign review order.

## Status

| # | Item | State | Commit |
|---|------|-------|--------|
| 1 | Client IP behind Caddy: `client_ip_header` (any header name, default cf-connecting-ip; `x-forwarded-for` mode), env overrides, startup refusal, warning on a trusted peer's missing or malformed header | committed | see log |
| 2 | Unauthenticated path cost: global peek, negative cache, no second query | todo | - |
| 3 | Caps derive from the owner cap; owner-first take; per-agent share | committed | 8d4574c |
| 4 | Dead config keys wired to code; `shard/rules` reports effective values | partial | a6e76f7 (shard/rules) |
| 5 | Owner cap: DB trigger, `owner add` reads yaml, auth refuses over cap | todo | - |
| 6 | Journal spacing bucket, no journal text in events, stream `max_bytes` | todo | - |
| 7 | NOTIFY payload is a hint; re-read token state before ending sessions | todo | - |

## Log

- Worktree created from `wave6-main` at `57576f6`; `./geldar.ps1 setup` ran clean.
- Shell cwd resets between calls: prefix every command with `Set-Location <fix-b path>;`. An early `pnpm filter` run hit wm-live4 by mistake; its result was discarded and the suites were rerun in fix-b.
- Item 1 (coordinator update): the deployment's Caddy sets `X-Geldar-Client-IP` via header_up, so `client_ip_header` takes any lowercase header name; `x-forwarded-for` is the optional rightmost-untrusted mode. The header counts only from a peer in `trusted_proxies`. `GELDAR_MCP_TRUSTED_PROXIES` and `GELDAR_MCP_CLIENT_IP_HEADER` override yaml, so real values stay out of git. A public host with no trusted proxy refuses startup. Warnings `client_header_missing` / `client_header_malformed` are logged, never rejected.
- Item 1 test: `http/client-address.test.ts` and `config-proxy.test.ts`. Existing `config.test.ts` public-host case now names a proxy.
- Item 3: caps default to 4 open per agent x owner_cap_owner per address (80 at 20) and 4 x owner cap x 4 owners for the listener (320); explicit keys override and phase0.yaml no longer sets them. Open slots also counted per owner. call() takes the agent's share of the owner bucket (owner rate / owner cap, min 1), then the owner bucket, then the player bucket. Handshake traffic takes no owner token. Global default assumes 4 owners at full cap (no owner count exists at config time), a judgement to revisit with item 5. Tests: http/limits-scale.test.ts (20 agents from one address, owner-first order, noisy-agent share), config.test.ts derived and override cases, updated handshake and connection-cap expectations. Revert check: share refusal changed to `return undefined; the scale test failed (1 failed, 6 passed); restored from scratchpad backup.
- Item 4: not started (context ran out after item 3).
- Item 4 (later session): `shard/rules` now reports `max_body_bytes`, `max_result_bytes`, `presence.lease_seconds` and `presence.hibernate_after_seconds` from the loaded shard (`ShardRules` in `resources.ts`, filled by `shardRules` in `main.ts`). Commit a6e76f7. Test: `main.test.ts` "shard/rules reports the effective limits" loads a copy of the shard with non-default values for the five keys. Revert check: `maxResultBytes` hard-coded to 16384; the test failed (expected 16384 to be 8192), then restored. Fixture updates in `resources.test.ts`, `e2e.test.ts`, `world-session.test.ts` and `neutral-text.test.ts`.
- Item 4 docs: `threshold/mcp/README.md` Configuration section lists the five keys, the owner-cap-derived caps (80 and 320 at 20), and the `GELDAR_MCP_TRUSTED_PROXIES` / `GELDAR_MCP_CLIENT_IP_HEADER` overrides (Caddy: `x-geldar-client-ip`). `shards/phase0.yaml` comments updated to match. No keys added or changed in the shard.
- Item 4 still open: the other dead keys still need a wire-up check (not reviewed in this session).
