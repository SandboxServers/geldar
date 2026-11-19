# 0327. No births, no attribute drift and no persona refresh in this campaign

- Status: Accepted (operator ruling, 2026-11-18)
- Date: 2026-11-18
- Spec: none. A campaign record for the character-sheet campaign; `docs/spec.md` is not edited.
- Related: D-CS-09, D-CS-13, D-CS-17 in [decisions-before-packets.md](../analysis/character-sheet/decisions-before-packets.md); OD-5 to OD-9 and W10, W11 in [work-packets-sheet-w9-w12.md](../analysis/harness/work-packets-sheet-w9-w12.md)

## Context

W10 (lineage and births) and W11 (attribute drift) were gated on OD-5 to OD-9. The cards planned decisions 0284 (lineage) and 0285 (drift) and SQL 0054 and 0055.

## Decision

1. **OD-5: no births between lives in this campaign.** W10 closes as merged inactive: no W10 card (S10-01a to S10-04, HC-42, HC-43) is dispatched, and lineage stays off by default. Anything later written for W10 merges inactive only.
2. **OD-6 and OD-7 are moot.** With no births there is no child text to approve and no child id to choose.
3. **OD-8: no attribute drift.** W11 is inactive: no W11 card (S11-01 to S11-06, HC-44) is dispatched, and a life's effective sheet stays its adopted baseline.
4. **OD-9: no persona refresh text.** No refreshed persona text reaches any agent. HC-44 and the kit's persona-refresh cards (HC-36a, HC-36b) are not built.

## Consequences

- Decisions 0284 and 0285 are not written; the numbers are released. SQL 0054 and 0055 stay free.
- W12 cards that list a W10 or W11 card as a dependency are corrected before dispatch: S12-01 exports the tables that exist (not "after S11-02"), and the cohort protocol has no inheritance or drift arm.
- The kit lineage cards (HC-34a to HC-35c) are not dispatched for this campaign.
- No psyche release after 1.1.0 is planned (S10-02 is inactive).
- OD-12's ancestry sub-question is moot (0323).
