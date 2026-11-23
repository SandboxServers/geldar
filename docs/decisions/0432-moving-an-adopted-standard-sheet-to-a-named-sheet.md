# 0432. Moving an adopted standard sheet to a named sheet

- Status: Proposed (awaits the co-owner and the owner)
- Date: 2026-11-23
- Spec: no spec section; decision-only. Related: 0186 (D-CS-03 was assumed there), 0327 (drift stays off), 0328 item 2 (operator approval of a ranger's values)

## Decision

1. D-CS-03, ruled here (0186 only assumed it): each life has one adopted baseline. Nothing reseeds it from config, a restart or a YAML edit.
2. Exception: a life whose baseline is the all-3 standard sheet may be moved ONCE to a named or role sheet, with a recorded co-owner approval of that ranger's values (0328 item 2). After that the baseline is immutable again.
3. No other change to a baseline. Drift stays off (0327).
4. S12-04b must not be built until this record is Accepted.

## Why

The sheet's baseline is a one-way door: the database refuses to change it (sql/0050, allow-listed until D-CS-03 is ruled). The rangers were adopted on the standard sheet, and the named sheets for them need exactly one move. A record that says so keeps that move from becoming a general way to edit a baseline.

## Consequences

- A migration that allows the one move needs this record Accepted first. It ships in a booked deploy window.
- Tests: a second move is refused, a non-standard source is refused, a move with no recorded approval is refused.
- The one-way-door check's allow-list entry for sql/0050 and sql/0051 ("until the co-owner and owner rule D-CS-03 / 0186") can be removed once D-CS-03 is Accepted.
