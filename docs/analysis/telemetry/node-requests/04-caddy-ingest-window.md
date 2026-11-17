# Node request 04: Caddy ingest window (one recreate of the shared `board-proxy`)

Status: DRAFT. The full procedure, with every command and the sudo list, is `deploy/caddy/README.md` section "OTLP ingest (otel.caddy)" and the design is `docs/analysis/telemetry/caddy-ingest-route.md`. This request does not repeat them: it states the request fields and the choices the owner must make. Nothing has been run. Owner ruling geldar-93 (2026-11-16): the ingest route only, stock Caddy, no custom image, no third-party module, UI by SSH tunnel only.

Owner approval: yes, at the time (collector-design N14).

## 1. What changes

1. Three env lines in the shared Caddy's env file (`GELDAR_INGEST_HOST`, `GELDAR_INGEST_UPSTREAM`, `GELDAR_INGEST_TOKEN`) after a root-only backup.
2. `otel.caddy` placed in `config/geldar/` on the node (same owner and mode as `mcp.caddy`).
3. ONE recreate of `board-proxy` (a restart does not load new env values).
4. A DNS record for the ingest host (owner action, before the window).

Owner choices needed: the ingest host name `ingest.<zone>` under the `sandboxservers.games` zone (the placeholder in this file is `ingest`; the real name goes into `GELDAR_INGEST_HOST` on the node only, never into the repo); the window time.

## 2. Token placement

The token is generated and placed by an operator session (the Claude session that runs the sudo steps, with the owner's word at the time): 32 random bytes as 64 hex characters, never in the repo, argv, history or a log; it arrives on stdin through the guarded append of README step 2c, and goes to the Mind host by role (the scriptorium launcher's state directory, `otel` folder, mode 600 in a mode-700 directory). Ops agents never run the sudo steps. Rotation is its own approved window with the same recreate.

## 3. Not touched

Other tenants' sites and config (they see only the outage below), Paper, Velocity, Bodies, NATS, the gateway (unchanged, must already run with the loopback publish `127.0.0.1:4320`), the Caddyfile itself (it already imports `/config/geldar/*.caddy`; read-only check), other `config/geldar` files, the SigNoz UI (no Caddy route).

## 4. Caps and outage

No CPU or RAM change. Outage: every site behind the shared Caddy is down for the recreate, ESTIMATE 5 to 15 seconds plus certificate load; the `mcp.caddy` SSE streams drop and reconnect. The number is unmeasured: record the real seconds and write it back to the README. A rollback is a second outage of the same size.

Window: low load, owner's time, never the same day as a Paper window (rollout plan). The gateway restage (01) happens before it, with its own verify.

## 5. Baseline (before)

README step 3 baseline: `probe` status and TLS result of one request per site (`map`, `glass`, `mcp` and every other site named by the owner) into `/mnt/nvme/geldar-telemetry/stage/caddy-baseline-<ts>.txt`; compose labels of `board-proxy` (project name and working directory, non-empty); `docker exec board-proxy caddy version` (README expects v2.11.6); the env-file owner and mode (`sudo stat -c '%U:%G %a'`); `docker port geldar-gateway` prints only `127.0.0.1:4320`. Never an unfiltered `docker inspect board-proxy` (prints the token).

## 6. Steps

README order: 1 (precheck), 2 (backup then guarded append), 4 (place snippet), 3 (throwaway `caddy validate` with the same image, env file and snippet, then the ONE recreate: `sudo docker compose -p <project> up -d --force-recreate board-proxy` from the working directory read in the baseline), then 6 (verify) and 7. If the throwaway validation fails: remove the snippet, restore nothing else, do not recreate. DNS record and the `certificate obtained` log line for `<ingest host>` must exist before step 6.

## 7. Verify (after)

README step 3 immediately after (container running, `caddy validate` passes, baseline comparison prints nothing), then step 6 matrix from the workstation with the token on stdin: no token 401 on the three paths, wrong token 401, GET 405, other path 404, authenticated POST gets the gateway's answer, authenticated 9 MiB POST gets 413 (measured on 2.10.2 only: write the 2.11.6 result back), log check prints `0` token hits and every credential header line is `REDACTED`, portscan unchanged. Then OTLP from the Mind host arrives in SigNoz (scriptorium side).

## 8. Rollback

README "Rollback and kill switch": failure before verification: remove the snippet, restore the env-file backup, recreate once more. After verification: copy `otel-off.caddy` over `otel.caddy`, validate, `docker restart board-proxy`, rerun the baseline comparison. Remove `otel.caddy` before removing the env lines. The env backup holds the node's other credentials: the owner deletes it after step 6 passes.

## 9. Open facts

The ingest name and DNS record; the env-file path and its actual owner and mode; the compose project name and directory of `board-proxy`; whether the node's issuer certificate path works for a new host; measured outage seconds; 413 and error-log redaction on 2.11.6; whether the node reaches its own public names (hairpin) for the baseline probes.
