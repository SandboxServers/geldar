# 0447. Running-Body cap 50 and per-owner player cap 100

- Status: Accepted (the owner's instruction, 2026-11-27)
- Date: 2026-11-27
- Spec: none. This record changes two numbers set by decision 0261 (running Bodies) and decision 0052 and migration 0002 (the per-owner player cap).
- Amends: 0261 item 3d (the running-Body cap of 40) and item 3e (the alert at 30 and the staged re-measure before a raise). Its other rules stand.

## Decision

1. **The running-Body cap goes from 40 to 50 in one step.** The owner instructed this on 2026-11-27. The staged 30/40 re-measurement that 0261 item 3e asks for before a raise is skipped on the owner's authority. The 15 sovereign hosts still count toward the cap, as 0261 item 3d says.
2. **The alert moves from 30 to 40.** The helper writes its one alert line when the running count first reaches 40, as 0261 item 3e sets the alert at a fixed point below the cap. The code value is `CAP_ALERT_AT` in `body-helper/src/service.ts`, and the default is `DEFAULT_GLOBAL_BODY_CAP` in `body-helper/src/config.ts`. `GELDAR_GLOBAL_BODY_CAP` still overrides the default, and the helper still never raises the cap itself.
3. **The per-owner sovereign player cap goes from 50 to 100.** Migration `sql/0069_owner_player_cap_100.sql` replaces the `mcp_owners.player_cap` CHECK from 0 to 50 with 0 to 100. The wrapper `deploy/colo-admin.sh owner-set-cap` and the CLI `mcp-tokens owner set-cap` accept 0 to 100, and `MAX_OWNER_CAP` in `tools/mcp-tokens/src/owners.ts` is 100. The `owner add --cap` ceiling (`owner_cap_owner`, 20) does not change.
4. **Measure after go-live.** TPS and MSPT (0261 item 3e: TPS 20 and MSPT under 25) are measured after the raise, not before it. Measure them against the Paper telemetry about 30 minutes after the change.
5. **Rollback.** If the measurement is bad, stop the extra Bodies with `player-stop` for each, or lower the cap in the helper's env and restart the helper. Revert the migration only with a new migration, never by editing 0069.

## Consequences

- The shard holds 50 players at the cap of 50 running Bodies. The Paper server (`MAX_PLAYERS` 400 in `compose/colo.yml`) and the Colo sizing were not benchmarked with more than one Body (`docs/operations/capacity-and-cost.md`). The owner accepts that risk for this step.
- A change to `sql/**` and `tools/mcp-tokens/**` is a colo-images path. It ships through the colo-images workflow, not a plain merge.
- Decision 0261 is not edited. This record is the amendment, and the README row says so.
