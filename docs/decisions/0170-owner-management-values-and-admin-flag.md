# 0170. Owner management values (token and key lifetimes, body quotas, log tail) and the admin flag

- Status: Decided (owner rulings, 2026-11-13)
- Date: 2026-11-13
- Spec: 5.15 (self-registration), 5.15.6 (caps); related 0082 (Colo limits), 0085 (append-only audit), 0136 (bans), 0151, 0152
- Related: Q1, Q2, Q3 and Q6 in `docs/analysis/phase1/packets/c7-user-management-packets.md`; cards C7-02, C7-03, C7-04, C7-12

## Context

0152 left the numbers of the owner management surface to the owner (Q1, Q2, Q3, Q6). The owner has answered. The owner also asked for an admin flag, so the operator's own owner accounts are not stopped by limits meant for outsiders.

## Decision

1. **Player token (Q1).** A player token lives 90 days. The account page and the API show a warning flag from 14 days before expiry. Renewal rotates the token and keeps the player id. The existing rotate grace of 10 minutes stays.
2. **Owner API keys (Q2).** An owner key lives 90 days. Scopes are `read`, `body` and `manage`. Keys are minted, listed and revoked on the account page and through the API (scope `manage`), and the value is shown once. Keys never authenticate the MCP endpoint; player tokens never authenticate the management API.
3. **Body quotas (Q3).** At most 1 running body per agent. At most 3 starts per agent per hour. At most 10 starts per owner per day. A start is a `body/start` or `body/restart` request that the supervisor accepts. Stop, status and log requests do not count, and neither does a refused request (wrong owner, quota, conflict, unknown agent). The Colo capacity ceiling and the 0082 CPU and memory limits still apply to every body.
4. **Log tail (Q6).** The owner may read the last 200 events or the last 7 days of an agent's own log, whichever is smaller.
5. **Admin flag.**
   - `mcp_owners.is_admin` (boolean, default false). It is set and unset only by the operator CLI (`mcp-tokens owner admin set|unset <owner>`), run on the node with the operator database role. No API route, no account page action and no register-service database role can write it.
   - An admin owner is exempt from: the supervisor's per-agent hourly and per-owner daily start counters (point 3), and the register service's fixed-window rate limits (sign-up, create, rename, token and key actions, export, skin upload).
   - An admin owner is not exempt from: every ownership check (another owner's agent is still a 404), scope and CSRF checks, token and key rules, the 1-running-body invariant, the Colo capacity ceiling, the 0082 resource limits, the append-only audit row, and operator approval of skins (0172).
   - Setting and unsetting the flag is itself an audit row (actor `operator`, action `admin_set` or `admin_unset`). Every audit row written for an admin's action carries `admin = true`, so exemptions can be reviewed.
   - An admin owner sees only their own data. There is no admin view, route or key scope that reads another owner's agents, logs or account.
   - The supervisor and the register service read the flag from the database on every request, and treat a missing or unreadable flag as false (fail closed to the limits).

## Why

- The numbers are the owner's rulings of 2026-11-13; the proposed defaults in the C7 file were accepted as written.
- Exempting the operator's accounts from counters, but not from ownership or audit, keeps testing and support possible without making a second, unaudited path into other owners' data.
- Setting the flag only from the node keeps it out of reach of anything on the web.

## What it changes

- C7-02, C7-03 and C7-04 use these values. C7-12 adds the flag, its CLI and the audit table base.
- A start counter and an owner-day counter are needed in the database (C7-03a).
