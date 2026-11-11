# 0091. Public MCP behind Caddy: trusted peer, the public block, kill switch, rate limit, negative cache, invitees

- Status: Proposed (orchestrator, 2026-11-11; owner to confirm)
- Date: 2026-11-11
- Spec: 5.15 (the sovereign MCP that the harnesses reach); decisions 0052 (owner cap), 0054 (hashed per-player tokens), 0071 (public endpoints through Caddy), 0077 (invitee tokens), 0090 (public MCP contract)
- Packet: C2-01 (public MCP behind Caddy)

## Decision

1. **Trusted peer from config only.** The server believes the client-address header only when the TCP peer is in the trusted list. The list comes from configuration (`GELDAR_MCP_TRUSTED_PROXIES`, `public.trusted_proxies`, `sovereign.mcp.trusted_proxies`) and is empty by default: with no list, the header is never read and the peer address is the client. A trusted peer that sends no usable address is logged and the peer is used. A prefix length of 0 is refused.
2. **The header.** `x-geldar-client-ip` (0090), set by Caddy. `CF-Connecting-IP` is not used.
3. **The `public:` YAML block** holds `trusted_proxies`, `client_ip_header`, `kill_switch` and `rate_limit` (`per_minute`, `burst`). Precedence, highest first: environment, then `public.*`, then `sovereign.mcp.*`.
4. **Kill switch.** `public.kill_switch: true` answers every public request with the 0090 503 body, before authentication, so it reads no token and spends no budget.
5. **Rate limit.** One bucket per client address for every public request, authenticated or not. When the `public:` block is present and names no limit, the defaults are 120 requests a minute with a burst of 40 (orchestrator, R15b; 0090 set no default). A refusal is the 0090 429 with `Retry-After`. A server started without a `public:` block applies no per-client limit.
6. **Negative cache.** A fixed table (1024 addresses) counts failed bearer attempts per client address over a 30 s window, with an injected clock. At the cap it evicts the address recorded longest ago. After 16 failures in a window an address is flagged, and the server stops asking the store why a bearer missed (that query only feeds the log). Nothing a client can see changes: a missing, malformed or unknown token gets the same 0090 401 body on every try, and a valid token from a flagged address is accepted. The 403 for a valid token of another player (0054) is not a failure and is not counted.
7. **Invitee issuing (0077, accepted by the owner on 2026-11-11, option A).** An invitee's MCP token is issued by the owner through the existing `mcp-tokens` mint: the token is written once to the owner-only file, only its HMAC is stored, and the invitee is a player of that owner, so it counts in the owner's cap (0052) when it is added. There is no off-by-default flag.

## Out of scope

A self-registration flow through GitHub or Discord sign-in is a separate decision (0135).

## Consequences

The Caddy deployment needs `public.trusted_proxies` set to Caddy's container address; until it is, every client shares the proxy's address and its limit.
