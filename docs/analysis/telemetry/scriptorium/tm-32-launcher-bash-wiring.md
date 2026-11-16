# TM-32: launcher (bash) merges the telemetry overlay when the owner enables it (scriptorium repo)

Repo: geldar-scriptorium. Depends on: TM-31. Unblocks: N13 for bash launcher hosts. Pair card: TM-33 (PowerShell) must behave identically; the two run in parallel in separate worktrees and touch different files. Mind redeploy: next launcher release. `colo-images` path: n/a.

## Goal

When the launcher's environment has `GELDAR_PLAY_OTEL=1`, every compose call for a player adds `-f <share>/compose/player-otel.yml`. Otherwise nothing changes, byte for byte.

## Files (exactly these)

- `launcher/lib/player.sh` (edit: the one function that builds the compose command, about line 226, `docker_cmd compose -p "geldar-player-$id" -f "$share/compose/player.yml" "$@"`)
- `launcher/test/telemetry-overlay.bash.test.ts` (new, modelled on `launcher/test/commands.test.ts` and `harness.ts`, using the fake docker)
- If the launcher bundle lists compose files by name instead of by glob, `tools/release/src/package-launcher.ts` (add the two new files) and its test; read `launcher/test/bundle.test.ts` first. This is the third file at most.

## Steps

1. Read `launcher/lib/player.sh` around the compose helper and every caller (start, stop, ps, logs, down must all see the same file list, or `down` would leave the network attached).
2. Build the file arguments once: `files=(-f "$share/compose/player.yml")`; when `${GELDAR_PLAY_OTEL:-}` is exactly `1`, append `-f "$share/compose/player-otel.yml"`. Use the array for every compose call (do not duplicate the list).
3. If the overlay is requested but `player-otel.yml` is missing from the install, exit with the launcher's usual error style and a message that names the file (not the variable's value).
4. Do not read or pass `GELDAR_INGEST_*`, and do not export `GELDAR_TELEMETRY_URL` from the launcher: the overlay supplies the value inside compose. `GELDAR_ID` is already set by the launcher for compose.
5. Tests (fake docker records its argv):
   - (a) env unset: every compose call's args are identical to the pre-change snapshot (store the snapshot from the existing tests).
   - (b) `GELDAR_PLAY_OTEL=1`: start, ps, logs, stop and down all include both `-f` files in the same order.
   - (c) `GELDAR_PLAY_OTEL=0` or `yes`: treated as off.
   - (d) overlay missing: non-zero exit, error names `player-otel.yml`, no docker call made.
   - (e) no recorded argv or environment passed to the fake docker contains `INGEST`.
6. Revert check: remove the append; (b) must fail. Make `yes` count as on; (c) must fail.

## Checks and commit

`pnpm lint`, `pnpm typecheck`, `pnpm test` (launcher tests include the bash suite; if bash is unavailable on the dev host, run on the host that has it and say so), `pnpm check:repo`, `git diff --check`. Commit: `T-13 TM-32: bash launcher merges the telemetry overlay only when GELDAR_PLAY_OTEL=1 (launcher)` plus the two trailers.

## Do NOT

- Do not touch `player.ps1` (TM-33) or `player.yml`.
- Do not enable the overlay by default or by the presence of a file.
- Do not log the overlay's contents or the player id with it.
