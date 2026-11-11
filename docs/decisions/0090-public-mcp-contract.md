# 0090. Public MCP contract: client-address header, refusal shapes and the public config keys

- Status: Proposed (orchestrator, 2026-11-11; owner to confirm)
- Date: 2026-11-11
- Spec: 5.15 (the sovereign MCP that the harnesses reach); decisions 0054 (hashed per-player tokens), 0071 (public endpoints through Caddy), 0072 (Glass and BlueMap public)
- Packet: C2-00 (contract unblocker for the public surfaces); schedule decision 0091 for C2-01

## Decision

1. **Client-address header.** The client address comes from the header `x-geldar-client-ip`, and only when the peer that connected is in `public.trustedProxies`. `CF-Connecting-IP` is not used. `threshold/mcp/src/http/front-address.test.ts` moves to `x-geldar-client-ip` in C2-01, so both address tests agree. Caddy sets the header (0071).
2. **Refusal shapes.** Each public refusal is a fixed JSON body with `error.code` and `error.message`. No body has a stack, a path, an internal host, or a detail that says whether a token is valid.
   - Unauthenticated: HTTP 401, body `{ "error": { "code": "unauthenticated", "message": "Unauthorized" } }`. The body is the same whether the token is missing, malformed or unknown.
   - Rate limit: HTTP 429, body `{ "error": { "code": "rate_limited", "message": "Too many requests" }, "retryAfter": <integer seconds> }`. `retryAfter` is at least 1. The same value is sent as the `Retry-After` header.
   - Kill switch: HTTP 503, body `{ "error": { "code": "unavailable", "message": "Service unavailable" } }`. It names no switch and no config key.
   The schemas are `PublicUnauthenticatedError`, `PublicRateLimitedError` and `PublicKillSwitchError` in `contract/schemas/mcp-common.schema.json`.
3. **Config key names.** The public MCP and Glass read these keys from the shard config:
   - `public.trustedProxies`: list of peer addresses allowed to set the client-address header. Default: empty, so the header is ignored.
   - `public.clientIpHeader`: header name. Default: `x-geldar-client-ip`.
   - `public.rateLimit.perMinute` and `public.rateLimit.burst`: integers for the per-client token bucket. No default; they must be set when rate limiting is on, as decision 0089 does for its config keys.
   - `public.killSwitch`: boolean. Default: `false`. When `true`, every public request gets the kill-switch shape (decision 3 above).
   The values live in the shard file, which C2-07 owns. This record names the keys only.
4. **Supersession.** Decision 0071 supersedes 0053. The 0053 Status line reads "Superseded by 0071 (2026-11-10)".

## Why

- One header name for the whole stack avoids two tests that disagree. `x-geldar-client-ip` is what `client-address.test.ts` already uses, and 0071 only requires Caddy to set it.
- A trusted-peer list from config, empty by default, means a client cannot forge its address by sending the header from the open internet.
- Fixed bodies stop a refusal from leaking whether a token exists or which internal part refused. The rate-limit `retryAfter` is the one value that varies, and a client needs it to back off.

## Consequences

- C2-01 reads the header only from a trusted peer, and returns the 401 body for all three token failures.
- C2-01 uses these shapes. A later card that refuses publicly reuses them rather than inventing a shape.
- Changing a shape, a code or a key name needs a new record.
- Owner confirmation is needed before C2-01 depends on the header rule.
