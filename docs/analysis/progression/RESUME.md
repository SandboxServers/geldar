# RESUME: progression campaign (colo v1)

Ledger: `README.md`. Packets: `work-packets.md`. Record: `docs/decisions/0385-progression-flag-relaxes-principle-2-per-shard.md` (revised 2026-11-19, Proposed).

## State (2026-11-19)

- X0 (this campaign, revised 0385): Writing on `progression/x0-campaign`.
- X1, X2a, X2b: written as prescriptive packets; may be dispatched; merges wait for D-PR-01.
- X2c to X5: BlockedDecision.

## Next action

Open the X0 PR (docs only) and request Cadacious's review of revised 0385. Ask the owner D-PR-04 (sheet held-live ruling) and D-PR-05 (levels) first: X2c onward needs both. Dispatch X1, X2a and X2b when the owner says to.

## Open for the owner

- D-PR-01 accept revised 0385 (Cadacious).
- D-PR-04 the sheet held-live ruling (2026-11-15) blocks XP on colo.
- D-PR-02 to D-PR-09 in the ledger.

## Facts settled while planning

- XP does not run on colo; `compose/opt-in/sheet-sink.yml` is the only place `GELDAR_XP` is set.
- Levels are pinned to 10, 30, 70 while the state service runs (`eventsink/src/sink-plan.ts`).
- `goto` takes a position or an agent name; action records carry no position; the bed is in a completed `sleep`'s `result.detail.bed`.
- The MCP cannot read the proficiency tables (`sql/0050`).
