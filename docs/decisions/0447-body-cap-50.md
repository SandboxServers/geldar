# 0447. Running-Body cap raised from 40 to 50 in one step

- Status: Accepted (the owner's instruction, 2026-11-27)
- Date: 2026-11-27
- Spec: none. This record changes one number set by decision 0261 (the running-Body cap).
- Amends: 0261 item 3d (the running-Body cap of 40) and item 3e (the alert point and the staged re-measure before a raise). Its other rules stand.

## Decision

1. **The running-Body cap goes from 40 to 50 in one step.** The owner instructed this on 2026-11-27. The staged 30/40 re-measurement that 0261 item 3e asks for before a raise is skipped on the owner's authority. The 15 sovereign hosts still count toward the cap, as 0261 item 3d says.
2. **The alert point is 40 running Bodies.** The helper writes its one alert line when the running count first reaches 40. This is a chosen margin of 10 below the cap, not a figure the owner set. The code value is `CAP_ALERT_AT` in `body-helper/src/service.ts`, and the default cap is `DEFAULT_GLOBAL_BODY_CAP` in `body-helper/src/config.ts`. `GELDAR_GLOBAL_BODY_CAP` still overrides the default, and the helper still never raises the cap itself.
3. **The per-owner player cap does not change.** It stays at 50 (decision 0052, migration 0002). The 31 new players are placed under one owner, which makes 45 of 50 (14 existing plus 31). No schema or token-tool change is needed.
4. **Measure after go-live.** TPS and MSPT are measured after the change, not before it. The bar is the one 0261 item 3e sets: TPS 20 and MSPT under 25. Measure against the Paper telemetry about 30 minutes after the change.
5. **Rollback.** If the measurement is bad, stop the newest players with `player-stop`, one per player. The cap can also be lowered by setting `GELDAR_GLOBAL_BODY_CAP` in the helper's environment and restarting the helper.

## Consequences

- The shard can hold 50 running Bodies. The Paper server (`MAX_PLAYERS` 400 in `compose/colo.yml`) and the Colo sizing were not benchmarked with more than one Body (`docs/operations/capacity-and-cost.md`). The owner accepts that risk for this step.
- Decision 0261 is not edited. This record is the amendment, and the README row says so.
