# 0322. The sheet campaign includes NeoForge as inert code

- Status: Accepted (operator ruling, 2026-11-18; answers OD-NF-7 only)
- Date: 2026-11-18
- Spec: none. A campaign record for the character-sheet campaign; `docs/spec.md` is not edited.
- Related: 0380, 0383, 0385 (Proposed), 0387 (Proposed); [neoforge-delta.md](../analysis/sheet/neoforge-delta.md); [work-packets-sheet-neoforge.md](../analysis/harness/work-packets-sheet-neoforge.md)

## Context

The operator chose "delta packets": the Paper sheet cards stay as written, and each card whose world side is Paper-specific gets a NeoForge twin (AN-NF-00, AN-NF-26a, AN-NF-27a, AN-NF-28b, AN-NF-47a, AN-NF-51a, AN-NF-50). OD-NF-7 asked whether the campaign includes the NeoForge shard at all.

## Decision

1. **OD-NF-7: yes, as inert code.** The twin cards are part of the sheet campaign. They ship off (`provenance.enabled` absent registers nothing), as every sheet card does.
2. **The twins are blocked on P3-LIVE and P4.** P3-LIVE: P3-6 merged and its scratch run passed. P4: the NeoForge block-owner log, with the requirements in the delta note section 4. A twin merges only after its prerequisite has merged, even where its code could be written earlier.
3. **OD-NF-1 to OD-NF-6 and OD-NF-8 stay open.** This record does not rule them.
4. Activation on either shard follows the held-live ruling of 2026-11-15 for that shard.

## Consequences

- The ledger lists the seven twins. AN-NF-51a stays BlockedDecision on OD-NF-3; the others are BlockedDependency.
- The Paper cards get amendments A1 to A4 (delta note section 3) before W5 and W8 dispatch, so the twins reuse `plugin/core-common` code. A5 (the human rule in `observedActor`) waits for OD-NF-2.
- This record does not authorize sheet Bodies on the NeoForge shard. NF-BODY (a Body NATS role on `geldar-nf` and the decision to run sheet Bodies there) is still needed, and the Body halves of AN-28b and AN-50 on NeoForge are not carded.
- No human name leaves the NeoForge server in any sheet message (the rule of the merged NeoForge export and every twin card).
