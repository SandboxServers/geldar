# 0328. Existing agents adopt the all-3 control sheet first

- Status: Accepted (operator ruling, 2026-11-18; answers OD-10)
- Date: 2026-11-18
- Spec: none. A campaign record for the character-sheet campaign; `docs/spec.md` is not edited.
- Related: D-CS-10 in [decisions-before-packets.md](../analysis/character-sheet/decisions-before-packets.md); OD-10 and cards S12-03, S12-04, S12-05, HC-45 in [work-packets-sheet-w9-w12.md](../analysis/harness/work-packets-sheet-w9-w12.md); the held-live ruling of 2026-11-15

## Context

OD-10 asked which sheet each existing agent (Adam and the six rangers) adopts, and whether existing agents adopt at all. The brief's named-sheet values are drafts read from prose.

## Decision

1. **Existing agents adopt the all-3 control sheet first.** It is the control-equivalence sheet: S12-03 proves that an all-3 life behaves as today's bot.
2. **Named sheets come one ranger at a time, each with operator approval.** A named sheet replaces the control sheet for one ranger only after the operator approves that ranger's values and the staged-enable step (S12-05) for it.
3. **All of this is behind the held-live ruling of 2026-11-15.** No adoption is written for a live agent until the whole campaign is complete and the feature has test-shard evidence.

## Consequences

- S12-04's dry-run half (S12-04a) can be written now. Its write half (S12-04b) stays gated by the held-live ruling, and writes the all-3 sheet only.
- S12-05 stages named sheets per ranger, each with a recorded operator approval.
- Decision 0287 (planned by S12-04 for the adoption record) is still written by that card and cites this ruling.
- D-CS-10's named-sheet values remain open, ranger by ranger.
