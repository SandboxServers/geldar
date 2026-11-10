# 0054. Sovereign MCP clients use static, hashed, per-player Bearer tokens, not OAuth 2.1

- Status: Accepted (launcher side agreed; owner may revise)
- Date: 2026-11-10
- Spec: 5.15.3 (the token and the 30-day default expiry); Wave M packet open question Q3; decision 0052

## Context

Spec 5.15.3 sets a 30-day default expiry for a sovereign player's token. The Scriptorium launcher sends a static token per player (`--token-file`), so OAuth 2.1 would add a flow with no user to sit in it. The packet's recommendation was accept, hashed storage, 30-day expiry, `rotate`, immediate revocation and one player per token.

## Decision

1. A token is `gmcp-` followed by 64 hex characters (`threshold/mcp/src/store/token-hash.ts`). It maps to exactly one player id, and the URL's `/p/<player_id>` must equal it. A wrong player gets 403; an unknown token gets 401.
2. The token is never stored. `mcp_tokens.token_hash` holds `HMAC-SHA256(pepper, token)` (`sql/0002_sovereign_mcp.sql`). The pepper is at least 32 bytes. `tools/mcp-tokens` refuses a shorter pepper at mint, with the same rule as the server.
3. A new token expires after `TOKEN_EXPIRY_DAYS` = 30 (`tools/mcp-tokens/src/tokens.ts`).
4. `rotate` mints a new token and revokes the old one after a grace window; `DEFAULT_GRACE_MINUTES` is 10. A zero grace revokes at once (fix commit `b92d900`).
5. Revocation sets `revoked_at`. A trigger sends `NOTIFY mcp_token_revoked`, and the front door refuses the token at once.
6. Digest comparisons and the resolved player id are compared in constant time (`wm-interface-requests.md`, WM-03 R1 to R3).

## Consequences

- A database leak alone does not reveal a usable token. The pepper lives on the host in a file that `mcp-tokens` writes with owner-only permissions (on win32 an icacls step, best effort).
- A lost token cannot be shown again; the owner rotates it.
- Failed-auth state is per client address; a cached hit skips it (`threshold/mcp/src/http/front.ts`).

## Open

- **Owner review of the 30-day expiry** for the Phase 0 rangers. Not revisited since the spec default.
- **Trailing whitespace in `Authorization`** is accepted, because Node strips it before the handler sees it (WM-03 Q3). The owner has not confirmed this.
