# 0033. The mock's wake and interest vocabulary is provisional, and the character is woken only by wake_on conditions and long-poll events

- Status: Accepted (provisional vocabulary)
- Date: 2026-11-09
- Spec: section 5.3.1 and 5.3.2 (deterministic code drives; the model is woken for decisions), 5.15.3 (tool contracts), Appendix K (the frozen `act` result); Scriptorium Wave 3 packets SC-30a, SC-32a to SC-32d (`geldar-scriptorium`, `docs/analysis/scriptorium/work-packets-wave3.md`)

## Decision

1. The mock Geldar MCP world (`threshold/mcp-mock`) uses a vocabulary of six interests and nine wake reasons, plus a set of player event types, defined in `contract/schemas/mcp-common.schema.json`. Each carries a `PROVISIONAL` comment: it is the mock's proposal, and the real server may differ. The frozen `act` result (Appendix K) is not extended to carry wake vocabulary.
2. The character is woken only by its `wake_on` conditions and by long-poll events (`wait`). An accepted intent is advanced by code between wakeups (a scripted tick-by-tick executor); a model call is never part of the mock.
3. Wake rules: wakeups are at least a minimum spacing apart (a configurable number of seconds); an intent that runs too long falls back to a wakeup (`intent_run_too_long`), exempt from the spacing window; the end of an intent wakes the character (`intent_finished`) regardless of interests; reasons have a fixed priority order; `directly_addressed`, `unexpected_damage`, `new_agent_nearby` and the others are filtered by `wake_on` and by the long-poll `interests`.

## Why

The spec fixes the principle but not the wire vocabulary; the mock needs one to be testable. Marking it provisional keeps the real server free to change it, and keeping Appendix K unchanged keeps the frozen contract intact.

## Consequences

- Any consumer of the mock must treat the vocabulary as subject to change.
- `PlayerSim.nextScheduledMs()` always includes the next half-day boundary and hunger step so that a `wait` with the default `day_night` interest wakes at dusk.
- The simulation clock is injected; no part of the mock calls a model.
