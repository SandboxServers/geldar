# 0011. Every action gets a receipt; economic actions get two

- Status: Accepted
- Date: 2026-11-08
- Spec: section 7 (distributed action protocol), section 10 (Phase 0 exit: "every action has a receipt"), Appendix D `receipts`

## Decision

- Every action ends with exactly one final receipt, phase `committed` (it took effect) or `aborted` (it didn't).
- Economic actions (`offer`, `give`, `write_book`, `read_book`, later Cradle acts) first write a `prepared` receipt (intent to consume), then the final one. The Mind credits only on a `committed` receipt.
- Each receipt is its own row with its own `receipt_id`. `(action_id, phase)` is unique, so a redelivered or repeated action can't write a second receipt for the same phase. That uniqueness is what makes a repeated `offer` with the same `action_id` a no-op.
- Receipts carry an optional `detail` (at most 256 characters) saying what happened, for example why an action aborted.

## Why

Section 7 describes economic operations as two-phase and Phase 0's exit asks for a receipt on every action. Appendix D's `receipts.action_id UNIQUE` allows only one row per action, which can't hold both phases. Moving the uniqueness to `(action_id, phase)` keeps the no-double-credit guarantee and allows both phases.

## Consequences

- `sql/0001_init.sql` differs from Appendix D here and says so in comments (packet P0-05).
- The `Receipt` schema in `contract/` is the definition (packet P0-03).
