# Fix packet B: MCP front door, limits, owner cap

Branch `fix/b-mcp-front-door` from `wave6-main`. Items follow the campaign review order.

## Status

| # | Item | State | Commit |
|---|------|-------|--------|
| 1 | Client IP behind Caddy: `client_ip_header` (any header name, default cf-connecting-ip; `x-forwarded-for` mode), env overrides, startup refusal, warning on a trusted peer's missing or malformed header | committed | see log |
| 2 | Unauthenticated path cost: global peek, negative cache, no second query | todo | - |
| 3 | Caps derive from the owner cap; owner-first take; per-agent share | committed | 8d4574c |
| 4 | Dead config keys wired to code; `shard/rules` reports effective values | partial | a6e76f7 (shard/rules) |
| 5 | Owner cap: DB trigger, `owner add` reads yaml, auth refuses over cap | committed (integration cases unverified here) | cb8600a, f85d597, 1f9a1f2, 63da242 |
| 6 | Journal spacing bucket, no journal text in events, stream `max_bytes` | NOT done | - |
| 7 | NOTIFY payload is a hint; re-read token state before ending sessions | committed | c7a341d |

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
- Item 5 (cb8600a, f85d597, 1f9a1f2, 63da242): migration `sql/0006_owner_cap_trigger.sql` enforces the owner cap in the database; `owner add` takes its default cap from the shard file; the runbook documents it; auth refuses a token whose owner is over its cap with `owner_over_cap` (never cached). Caveat: `owner_cap_owner` (20) is not applied by `owner add`, because the yaml names no owner slug; the operator passes `owner add --cap 20`. The owner-cap integration cases in `tools/mcp-tokens/test/owner-cap.it.test.ts` were not run here (no Postgres in this worktree). CI's Postgres job must run them before the integration merge. The CI job file on `fix/f-supply-chain` is not present in this worktree, so the job list was not checked here.
- Item 6: NOT done. Journal spacing bucket, the no-journal-text-in-events rule and the stream `max_bytes` were not started.
- Item 7 (c7a341d): the `mcp_token_revoked` listener treats the NOTIFY payload as a hint and re-reads `revoked_at` and the player's `status` for that token and player before it ends sessions or drops the cache. Any DB role may NOTIFY (geldar_glass can). A forged NOTIFY for an active token ends nothing. A failed re-read ends nothing, and a revoked token is still refused by the next resolve (the hit cache lasts up to 5 s). Tests: `pg-tokens.test.ts` LISTEN cases (forged NOTIFY, real revoke, player left active). Revert check: the table check made to always fire; "a forged NOTIFY for an active token ends no session" failed (1 failed, 37 passed); restored from a scratchpad backup and `git diff --stat` was empty.
