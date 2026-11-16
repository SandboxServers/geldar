# deploy/caddy: public read-only sites through the shared Caddy

Decisions: [0071](../../docs/decisions/0071-public-endpoints-and-ports.md) (the shared Caddy is reloaded, never restarted) and [0072](../../docs/decisions/0072-glass-and-bluemap-are-public.md) (Glass and BlueMap are public, read-only, hardened). The open record is [0094](../../docs/decisions/0094-public-sites-read-only-through-caddy.md).

## Files

| Site | Live file | Kill switch | Upstream placeholder |
|---|---|---|---|
| BlueMap map | `map.caddy` | `map-off.caddy` | `{$GELDAR_MAP_UPSTREAM}` |
| Glass | `glass.caddy` | `glass-off.caddy` | `{$GELDAR_GLASS_UPSTREAM}` |
| MCP (`/p/<player_id>` only) | `mcp.caddy` | `mcp-off.caddy` | `{$GELDAR_MCP_UPSTREAM}` |

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
3. Reload: `caddy reload` on the node.

## Kill procedure

Swap to `<site>-off.caddy` (`deploy/colo-public.sh off <site>`) and reload. `mcp.caddy` and the Glass `/api/stream` route set `stream_close_delay 5s`, which is intended to close open streams on a reload; that is not verified for SSE yet (C2-07 live check). Until it is, restart the MCP container and Glass after the swap. The in-process kill switches of the MCP and of Glass are read at start (ruling R26), so changing them needs a service restart; the Caddy swap is the live switch.

The 405 for a refused method is `handle @not_allowed { respond 405 }`, the first handle in each site, because Caddy sorts a site-level `respond` after `handle` and it would never run. `tools/repo-checks/src/caddy-adapt.test.ts` adapts each file in the pinned image and checks the route order.

Never run `systemctl restart caddy` or restart the container. Caddy serves other sites on the node, and a restart interrupts them all.

## OTLP ingest (otel.caddy)

The telemetry gateway's OTLP/HTTP ingest for Mind hosts. Live file `otel.caddy`, kill switch `otel-off.caddy`. The full design, abuse case and limits are in [caddy-ingest-route.md](../../docs/analysis/telemetry/caddy-ingest-route.md). Owner ruling geldar-93 (2026-11-16): the ingest route goes on the shared Caddy, authenticated with the ingest token; stock Caddy only, no custom image, no third-party module. The SigNoz UI has no Caddy route.

Differences from the sites above (the doc is followed where it differs from `mcp.caddy`):

- The host is `{$GELDAR_INGEST_HOST}` (no `GELDAR_DOMAIN` prefix), the upstream is `{$GELDAR_INGEST_UPSTREAM}` (the gateway's loopback publish, `localhost:4320` form, no IP literal in the file) and the token is `{$GELDAR_INGEST_TOKEN}`.
- Only POST passes (405 otherwise), on `/v1/traces`, `/v1/logs` and `/v1/metrics`. Without the exact `Authorization: Bearer <token>` header those paths get 401; any other path gets 404. The kill switch answers 503 on the whole host.
- Per-site limits only: `request_body { max_size 8MiB }` (413 over it) and `transport http { dial_timeout 5s; response_header_timeout 60s }`. No global `servers` timeouts, because `mcp.caddy` serves long-lived SSE.
- The access log uses the filter encoder and deletes `request>headers>Authorization`. No plain-HTTP listener is added (automatic HTTPS only).
- Stock Caddy has no rate limit and the token compare is not constant-time; see the Abuse case in the doc.
- The live file goes in `config/geldar/` on the node (the Caddyfile imports `/config/geldar/*.caddy`, top level only; subdirectories are not loaded). It is not in `deploy/colo-public.sh`'s site list, and `validate.sh` does not cover it yet (a follow-up that adds the three placeholders with test values, never the real token).

Every step below needs the owner's approval at the time. Record the exact commands run.

1. Precheck, read-only. Confirm the import line (`import /config/geldar/*.caddy`) in the node's Caddyfile, and that the env file the shared Caddy container (`board-proxy`) reads (`azure.env`, root-only) exists. Do not print its contents.
2. Place the three variables in that env file. The file is root-only, so this needs `sudo` beyond a mkdir/chown scope (geldar-93 allows sudo where the work needs it); record the exact commands. The owner sets `GELDAR_INGEST_HOST` and `GELDAR_INGEST_UPSTREAM`. For the token, generate it on the node, never print it, never put it on a command line or in the repo; keep the file mode and owner it already has:

   ```bash
   # Appends one line. The value is never echoed. Run once; do not run it if the line exists.
   sudo grep -q '^GELDAR_INGEST_TOKEN=' <env-file> \
     || { printf 'GELDAR_INGEST_TOKEN=%s\n' "$(openssl rand -hex 32)" | sudo tee -a <env-file> >/dev/null; }
   ```

   `openssl rand -hex 32` is 32 random bytes as 64 hex characters. Check by length only, for example `sudo awk -F= '/^GELDAR_INGEST_TOKEN=/{print length($2)}' <env-file>` (expect at least 64, not the value), and that `GELDAR_INGEST_HOST` and `GELDAR_INGEST_UPSTREAM` are set. An empty token would make the match `Bearer ` and admit that header, so any failure here stops the procedure.
3. The one recreate of the shared Caddy container, to load the new variables (a running Caddy cannot see a new environment value). Its own approved window, with the exact diff and rollback. Later changes are reloads only; rotating the token needs the same recreate.
4. Put `otel.caddy` in `config/geldar/` on the node, then `caddy validate` with the Caddyfile (the Caddy container already holds the variables; do not pass the token with `docker exec -e`). Locally, `bash deploy/caddy/validate.sh` plus `tools/repo-checks/src/caddy-adapt.test.ts` check the file in the pinned image.
5. `caddy reload`.
6. Verify, from the operator workstation, with the owner's token (the value is not written here and is not put in shell history or the log):
   - POST without a token to each of `/v1/traces`, `/v1/logs`, `/v1/metrics`: 401.
   - GET to an OTLP path: 405.
   - POST with the token to `/v1/traces`: neither 401 nor 404 (the gateway's own status is the answer).
   - POST to any other path: 404.
   - A body over 8 MiB: 413.
   - After these requests the access log has no `Authorization` value (search the log for the token's first characters, by length-safe means; no match expected).
7. Portscan and after-reload checks: the host gains no new listener (no plain-HTTP port; Caddy already owns 443 on the node), the gateway's publish stays on the loopback address, and `tools/portscan` is unchanged. Other sites on the shared Caddy (`mcp`, `glass`, `map`) still answer as before.

Rollback, no restart: put `otel-off.caddy` in place of `otel.caddy` (or remove the live file), `caddy validate`, `caddy reload`. The host answers 503 for every path. The environment variables can stay until the next recreate. The public hostname stays in the 0071 and 0096 amendments until the owner decides to drop it.

## Status

The live reload is an owner or ops step (C2-07). Nothing here has been loaded on a node.
