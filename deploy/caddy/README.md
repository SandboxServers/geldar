# deploy/caddy: public read-only sites through the shared Caddy

Decisions: [0071](../../docs/decisions/0071-public-endpoints-and-ports.md) (the shared Caddy is reloaded; on the Colo node the admin API is off, owner ruling R39, and R39 wins: there a change is a container restart or, for new environment values, one recreate, see below) and [0072](../../docs/decisions/0072-glass-and-bluemap-are-public.md) (Glass and BlueMap are public, read-only, hardened). The open record is [0094](../../docs/decisions/0094-public-sites-read-only-through-caddy.md).

## Files

| Site | Live file | Kill switch | Upstream placeholder |
|---|---|---|---|
| BlueMap map | `map.caddy` | `map-off.caddy` | `{$GELDAR_MAP_UPSTREAM}` |
| Glass | `glass.caddy` | `glass-off.caddy` | `{$GELDAR_GLASS_UPSTREAM}` |
| MCP (`/p/<player_id>` only) | `mcp.caddy` | `mcp-off.caddy` | `{$GELDAR_MCP_UPSTREAM}` |
| OTLP ingest (see the OTLP section) | `otel.caddy` | `otel-off.caddy` | `{$GELDAR_INGEST_UPSTREAM}` |
| BlueMap NeoForge map | `map-neoforge.caddy` | `map-neoforge-off.caddy` | `{$GELDAR_MAP_NF_UPSTREAM}` |

The NeoForge map is host `map.neoforge.<domain>`. Its upstream is the loopback `bluemap-web-nf` container on port 8110, not the Paper map on 8100. It has no live proxy: the files are in the repo only, and nothing has been loaded on a node.

The live and kill-switch files stay in this directory, `deploy/caddy/<site>.caddy`. That is where C2-04 and `deploy/colo-public.sh` look; the `deploy/caddy/sites/` path in the C2-07 card is superseded.

The Glass host also carries the register service: `/register*` and `/roster*` (GET, HEAD and POST, 8 KiB body) go to `{$GELDAR_REGISTER_UPSTREAM}` before Glass handles the rest, so one host and one host-only `gk_session` cookie serve both (decision 0135, amendment R42). There is no separate register site; `glass-off.caddy` switches both off, and the service has its own kill switch. The Entra redirect URI is `https://glass.<domain>/register/callback`.

Glass's proxy blocks set `header_up Host localhost`, because Glass answers 421 to any other Host. Glass serves the page (`/`, its four stylesheets, `/app.js`, `/js/*`, the service worker `/sw.js`, `/manifest.webmanifest`, `/fonts/*` and `/icons/*`) and the API through Caddy. The page paths on the `@glass_page` line must match the files Glass serves (`glass/src/static-files.ts`; `glass/test/caddy-paths.test.ts` checks it): a page file Caddy does not route is a 404, and the page loses its styles or its script. Load a changed `glass.caddy` with the Glass image that needs it. `/api/stats` is not routed.

Placeholders are read from the environment by Caddy: `GELDAR_DOMAIN` is the project domain, and each upstream is a service address set by the integration packet C2-07. No real domain or IP address is in these files.

## Rules every site keeps

- Only the listed methods pass: GET and HEAD for map and Glass; POST, GET and DELETE for MCP. Every other method gets 405.
- The site strips `x-geldar-client-ip`, `X-Forwarded-For` and `CF-Connecting-IP` from the request, and each `reverse_proxy` sets `x-geldar-client-ip` to `{remote_host}` with `header_up`. The MCP service trusts that header only from Caddy.
- Each site has a request body cap (1 KiB for the read-only sites, 64 KiB for MCP, the same as `BODY_LIMIT_BYTES` in the MCP front).
- Unknown paths get 404 (Glass and MCP). BlueMap serves its own static tree.
- Glass's SSE route (`/api/stream`) and the MCP route flush each chunk at once.

## Rate limits

Core Caddy has no rate limiter, and this repo adds no third-party Caddy module (0094). The limits live in the services: Glass (C2-03) and the public MCP (C2-01).

## Reload procedure

1. Edit the site file, or swap a site for its kill switch (for example `map-off.caddy` in place of `map.caddy`).
2. Validate: `bash deploy/caddy/validate.sh` (uses the pinned caddy image, `docker run --rm` only). CI runs it in the `compose` job.
3. Apply: `caddy reload` where the admin API is on. On the Colo node it is off (R39): one `docker restart board-proxy` instead (see below and `deploy/colo-public.sh`).

## Kill procedure

Swap to `<site>-off.caddy` (`deploy/colo-public.sh off <site>`) and reload. `mcp.caddy` and the Glass `/api/stream` route set `stream_close_delay 5s`, which is intended to close open streams on a reload; that is not verified for SSE yet (C2-07 live check). Until it is, restart the MCP container and Glass after the swap. The in-process kill switches of the MCP and of Glass are read at start (ruling R26), so changing them needs a service restart; the Caddy swap is the live switch.

The 405 for a refused method is `handle @not_allowed { respond 405 }`, the first handle in each site, because Caddy sorts a site-level `respond` after `handle` and it would never run. `tools/repo-checks/src/caddy-adapt.test.ts` adapts each file in the pinned image and checks the route order.

On the Colo node the shared Caddy (`board-proxy`) has its admin API OFF (owner ruling R39, `deploy/README.md` section Caddy), so `caddy reload` fails there: every change of a live file is one operator `docker restart board-proxy` (`deploy/colo-public.sh` restart mode is the precedent). Caddy serves other sites on the node, and a restart interrupts them all (estimate: 5 to 15 seconds, plus certificate load; to be measured at the first window and written back here), so batch changes. Never run `systemctl restart caddy`, and never recreate the container except in an approved window of the OTLP section below: the first install is one window, and each token rotation is another approved window with the same procedure.

## OTLP ingest (otel.caddy)

The telemetry gateway's OTLP/HTTP ingest for Mind hosts. Live file `otel.caddy`, kill switch `otel-off.caddy`. The full design, abuse case and limits are in [caddy-ingest-route.md](../../docs/analysis/telemetry/caddy-ingest-route.md). Owner ruling geldar-93 (2026-11-16): the ingest route goes on the shared Caddy, authenticated with the ingest token; stock Caddy only, no custom image, no third-party module. The SigNoz UI has no Caddy route.

Differences from the sites above (the doc is followed where it differs from `mcp.caddy`):

- The host is `{$GELDAR_INGEST_HOST:otel.invalid}` (no `GELDAR_DOMAIN` prefix), the upstream is `{$GELDAR_INGEST_UPSTREAM:localhost:4320}` (the gateway's loopback publish, `127.0.0.1:4320:4318` in `compose.gateway.yml` on the telemetry/t25-gateway branch; one value, `localhost:4320`, everywhere) and the token is `{$GELDAR_INGEST_TOKEN}`. The defaults keep Caddy starting if a variable is missing; an empty or short token never matches, because the proxy matcher also needs ``size(token) >= 64`` (adapt-tested). Defaults are a safety net, not a procedure: remove the live file before removing the variables.
- Only POST passes (405 otherwise), on `/v1/traces`, `/v1/logs` and `/v1/metrics`. Without the exact `Authorization: Bearer <token>` header those paths get 401; any other path gets 404. The kill switch answers 503 on the whole host.
- Per-site limits only: `request_body { max_size 8MiB }` (413 over it, for an authenticated request on one of the three paths; see step 6) and `transport http { dial_timeout 5s; response_header_timeout 60s }`. No global `servers` timeouts, because `mcp.caddy` serves long-lived SSE.
- The access log uses the filter encoder and deletes the `Authorization`, `Cookie` and `Proxy-Authorization` request headers. The error log (default logger; the node's global block sets no `log` and no `log_credentials`) relies on Caddy's default redaction of credential headers: step 6 checks it after a forced 502. No plain-HTTP listener is added (automatic HTTPS only, with its HTTP-to-HTTPS redirect on every host), so Mind hosts must use `https://` endpoints: a token sent over `http://` would travel in clear once.
- Stock Caddy has no rate limit and the token compare is not constant-time; see the Abuse case in the doc.
- The live file goes in `config/geldar/` on the node (the Caddyfile imports `/config/geldar/*.caddy`, top level only; subdirectories are not loaded). It is not in `deploy/colo-public.sh`'s site list. `bash deploy/caddy/validate.sh` checks it in the pinned image with test values for the three placeholders (the sets `live-otel` and `killed-otel`; never the real token). The pinned image is Caddy 2.10.2 and the node runs 2.11.6, so the node's own `caddy validate` (the throwaway validation of step 3, then the running container) is the check for its version.
- Risk, measured on 2.10.2 only: the 413 behaviour (the body cap trips only for the authenticated, proxied request) and the error-log redaction of credential headers were measured only on Caddy 2.10.2 in the repo tests. The node's Caddy is 2.11.6. Check both on the node (step 6) and write the result back here and in the analysis doc.
- Outage: on the happy path the install is ONE outage, one recreate of `board-proxy` (estimate 5 to 15 seconds for every site behind the shared Caddy, plus certificate load; the number is an estimate to be measured at the first window and written back; earlier text said only "a few seconds"). A rollback adds one more.

Roles (defined once, used below): the owner is the human who approves each step and the time. The operator session is the Claude session that runs the sudo steps, with the owner's word at the time. The coordination session relays between them. Ops agents never run these sudo steps.

Token: the operator session generates it from 32 random bytes encoded as 64 hex characters (never in the repo, never in argv). It is delivered to the node by stdin, and to the Mind host VM into a file with mode 600 in a mode-700 directory in the launcher's state directory (by role: the scriptorium launcher's state directory, under an `otel` folder). The Mind host's SDK side is owned by the scriptorium orchestrator, which sets `GELDAR_TELEMETRY_URL` there to the public https ingest URL.

DNS: the ingest host name is a NEW public name in the owner's DNS zone (owner action): an A or CNAME record to the same public address as the other Geldar sites. Caddy issues the certificate through the DNS plugin (the DNS-challenge credentials are already in the same env file), so wait for the `certificate obtained` log line before verification. The owner chooses the exact name and it goes into `GELDAR_INGEST_HOST` only, never into the repo.

Every step below needs the owner's approval at the time. Record the exact commands run.

Execution order, one outage on the happy path: 1, 2, 4, 3, 6, 7. Steps 2 and 4 change only files on disk while the container keeps running (nothing loads until the container starts, because the admin API is off). Step 3 pre-validates in a throwaway container with the same image and the same files, and only if that passes does the ONE recreate happen, which picks up the new env file and the snippet together. Step 5 (the old two-step: recreate for the variables, then a separate `docker restart` for the snippet) is the documented FALLBACK, used only when the throwaway validation cannot include the snippet or cannot be made equivalent, and for a later edit of the snippet.

Trade-off: with the snippet in place before the recreate, a bad snippet could take every site down at the start. The throwaway validation (the same image, run exactly against the files that will be mounted) is the mitigation; if the container still does not come back, the failure path is the rollback: remove the snippet and recreate once more (a second outage).

1. Precheck, read-only. Confirm the import line (`import /config/geldar/*.caddy`) in the node's Caddyfile, and that the env file the shared Caddy container (`board-proxy`) reads (`azure.env`, root-only) exists. Do not print its contents.
2. Place the three variables in that env file (`<env-file>` is its path on the node, given by the owner; its contents are never printed). This step needs `sudo`, run by the operator session with the owner's word; these are the exact commands for the record. The container keeps running and nothing is loaded. If the file is the owner's hand-edited credential file, a bad append can break the shared Caddy's certificate renewal for every site, so the order is backup, guarded append, check, and nothing else.

   The values arrive on stdin from the operator session; the token is generated as stated under "Token" above, not on the node. `GELDAR_INGEST_HOST` is the owner's new public hostname (see "DNS" above); `GELDAR_INGEST_UPSTREAM` is `localhost:4320`, the gateway's loopback publish (`127.0.0.1:4320:4318` in `compose.gateway.yml` on the telemetry/t25-gateway branch; it is not on main until that branch merges); `GELDAR_INGEST_TOKEN` is the ingest token, at least 64 hex characters. The same token value is what the Mind host gets (see "Token" above).

   a. Record owner and mode (names and digits only): `sudo stat -c '%U:%G %a' <env-file>`.

   b. Back up first, root-only, same directory, with a timestamp (use the same name in the failed-recreate path of step 3):

   ```bash
   sudo sh -c 'cp -p "$1" "$2" && chmod 0600 "$2"' _ <env-file> <env-file>.bak-<UTC timestamp>
   ```

   c. Guarded append. The three values arrive on STDIN only, one per line in this order: host, upstream, token, each line ending in a newline. They are never in argv, in a here-doc in the repo, in the shell history or echoed (`printf` is a shell builtin). The script refuses a path that is not an existing regular file (it never creates the file; `umask 077` covers any other file it could make), an empty host, an upstream other than `localhost:4320`, an empty, short (under 64) or non-hex token, and a name that already exists in the file (also as `export NAME=` or with leading spaces); every refusal prints a message, exits 1 and leaves the file untouched (a value with CRLF is refused as a bad host or a non-hex token; a token line without its final newline is accepted); it adds a newline first when the last byte of the file is not one, so the token cannot be glued onto an existing line:

   ```bash
   <the owner's vault pipe, printing host, upstream and token as three lines> | sudo sh -c '
   set -eu
   umask 077
   f=$1
   [ -f "$f" ] || { echo "no such file" >&2; exit 1; }
   read -r host; read -r up; read -r tok || [ -n "$tok" ]
   case $host in ""|*[!A-Za-z0-9.-]*) echo "bad host" >&2; exit 1;; esac
   [ "$up" = localhost:4320 ] || { echo "upstream must be localhost:4320" >&2; exit 1; }
   [ "${#tok}" -ge 64 ] || { echo "token empty or shorter than 64" >&2; exit 1; }
   case $tok in *[!0-9a-fA-F]*) echo "token is not hex" >&2; exit 1;; esac
   for n in GELDAR_INGEST_HOST GELDAR_INGEST_UPSTREAM GELDAR_INGEST_TOKEN; do
     if grep -Eq "^[[:space:]]*(export[[:space:]]+)?$n[[:space:]]*=" "$f"; then echo "$n already in the file" >&2; exit 1; fi
   done
   [ -z "$(tail -c1 "$f")" ] || echo >> "$f"
   printf "GELDAR_INGEST_HOST=%s\nGELDAR_INGEST_UPSTREAM=%s\nGELDAR_INGEST_TOKEN=%s\n" "$host" "$up" "$tok" >> "$f"
   ' _ <env-file>
   ```

   d. Check, printing counts and names only: (1) `sudo stat -c '%U:%G %a' <env-file>` equals the line from a; (2) `sudo grep -vcE '^[A-Za-z_][A-Za-z0-9_]*=' <env-file>` equals the same command on the backup (no new malformed line; the count may be non-zero only if it was before); (3) each of `sudo grep -c '^GELDAR_INGEST_HOST=' <env-file>`, `...UPSTREAM=` and `...TOKEN=` prints `1`; (4) `sudo grep -c '' <env-file>` is the backup's count plus 3; (5) `sudo cmp -n "$(sudo stat -c %s <backup>)" <backup> <env-file>` prints nothing (the old bytes are unchanged). Any failure: restore with `sudo cp -p <backup> <env-file>`, stop, report.

   e. The recreate (step 3) runs only after the throwaway validation in step 3 passes against this file and the placed snippet. The other two variables stay valid on their own; do not remove any `GELDAR_INGEST_*` line while a live `otel.caddy` or `otel-off.caddy` is in `config/geldar/` (Caddy still starts on the defaults, but with `GELDAR_INGEST_HOST` unset the site answers only the placeholder name `otel.invalid`, which silently disables the route; Caddy may also retry ACME for that placeholder name and log noise, unverified on the node): remove the live file first, restart, then edit the env file.

   Not verified without the node: the file's actual owner and mode, whether its lines are plain `KEY=VALUE` (docker `--env-file` and compose read it that way), and whether the file has comment or blank lines (check d.2 compares against the backup for that reason).
3. Run after step 4 (snippet already placed, env file already appended). Pre-validate, then the ONE recreate of the shared Caddy container, which loads the new variables and the snippet together (a running Caddy cannot see a new environment value, and `docker restart` keeps the old one, so only a recreate loads them). Its own approved window. Cost: every site on the node is down while the container is recreated (estimate 5 to 15 seconds, plus certificate load; measure it and write it back), and the long-lived `mcp.caddy` SSE streams drop and their clients reconnect. Rotating the token is another approved window with the same recreate.
   - Baseline, BEFORE the recreate (read-only requests; the workstation or the node shell, bash; the file stays on the node under `/mnt/nvme/geldar-telemetry/stage/`). The sites are the ones `deploy/colo-public.sh` installs (its `SITES` variable: `map`, `glass`, `mcp`), each at `<site>.<domain>`, with `<domain>` the `GELDAR_DOMAIN` value the owner holds (the same value `colo-public.sh` reads from its env file), path `/`; plus every other site this Caddy serves. List the others by names only from the node's Caddyfile (site address lines, no body, no env values): `sudo grep -E '^[^[:space:]#({}].*\{[[:space:]]*$' <host Caddyfile> | sed 's/[[:space:]]*{[[:space:]]*$//'`; drop the Geldar names and the ones imported from `config/geldar/`, and ask the owner for the path of each remaining site if `/` is not meaningful. Record the status and TLS result of one request per site:

     ```bash
     probe() { while read -r u _; do printf '%s %s\n' "$u" "$(curl -s -o /dev/null -w '%{http_code} tls=%{ssl_verify_result}' --max-time 10 "https://$u")"; done; }
     umask 077; b=/mnt/nvme/geldar-telemetry/stage/caddy-baseline-<UTC timestamp>.txt
     printf '%s\n' map.<domain>/ glass.<domain>/ mcp.<domain>/ <other-site><path> | probe > "$b"
     ```

     Each line is `<host><path> <status> tls=<n>` (`curl -w '%{http_code}'` form, with the TLS verify result added: `tls=0` is success, status `000` is a connection or TLS failure). Read the file once: a site that is already failing in the baseline is reported to the owner and is not a reason to stop, but it cannot be compared. Compare, now and after each later restart: `cut -d' ' -f1 "$b" | probe | diff "$b" -` prints nothing when every site answers status for status as before. The `mcp.caddy` site answers 404 on `/` by design.
   - Compose precheck, before the recreate (labels only, never an unfiltered `docker inspect`, which prints the container environment including the token): `docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }} {{ index .Config.Labels "com.docker.compose.project.working_dir" }}' board-proxy` must print a non-empty project name and a directory. Empty output means compose did not create the container: stop, do not run `docker compose up` (it would fail on the name or start a second host-network container on ports 80 and 443). The recreate runs from that directory, with that project name (`docker compose -p <project>`). After it, the same inspect prints the same two values.
   - PRE-VALIDATION of BOTH the new env file and the placed snippet before the recreate, in a throwaway container of the running container's own image with the new env file and a read-only mount of the host config directory (including the new `config/geldar/otel.caddy`), run exactly against the files that will be mounted, so a bad file or snippet is caught before the shared Caddy goes down. If it fails, go to the failure path of step 4. If it cannot include the snippet or be made equivalent (a different image, a different mount), use the fallback of step 5 instead. `sudo docker run --rm --env-file <env-file> -v <host Caddyfile>:/etc/caddy/Caddyfile:ro -v <host config dir>:/config:ro "$(docker inspect -f '{{.Config.Image}}' board-proxy)" caddy validate --config /etc/caddy/Caddyfile` (the env file is read by docker and not printed; `GELDAR_PUBLIC_ENV`-style host paths come from the owner, as in `deploy/colo-public.sh`). Unverified on the node: whether `validate` of a build with the DNS module needs more than the env file.
   - Recreate, from the compose project directory of `board-proxy` (the owner supplies the project and file names; the repo does not know them): `sudo docker compose up -d --force-recreate board-proxy`.
   - Immediately after, before step 4: the container runs (`docker inspect -f '{{.State.Running}}' board-proxy` prints `true`), `docker exec board-proxy caddy validate --config /etc/caddy/Caddyfile` passes (the check `deploy/colo-public.sh` runs after its own restart, for up to 30 s), and the baseline comparison above prints nothing (every site, Geldar and non-Geldar, answers status for status as in the baseline). `deploy/colo-public.sh status` shows the files on disk only.
   - Failed recreate (the container does not run, or the baseline comparison prints a difference): this is the rollback. Remove the snippet (`sudo rm -f <host config dir>/geldar/otel.caddy`), restore the env file backup made in step 2 over the env file (`sudo cp -p <backup> <env-file>`; never print it) and run the same recreate command once more (a second outage), then repeat the checks. Stop the procedure and report. Failed pre-validation (before any recreate) needs no recreate: see step 4.
4. Run after step 2, before step 3. Put `otel.caddy` in `config/geldar/` on the node (same owner and mode as `mcp.caddy`: read them first with `sudo stat -c '%U:%G %a' <host config dir>/geldar/mcp.caddy`) while the container keeps running. Nothing loads, because the admin API is off. Do NOT validate with `docker exec`: the running container does not hold the new variables yet, so it would only prove the defaults; the check is the throwaway validation of step 3. Locally, `tools/repo-checks/src/caddy-adapt.test.ts` checks the file in the pinned image.

   If the throwaway validation of step 3 FAILS: delete the new live file at once, `sudo rm -f <host config dir>/geldar/otel.caddy`, and re-run the same throwaway validation (it must pass: the file set is what it was before; the env file backup of step 2 is restored too if the env file was the fault). Do NOT recreate or restart `board-proxy`. A bad file left in the imported directory would stop the shared Caddy loading at its next start (the next restart for any site, or a host reboot under `restart: unless-stopped`), and every site would be down. Report the validate error text (it names the line; it holds no token) and stop.
5. FALLBACK, the old two-step, only when the throwaway validation of step 3 cannot include the snippet or be made equivalent, or for a later change of the live file: first the recreate of step 3 without the snippet in place (variables only), then place the snippet, `docker exec board-proxy caddy validate --config /etc/caddy/Caddyfile` (the container holds the variables by then; do not pass the token with `docker exec -e`), then apply with one `docker restart board-proxy` (admin API off, R39: `caddy reload` does not work). Cost of the fallback: two outages (the recreate and the restart), each an estimated 5 to 15 seconds on every site, including the `mcp.caddy` SSE streams, which reconnect. Then repeat the post-recreate checks of step 3. Failed restart or a comparison that prints a difference: `sudo rm -f <host config dir>/geldar/otel.caddy` (the file set is then what it was before), `docker restart board-proxy` again, repeat the checks against the same baseline file, and report. If the second comparison still differs, the baseline may itself have been wrong for that site: report both outputs and stop, do not restore anything else.

   Which failure path applies: a failure before verification (pre-validation, the recreate, or the checks right after it) means remove the snippet file and recreate (or restart in the fallback), as above. A failure after verification (step 6 passed, a later abuse case or fault) means the kill switch snippet in the Rollback section below.
6. Verify, from the operator workstation, run by the operator session with the ingest token. `<host>` is the ingest hostname; use `https://` only. The token (see "Token" above) never appears on a command line, in argv, in shell history or in a log. Every command below takes it from STDIN (`<vault pipe>` stands for the stdin source that prints the token, one line):
   - Token header through a curl config read from stdin (nothing in argv): `<vault pipe> | sed 's/^/header = "Authorization: Bearer /; s/$/"/' | curl --config - -sS -o /dev/null -w '%{http_code}\n' --data '{}' -H 'Content-Type: application/json' https://<host>/v1/traces`. The alternative is a header file with mode 0600 (`umask 077`), used with `curl -H @<file>` and deleted straight after; never leave it on disk.
   - POST without a token to each of `/v1/traces`, `/v1/logs`, `/v1/metrics`: 401. POST with `Authorization: Bearer` and an empty value, and with a wrong fixed string such as `Bearer wrong`: 401 each.
   - GET to an OTLP path: 405.
   - POST with the token to `/v1/traces`: neither 401 nor 404 (the gateway's own status is the answer; 502 after at most 5 s while the gateway's publish is not up).
   - POST to any other path: 404.
   - What each request class returns (the handle order in `otel.caddy`: 405 for a non-POST, then the authenticated proxy, then 401 on the three paths, then 404): non-POST 405 whatever the body; POST without a valid token to the three paths 401, whatever the body size; POST to another path 404, whatever the body size; POST WITH the token to one of the three paths, body up to 8 MiB the gateway's answer, body over 8 MiB 413. Measured on Caddy 2.10.2: an unauthenticated 9 MiB body gets 401 (and 404 on another path), because the cap trips only when a body is read, which only the proxied request does. So a 401 for an unauthenticated big body is NOT a failed cap. Test the cap with the token: `<vault pipe> | sed 's/^/header = "Authorization: Bearer /; s/$/"/' | curl --config - -sS -o /dev/null -w '%{http_code}\n' -X POST --data-binary @<file of 9 MiB> https://<host>/v1/traces` must print 413. This is the "measured on 2.10.2 only" risk: the node runs 2.11.6, so run this check on the node and write the result (413 or not) back into this README and the analysis doc. If it prints something else, report; do not roll back on this alone.
   - Log check, after these requests and after a forced 502 (send the authenticated POST while the gateway's loopback publish is not up; do not stop the gateway for this. The gateway must run before Mind hosts send, so if it is already up there is no 502 and the error-log part of this check is skipped: only the access log is checked, say so in the report): `umask 077; t=$(mktemp); docker logs board-proxy --since <time of the recreate> >"$t" 2>&1`, then `<vault pipe> | grep -c -F -f - "$t"` (the pattern comes from stdin, the file is the argument) must print `0`. First confirm the pipe printed a non-empty token: an empty pipe line would match every line and print the total, which is not a pass (also a checklist item below). Also write the redaction result on 2.11.6 back (measured on 2.10.2 only); `grep -i -e authorization -e bearer -e cookie "$t" | grep -vc REDACTED` must print `0`: every remaining line that names a credential header is a `REDACTED` line (other sites' access lines and the 502 error line carry `"Authorization":["REDACTED"]` by design, so a plain count of the first grep is not zero and is not the check; read it with the `-vc REDACTED` count, which never prints a line); then `rm -f "$t"`. Print counts only.
   - The gateway receives the `Authorization` header too (`reverse_proxy` forwards it): the gateway's own config must not log request headers.
   - The Mind-host side (`GELDAR_TELEMETRY_URL` set to `https://<host>` and the same token file) is the scriptorium orchestrator's step, not part of this procedure.
   - Precondition: the DNS record for `<host>` is created by the owner (see "DNS" above) and the node's Caddy has issued its certificate before this step; without it these requests fail on TLS. The node's build has the `caddy-dns/azure` module and reads its credentials from the same env file, so certificates for new hosts come through the same DNS-challenge path as the existing sites; the Caddyfile's issuer was not read, so the owner confirms it. Wait for the `certificate obtained` log line for `<host>` before the checks of this step.
7. Portscan and after-restart checks: the host gains no new listener (no plain-HTTP port; Caddy already owns 443 on the node), the gateway's publish stays on the loopback address, and `tools/portscan` is unchanged. Other sites on the shared Caddy (`mcp`, `glass`, `map` and the non-Geldar ones) still answer as before: the baseline comparison of step 3 prints nothing.

Rollback and kill switch, one restart (R39; this section applies after verification, step 6 passed; a failure before verification uses the failure paths of steps 3 to 5, which remove the file and recreate; a rollback adds one more outage to the install's one): copy `otel-off.caddy` over `config/geldar/otel.caddy` (never both files at once: they name the same host), `docker exec board-proxy caddy validate --config /etc/caddy/Caddyfile`, `docker restart board-proxy`, then the checks of step 3. Cost: the same outage (estimate 5 to 15 seconds) of dropped connections on every site (the `mcp.caddy` SSE streams reconnect) and the ingest route is down during it; afterwards the host answers 503 for every path and Mind-host exporters see 503 until the owner restores the route (their retry queues are the gateway design's concern, not Caddy's). The kill switch is therefore not instant and not free: batch it with other changes when the abuse is not urgent. Removing the file instead of swapping it needs the same restart. Remove the live file before removing `GELDAR_INGEST_*` from the env file (see step 2). A restart-free partial stop for an abuse case is `docker stop geldar-gateway` (authenticated POSTs then get 502 within 5 s, the rest stay 401/404/405); it stops the whole gateway, so it is the owner's call. The public hostname stays in the 0071 and 0096 amendments until the owner decides to drop it.

### Commands and sudo used, for the record (OTLP ingest)

Shell: bash on the operator workstation and on the node. `<host config dir>` is the host path mounted at `/config` in `board-proxy`; `<repo>` is the checkout the files come from. Never run an unfiltered `docker inspect board-proxy` (it prints the environment, including the token); only `-f` field filters.

- Env file (step 2): `sudo stat -c '%U:%G %a' <env-file>`; `sudo sh -c 'cp -p "$1" "$2" && chmod 0600 "$2"' _ <env-file> <env-file>.bak-<UTC timestamp>`; the guarded append (`<vault pipe> | sudo sh -c '...' _ <env-file>`); the check commands `sudo grep -c`, `sudo grep -vcE`, `sudo cmp -n`, `sudo stat -c %s`; restore `sudo cp -p <backup> <env-file>`.
- Baseline (step 3): `sudo grep -E ... <host Caddyfile> | sed ...` (site names only); `curl` probes; the baseline file under `/mnt/nvme/geldar-telemetry/stage/`.
- Run order: steps 2 and 4 first (files only), then step 3: pre-validation of the env file and the placed snippet, then the one recreate. All sudo steps are run by the operator session with the owner's word.
- Recreate (step 3): `sudo docker run --rm --env-file <env-file> -v ... caddy validate`; `sudo docker compose -p <project> up -d --force-recreate board-proxy`.
- Live file (step 4, the fallback of step 5, the rollback): read the owner and mode `sudo stat -c '%U:%G %a' <host config dir>/geldar/mcp.caddy`; place `sudo install -m <mode> -o <owner> -g <group> <repo>/deploy/caddy/otel.caddy <host config dir>/geldar/otel.caddy`; remove `sudo rm -f <host config dir>/geldar/otel.caddy`; swap to the kill switch `sudo install -m <mode> -o <owner> -g <group> <repo>/deploy/caddy/otel-off.caddy <host config dir>/geldar/otel.caddy` (the same destination name, so the two files never coexist).
- No sudo: `docker exec board-proxy caddy validate ...`, `docker restart board-proxy`, `docker inspect -f ...`, `docker logs`, `docker stop geldar-gateway` (if the owner's docker group applies; otherwise sudo).
- Cleanup: the env file backup `<env-file>.bak-<UTC timestamp>` holds the node's other credentials; the owner deletes it (`sudo rm -f`) once step 6 passes. Delete the baseline file with it or keep it for the record (it holds site names and status codes only).

### Node-only checks (cannot be settled in the repo)

1. Caddy version and the 413 case on 2.11.6 (measured on 2.10.2 only): `docker exec board-proxy caddy version` prints v2.11.6; run the step 6 matrix, including the authenticated 9 MiB POST (413 expected; an unauthenticated one may answer 401). Write the result back.
2. Env file facts: `sudo stat -c '%U:%G %a' <env-file>`; plain `KEY=VALUE` lines (`sudo grep -vcE '^[A-Za-z_][A-Za-z0-9_]*=' <env-file>` is the count of lines that are not, which may be non-zero for comment or blank lines); whether values are quoted: ask the owner (docker `--env-file` keeps quotes literally; the three new lines are unquoted).
3. Compose labels: the step 3 inspect prints a non-empty project and working directory.
4. Certificate issuance for the new host through the DNS challenge: the Caddy log shows `certificate obtained successfully` for it before step 6: `docker logs board-proxy --since <time> 2>&1 | grep -c 'certificate obtained successfully'` is at least 1 (counts only; other sites' renewals also match, so read the name with the owner).
5. Error-log redaction on 2.11.6 (measured on 2.10.2 only; write the result back): the forced-502 log check of step 6 (only before the gateway is up).
6. Whether the node reaches its own public names (hairpin) for the baseline probes: if the probes fail on the node, run them from the workstation and keep the baseline file there.
7. The loopback publish: `docker port geldar-gateway` shows `127.0.0.1:4320` only.
8. The token pipe must print a non-empty line before `grep -F -f -` is used: with an empty pattern line `grep -c -F -f - "$t"` matches every line and prints the total, not `0`. Check the pipe output length first (print the length only).
9. Outage length of the one recreate: record the measured seconds (estimate 5 to 15) and write it back into this README and the analysis doc.

## Status

The live restart is an owner or ops step (C2-07). Nothing here has been loaded on a node.
