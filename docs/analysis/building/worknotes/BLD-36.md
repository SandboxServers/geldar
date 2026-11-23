# BLD-36 worknotes

- Decision 0428: `mine`, `break` and plan no longer refuse a dig for a falling column, liquid, a walled-in cell or the block under the feet.
- `mine.ts` no longer calls `digSafetyRefusal` (and no longer skips the block under the feet, `standsOn`). Only `unbreakableReason` refuses.
- `dig-safety.ts` is unchanged: `digSafetyRefusal` still serves escape-ladder, escape-stairs, pillar, unstick, unstick-up and the dig-cell reflex, which are outside BLD-36's file list. Its own tests still pass.
- `mine-cell.ts` has no dig-safety call site; its "would drop you" test now expects the dig.
- Tests rewritten from refusal to dig: `mine.test.ts`, `mine-falling.test.ts`, `mine-cell.test.ts`.
