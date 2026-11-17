# Caddy OTLP ingest route (T-15): config, checks and rollback

Status: written for T-15 (docs only, 2026-11-16); files written by T-26 (2026-11-16): `deploy/caddy/otel.caddy` and `otel-off.caddy` match the text below (the directives are identical; the header comment gained placement, validation and rollback lines), pass `caddy validate` and `caddy adapt` in the pinned image (placeholders set to test values), and are covered by `tools/repo-checks/src/caddy-snippets.test.ts` and `caddy-adapt.test.ts`. The node steps are in `deploy/caddy/README.md` (OTLP ingest). Decision amendments: 0371 (amends 0071, including the one Caddy recreate) and 0372 (amends 0096). `validate.sh` includes the ingest files (sets `live-otel` and `killed-otel`, test values only). Nothing here is loaded or applied to the node. Owner ruling geldar-93, 2026-11-16: the OTLP ingest gets a Caddy route on the shared Caddy, authenticated with the ingest token. This covers the ingest route only. The SigNoz UI has no Caddy route (0350 clarification 2 and 3, 0352, collector-design section 9). Each node step below needs the owner's approval at the time.

Stock Caddy only. Owner ruling geldar-93, 2026-11-16: a custom Caddy image is not approved, and no third-party Caddy module is used. Every directive below is a stock Caddy directive. The route has no rate limit, because stock Caddy has none (see Abuse case). The node's build already includes a third-party DNS module (`caddy-dns/azure`, see Node facts); this route adds nothing to that build.

## Repo shape this matches

- `deploy/caddy/` holds one file per site: the live file `<site>.caddy` and its kill switch `<site>-off.caddy`. Each uses `{$GELDAR_*}` environment placeholders, and the file holds no value (`deploy/caddy/mcp.caddy`, `deploy/caddy/README.md`).
- Validate with `bash deploy/caddy/validate.sh` (the pinned Caddy image, `docker run --rm`). The shared Caddy's admin API is off (owner ruling R39, `deploy/README.md`), so `caddy reload` cannot work there: every apply is one `docker restart board-proxy`.
- A restart keeps the container's old environment, so this route asks for one owner-approved recreate for the new variables (see Load). After that, each change of the live file (including the kill switch swap) is one restart. Each restart drops connections on every site on the node for a few seconds, including `mcp.caddy`'s long-lived SSE streams (clients reconnect), so changes are batched.
- Node import line (read-only check, 2026-11-16 12:33Z; see Node facts below): the Caddyfile's only import is `import /config/geldar/*.caddy`. It is a top-level glob, so live files go in `config/geldar/` on the node, next to `mcp.caddy`. Subdirectories are not loaded.

## Node facts (read-only, 2026-11-16 12:33Z)

- The shared Caddy is container `board-proxy`, Caddy v2.11.6, built locally from `caddy:2-builder` with the `caddy-dns/azure` module. The image tags are unpinned; a digest pin is a follow-up.
- Compose project on the node under `board-proxy`. The Caddyfile is bind-mounted read-only; the config directory is mounted at `/config`. Admin API off. Host network. Memory limit 256 MiB. Restart policy `unless-stopped`.
- The environment comes from an env file named `azure.env`, root-only. The owner edits it; a recreate is needed to load new values. Values are not recorded here.
- The global block has `admin off`, an `email` directive and `servers { trusted_proxies static private_ranges }`. It sets no timeouts.
- `mcp.caddy` serves long-lived SSE (`flush_interval -1`, `stream_close_delay 5s`). This is why no global timeouts are added (see Stock Caddy limits).

Placeholders (no values in the repo; set in the Caddy environment on the node by the owner):

| Placeholder | Holds | Set by |
|---|---|---|
| `{$GELDAR_INGEST_HOST:otel.invalid}` | the public hostname of the route (default `otel.invalid`, so Caddy still starts if the variable is missing) | owner, Caddy environment |
| `{$GELDAR_INGEST_UPSTREAM:localhost:4320}` | the gateway's loopback publish, `localhost:4320` (`127.0.0.1:4320:4318` in `compose.gateway.yml` on the telemetry/t25-gateway branch, not on main until it merges) | owner, Caddy environment |
| `{$GELDAR_INGEST_TOKEN}` | the ingest token (Caddy environment secret) | owner, never typed into a shell or a file in the repo |

## The snippet (diff)

New live file `deploy/caddy/otel.caddy`. The file is new, so every line is an addition:

```diff
+# OTLP/HTTP ingest for Mind hosts (T-15; 0350 item 9; collector-design section 9; owner ruling 2026-11-16).
+# Placeholders: GELDAR_INGEST_HOST (public hostname), GELDAR_INGEST_UPSTREAM (gateway loopback publish, host:port),
+# GELDAR_INGEST_TOKEN (ingest bearer token, Caddy environment secret). No value is written in this file.
+{$GELDAR_INGEST_HOST:otel.invalid} {
+	# Only POST passes (the OTLP/HTTP exporters POST).
+	@not_post not method POST
+	handle @not_post {
+		respond 405
+	}
+
+	# Drop any address header a client sent. Caddy sets the one it vouches for inside reverse_proxy.
+	request_header -x-geldar-client-ip
+	request_header -X-Forwarded-For
+	request_header -CF-Connecting-IP
+
+	header {
+		-Server
+		X-Content-Type-Options nosniff
+	}
+
+	# The access log must never hold the Authorization header (it carries the ingest token).
+	log {
+		format filter {
+			wrap json
+			fields {
+				request>headers>Authorization delete
+				request>headers>Cookie delete
+				request>headers>Proxy-Authorization delete
+			}
+		}
+	}
+
+	# The same 8 MiB cap for every request. A 2048-span batch is about 2.5 MB (collector-design section 6).
+	request_body {
+		max_size 8MiB
+	}
+
+	# Authenticated ingest on the three OTLP/HTTP paths only. Stock Caddy: no rate limit (see Abuse case).
+	@ingest {
+		path /v1/traces /v1/logs /v1/metrics
+		header Authorization "Bearer {$GELDAR_INGEST_TOKEN}"
+		expression `size('{$GELDAR_INGEST_TOKEN}') >= 64`
+	}
+	handle @ingest {
+		reverse_proxy {$GELDAR_INGEST_UPSTREAM:localhost:4320} {
+			header_up Host localhost
+			header_up x-geldar-client-ip {remote_host}
+			transport http {
+				dial_timeout 5s
+				response_header_timeout 60s
+			}
+		}
+	}
+
+	# The same three paths without a valid token: 401. Not rate limited (stock Caddy has no rate limit).
+	@signal path /v1/traces /v1/logs /v1/metrics
+	handle @signal {
+		respond 401
+	}
+
+	# Every other path is 404.
+	handle {
+		respond 404
+	}
+}
```

Kill switch, new file `deploy/caddy/otel-off.caddy` (swap it in for `otel.caddy` to stop the route):

```diff
+# OTLP ingest kill switch (caddy-ingest-route.md). Swap in for otel.caddy, then validate and restart (admin API off, R39).
+{$GELDAR_INGEST_HOST:otel.invalid} {
+	respond 503
+}
```

No global server timeouts are added. The `servers` block is a global option that applies to every site on the shared Caddy, including `mcp.caddy`. Its long-lived SSE streams (`flush_interval -1`, `stream_close_delay 5s`) could be cut by a global `write` or `idle` timeout. The only timeouts are the per-site `transport http` values inside `reverse_proxy` in `otel.caddy` (PROPOSED: `dial_timeout 5s`, `response_header_timeout 60s`). The node's global block is not changed.

Notes on the snippet:
- The snippet uses only stock Caddy directives: `handle`, `respond`, `request_header`, `header`, `log` with the filter encoder, `request_body`, and `reverse_proxy` with its `transport http` timeouts. No global `servers` block is added. It has no rate limit and adds no module, and it needs no custom image.
- The token matcher is a plain string match plus a CEL guard, `expression size('{$GELDAR_INGEST_TOKEN}') >= 64`, in the same matcher (all conditions must hold). An unset, empty or short token turns the header match into `Bearer ` or similar, but the guard is false, so the proxy route never matches and the request gets 401. The adapt test checks the guard with an empty token. The guard checks length only; the procedure still refuses a short token before anything is written (README step 2).
- The placeholders have defaults (`otel.invalid`, `localhost:4320`, empty token), so a recreate with a variable missing still starts Caddy and cannot take every site down. Do not rely on it: remove the live file before removing the variables.
- Logging. The access log of this site uses the filter encoder and deletes the `Authorization`, `Cookie` and `Proxy-Authorization` request headers. The error log (for example the 502 when the gateway is down) is the default logger, which the node's global block does not change (it has `admin off`, `email` and `servers { trusted_proxies }` only, no `log` and no `log_credentials`); Caddy redacts credential headers there by default (`log_credentials` is off), so the headers appear as `REDACTED`. This is Caddy's documented default, not verified on the node's 2.11.6: README step 6 reads the `board-proxy` log after a forced 502 and greps (pattern from stdin) for the token and for `Authorization`. The gateway receives the `Authorization` header and must not log request headers.

## Abuse case

Who can send what:
- **A holder of the ingest token** (a Mind host, or anyone who has copied the token) can send valid-looking OTLP that is junk, malformed or oversized, to the three paths.
- **An unauthenticated scanner** can send requests to the three paths, and gets 401 for each. It can also send large bodies to them.

What each limit bounds:
- `request_body { max_size 8MiB }` bounds the size of one request body. A larger body gets 413 at Caddy and never reaches the gateway.
- The `transport http` timeouts (`dial_timeout`, `response_header_timeout`) bound how long the proxy waits on the gateway. No global timeouts are set, because `mcp.caddy` serves long-lived SSE. A slow or stalled request body is bounded by `request_body max_size 8MiB` and by the gateway's own limits, not by a server timeout.
- The Bearer match is the only thing that admits a request to the proxy. Without the token, nothing is forwarded.

Downstream of Caddy, for what is admitted:
- the gateway collector's `memory_limiter` and bounded sending queue (collector-design sections 5 and 6) bound its memory and its disk;
- the ClickHouse 100 GB budget alarm (collector-design section 13) is the last bound on stored data.

What this does not bound, stated plainly:
- **Stock Caddy has no per-client rate limit.** A token holder or a scanner can send requests as fast as the connection and timeouts allow. The 401 path is not rate limited.
- **The token compare is not constant-time.** The `header` matcher compares strings with ordinary equality.

So the real defence is the token itself, plus the 8 MiB body limit and the gateway's own limits. The token must be at least 32 random bytes, generated by the owner. If it is leaked, the owner rotates it: the owner sets a new value in the Caddy environment, and a running Caddy keeps the old value until the approved recreate (see Load).

## Stock Caddy limits used

- `request_body { max_size 8MiB }`, at site level in `otel.caddy`. Stock directive. Over the limit: 413.
- Per-site proxy timeouts: `reverse_proxy` `transport http { dial_timeout 5s; response_header_timeout 60s }` on the otel site only. Stock options. PROPOSED values. Verify with `caddy validate` on the node's Caddy version. No global `servers` timeouts: they would also apply to `mcp.caddy` and could cut its SSE streams.
- Connection count limit: not used. This document does not name a stock Caddy directive for a per-client or total connection cap, and none is set here. Any cap claimed later must be verified with `caddy validate` before it is written down.

## Validation (before each restart)

1. Check the Caddy environment on the node by length only, never by printing the value: `GELDAR_INGEST_TOKEN` is set and at least 64 hex characters (the owner's value, delivered on stdin only, never on a command line); `GELDAR_INGEST_HOST` and `GELDAR_INGEST_UPSTREAM` are set. Any failure stops the step.
2. `bash deploy/caddy/validate.sh` runs `caddy validate` in the pinned image (Caddy 2.10.2; the node runs 2.11.6). It sets the three placeholders to test values, never the real token, and does not touch the running Caddy.
3. The snippet, including its `transport http` block, must pass `caddy validate` on the node's build. A directive that fails validation is a fault in the snippet, not a reason to add a module.

## Load (owner approval at the time)

1. Once, for the variables: the owner places them in the Caddy env file and the container is recreated (validated first in a throwaway container of the same image). Every site on the node is down while it happens; the other sites are checked at once, with a failed-recreate path (restore the env file backup, recreate again). Later token rotations need the same recreate. Exact commands: `deploy/caddy/README.md`, OTLP ingest, steps 2 and 3.
2. Place the live file, `caddy validate` inside the container, then `docker restart board-proxy` (R39: no reload). Do not pass the token on the command line (`docker exec -e` is not used; the container already holds the variable). A failed restart is undone by deleting the live file and restarting again.
3. Read-only checks from the operator workstation, run by the owner with the owner's token (the value is not written here):
   - a POST without a token to each of the three paths gets 401;
   - a GET to an OTLP path gets 405;
   - a POST with the token to `/v1/traces` does not get 401 or 404 (the gateway's own status is the answer);
   - a POST to any other path gets 404;
   - a body over 8 MiB gets 413;
   - the access log has no `Authorization` value after these requests.

## Rollback (owner approval at the time)

1. Swap `deploy/caddy/otel-off.caddy` in for `deploy/caddy/otel.caddy` (or remove the live file from the node's set), run `caddy validate`, and `docker restart board-proxy`. The hostname then answers 503 for every path (when the file is removed instead, the host has no site).
2. The rollback is a restart (R39), so it costs the same few seconds of dropped connections on every site, and the ingest route is down during it. The kill switch is not instant. Remove the live file before removing the variables from the env file: a recreate with the file live and `GELDAR_INGEST_HOST` unset leaves Caddy unable to start (every site down).
3. The public hostname stays in the 0071 and 0096 amendments until the owner decides to drop it.
4. No global timeouts exist to remove, because none are added. The `transport http` block leaves with `otel.caddy` in step 1.

## Change policy for the shared Caddy

- One container recreate for the variables, then one `docker restart board-proxy` per change of the live file (admin API off, R39; no reloads).
- Every recreate or restart needs the owner's approval at the time, against the exact file in this document.
- The UI is never routed through Caddy, and no restart is requested for it.
- The ingest token secret needs one approved recreate of the shared Caddy container, requested as its own window with the exact diff and rollback.
