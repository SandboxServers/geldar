# Caddy OTLP ingest route (T-15): config, checks and rollback

Status: written for T-15 (docs only, 2026-11-16). Nothing here is loaded or applied to the node. Owner ruling geldar-93, 2026-11-16: the OTLP ingest gets a Caddy route on the shared Caddy, authenticated with the ingest token. This covers the ingest route only. The SigNoz UI has no Caddy route (0350 clarification 2 and 3, 0352, collector-design section 9). Each node step below needs the owner's approval at the time.

## Repo shape this matches

- `deploy/caddy/` holds one file per site: the live file `<site>.caddy` and its kill switch `<site>-off.caddy`. Each uses `{$GELDAR_*}` environment placeholders, and the file holds no value (`deploy/caddy/mcp.caddy`, `deploy/caddy/README.md`).
- Validate with `bash deploy/caddy/validate.sh` (the pinned Caddy image, `docker run --rm`). Reload with `caddy reload` on the node.
- The README says the shared Caddy is never restarted. A running Caddy cannot see a new environment secret without a container recreate, so this route asks for one owner-approved recreate for the token (see Load). After that, changes are reloads only.
- The node's import line that loads each live file is not in the repo (UNVERIFIED; check at N1).

Placeholders (no values in the repo; set in the Caddy environment on the node by the owner):

| Placeholder | Holds | Set by |
|---|---|---|
| `{$GELDAR_INGEST_HOST}` | the public hostname of the route | owner, Caddy environment |
| `{$GELDAR_INGEST_UPSTREAM}` | the gateway's loopback publish, `127.0.0.1:<port>` (port chosen at N1) | owner, Caddy environment |
| `{$GELDAR_INGEST_TOKEN}` | the ingest token (Caddy environment secret) | owner, never typed into a shell or a file in the repo |

## The snippet (diff)

New live file `deploy/caddy/otel.caddy`. The file is new, so every line is an addition:

```diff
+# OTLP/HTTP ingest for Mind hosts (T-15; 0350 item 9; collector-design section 9; owner ruling 2026-11-16).
+# Placeholders: GELDAR_INGEST_HOST (public hostname), GELDAR_INGEST_UPSTREAM (gateway loopback publish, host:port),
+# GELDAR_INGEST_TOKEN (ingest bearer token, Caddy environment secret). No value is written in this file.
+{$GELDAR_INGEST_HOST} {
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
+			}
+		}
+	}
+
+	# The same 8 MiB cap for every request. A 2048-span batch is about 2.5 MB (collector-design section 6).
+	request_body {
+		max_size 8MiB
+	}
+
+	# Authenticated ingest on the three OTLP/HTTP paths only. Rate numbers are PROPOSED.
+	@ingest {
+		path /v1/traces /v1/logs /v1/metrics
+		header Authorization "Bearer {$GELDAR_INGEST_TOKEN}"
+	}
+	handle @ingest {
+		rate_limit {
+			zone ingest_authed {
+				key {remote_host}
+				events 600
+				window 1m
+			}
+		}
+		reverse_proxy {$GELDAR_INGEST_UPSTREAM} {
+			header_up Host localhost
+			header_up x-geldar-client-ip {remote_host}
+		}
+	}
+
+	# The same three paths without a valid token: 401, and rate limited too, so token guessing is limited.
+	@signal path /v1/traces /v1/logs /v1/metrics
+	handle @signal {
+		rate_limit {
+			zone ingest_unauthed {
+				key {remote_host}
+				events 60
+				window 1m
+			}
+		}
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
+# OTLP ingest kill switch (caddy-ingest-route.md). Swap in for otel.caddy, then validate and reload.
+{$GELDAR_INGEST_HOST} {
+	respond 503
+}
```

Notes on the snippet:
- `rate_limit` is not a stock Caddy directive. It needs the third-party module, in a custom Caddy image pinned by version and digest. On the stock image, validation fails with an unrecognised directive; that failure is the check that the module is missing.
- The token matcher is a plain string match. If `GELDAR_INGEST_TOKEN` is unset or empty, the matcher becomes `Bearer ` and would accept a request with that exact header. The validation step therefore refuses an empty or short token before anything else.

## Validation (no restart)

1. Check the Caddy environment on the node by length only, never by printing the value: `GELDAR_INGEST_TOKEN` is set and at least 32 bytes; `GELDAR_INGEST_HOST` and `GELDAR_INGEST_UPSTREAM` are set. Any failure stops the step.
2. `bash deploy/caddy/validate.sh` runs `caddy validate` in the pinned image. It reads the file and does not touch the running Caddy. UNVERIFIED: whether `validate.sh` sets the three placeholders today. If it does not, a separate packet adds them with test values, never the real token.
3. The custom build with the `rate_limit` module is the one that passes step 2. The stock image fails on `rate_limit`, which is the expected failure.

## Load (owner approval at the time)

1. Once, for the token: the owner places the token in the Caddy environment and recreates the Caddy container. This is the one restart of the shared Caddy for this change. Later rotations need the same recreate.
2. `caddy reload` on the node, with the live file in place. Do not pass the token on the command line (`docker exec -e` is not used; the container already holds the variable).
3. Read-only checks from the operator workstation, run by the owner with the owner's token (the value is not written here):
   - a POST without a token to each of the three paths gets 401;
   - a GET to an OTLP path gets 405;
   - a POST with the token to `/v1/traces` does not get 401 or 404 (the gateway's own status is the answer);
   - a POST to any other path gets 404;
   - a body over 8 MiB gets 413;
   - the rate limit gets 429 after its zone is used up;
   - the access log has no `Authorization` value after these requests.

## Rollback (owner approval at the time)

1. Swap `deploy/caddy/otel-off.caddy` in for `deploy/caddy/otel.caddy` (or remove the live file from the node's set), run the validation step, and `caddy reload`. The hostname then answers 503 for every path.
2. No restart is needed for the rollback. The environment secret can stay until the next recreate, then be removed.
3. The public hostname stays in the 0071 and 0096 amendments until the owner decides to drop it.

## Change policy for the shared Caddy

- One container recreate (a restart) for the token, then reloads only.
- Every restart or reload needs the owner's approval at the time, against the exact file in this document.
- The UI is never routed through Caddy, and no restart is requested for it.
- For the owner's decision: the rate limit needs a pinned third-party Caddy module in a custom image, and the ingest token secret needs one approved recreate of the shared Caddy container.
