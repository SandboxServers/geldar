# 0173. Owner keys are managed by cookie session, and the Bearer scope rule for API v1

- Status: Decided (ruling recorded for C7-04b-3, 2026-11-13)
- Date: 2026-11-13
- Spec: 5.15.6 (caps); related 0152 (two credentials), 0170 (point 2, owner keys), 0085 (append-only audit), 0136 (bans)
- Related: cards C7-04b, C7-04c and the candidate C7-04d in `docs/analysis/phase1/packets/c7d-packets.md`; migration 0035

## Context

0170 point 2 says owner keys are minted, listed and revoked on the account page and through the API, with scope `manage`. Migration 0026 takes a presented owner key for each of those actions. A human who signs in with only a cookie session therefore has no way to mint the first key, because there is no key to present. That is a bootstrap hole.

Migration 0032 already solves the same problem for player tokens by taking the identity hash of the signed-in session. Owner keys need the same shape.

The C7-04b packet also mixed two kinds of caller on the token and key routes: the cookie session and a Bearer owner key. Rotating a token or managing keys from a script needs an owner-id keyed token path that the current SQL does not have.

## Decision

1. **Owner keys are managed by cookie session (migration 0035).** Mint, list and revoke take the identity hash of the signed-in session, as the 0032 token functions do. The owner is resolved from that hash. A banned or unknown identity is refused with SQLSTATE 42501, and the list raises the same error, so a refusal never reads as an empty list. The 0026 functions that take a presented key stay in place for Bearer callers. Lifetime (90 days), scopes (`read`, `body`, `manage`), the 10-live-key cap and the show-once value are unchanged from 0170.
2. **API v1 scope ruling.**
   - Token rotate and revoke, and owner-key mint, list and revoke, are **cookie-session only** in API v1. Each state-changing call is CSRF-protected. A Bearer owner key is refused on these routes.
   - A Bearer owner key carries the scopes `read` (agents, body status and log) and `body` (start, stop and restart, C7-04c).
   - The `manage` scope still exists in the table and is still checked by the database functions. It is not used by any Bearer route in API v1.
   - Bearer-driven token rotation and Bearer key management are **deferred** to candidate card C7-04d (size M). That card needs an owner-id keyed token SQL path and therefore a migration.

## Why

- The bootstrap hole closes without changing what a key can do. The cookie session is the owner's own authority, the same authority the account page already has, so it does not need a scope.
- A cookie session is the owner itself, so the database rules for a session call check identity and ownership, not a key scope. The scope rule applies to Bearer keys only.
- Keeping token and key management cookie-only in v1 avoids building a second, unaudited credential path into the most sensitive writes before the owner-id keyed SQL exists. A script that needs a new key uses the account page once, as the owner does today.
- Bearer `read` and `body` cover what scripts need in v1: reading agents and logs, and starting, stopping and restarting bodies.

## What it changes

- C7-04b-3 adds the three session functions (migration 0035) and their adapter and service methods. C7-04b's token and key routes are cookie-session only. C7-04c's body routes accept Bearer keys with scope `body`.
- A new candidate card C7-04d covers Bearer token rotation and Bearer key management. It is not built in Phase 1.

## What it does not change

- 0170's lifetimes, scopes, cap, show-once rule and admin exemptions.
- 0152's rule that keys never authenticate the MCP endpoint and player tokens never authenticate the management API.
- Ownership checks: another owner's key or agent is never reachable, and a refusal of another owner's item stays a not-found answer.
