# 0034. Mock result shapes: snapshots in results, the untrusted-text wrapper, and the waking event is never trimmed

- Status: Accepted (provisional with the mock)
- Date: 2026-11-09
- Spec: section 5.15.3 (tool contracts), Appendix K; Scriptorium Wave 3 packets SC-30a, SC-30b, SC-32c, SC-32d

## Decision

1. Tool results that show the world (`look`, `wait`, `act`, `sleep`) carry a snapshot with `heard` always empty and sign text only inside the wrapper `untrusted_world_text`. Anything an agent or player wrote (laws, journal text, book text, overheard speech, sign text) appears only inside `untrusted_world_text`; the surrounding fields are fixed templates.
2. The `act` result is exactly the frozen Appendix K shape (`accepted`, `rejected` with flat indices and reason codes, `budget_remaining_thoughts`).
3. A `wait` result that is too large is trimmed in this order: other events oldest-first, then speech lines that do not belong to a waking event oldest-first, then book text, and only as a last resort the waking text is truncated deterministically (longest first). The events that caused the wake, their `wake_reason`, and the speech lines that belong to them are never dropped. If more than 200 events are waking, the oldest waking events are dropped (the schema cap).
4. Skill code written by a player is stored as text and never run by the mock.

## Why

A character woken with no visible cause cannot decide well (ruling from the packet author, 2026-11-09). Keeping player-authored text in one wrapper makes it identifiable as data, not instruction.

## Consequences

- Consumers read untrusted text only from the wrapper.
- A very large result may return fewer other events than the cap.
- The mock's CLI and logs never print tokens or request bodies.
