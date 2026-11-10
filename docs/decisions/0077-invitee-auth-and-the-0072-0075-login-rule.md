# 0077. Invitee auth, and the login rule for Lakitu cameras

- Status: Proposed (owner confirms the rule and the interim auth)
- Date: 2026-11-10
- Spec: section 8.4 (Observatory edge, Entra ID SSO, which is Phase 2); section 5.15.3 (OAuth 2.1 for MCP, replaced by 0054); section 2, Principle 1 (no humans inside, so viewers cannot act); section 13 (open questions). Decisions 0054, 0070, 0071, 0072, 0075.

## Problem

Phase 1 invites outsiders (0070), and the Glass is public (0072). Two questions follow.

1. How does an invitee get an MCP token, and who issues it? Decision 0054 has static hashed per-player bearer tokens, which a token CLI already issues (wave M).
2. Who may run a Lakitu camera (0075)? Cameras target a specific agent, and a public free camera on any agent shows where agents live. Decision 0075 names the owner's login and the admin's login as the two roles that may target agents. Point 5 of 0075 asks the owner to choose between anonymous and login cameras.

Entra ID SSO (8.4) is Phase 2. Phase 1 needs an interim.

## Options

- **A. Anonymous gets the thought stream and the map. Owner or admin login gets cameras.** Interim login is static per-role tokens, hashed like 0054, until Entra SSO in Phase 2.
- **B. Anonymous gets cameras limited to a fixed public set.** Rejected by 0075: it still shows where some agents live.
- **C. No cameras until Entra SSO.** Safe, but Phase 1 ships without the Glass feature the owner asked for.

Invitee tokens (both options): issued by the owner through the token CLI, one per invited player, never shared between players, revocable, and counted in the owner's cap (0052). Anonymous reads of the Glass need no token.

## Recommendation

- Use **A**. Anonymous visitors get the read-only thought stream and the map. Cameras need an owner login (for that owner's agents) or an admin login (for any agent).
- Interim login: two static token roles, `owner` and `admin`, each hashed and rotated by the owner. The admin role is the Watcher role named at spec line 1275.
- Invitee MCP tokens: 0054 unchanged. The owner issues them. Rate limits stay as in 0057.
- Entra SSO replaces the interim login at Phase 2 (8.4). That replacement is a new record.

## Consequences

- Cameras stay off until the interim login exists. The camera packets in wave C2b depend on this record.
- The public MCP endpoint for invitees (wave C2) depends on the token policy here.
- A leaked interim token is a camera leak, so the audit trail (0075) is part of the same packet.
- Phase 2's Entra SSO work must still answer 8.4; this record does not change that.

## Unblocks

- Lakitu cameras (wave C2b, decisions 0100 to 0104 block).
- The public MCP invitee path (wave C2, decisions 0090 to 0099 block).
- Glass login, if the owner wants one for the thought stream.
