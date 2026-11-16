# deploy/caddy: public read-only sites through the shared Caddy

Decisions: [0071](../../docs/decisions/0071-public-endpoints-and-ports.md) (the shared Caddy is reloaded, never restarted) and [0072](../../docs/decisions/0072-glass-and-bluemap-are-public.md) (Glass and BlueMap are public, read-only, hardened). The open record is [0094](../../docs/decisions/0094-public-sites-read-only-through-caddy.md).

## Files

| Site | Live file | Kill switch | Upstream placeholder |
|---|---|---|---|
| BlueMap map | `map.caddy` | `map-off.caddy` | `{$GELDAR_MAP_UPSTREAM}` |
| Glass | `glass.caddy` | `glass-off.caddy` | `{$GELDAR_GLASS_UPSTREAM}` |
| MCP (`/p/<player_id>` only) | `mcp.caddy` | `mcp-off.caddy` | `{$GELDAR_MCP_UPSTREAM}` |
| OTLP ingest (see the OTLP section) | `otel.caddy` | `otel-off.caddy` | `{$GELDAR_INGEST_UPSTREAM}` |

The live and kill-switch files stay in this directory, `deploy/caddy/<site>.caddy`. That is where C2-04 and `deploy/colo-public.sh` look; the `deploy/caddy/sites/` path in the C2-07 card is superseded.

The Glass host also carries the register service: `/register*` and `/roster*` (GET, HEAD and POST, 8 KiB body) go to `{$GELDAR_REGISTER_UPSTREAM}` before Glass handles the rest, so one host and one host-only `gk_session` cookie serve both (decision 0135, amendment R42). There is no separate register site; `glass-off.caddy` switches both off, and the service has its own kill switch. The Entra redirect URI is `https://glass.<domain>/register/callback`.

Glass's proxy blocks set `header_up Host localhost`, because Glass answers 421 to any other Host. Glass serves the page (`/`, `/app.css`, `/app.js`, `/js/*`) and the API through Caddy; `/api/stats` is not routed.

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

On the Colo node the shared Caddy (`board-proxy`) has its admin API OFF (owner ruling R39, `deploy/README.md` section Caddy), so `caddy reload` fails there: every change of a live file is one operator `docker restart board-proxy` (`deploy/colo-public.sh` restart mode is the precedent). Caddy serves other sites on the node, and a restart interrupts them all for a few seconds, so batch changes. Never run `systemctl restart caddy`, and never recreate the container except in the one approved window of the OTLP section below.

## OTLP ingest (otel.caddy)

The telemetry gateway's OTLP/HTTP ingest for Mind hosts. Live file `otel.caddy`, kill switch `otel-off.caddy`. The full design, abuse case and limits are in [caddy-ingest-route.md](../../docs/analysis/telemetry/caddy-ingest-route.md). Owner ruling geldar-93 (2026-11-16): the ingest route goes on the shared Caddy, authenticated with the ingest token; stock Caddy only, no custom image, no third-party module. The SigNoz UI has no Caddy route.

Differences from the sites above (the doc is followed where it differs from `mcp.caddy`):

- The host is `{$GELDAR_INGEST_HOST}` (no `GELDAR_DOMAIN` prefix), the upstream is `{$GELDAR_INGEST_UPSTREAM}` (the gateway's loopback publish, `localhost:4320` form, no IP literal in the file) and the token is `{$GELDAR_INGEST_TOKEN}`.
- Only POST passes (405 otherwise), on `/v1/traces`, `/v1/logs` and `/v1/metrics`. Without the exact `Authorization: Bearer <token>` header those paths get 401; any other path gets 404. The kill switch answers 503 on the whole host.
- Per-site limits only: `request_body { max_size 8MiB }` (413 over it) and `transport http { dial_timeout 5s; response_header_timeout 60s }`. No global `servers` timeouts, because `mcp.caddy` serves long-lived SSE.
- The access log uses the filter encoder and deletes `request>headers>Authorization`. No plain-HTTP listener is added (automatic HTTPS only).
- Stock Caddy has no rate limit and the token compare is not constant-time; see the Abuse case in the doc.
- The live file goes in `config/geldar/` on the node (the Caddyfile imports `/config/geldar/*.caddy`, top level only; subdirectories are not loaded). It is not in `deploy/colo-public.sh`'s site list. `bash deploy/caddy/validate.sh` checks it in the pinned image with test values for the three placeholders (the sets `live-otel` and `killed-otel`; never the real token). The pinned image is Caddy 2.10.2 and the node runs 2.11.6, so the node's own `caddy validate` (steps 3 and 4) is the check for its version.

Every step below needs the owner's approval at the time. Record the exact commands run.

1. Precheck, read-only. Confirm the import line (`import /config/geldar/*.caddy`) in the node's Caddyfile, and that the env file the shared Caddy container (`board-proxy`) reads (`azure.env`, root-only) exists. Do not print its contents.
2. Place the three variables in that env file (`<env-file>` is its path on the node, given by the owner; its contents are never printed). This step needs `sudo` beyond the earlier mkdir/chown scope; the owner and geldar-93 have now allowed sudo for work that needs it, and these are the exact commands for the record. If the file is the owner's hand-edited credential file, a bad append can break the shared Caddy's certificate renewal for every site, so the order is backup, guarded append, check, and nothing else.

   The values are provided by the owner (or geldar-93's vault pipe), not generated on the node (see "Token route" below). `GELDAR_INGEST_HOST` is the owner's public hostname; `GELDAR_INGEST_UPSTREAM` is `localhost:4320`, the gateway's loopback publish (`127.0.0.1:4320:4318` in `compose.gateway.yml` on the telemetry/t25-gateway branch; it is not on main until that branch merges); `GELDAR_INGEST_TOKEN` is the ingest token, at least 64 hex characters. The same token value is what the Mind hosts' otel-agent gets, placed there by the owner.

   a. Record owner and mode (names and digits only): `sudo stat -c '%U:%G %a' <env-file>`.

   b. Back up first, root-only, same directory, with a timestamp (use the same name in the failed-recreate path of step 3):

   ```bash
   sudo sh -c 'cp -p "$1" "$2" && chmod 0600 "$2"' _ <env-file> <env-file>.bak-<UTC timestamp>
   ```

   c. Guarded append. The three values arrive on STDIN only, one per line in this order: host, upstream, token, each line ending in a newline. They are never in argv, in a here-doc in the repo, in the shell history or echoed (`printf` is a shell builtin). The script refuses an empty host, an upstream other than `localhost:4320`, an empty, short (under 64) or non-hex token, and a name that already exists in the file; it adds a newline first when the last byte of the file is not one, so the token cannot be glued onto an existing line:

   ```bash
   <the owner's vault pipe, printing host, upstream and token as three lines> | sudo sh -c '
   set -eu
   f=$1
   read -r host; read -r up; read -r tok
   case $host in ""|*[!A-Za-z0-9.-]*) echo "bad host" >&2; exit 1;; esac
   [ "$up" = localhost:4320 ] || { echo "upstream must be localhost:4320" >&2; exit 1; }
   [ "${#tok}" -ge 64 ] || { echo "token empty or shorter than 64" >&2; exit 1; }
   case $tok in *[!0-9a-fA-F]*) echo "token is not hex" >&2; exit 1;; esac
   for n in GELDAR_INGEST_HOST GELDAR_INGEST_UPSTREAM GELDAR_INGEST_TOKEN; do
     if grep -q "^$n=" "$f"; then echo "$n already in the file" >&2; exit 1; fi
   done
   [ -z "$(tail -c1 "$f")" ] || echo >> "$f"
   printf "GELDAR_INGEST_HOST=%s\nGELDAR_INGEST_UPSTREAM=%s\nGELDAR_INGEST_TOKEN=%s\n" "$host" "$up" "$tok" >> "$f"
   ' _ <env-file>
   ```

   d. Check, printing counts and names only: (1) `sudo stat -c '%U:%G %a' <env-file>` equals the line from a; (2) `sudo grep -vcE '^[A-Za-z_][A-Za-z0-9_]*=' <env-file>` equals the same command on the backup (no new malformed line; the count may be non-zero only if it was before); (3) each of `sudo grep -c '^GELDAR_INGEST_HOST=' <env-file>`, `...UPSTREAM=` and `...TOKEN=` prints `1`; (4) `sudo grep -c '' <env-file>` is the backup's count plus 3; (5) `sudo cmp -n "$(sudo stat -c %s <backup>)" <backup> <env-file>` prints nothing (the old bytes are unchanged). Any failure: restore with `sudo cp -p <backup> <env-file>`, stop, report.

   e. The recreate (step 3) runs only after the validate in step 3 passes against this file. The other two variables stay valid on their own; do not remove any `GELDAR_INGEST_*` line while a live `otel.caddy` or `otel-off.caddy` is in `config/geldar/` (Caddy then fails to start and every site is down): remove the live file first, restart, then edit the env file.

   Not verified without the node: the file's actual owner and mode, whether its lines are plain `KEY=VALUE` (docker `--env-file` and compose read it that way), and whether the file has comment or blank lines (check d.2 compares against the backup for that reason).
3. The one recreate of the shared Caddy container, to load the new variables (a running Caddy cannot see a new environment value, and `docker restart` keeps the old one, so only a recreate loads them). Its own approved window. Cost: every site on the node is down while the container is recreated (a few seconds, plus start time), and the long-lived `mcp.caddy` SSE streams drop and their clients reconnect. Rotating the token needs the same recreate.
   - Validate the new env file before the recreate, in a throwaway container of the running container's own image, so a bad file never takes the shared Caddy down: `sudo docker run --rm --env-file <env-file> -v <host Caddyfile>:/etc/caddy/Caddyfile:ro -v <host config dir>:/config:ro "$(docker inspect -f '{{.Config.Image}}' board-proxy)" caddy validate --config /etc/caddy/Caddyfile` (the env file is read by docker and not printed; `GELDAR_PUBLIC_ENV`-style host paths come from the owner, as in `deploy/colo-public.sh`). Unverified on the node: whether `validate` of a build with the DNS module needs more than the env file.
   - Recreate, from the compose project directory of `board-proxy` (the owner supplies the project and file names; the repo does not know them): `sudo docker compose up -d --force-recreate board-proxy`.
   - Immediately after, before step 4: the container runs (`docker inspect -f '{{.State.Running}}' board-proxy` prints `true`), `docker exec board-proxy caddy validate --config /etc/caddy/Caddyfile` passes (the check `deploy/colo-public.sh` runs after its own restart, for up to 30 s), and every existing public site answers: the `map`, `glass` and `mcp` sites that `deploy/colo-public.sh` installs, requested from the workstation exactly as in step 7. `deploy/colo-public.sh status` shows the files on disk only.
   - Failed recreate (the container does not run, validate fails, or a site does not answer): restore the env file backup made in step 2 over the env file (`sudo cp -p <backup> <env-file>`; never print it) and run the same recreate command again, then repeat the checks. Stop the procedure and report.
4. Put `otel.caddy` in `config/geldar/` on the node (same owner and mode as `mcp.caddy`), then `docker exec board-proxy caddy validate --config /etc/caddy/Caddyfile` (the container already holds the variables; do not pass the token with `docker exec -e`). Locally, `tools/repo-checks/src/caddy-adapt.test.ts` checks the file in the pinned image.
5. Apply with one `docker restart board-proxy` (admin API off, R39: `caddy reload` does not work). Cost: a few seconds of dropped connections on every site, including the `mcp.caddy` SSE streams, which reconnect. Then repeat the post-recreate checks of step 3 (container running, validate passes, `map`, `glass` and `mcp` answer). Failed restart or a site that does not answer: delete `config/geldar/otel.caddy` (the file set is then what it was before step 4), `docker restart board-proxy` again, repeat the checks, and report.
6. Verify, from the operator workstation, with the owner's token. `<host>` is the ingest hostname; use `https://` only. Token route: the owner holds the token (it is not generated on the node); it never appears on a command line, in argv, in shell history or in a log. Every command below takes it from STDIN (`<vault pipe>` stands for the owner's pipe that prints the token, one line):
   - Token header through a curl config read from stdin (nothing in argv): `<vault pipe> | sed 's/^/header = "Authorization: Bearer /; s/$/"/' | curl --config - -sS -o /dev/null -w '%{http_code}\n' --data '{}' -H 'Content-Type: application/json' https://<host>/v1/traces`. The alternative is a header file with mode 0600 (`umask 077`), used with `curl -H @<file>` and deleted straight after; never leave it on disk.
   - POST without a token to each of `/v1/traces`, `/v1/logs`, `/v1/metrics`: 401. POST with `Authorization: Bearer` and an empty value, and with a wrong fixed string such as `Bearer wrong`: 401 each.
   - GET to an OTLP path: 405.
   - POST with the token to `/v1/traces`: neither 401 nor 404 (the gateway's own status is the answer; 502 after at most 5 s while the gateway's publish is not up).
   - POST to any other path: 404.
   - A body over 8 MiB gets 413 on any path, with or without a token: it shows the cap, not authentication.
   - Log check, after these requests and after a forced 502 (send the authenticated POST while the gateway's loopback publish is not up; do not stop the gateway for this): `umask 077; t=$(mktemp); docker logs board-proxy --since <time of step 5> >"$t" 2>&1`, then `<vault pipe> | grep -c -F -f - "$t"` (the pattern comes from stdin, the file is the argument) must print `0`; `grep -ci -e authorization -e bearer -e cookie "$t"` must print `0` or only lines that say `REDACTED`; then `rm -f "$t"`. Logs can include other sites' lines: print counts only.
   - The gateway receives the `Authorization` header too (`reverse_proxy` forwards it): the gateway's own config must not log request headers.
   - The Mind-host side (the otel-agent endpoint `https://<host>` and the same token) is the owner's step, not part of this procedure.
   - Precondition: the DNS record for `<host>` is created by the owner (Azure DNS, decision 0071 item 5) and the node's Caddy has issued its certificate before this step; without it these requests fail on TLS. The node's build has the `caddy-dns/azure` module and reads its credentials from the same env file, so certificates for new hosts come through the same DNS-challenge path as the existing sites; I did not read the node's Caddyfile for the issuer, so the owner confirms it. Wait for issuance (the Caddy log) before step 6.
7. Portscan and after-restart checks: the host gains no new listener (no plain-HTTP port; Caddy already owns 443 on the node), the gateway's publish stays on the loopback address, and `tools/portscan` is unchanged. Other sites on the shared Caddy (`mcp`, `glass`, `map`) still answer as before.

Rollback and kill switch, one restart (R39): copy `otel-off.caddy` over `config/geldar/otel.caddy` (never both files at once: they name the same host), `docker exec board-proxy caddy validate --config /etc/caddy/Caddyfile`, `docker restart board-proxy`, then the checks of step 3. Cost: the same few seconds of dropped connections on every site (the `mcp.caddy` SSE streams reconnect) and the ingest route is down during it; afterwards the host answers 503 for every path and Mind-host exporters see 503 until the owner restores the route (their retry queues are the gateway design's concern, not Caddy's). The kill switch is therefore not instant and not free: batch it with other changes when the abuse is not urgent. Removing the file instead of swapping it needs the same restart. Remove the live file before removing `GELDAR_INGEST_*` from the env file (see step 2). The public hostname stays in the 0071 and 0096 amendments until the owner decides to drop it.

## Status

The live restart is an owner or ops step (C2-07). Nothing here has been loaded on a node.
