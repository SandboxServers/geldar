# TM-35: ingest token rotation procedure (the one rollout-plan risk 8 says must exist before N13)

Repo: geldar (this directory; docs only). Depends on: none. Unblocks: TM-34, N13 (A13). `colo-images` path: NO. This is a procedure for the owner and the ops agent, not a coder packet: it is written complete here. A coder card to copy it into the geldar runbooks folder (`docs/runbooks/`) is optional and small (one file, no checks beyond `pnpm check:repo`).

Governing text: `../collector-design.md` section 9 (token handling), `../caddy-ingest-route.md` (placeholders, Load, Rollback), `../rollout-plan.md` (B1, A13, the stop rule). Owner ruling geldar-93, 2026-11-16: ingest route on the shared Caddy, token at least 32 random bytes, owner-generated, owner-placed, never in the repo, a compose file, a log or a chat.

## Where the token lives (so nothing is missed)

| Place | Form | Holder |
|---|---|---|
| Owner's secret store | the master copy | owner |
| Shared Caddy, environment `GELDAR_INGEST_TOKEN` | environment secret, read through `{$GELDAR_INGEST_TOKEN}`; a new value needs ONE recreate of the shared Caddy container | owner, root on the node |
| Colo gateway environment | only if T-02 added a gateway-side check (UNVERIFIED; read `deploy/otel/gateway.yaml`); if present, same value, one more recreate of the gateway | owner |
| Each Mind host, the otel-agent's environment file (`GELDAR_INGEST_TOKEN`) | file, mode 0600, outside every repo | owner |
| NOT in: any repo, compose file, player container, supervisor or model child environment, log, chat, shell history, command line | | |

## Roles

Owner: generates, places, approves each node action at the time (geldar-93 for the orchestrator). Ops agent: runs the read-only checks and the exact commands the owner approved; never sees the token value. Coders: none.

## A. Planned rotation (token not suspected leaked)

Choose a low-load window that is not a Body, Paper or MCP deploy window and not B1, C1 or D2 (rollout-plan: shared Caddy changes are never in the same window as a Body or Paper restart).

1. Generate (owner, on the owner's workstation). Create a new token of at least 32 random bytes and write it straight to a file mode 0600 in a temp folder outside every repo. bash: `umask 077; openssl rand -hex 32 > "$HOME/.ingest-new"`. PowerShell 7: generate 32 bytes with `[System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)`, write them as hex to a new file, then restrict it to the owner with `icacls`. Do not print it, copy it into chat, or put it in an argument. Record its length only (64 hex characters).
2. Pre-check (ops agent, read-only, reported before approval): shared Caddy healthy; `mcp.caddy` SSE site answering; access-log filter in place (no `Authorization` field); the current route returns 401 without a token and not 401 with the old token (from the owner's workstation, using a header FILE so the token is not in argv: `curl -sS -o /dev/null -w '%{http_code}' -X POST -H @<old-header-file> https://<ingest host>/v1/traces`; the file holds one line, `Authorization: Bearer <old>`); the number of Mind hosts and their agent env file paths listed; no deploy in flight.
3. Stage the new value on each Mind host (owner). Put the new token into a NEW env file next to the live one (`<file>.new`, mode 0600), without restarting the agent. The live agent keeps working until step 5.
4. Update Caddy (owner approves at the time; one request with the exact diff and rollback). In the Caddy environment file on the node (the root-only file named in `../caddy-ingest-route.md` Node facts) replace the value of `GELDAR_INGEST_TOKEN` with the new one, by an editor on the node, never by a command that contains it. Check length only (at least 32 bytes; not empty: an empty value turns the matcher into `Bearer `, see `../caddy-ingest-route.md`). Then ONE recreate of the shared Caddy container. If the gateway checks the token (see table), update its environment file in the same visit and recreate the gateway after Caddy.
5. Move the agents (owner, each Mind host, immediately after step 4, target under 10 minutes between 4 and 5). Replace the live env file with the `.new` one; recreate the agent: `docker compose -p geldar-otel-agent -f image/compose/otel-agent.yml --env-file <file> up -d --force-recreate otel-agent`. The agent only reads its environment at start.
6. Verify (ops agent reads; owner reads the token-bearing tests):
   - (a) the OLD token now gets 401 on `/v1/traces` (header-file test as in step 2);
   - (b) the NEW token gets neither 401 nor 404 (the same test with the new header file; an empty POST body may return 400 or 200, which is fine);
   - (c) a request with no token gets 401 on all three paths; GET gets 405; another path gets 404 (the B1 verification list, reused);
   - (d) `mcp.caddy` unaffected: the SSE site answers; no other site's status changed;
   - (e) each agent: no `401`, `403` or `unauthorized` in its log for 5 minutes; `docker logs <agent> | grep -ci bearer` prints 0; the agent's restart count is 1 (the one recreate);
   - (f) SigNoz (SSH tunnel) shows spans from each Mind host after its restart time; the telemetry gap is the window between steps 4 and 5;
   - (g) the Caddy access log has no `Authorization` value (the filter holds);
   - (h) a pattern-file search (`grep -F -f <pattern file holding the new token>`; never the token as an argument) over each agent's log, the Caddy log and the gateway log finds nothing.
7. Clean up (owner). Delete the temp token files and the `.new` env files on every host (`shred -u` on bash hosts where the file system supports it; on Windows delete and empty the recycle bin, noting that deletion does not erase an SSD). Remove the old token from the secret store only after step 6 passes and the owner confirms. Record in the rollout log: date, UTC window, hosts, which checks passed. Never record the token.

## B. Emergency rotation (token suspected or shown in a log, a chat or a screen)

1. Stop the leak path (owner, minutes): swap `otel-off.caddy` in for `otel.caddy` and reload (`../caddy-ingest-route.md` Rollback; a reload, no recreate; every path then answers 503). This invalidates nothing yet but stops ingest being usable for abuse or data poisoning. Owner approval at the time.
2. Stop the agents on every Mind host: `docker compose -p geldar-otel-agent ... down`. Minds keep running; telemetry is simply lost meanwhile.
3. Scrub: find where the token was shown; remove it from that log or chat per its tool; treat the old token as public.
4. Rotate: run section A steps 1, 3, 4 (the recreate loads the new token; do not restore `otel.caddy` before it), 5 (start the agents), then restore `otel.caddy` and reload, then step 6 and 7.
5. Write a short incident note (what, when, how found, what was done), no token.

## Stop conditions (stop and tell the orchestrator; do not continue to the next step)

- Before step 4: Caddy not healthy; `mcp.caddy` SSE site not answering; the access-log filter is missing; any Body, Paper or MCP deploy in flight; the new token shorter than 32 bytes or empty; fewer agent env files staged than there are Mind hosts.
- After the recreate in step 4: the shared Caddy container does not come back healthy within 2 minutes, or any other site (`mcp.caddy`, the public sites) fails its check: ROLL BACK AT ONCE (restore the previous Caddy environment file from the owner's copy, one more recreate, verify the other sites first). The shared Caddy serves the MCP and public sites, so recovering them outranks telemetry.
- Step 6 (a) shows the old token still accepted: the recreate did not load the new value; check the environment file, recreate once more, and if it persists treat as emergency B.
- Step 6 (e) shows repeated `401`: a host still has the old value; fix that host only.
- Step 6 (h) finds the token in any log: emergency B.
- Any step needs the token on a command line, in a chat or in a repo file: stop; that is a procedure error.

## Rollback of a planned rotation

Put the previous token back in the Caddy environment file, recreate Caddy once more, put the previous env file back on each Mind host, recreate each agent, verify as in step 6 with the roles of the tokens reversed. This costs a second shared-Caddy recreate; it is why the pre-check in step 2 matters.

## Known limits (do not hide)

- Stock Caddy has one token slot, so there is a window (steps 4 to 5) in which an agent's posts get 401. OTLP does not retry a 401, so telemetry sent in that window is lost. This is accepted for a development-stage rotation. A two-token matcher (`GELDAR_INGEST_TOKEN` and a `_NEXT` variable accepted together) would remove it; it is a change to `../caddy-ingest-route.md` and `deploy/caddy/otel.caddy` for another session.
- Caddy's `header` matcher is not constant-time (`../collector-design.md` section 9); the defence is length (at least 32 random bytes) and rotation.
- The Caddy environment is visible to root on the node through `docker inspect`; accepted (same trust as the node's root).
- There is no rate limit on the 401 path (stock Caddy).

## Open for the owner

- Cadence: rotate on a schedule (for example after any Mind-host change of hands) or only on suspicion. This card sets none.
- Whether the owner wants the optional coder card that puts this text into `docs/runbooks/`.
