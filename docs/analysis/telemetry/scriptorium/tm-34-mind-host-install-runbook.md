# TM-34: Mind-host otel-agent install runbook (N13 / A13), written for the owner (scriptorium repo, docs)

Repo: geldar-scriptorium (docs only). Depends on: TM-31, TM-32 and TM-33 merged; B1 (the Caddy ingest route) live; TM-35 (rotation) written; TM-25 passed on the kit image in use. Unblocks: the owner's N13 step. `colo-images` path: n/a. Node step: this card WRITES the runbook; the install itself is the owner's session (rollout-plan A13), one request to the orchestrator per host with caps, window, rollback.

## Goal

A runbook the owner follows on each Mind host. The coder writes it; the coder never runs it.

## Files (exactly these)

- `docs/runbooks/otel-agent.md` (new; check the repo's runbook folder name and style first; if `docs/runbooks/` does not exist use `docs/`)

## What the runbook must contain (each item is a section with exact commands; no values)

1. Preconditions, each a checkbox the owner ticks: B1 done and verified (POST without token gets 401, with token not 401 or 404); the ingest token generated and stored by the owner (TM-35 steps 1 to 2, never in this file); TM-25 passed on the kit image; the gateway on the Colo healthy; owner approval for N13 recorded.
2. One-time per host: `docker network create --internal geldar-otel`. Check it is internal: `docker network inspect geldar-otel --format '{{.Internal}}'` prints `true`.
3. The env file: a file outside every repo, mode 0600 (PowerShell: create empty, then `icacls` to the owner only; bash: `umask 077`), holding two lines `GELDAR_INGEST_HOST=` and `GELDAR_INGEST_TOKEN=`. The owner types the values into the file in an editor. The runbook never shows the commands that print them, and says not to `echo` the token or paste it into a shell.
4. Start the agent: `docker compose -p geldar-otel-agent -f image/compose/otel-agent.yml --env-file <the 0600 file> up -d`. Confirm: container running; `docker inspect` shows no published ports, `ReadonlyRootfs` true, memory limit 256 MiB.
5. Verify the agent before any player points at it: `docker logs geldar-otel-agent-otel-agent-1` shows the receiver started and no `401`, `403`, `unauthorized` or DNS lines in two minutes; `docker logs ... | grep -ci bearer` prints 0.
6. Enable one player first (a scratch player, or the least important): set `GELDAR_PLAY_OTEL=1` in the launcher's environment for that player's start, restart that Mind through the launcher. Confirm the supervisor started telemetry (`status.json` unchanged in shape; the operator checks in SigNoz through the SSH tunnel, per the UI rule, for a span named `mind.run` with the player's id after one run).
7. Verify isolation on the live host without touching the token: run the TM-25 probes (the test is for the stub image; on the live host the owner runs P1, P2, P5, P8 by hand through `docker exec --user 1000:1000` against the real player container and records the results).
8. Then the other players, one at a time, a few minutes apart. Stop at the first anomaly.
9. Verification of data: SigNoz (tunnel) shows `service.name=geldar-mind` spans and logs from this host; `geldar.content.prompt` events present; no attribute named like a token; queue not growing (agent logs show no `dropping data` lines).
10. Rollback, in this order: unset `GELDAR_PLAY_OTEL` and restart the Minds (they then stop exporting); `docker compose -p geldar-otel-agent ... down`; remove the network when no player is attached; if the token may have appeared in any log, follow TM-35 (emergency path).
11. Stop conditions (the owner stops and tells the orchestrator): a Mind's run timing changes (compare `supervisor.log` `secs=` values over five runs before and after); any `401`/`403` from the route; the agent restarts more than once; memory above 200 MiB; the token string found by `grep -F` in any agent or Mind log (grep with a pattern file, never an argument); the Caddy access log shows an `Authorization` value.
12. What is NOT done here: no Caddy change, no Colo change, no token generation or rotation (TM-35).

## Steps for the coder

1. Read `docs/` layout and one existing runbook for style (the geldar repo's `docs/runbooks/kino.md` is an example of tone, not a path to copy into this repo).
2. Write the runbook with the twelve sections above. Every command is complete and copy-ready for both PowerShell 7 and bash where the host may be either.
3. No hostnames, no IPs (except `127.0.0.1`), no account names, no token values or examples that look like tokens.
4. Test: `pnpm lint:md` passes; a small test (or the existing docs check) that the file contains no `Bearer ` followed by a non-placeholder, no `://` URL with a real-looking domain (allow `example.invalid`), and mentions TM-35.

## Checks and commit

`pnpm lint:md`, `pnpm lint`, `pnpm check:repo`, `git diff --check`. Commit: `T-13 TM-34: Mind-host otel-agent install runbook (docs)` plus the two trailers.

## Do NOT

- Do not run any step of the runbook, and do not put it where the model can read it (it is under `docs/`, outside the template).
- Do not include the Caddy side; that is rollout-plan B1 in the geldar repository.
