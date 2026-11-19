# 0320. The kit's kit-b cards are authoritative for HC-19 to HC-26c

- Status: Accepted (operator ruling, 2026-11-18)
- Date: 2026-11-18
- Spec: none. A campaign record for the character-sheet campaign; `docs/spec.md` is not edited.
- Related: 0280 (proficiency contract), 0281 (psyche package boundary); [sheet-cards-verification-2026-11-18.md](../analysis/harness/sheet-cards-verification-2026-11-18.md) section 2; [sheet-next-wave-order.md](../analysis/harness/sheet-next-wave-order.md) section 3 item 1

## Context

Two card sets describe the kit cards HC-19 to HC-26c: this repo's `docs/analysis/harness/work-packets-sheet-w3-w5.md` and the kit repo's `docs/analysis/harness/work-packets-kit-b.md`. HC-18 merged on the kit's `scriptorium/hw0` following kit-b, so the in-repo copies code against names the merged package does not have (`Fx` objects, `InstinctStore`, `runStep`, `--config`). The kit-b cards use the merged names (`runInstinct`, `GELDAR_INSTINCT_*`, `run --run <n>`, `InstinctResult`). Kit-b HC-20 still reads proficiency from `sheet.proficiency`, which the kit's `parseSheet` refuses. OD-C (where the kit gets proficiency levels) had a recommendation but no ruling.

## Decision

1. **Kit-b is the authority** for HC-19, HC-20, HC-21a, HC-21b, HC-22, HC-23a, HC-23b, HC-24, HC-25, HC-26a, HC-26b and HC-26c.
2. **The in-repo copies are retired.** The HC-18 to HC-26c sections of `work-packets-sheet-w3-w5.md` are history; no coder is dispatched from them. HC-33 (docs only) is not covered by this ruling and keeps its in-repo card.
3. **OD-C is ruled: proficiency for HC-20 in round one is all zero, marked degraded.** The kit does not read proficiency from the sheet. Every domain level is 0 and the run records that its proficiency input is degraded. A supervisor-only feed from the world state is a later decision, not made here.

## Consequences

- The ledger points HC-19 to HC-26c at kit-b (kit repo) and marks the in-repo copies retired.
- Kit-b HC-20 is corrected before dispatch: drop the `sheet.proficiency` read, pass level 0 for every domain, record the degraded flag.
- Kit-b HC-19 to HC-26c are re-verified against `scriptorium/hw0` before dispatch (the wave-order note, section 3 item 1). Kit-side shared files still need the scriptorium orchestrator's go.
- The W6 kit cards in `work-packets-sheet-w6-w8.md` that name S-INSTINCT shapes (HC-30a, HC-31) still need their own correction to the merged names; this record does not retire them.

## Not decided here

- The world-to-kit proficiency feed after round one.
- OD-A (temperament route and wording, HC-25) and OD-B (veto wording, HC-23a).
