# TM-12: supervisor reads the telemetry setting and starts and stops the SDK (scriptorium repo)

Repo: geldar-scriptorium. Depends on: TM-11. Unblocks: TM-13, TM-15 and everything on the supervisor. Mind redeploy: next kit image (batched). `colo-images` path: n/a.

## Goal

One switch, `GELDAR_TELEMETRY_URL` (the OTLP/HTTP base URL of the otel-agent on the Mind host). Unset or blank: nothing starts, nothing changes. Set: the SDK starts at supervisor start and shuts down at supervisor stop. The model child never sees the variable.

## Files (exactly these)

- `packages/supervisor/package.json` (add dependency `@geldar/scriptorium-telemetry: workspace:*`)
- `packages/supervisor/src/settings.ts` (add `telemetryUrl: string` and `playerId: string` to `Settings`, read from `GELDAR_TELEMETRY_URL` and `GELDAR_PLAYER_ID`)
- `packages/supervisor/src/telemetry/start.ts` (new)
- `packages/supervisor/src/cli.ts` (call `startMindTelemetry(settings)` before the loop and `await handle.shutdown()` after it)
- `packages/supervisor/src/telemetry-start.test.ts` (new)
- `image/compose/player.yml` is NOT in this card (the variable names go there in TM-31 so all compose edits are in one card).

## Steps

1. Read `settings.ts` (the `readSettings` function and the `num` helper style), `cli.ts`, `image/Dockerfile` (does it copy `packages/*` and install workspace dependencies? If the supervisor is bundled or only its own package is installed, stop and report: G-10).
2. `readSettings`: `telemetryUrl` is the trimmed value or `''`. Accept only `http://` or `https://` URLs; anything else throws `SettingError('GELDAR_TELEMETRY_URL')` (the message names the variable, never its value). Reject a URL containing `@` (user info) the same way. `playerId` is `GELDAR_PLAYER_ID`, allowed pattern `^[a-z0-9][a-z0-9_-]{0,63}$`, default `''`; an invalid value throws `SettingError('GELDAR_PLAYER_ID')`.
3. `telemetry/start.ts` exports `startMindTelemetry(settings, version)` returning `{ enabled, tracer, meter, shutdown }`. With `telemetryUrl === ''` it returns a disabled handle without importing or touching the SDK (a static import of the package is fine; calling `startTelemetry` is what must not happen). With a URL it calls `startTelemetry({ service: 'geldar-mind', version, environment: 'mind-host', endpoint: telemetryUrl })` and exposes `tracerProvider.getTracer('geldar-mind')` and the global meter. Never throws: wrap in try/catch, return disabled on error and write one line to stderr naming no value.
4. `cli.ts`: call it once, keep the handle for the run, call `shutdown()` in a `finally`, bounded by the package's own 10 s ceiling. A shutdown error is ignored.
5. `childEnv` is NOT edited. Add no name to `PASS_THROUGH`.
6. Tests (`telemetry-start.test.ts`):
   - (a) `readSettings({})` has `telemetryUrl === ''` and `startMindTelemetry` returns `enabled: false` and does not call a stub exporter (use the package's `exporters` seam through an injectable factory parameter).
   - (b) `readSettings({ GELDAR_TELEMETRY_URL: 'ftp://x' })` throws `SettingError` with `variable === 'GELDAR_TELEMETRY_URL'`, and the error message does not contain `ftp`.
   - (c) with a valid URL and a stub exporter, `enabled` is true and a span reaches the stub after `shutdown()`.
   - (d) `childEnv(readSettings({ GELDAR_TELEMETRY_URL: 'http://agent:4318', GELDAR_PLAYER_ID: 'p1' }), { GELDAR_TELEMETRY_URL: 'http://agent:4318', GELDAR_PLAYER_ID: 'p1' })` contains neither name nor either value.
   - (e) a closed port as the URL: `shutdown()` resolves within 12 s and nothing throws.
7. Revert check: add `'GELDAR_TELEMETRY_URL'` to `PASS_THROUGH` locally; (d) must fail. Restore. Make `readSettings` skip the scheme check; (b) must fail. Restore.

## Checks

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm check:repo
git diff --check
```

## Commit

`T-13 TM-12: supervisor starts and stops telemetry from GELDAR_TELEMETRY_URL, off by default (supervisor)` plus the two trailers.

## Do NOT

- Do not write the URL or the player id into `status.json`, `supervisor.log`, a prompt or any file.
- Do not read the ingest token anywhere: the supervisor never holds it (README A1).
- Do not change `PASS_THROUGH` or `childEnv`.
- Do not add spans yet (TM-13).
