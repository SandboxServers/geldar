# TM-33: launcher (PowerShell) merges the telemetry overlay when the owner enables it (scriptorium repo)

Repo: geldar-scriptorium. Depends on: TM-31. Unblocks: N13 for Windows launcher hosts (the owner's machine today). Pair card of TM-32 (bash): identical behaviour, identical test cases. Mind redeploy: next launcher release. `colo-images` path: n/a.

## Goal

When the launcher's environment has `GELDAR_PLAY_OTEL=1`, every compose call for a player adds `-f <share>/compose/player-otel.yml`. Otherwise nothing changes.

## Files (exactly these)

- `launcher/lib/player.ps1` (edit: the helper that builds the compose command, about line 266, `Invoke-Docker compose -p "geldar-player-$Id" -f "$sd/compose/player.yml" @ComposeArgs`)
- `launcher/test/telemetry-overlay.pwsh.test.ts` (new, modelled on the existing `*.pwsh.test.ts` files and `harness.ts`)
- If TM-32 found that the bundle lists compose files by name, the same two-line change in `tools/release/src/package-launcher.ts` is made by whichever of TM-32 and TM-33 merges first; the other rebases onto it.

## Steps

1. Read `player.ps1` around the compose helper and all its callers.
2. Build one argument array: `$files = @('-f', "$sd/compose/player.yml")`; when `$env:GELDAR_PLAY_OTEL -eq '1'` add `'-f', "$sd/compose/player-otel.yml"`. Use it in every compose call.
3. Missing overlay file: fail with the launcher's error style naming the file.
4. No `GELDAR_INGEST_*` handling; no export of `GELDAR_TELEMETRY_URL`.
5. Tests: the same five cases (a) to (e) as TM-32, run through the PowerShell launcher with the fake docker (`docker.cmd` shim on Windows as `harness.ts` does).
6. Revert check: remove the append; (b) must fail.

## Checks and commit

Same as TM-32 (PowerShell 7 on Windows for the pwsh suite). Commit: `T-13 TM-33: PowerShell launcher merges the telemetry overlay only when GELDAR_PLAY_OTEL=1 (launcher)` plus the two trailers.

## Do NOT

- Do not touch `player.sh`, `player.yml` or compose files.
- Do not let the two launchers differ in what counts as "on" (only the exact string `1`).
- Do not use `Invoke-Expression` or build the command as one string.
