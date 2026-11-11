# 0135. Self-registration with GitHub and Discord sign-in, no manual approval

- Status: Accepted in principle (owner ruling, 2026-11-11: "GitHub and Discord, both; as long as their accounts are verified by the IdP I don't want to approve again"). The design details below are Proposed (orchestrator, 2026-11-11) for owner review.
- Date: 2026-11-11
- Spec: 5.15 (sovereign players), 5.15.3 (OAuth 2.1 for MCP, replaced by 0054 for the MCP itself), 5.15.6 (one human, many players; default cap 3 per owner per shard), section 2 Principle 1 (no humans inside). Decisions 0052, 0054, 0057, 0070, 0072, 0077, 0090, 0091.
- Packets: C2-08a, C2-08b, C2-08c ([packets/c2-register-packets.md](../analysis/phase1/packets/c2-register-packets.md)).

## Problem

0077 has the owner minting each invitee's MCP token with the CLI. The owner wants people to register themselves and get a token, with verification, and without approving each one.

## Decision

1. **Sign-in providers.** A registrant signs in with GitHub or Discord, using OAuth 2.0 authorization code with PKCE and a single-use `state`. No other provider in Phase 1. Entra ID SSO for the observatory (spec 8.4) is unchanged and still Phase 2.
2. **Verified means:**
   - GitHub: the account has at least one email with `verified: true` (from `GET /user/emails`, scope `user:email`), and the account is at least **30 days old** (`created_at`).
   - Discord: `verified: true` on `GET /users/@me` (scope `identify email`), and the account is at least **30 days old** (taken from the snowflake id).
   - The age floor is an orchestrator default to keep out throwaway accounts. The owner can set it to 0.
   - A verified account is admitted with no manual approval (owner ruling).
3. **What is stored.**
   - An identity row keyed by `HMAC-SHA256(pepper, provider + ":" + provider_user_id)`. The raw provider user id, the email and the OAuth tokens are never stored. The provider access token is used once, during the callback, and then discarded.
   - The provider login handle is stored as the owner's `display`. It is operator-only, and it never appears in agent-visible text, Glass, the Lakitu feed or logs.
   - One identity is one owner (`mcp_owners`), with the default cap of 3 players (spec 5.15.6). Linking a GitHub and a Discord identity to one owner is not in v1.
4. **What a registrant gets.** After sign-in, they pick a player id (the 0054 pattern `ag-...`) and a display name, and choose a harness from the allowed list (the compliance rule 5.15.1 stands). The service creates the player and its life, and shows the bearer token **once**. Only its HMAC is stored (0054). Signing in again lets a registrant list their players, mint a new token (which revokes the old one), or retire a player. It never shows an existing token.
5. **Controls.**
   - A registration kill switch.
   - A global cap on new owners per day (default 10).
   - A per-address rate limit on the sign-in routes (the 0090 header, read from Caddy only).
   - Every refusal uses the 0090 shapes.
   - Registration stays **off** until the C2 gates pass (0070 consequence 3; owner answer 4 of 2026-11-11).
6. **Where it runs.**
   - A small separate service (`threshold/register`), not inside the MCP, so a bug in the sign-in path cannot reach the MCP's request handling.
   - It is published through Caddy as `register.<project domain>`, the same way as the other C2 sites.
   - Its database role can only insert owners, players, identities and tokens. It cannot read thoughts, events or other owners' rows.
7. **Secrets.** The GitHub and Discord client secrets and the identity pepper are file secrets on the node (the Colo secrets pattern), never in the repo. The owner creates the GitHub OAuth app and the Discord application, with callback URLs on the register host.

## What this changes

- **0070's "invite-only" becomes "verified sign-up, unannounced"** for Phase 1. The shard stays unannounced. Anyone who finds the register page and has a verified account at least 30 days old can join. 0070 is not edited; this record amends it. No spec text changes: the spec has no invite-only rule for the MCP. It says owners are people with sovereign players, capped at 3 each.
- 0077's owner-minted invitee tokens stay available (the CLI path) for the owner's own players and special cases.

## Consequences

- A new public surface. It joins the C2 review (C2-R1 scope grows to cover register) and the external scan's expected list (443 only; register is a Caddy site).
- **New players need Bodies.** Today one `players-host` container serves one ranger, started by hand (C1-11a: "per-ranger lifecycle is not built yet"). Registration creates players faster than the owner can start hosts. Before registration is turned on, the per-player Body lifecycle (presence starts and stops the player's process) must exist. Without it a registered player has a token but no Body, so the MCP answers `body_unavailable`. That is follow-up packet C2-08d, tied to C3's roster and cap work.
- Capacity: the node budget in `shards/colo.yaml` limits the total player count. The daily cap and the per-owner cap keep growth inside it, and the global player ceiling is a C3-04 roster setting.
- Abuse: a revoked owner is retired by its identity hash, and the same account cannot register again. Alternate accounts are limited by the age floor and the daily cap, not prevented.

## Owner items

1. Create the GitHub OAuth app and the Discord application. Callback: `https://register.<project domain>/callback/github` and `/callback/discord`. Put the secrets in the node's secrets directory.
2. Confirm or change: the 30-day age floor, 10 new owners a day, and 3 players per registered owner.
