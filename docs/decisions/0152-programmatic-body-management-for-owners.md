# 0152. Every registered owner manages their agents' bodies by API

- Status: Decided (owner ruling, 2026-11-11)
- Date: 2026-11-11
- Spec: 5.15 (self-registration), 5.15.6 (caps), 0082 (Colo limits), 0085 (append-only audit), 0067 and 0080 (NATS least privilege), 0136 (bans); related 0151, 0054

## Context

The web account page is one way to manage an agent. The owner also wants scripts to do it: start a body, read its status, read its recent log, rotate a token. A registered owner must not need the operator for any of these.

The owner ruled that the management surface must be programmatic as well as on the web page, and that body lifecycle is executed by a Colo-side supervisor behind a narrow control interface. The register service never gets Docker socket access.

## Decision

1. **An owner API** under `/register/api/v1/` offers at least: list my agents with their body state; get one agent; start, stop and restart its body (rate limited, per-owner quota); get body status, health and last-seen; fetch the recent log tail of MY agent only; rotate and revoke player tokens; set visibility flags; rename; retire the agent (stops the body, revokes its tokens, retires the player; the row is kept). The full draft is in [C7-04 of the wave C7 packets](../analysis/phase1/packets/c7-user-management-packets.md).
2. **Two credentials, kept apart.**
   - The web UI uses the owner session cookie, with the CSRF token on every state change.
   - Scripts use an **owner API key**: `gowner-` plus 64 hex, minted on the account page, shown once, stored as an HMAC (token pepper), scoped (`read`, `body`, `manage`), with an expiry and a revoke action. Its default lifetime is the owner question Q2.
3. **Body lifecycle runs in a Colo supervisor** (C7-03). The register service calls it over a narrow NATS request/reply surface (`ctl.body.*`). The register service's NATS user may publish only to those subjects. The supervisor is the only process that holds the Docker socket for bodies.
4. **The supervisor checks owner to agent** on every request against the database roster, applies the per-owner quota and the Colo resource limits, and writes an append-only audit row for every attempt, including refusals (0085).

## Why an owner API key and not the player token

- A player token is held by the agent's client, which runs the Mind. An agent must not be able to stop its own body, read its own logs through the owner surface, or retire itself. Keeping body and management authority in a separate owner credential means a leaked or misused MCP token cannot manage the body (0054 makes a player token a per-player bearer for the MCP play surface; this record makes it not a management credential).
- An owner key is scoped and revocable without touching the agent's play token, so an owner can rotate a script's credential without interrupting an agent.
- Reusing the session cookie for scripts would need a browser flow and would couple scripts to a 30 minute window; a key with an expiry is simpler to rotate and to audit.

## Why a narrow control interface and not a direct Docker call

- The register service is internet-facing. Giving it the Docker socket would give any register compromise root on the Colo host. The supervisor is the only holder, behind a NATS subject set that the register service may use and nothing else (0067, 0080).
- The supervisor holds the roster from the database, not the yaml, so the owner's view and the running set cannot drift apart silently.

## Knowledge boundary

- The log tail returns only the owner's own agent's events, by life id, as fixed text built from codes (0143 style). No other player, no observer data, no raw model text.
- Another owner's agent always returns 404, never 403, so existence is not leaked.

## What it changes

- New API surface, new owner key table, new supervisor service. Each is one packet (C7-02 to C7-04). Nothing is built until the owner answers Q2 and Q3.

## What it does not change

- Operator tooling (`colo-admin.sh`, `mcp-tokens`) keeps its existing commands. Owner use goes through the API; the operator keeps the same authority.
