# 0057. Sovereign budget numbers, rate limits, wake spacing and presence timings for Phase 0

- Status: Accepted (owner standing instruction: decisions recorded, owner may revise)
- Date: 2026-11-10
- Spec: 5.7 (credits per real hour), 5.15.6 (owner caps); decisions 0052, 0058; Wave M packets WM-03, WM-04, WM-05

## Context

The mock had no real budget, and Wave M needed numbers that the rangers and Adam can live with. The numbers sit in `shards/phase0.yaml` and are read by `threshold/mcp/src/config.ts`.

## Decision

1. **Credits.** A life accrues 30 credits per real hour and holds at most 240 (`budget.credits_per_real_hour`, `budget.cap_credits`). Each accepted `say` and each intent costs one credit. `wait`, `look`, `read_book` and `status` are free.
2. **Owner caps.** One owner may hold 3 sovereign players by default (`owner_cap_default`) and 20 for the owner (`owner_cap_owner`, decision 0052).
3. **Rate limits.** 60 calls a minute per player; 600 a minute per owner; `act` at least 2 s apart and `say` at least 3 s apart per player; 30 failed auths a minute per client address; a global failed-auth limit of 300 a minute.
4. **Wake spacing.** A player is woken at most once per 30 s (`wake.min_spacing_seconds`). An intent running longer than 300 s wakes its player once.
5. **Presence.** A call or an open `wait` keeps a player awake for 60 s. A player that is dim for 600 s hibernates, and its Body goes down. Bodies start on demand, never at boot.
6. **`wait` limit.** `wait` is clamped to 240 s; the client's own timeout is 300 s, so a `wait` returns before the client gives up.

## Consequences

- A player cannot spend more than 240 credits, so a runaway loop is bounded by the cap, not by the thinking loop.
- The 30 s wake spacing means a player is not woken twice in quick succession by the same stimulus.

## Open

- **Global failed-auth limit (300 a minute)** is set in code, not in config, and the packet asks whether it should be a config key.
- **The live hibernate test** runs with an override of 60 s, not 600 s. It is a test setting, not the Phase 0 value.
- **The budget numbers have not been checked against a real session.** The first owner session is the first real measure.
