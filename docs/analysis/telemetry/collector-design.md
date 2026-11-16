# Geldar Collector: design (T-02)

Status: design only, written 2026-11-15 for card T-02 of the telemetry survey. Nothing here is built, merged or switched on. No compose overlay or deploy file is added by this document; those come in the T-02 implementation packet, after the owner approvals listed in section 14.

Governing records: [0350](../../decisions/0350-telemetry-scope-and-full-capture.md) (telemetry scope, full capture, one-year retention, 100 GB budget, operator-only readers), [0082](../../decisions/0082-colo-compose-network-and-limits.md) (compose layout, limits, loopback binds, log limits), [0071](../../decisions/0071-public-endpoints-and-ports.md) and [0096](../../decisions/0096-public-topology-as-built.md) (public endpoints, shared Caddy), [0260](../../decisions/0260-body-container-control-by-host-helper.md) (no Docker socket in containers), [0088](../../decisions/0088-metrics-exporters-and-replay-window.md) (metric labels, amended by 0350).

Source for the facts: the telemetry survey of 2026-11-15, sections 1.2, 1.3, 4.1, 4.2, 4.5, 6, 7 (cards T-02, T-04, T-09, T-10, T-15), 9.6 and 9.7. Anything not checked in this session is marked **UNVERIFIED**.

## 1. Scope and non-goals

In scope: the `otel-gateway` service on the Colo (the Geldar Collector), its image, its network placement, its pipelines, its caps, the host-metrics path without a socket, the NATS and Postgres scrape paths, the Mind-host route through Caddy, the budget and retention settings, the node steps with rollout and rollback, verification and risks.

Out of scope: the other tenant's SigNoz stack (its config is never changed by Geldar), the SDK package (T-03), the Paper agent (T-11), the Mind-side exporter (T-13), dashboards (T-17).

## 2. Topology

```
Colo node (16 CPUs, 125 GB RAM at the 2026-11-15 sample)
  network geldar-colo (compose/colo.yml)
    nats  <-- nats-exporter (network_mode: service:nats; metrics on the nats name)   [T-09]
    postgres <-- postgresql receiver, monitoring role                                 [T-10]
    geldar services, paper, velocity --OTLP/HTTP (colo network)--> otel-gateway:4318
    otel-gateway --loopback publish 127.0.0.1:<port>:4318--> shared Caddy (host network)
  network <SigNoz network, owned by another tenant>  (joined by otel-gateway only)
    otel-gateway --OTLP gRPC--> signoz-otel-collector:4317 --> ClickHouse (shared)
  host /proc, /sys read-only (host_metrics)                                          [section 8]

Mind host (owner's desktop today)
  otel-agent --HTTPS + bearer token--> https://otel.<domain> (Caddy) --> otel-gateway  [section 9]
```

Rules this follows: no service publishes anything except the one loopback port the Caddy route needs (section 9); no container mounts the Docker socket (section 8); the other tenant's containers and config are untouched (0350 item 4).

## 3. Image

- Image: `otel/opentelemetry-collector-contrib:0.164.0`, pinned by digest.
- Digest recorded by the survey on 2026-11-15: `sha256:340c9ca6a36617084c6661bdc4f0fe92b7cda5a805d61673ec8db375fddc522b`. **UNVERIFIED for this packet**: the digest must be read from the registry at implementation time, compared with the survey value, and the comparison recorded in the T-02 report. If they differ, stop and ask.
- Release date of 0.164.0: 2026-10-27 (survey, 9.0). The survey lists 0.165.0 as newer and not yet two weeks old at the time of the survey; do not pick it.
- Component names: use the snake_case names of 0.164 (`file_log`, `host_metrics`, `resource_detection`); the old names are deprecated aliases (survey 9.7).
- Components not used: `docker_stats`, the Docker resource detector, `tail_sampling` (survey 4.5; 0350 keeps 100% of traces).
- Image user, read-only root filesystem and `cap_drop: ALL` are wanted; whether the contrib image runs as a non-root user **UNVERIFIED** (check `docker inspect` of the pulled image before the implementation packet).

## 4. Services, network and ports

| Service | Network | Published | Caps (0082 pattern) | Notes |
|---|---|---|---|---|
| `otel-gateway` | `geldar-colo` and the SigNoz network | `127.0.0.1:<port>:4318` only (literal; section 9) | 0.5 CPU, 512m, 128 pids | `GOMEMLIMIT=400MiB`, read-only root, `cap_drop: ALL`, `no-new-privileges`, healthcheck on the in-container health extension |
| `nats-exporter` | none of its own (`network_mode: service:nats`) | none | 0.1 CPU, 64m, 64 pids (pids **UNVERIFIED** choice) | scrapes NATS monitor on its loopback inside the NATS namespace; its metrics port is reached as `nats:<port>` on the colo network |

Rules:
- The gateway's gRPC port 4317 is not published (the survey's 4.1 design, kept). 4318 is reachable from the colo network by name, and from the host only through the one loopback publish.
- The loopback publish is a **change to T-02's text**. T-02 says "OTLP on the `colo` network only". Caddy runs in host networking (`deploy/caddy/README.md`, 0096 item 1), so it can reach a Geldar service only through a loopback publish, as MCP (8788) and Glass (8787) already do (0096 item 2). The loopback check (`tools/repo-checks/src/loopback-ports.ts`) must allow exactly that one entry in the new overlay, the same way it allows the public Minecraft entry in `compose/colo-public.yml`. **Owner decision** (finding F1).
- The loopback port number is chosen at implementation time and checked free on the node (read-only `ss`), like 25567 in 0082. **UNVERIFIED**: no free port has been checked.
- Logging for every service: the 0082 anchor (`json-file`, `max-size` 10m, `max-file` 3). No service uses the default logging driver.
- Healthchecks: `restart: unless-stopped` (0082).
- Compose file: a new overlay `compose/colo-otel.yml`, merged over `compose/colo.yml` the way `colo-kino.yml` is (its header says "Merge it over compose/colo.yml only when..."). It is gated by env (see section 15) so the default `colo.yml` stays as it is. Geldar's services get the endpoint variable from the overlay, and the SDK stays off when the variable is unset (T-03).
- The gateway is on no default network: `networks: [colo, signoz]`, with `signoz` declared `external: true` and named by a variable (`GELDAR_SIGNOZ_NETWORK`). The name is not in the repo, and the script refuses to start when it is unset.

## 5. Pipelines

The Collector's `service.pipelines` (order matters; `memory_limiter` first in every pipeline; sketch below, not a final file):

```yaml
receivers:
  otlp:
    protocols:
      grpc: {endpoint: 0.0.0.0:4317}   # colo network only; not published
      http: {endpoint: 0.0.0.0:4318}   # colo network; one loopback publish for Caddy
  prometheus:
    config:
      scrape_configs:
        - job_name: nats
          scrape_interval: 30s
          static_configs: [{targets: ["nats:<exporter port>"]}]   # UNVERIFIED port
  postgresql:
    endpoint: postgres:5432
    transport: tcp
    username: <monitoring role name>
    password: ${file:/run/secrets/otel-pg.txt}   # config file provider; UNVERIFIED
    databases: [<application database name>]
    tls: {insecure: true}                         # internal network only; UNVERIFIED for this image
  hostmetrics:
    root_path: /hostfs
    collection_interval: 30s
    scrapers:
      cpu: {}
      load: {}
      memory: {}
      filesystem: {}     # the /mnt/nvme alarm (section 13) reads this
      network: {}
      disk: {}
processors:
  memory_limiter: {check_interval: 1s, limit_mib: 400, spike_limit_mib: 80}
  resource:
    attributes:
      - {key: deployment.environment.name, value: colo, action: upsert}
      - {key: service.namespace, value: geldar, action: upsert}
  filter/noise:
    error_mode: ignore
    logs:
      log_record:
        # Drop the RCON client lifecycle lines; keep the [Rcon: ...] command echoes (survey 5.2).
        - 'IsMatch(body, ".*Thread RCON Client .*(started|shutting down).*")'
    traces:
      span:
        - 'attributes["http.route"] == "/healthz"'   # health-check spans; route name to confirm
  transform/redact:
    error_mode: ignore
    log_statements:
      - context: log
        statements:
          - 'replace_pattern(body, "(?:\\d{1,3}\\.){3}\\d{1,3}", "<addr>")'   # IPv4 in Paper's "logged in with entity id ... [/<address>]" lines
          # plus an IPv6 pattern; the exact expression is written and tested in T-02
          - 'delete_matching_keys(attributes, "(?i)(token|secret|password|passwd|authorization|cookie|api[_-]?key)")'
          - 'delete_key(attributes, "user.email")'
    trace_statements:
      - context: span
        statements:
          - 'delete_matching_keys(attributes, "(?i)(token|secret|password|passwd|authorization|cookie|api[_-]?key)")'
  transform/metric_labels:
    error_mode: ignore
    metric_statements:
      - context: datapoint
        statements:
          # 0088 and 0350 item 1: metrics keep no life, player or token label
          - 'delete_key(attributes, "geldar.life_id")'
          - 'delete_key(attributes, "player_id")'
  batch: {send_batch_size: 2048, timeout: 5s}   # proposal; not tuned
exporters:
  otlp/signoz:
    endpoint: ${env:GELDAR_SIGNOZ_OTLP_ENDPOINT}   # the SigNoz collector's gRPC name on that network; UNVERIFIED
    tls: {insecure: true}
    compression: gzip
    timeout: 5s
    retry_on_failure: {enabled: true, max_elapsed_time: 300s}
    sending_queue: {enabled: true, storage: file_storage, queue_size: <see section 6>, block_on_overflow: false}
extensions:
  health_check: {endpoint: 0.0.0.0:13133}   # bound inside the container, not published
  file_storage: {directory: /var/lib/otelcol/queue, create_directory: true}
service:
  extensions: [health_check, file_storage]
  pipelines:
    traces:  {receivers: [otlp], processors: [memory_limiter, resource, filter/noise, transform/redact, batch], exporters: [otlp/signoz]}
    logs:    {receivers: [otlp], processors: [memory_limiter, resource, filter/noise, transform/redact, batch], exporters: [otlp/signoz]}
    metrics: {receivers: [otlp, prometheus, postgresql, hostmetrics], processors: [memory_limiter, resource, transform/metric_labels, batch], exporters: [otlp/signoz]}
```

Notes:
- OTTL function names and the escaping of regular expressions inside YAML are **UNVERIFIED** against 0.164.0; the T-02 packet checks each statement with the Collector's own config validation (`otelcol validate`, run inside the image) and a unit fixture that feeds a Paper log line with an address and a `Thread RCON Client` line through the pipeline.
- `redaction` (alpha) is not used unless the `transform` version proves harder to read (survey 4.5).
- The filter for health checks is kept as a placeholder until the health route name is read from the code.
- Trace context is kept as is: the gateway forwards `traceparent` and `tracestate`, not Baggage (0350 item 7).

## 6. Sending queue and disk cap

- `file_storage` holds the persisted queue on a named volume, `/var/lib/otelcol/queue`. A restart of SigNoz loses nothing that is queued (survey 4.1).
- Survey 9.7: the exporter queue holds `queue_size` requests (default 1,000) and, with `block_on_overflow: false`, drops when full. The survey's 1 GiB volume is a proposal.
- **Finding F2**: `file_storage` and `sending_queue` in 0.164.0 cap items, not bytes (**UNVERIFIED** that no byte cap exists). The disk cap therefore needs a bound on the volume itself. Two options, pick one in T-02:
  - a fixed-size filesystem for the queue (a loop-mounted image of 1 GiB under a directory the root operator creates; a node step, section 17);
  - or a `queue_size` derived from the largest request: `queue_size = 1 GiB / largest request bytes`, with the largest request measured in the T-02 soak test (the proposal's 2,048-span batch at about 1.2 KB a span is about 2.5 MB, which gives about 400 items for 1 GiB; **UNVERIFIED** estimate).
- The disk alarm in section 13 covers the node; a separate alarm on the queue directory is recommended (`system.filesystem.utilization` for its mount point).

## 7. Caps, logs and hardening

- `deploy.resources.limits`: `cpus: "${GELDAR_COLO_OTEL_GATEWAY_CPUS:-0.5}"`, `memory: "${GELDAR_COLO_OTEL_GATEWAY_MEM:-512m}"`, `pids: 128` (0082 naming pattern; the loopback-ports check is updated for the new service in the same packet).
- `GOMEMLIMIT=400MiB` (80% of 512 MiB, survey 9.7). The `memory_limiter` soft limit is 400 MiB with an 80 MiB spike; the Go limit is set so the runtime collects before the limiter refuses.
- Log limits: the 0082 anchor (`json-file`, 10 MiB, 3 files). Survey 9.5 notes Paper and others already log heavily; the gateway's own logs are at `warn`.
- Read-only root, `tmpfs` for `/tmp`, the queue volume as the only writable path, `cap_drop: ALL`, `security_opt: [no-new-privileges:true]`.
- The config directory is a read-only bind of `deploy/otel/gateway.yaml`, with the secrets directory bind read-only (`/run/secrets/otel-pg.txt`, the SigNoz network variable only in the environment).
- No `docker.sock` mount in any Geldar telemetry container (0260 and 0350 item 9). The rule is checked by a repo test on the overlay, not left to review.

## 8. Host metrics without the Docker socket

The gateway needs two kinds of host data: node-wide (`hostmetrics`, read-only `/proc` and `/sys`, plus the root mount for filesystems) and per-container (CPU, memory and pids of each Geldar container, for the caps check in section 16).

Node-wide: mount the host's `/proc`, `/sys` and the root filesystem read-only under `/hostfs`, and set `root_path: /hostfs`. **Finding F3**: mounting host `/proc` gives the gateway the host's process list (command lines included). Disable the process scraper (it is not in the list above) and check that no other host file is reachable. **UNVERIFIED** that `hostmetrics` honours `root_path` for every scraper in 0.164.0 (survey 9.1 and the `hostmetrics` page say yes for the listed scrapers).

Per-container: the contrib `docker_stats` receiver needs the socket and is ruled out (0260, 0350 item 9). Two substitutes:

- **Option A, read-only cgroup reads.** Mount the host cgroup tree read-only and read `cpu.stat`, `memory.current` and `pids.current` under the per-container scope directories (cgroup v2 layout `system.slice/docker-<full container id>.scope`, **UNVERIFIED** on the node). The container id is mapped to a service name by a file the deploy script writes from `docker compose ps` run by the operator, not by the container. Cost: a small custom reader that is not a contrib receiver; more code to review.
- **Option B, a read-only stats endpoint on the host helper.** The host helper already holds the Docker socket (0260 names it the only holder). It adds one loopback-only route that answers `GET` of container stats for the Geldar project, and nothing else. The gateway scrapes it with the `prometheus` receiver, which is contrib code. Cost: a change to a root-run unit, which needs its own review and a packet of its own.
- **Option C (not recommended)**: a socket proxy container. It is a second holder of the socket, which breaks 0260's single-holder rule.

**Recommendation: Option B.** The helper is already the designated holder, the gateway gets no socket and no custom parser, and the new route is read-only and limited to one project. Option A is the fallback if the owner rules that the helper must not grow. The choice is an owner decision; this document does not make it for the owner. (Operator checks with `docker stats` need no change; the operator uses the socket from the workstation shell, not from a container.)

## 9. Mind-host route through Caddy (T-15)

Path: `otel-agent` on each Mind host (outside the player containers, 4.6) posts OTLP/HTTP protobuf to `https://otel.<domain>/v1/{traces,logs,metrics}` with `Authorization: Bearer <token>`. Caddy checks the token and forwards to the gateway's loopback publish. Only POST passes (other methods get 405); a missing or wrong token on the three OTLP paths gets 401; any other path gets 404.

The site file is `deploy/caddy/otel.caddy` with a kill switch `deploy/caddy/otel-off.caddy` (the 0094 pattern in `deploy/caddy/README.md`). Load with `caddy validate` then `caddy reload` through `docker exec` (0096 item 1). Placeholders are env values (`GELDAR_DOMAIN`, `GELDAR_OTEL_UPSTREAM`, `GELDAR_OTEL_INGEST_TOKEN`); none is written in the file.

```caddyfile
# OTLP/HTTP ingest for Mind hosts (T-15; decisions 0071, 0096, 0350). Load this file, then `caddy validate` and `caddy reload`.
# Placeholders: GELDAR_DOMAIN, GELDAR_OTEL_UPSTREAM (the gateway's loopback publish, host:port), GELDAR_OTEL_INGEST_TOKEN (bearer token).
otel.{$GELDAR_DOMAIN} {
	# Only OTLP posts pass.
	@not_post not method POST
	handle @not_post {
		respond 405
	}

	# Drop any address header a client sent; Caddy sets the one it vouches for.
	request_header -x-geldar-client-ip
	request_header -X-Forwarded-For
	request_header -CF-Connecting-IP

	header {
		-Server
		X-Content-Type-Options nosniff
	}

	# Authenticated ingest: the three OTLP/HTTP paths with the bearer token.
	@ingest {
		path /v1/traces /v1/logs /v1/metrics
		header Authorization "Bearer {$GELDAR_OTEL_INGEST_TOKEN}"
	}
	handle @ingest {
		# 8 MiB: a 2048-span batch is about 2.5 MB (section 6); the cap stops oversize posts.
		request_body {
			max_size 8MiB
		}
		reverse_proxy {$GELDAR_OTEL_UPSTREAM} {
			header_up Host localhost
			header_up x-geldar-client-ip {remote_host}
		}
	}

	# The same paths without a valid token.
	@signal path /v1/traces /v1/logs /v1/metrics
	handle @signal {
		respond 401
	}

	# Every other path is 404.
	handle {
		respond 404
	}
}
```

Points to settle before this is loaded (all **UNVERIFIED** until tested on the node):
- **F4, token in the reload environment.** Caddy substitutes `{$VAR}` when the CLI parses the file. `caddy reload` runs in a `docker exec`, so the token must be in that exec's environment (`docker exec -e GELDAR_OTEL_INGEST_TOKEN ...`), which is visible to root on the node and in shell history if typed. The alternative is a file placeholder (`{file./path}` in Caddy 2) read by the Caddy process; check the node's Caddy version before choosing. Either way the token stays out of the repo.
- **F5, comparison.** The `header` matcher compares strings; it is not constant-time. The risk is low for a long random token over TLS, but the token must be at least 32 random bytes.
- **F6, Mind host side.** The token is on the Mind host. The model child runs as another uid and does not inherit the supervisor's environment (4.6, T-14). That isolation is what keeps the token from the model; it is tested in T-14's HC-26 extension, not assumed.
- **Public surface.** The route rides the shared Caddy's existing HTTPS ingress, so no new public port is added. It is a new public hostname, and 0096's list of public routes must name it (section 10).

## 10. Portscan, expected endpoints and decision amendments

- `tools/portscan`: the expected open-port list does not change if the route rides the existing HTTPS listener (0071). Confirm by running the scan after the Caddy reload; a new listener would be a new port and needs its own decision.
- The expected public hostname list changes: add `otel.<domain>` (owner-held value, not in the repo). Where the list lives in the repo is named in the T-15 packet; **UNVERIFIED** location.
- The loopback-ports check changes: allow exactly one new publish, `127.0.0.1:<port>:4318` on `otel-gateway` in `compose/colo-otel.yml`; allow `otel-gateway` with limits; refuse any other publish. This is the same pattern as `compose/colo-public.yml` (0096 item 5).
- **Amend 0071** (public endpoints and ports): the OTLP ingest is an additional public hostname on the existing HTTPS ingress, authenticated by bearer token; no new TCP port.
- **Amend 0096** (public topology as built): add the `otel` route to the list of Caddy sites, with its kill switch.
- **0350** already records the amendments of 0088 (labels, content) and the public ingress; this document adds no further 0350 change, but 0350's open item "owner approvals still needed" stays open until section 14 is approved.
- The spec is not edited (0073).

## 11. NATS monitor (T-09)

- The `nats-exporter` runs in the NATS network namespace (`network_mode: service:nats`) and reads the monitor on loopback there. It is scraped by the gateway as `nats:<exporter port>` on the colo network.
- Scope: `/varz` and `/jsz` only. The exporter's flags must enable only those endpoints (**UNVERIFIED** flag names for the pinned release, 0.20.3 per the survey); `/subsz`, `/connz` and `/routez` stay off, because `/subsz` reveals which agents are watched (0350 item 9, `docs/runbooks/kino.md`).
- The NATS monitor port is not published (the exporter reads it inside the namespace). The exporter's own port is also not published.
- Image: `natsio/prometheus-nats-exporter:0.20.3`, digest `sha256:4b8ddc1c86fec360b5cd3d5e1fbc6fb52bdafd5805bba3901cc52926538af255` (survey 9.0; re-read at implementation time, **UNVERIFIED** for this packet).
- Adding this service does not restart NATS when the NATS service itself is unchanged; the T-09 packet confirms with `docker compose` dry run (**UNVERIFIED**).

## 12. Postgres monitoring role (T-10)

A separate read-only role, created once by the migration role. Its password comes from a file secret (`/run/secrets/otel-pg.txt`), not from the repo. Placeholders in angle brackets.

```sql
-- Run once, as the migration role. The password is read from a secret file at runtime; it is not written here.
CREATE ROLE <monitoring role> LOGIN;
ALTER ROLE <monitoring role> PASSWORD :'otel_pg_password';   -- psql variable from the secret file
GRANT pg_monitor TO <monitoring role>;
GRANT CONNECT ON DATABASE <application database> TO <monitoring role>;
```

- `pg_monitor` lets the role read other sessions' query text in `pg_stat_activity` (**UNVERIFIED** effect on literal values). That is a content path, and 0350 allows content in telemetry, so this is recorded, not a blocker. It is listed as a risk.
- The role has no write grant, no `CREATE`, and is not a superuser.
- `pg_stat_statements` is not part of T-02 or T-10 by default: it needs `shared_preload_libraries` and a Postgres restart (survey card T-10), which is its own node request.
- The postgres receiver's query samples are off (they need `pg_monitor` and a parent span link; survey 9.8).

## 13. Budget, alarms and retention

Budget (0350 item 5): 100 GB for Geldar's telemetry in ClickHouse; alarm at 70 GB; node-wide alarm when `/mnt/nvme` passes 60%; stop and ask the operator if the estimate passes 100 GB.

**Finding F7, the budget cannot be enforced per tenant as written.** 0350 says "the Geldar database holds only Geldar's data". It does not. SigNoz writes into one ClickHouse with the other tenant's data (survey 1.2: the `signoz-clickhouse` volume is 60 GB, about 345 MB a day from the other tenants). Geldar data is identifiable only by resource attributes (`service.namespace=geldar`, `deployment.environment.name=colo`). Options:
- measure Geldar's share by a scheduled query on the SigNoz ClickHouse, filtered by those attributes (**UNVERIFIED** table and column names; SigNoz keeps traces, logs and metrics in separate databases);
- or ask the owner for a separate ClickHouse for Geldar (a new node stack, a separate packet, not in T-02).

The 70 GB alarm is therefore an alarm on the measured Geldar share, and the 100 GB stop is a rule for the operator. Both are owner-level choices and are listed in section 14.

Alarms:
- **Geldar share 70 GB**: a SigNoz alert (metrics or a scheduled query) on the measured value above; the channel is not chosen (0350 open item), so the alert goes to operators only (0350 item 8).
- **Node `/mnt/nvme` above 60%**: `system.filesystem.utilization` from `hostmetrics` for that mount point, alarm at 0.6 (survey 1.2: the NVMe data disk has 1.2 TB free as of the sample). This is node-wide, so it covers other tenants too.
- **Queue volume**: a separate alarm (section 6).

Retention (0350 item 5, one year):
- SigNoz's retention is one setting per signal for the whole workspace (survey 9.6; Settings, Workspace, Retention). Setting it to 365 days for traces, logs and metrics changes the other tenant's retention too.
- The setting applies only to newly ingested data.
- Current values are **UNVERIFIED** (the metadata directory is root-only, survey 1.2). Read them in the UI before any change and record them in the T-02 report.
- Steps (owner-approved, workspace-level): open the workspace retention page, set traces, logs and metrics to 365 days, save; then check the ClickHouse TTL on the three tables after the next merge, using the read-only query in section 16. The API path (`/api/v1/settings/ttl` or similar) **UNVERIFIED**; use the UI unless the API is checked.
- "Hard TTL" for Geldar data (0350 item 5) is not achievable per tenant inside a shared ClickHouse; it is a workspace setting. This is finding F8, for the owner.
- Retention is not a per-life erasure (0350 item 3, known gap); section 14 keeps it open.

Size estimate (0350 item 5 and survey 5.5): about 0.1 to 0.15 GB a day after compression, which is about 37 to 55 GB for a year. That is inside 100 GB, but only if the estimate holds; measure it in the first week of data.

## 14. Owner approvals and the geldar-93 requests

Each manual node step below is a separate request to the orchestrator geldar-93, with its own caps, window and rollback. Nothing here is run by this document.

| # | Node step | Caps | Window | Rollback | Owner approval |
|---|---|---|---|---|---|
| N1 | Read-only checks: free loopback port (`ss`), SigNoz network name, containers on that network (names only), Caddy version, cgroup layout, NATS monitor port, current SigNoz retention values | read-only; no writes | any time | none needed | no |
| N2 | Create the queue directory (or loop-mounted fixed-size image) for `file_storage` | 1 GiB | low-load window | remove the mount, then the directory | no |
| N3 | Merge `compose/colo-otel.yml` and start `otel-gateway` through the normal deploy (`colo-up.sh` last step, gated by env) | 0.5 CPU, 512 MiB, 128 pids | low-load window, Paper not restarted | unset the gateway env and recreate the Geldar services through CD; the SDK goes off when the endpoint is unset (T-03); then remove the gateway service | yes (new network join, new loopback port) |
| N4 | Start `nats-exporter` (NATS namespace) | 0.1 CPU, 64 MiB, 64 pids | any window (no NATS restart) | remove the service; NATS untouched | no (scope within `/varz` and `/jsz` already approved) |
| N5 | Create the monitoring role (SQL, section 12) | none | low-load window | `DROP ROLE` after `REASSIGN OWNED` checks (none owned); revoke grants first | yes (database role) |
| N6 | Caddy route: copy `deploy/caddy/otel.caddy`, add the import line, `caddy validate`, `caddy reload` through `docker exec` (never restart Caddy, 0071 item 6) | none | window with no Caddy reload in progress | put `otel-off.caddy` in place of the live file, validate, reload; the Mind host's exporter then fails silently (bounded, dropping) | yes (public route, 0071 and 0096 amendments, exact config; the survey's card T-15 and 0350 item 4) |
| N7 | SigNoz retention change (section 13) | none on the node; storage grows | after the owner's sign-off | set the previous values back in the UI; data already ingested is not restored | yes (workspace-wide, affects the other tenant) |
| N8 | SigNoz alert rules (Geldar share, `/mnt/nvme`, queue) | none | any | disable the rule | yes (alert channel not chosen) |
| N9 | Mind-host `otel-agent` install (client side, owner's machine) | agent caps 0.25 CPU, 256 MiB | owner's session | stop and remove the agent; the supervisor's exporter goes silent | yes (token) |
| N10 | Helper read-only stats route (Option B, section 8) | helper unit as is | separate window | remove the route and redeploy the helper | yes (root-run unit change) |

Each request carries: the step number, the exact command or file, the caps above, the window, the rollback, and the verification in section 16. Steps N2 to N4 are needed for T-02 itself; N5 to N10 are needed by later cards and can wait.

## 15. Compose and deploy files (for the implementation packet only)

- `compose/colo-otel.yml`: the overlay (service, networks, caps, loopback publish, env gating). Merged over `colo.yml` only when `GELDAR_OTEL_ENABLED` is set, as `colo-kino.yml` is merged only when Kino is on.
- `deploy/otel/gateway.yaml`: the Collector config in section 5, read-only bind.
- `deploy/caddy/otel.caddy` and `deploy/caddy/otel-off.caddy` (section 9).
- `deploy/colo-up.sh` and `deploy/common.sh`: add the overlay merge gated by env, with a refusal when the SigNoz network variable is missing (the same style as the public overlay, 0096).
- `tools/repo-checks`: the loopback allow-list entry (section 10) and a test that no overlay mounts `docker.sock`.
- Env names only (values stay out of the repo and the Mind host's files): `GELDAR_OTEL_ENABLED`, `GELDAR_SIGNOZ_NETWORK`, `GELDAR_SIGNOZ_OTLP_ENDPOINT`, `GELDAR_OTEL_UPSTREAM`, `GELDAR_OTEL_INGEST_TOKEN`, `GELDAR_OTEL_ENDPOINT` (the Geldar services' endpoint, `http://otel-gateway:4318`), `GELDAR_COLO_OTEL_GATEWAY_CPUS`, `GELDAR_COLO_OTEL_GATEWAY_MEM`, `GELDAR_OTEL_PG_PASSWORD_FILE` (the secret file's path, under the secrets directory).

## 16. Verification checklist

SigNoz (read through the viewer-role key on the workstation only; no change to the other tenant's views):
- Services `geldar-*` appear with `service.namespace=geldar` and `deployment.environment.name=colo`.
- A Geldar trace has `geldar.life_id` (or `life_id`, per the T-03 name) on the span, and no life or player label on any metric series. Query metric label names: none of `geldar.life_id`, `player_id`, `token`, `email`.
- Logs contain no IPv4 or IPv6 literal in the body where Paper logs `logged in with entity id ... [/<address>]`: search for the literal `[/` followed by digits; expect zero hits.
- No `Thread RCON Client ... started|shutting down` lines; `[Rcon:` echoes present.
- No attribute named `user.email`, `*token*`, `*password*`, `*authorization*`, `*cookie*`.
- Queue: `otelcol_exporter_queue_size` below capacity under normal load; `otelcol_exporter_send_failed_*` flat; `otelcol_processor_refused_*` zero (memory limiter not triggering).
- `nats` series present (`/varz`, `/jsz`) and no `subsz` or connection series.
- `postgresql` series present; the monitoring role cannot write (negative test with a `psql` `INSERT` as that role, expecting permission denied).
- Retention: the values read in N1 and the value set in N7, recorded.
- Geldar share of ClickHouse bytes (the measured value from section 13) recorded daily for the first week.

Docker stats (operator, from the workstation or the host shell; read-only verbs only):
- `docker stats --no-stream` for `geldar-colo-otel-gateway` (or the project's name): CPU at or below 0.5, memory at or below 512 MiB, PIDs at or below 128.
- The same for `nats-exporter` (0.1 CPU, 64 MiB).
- `docker inspect` of the gateway: no `docker.sock` in `Mounts`; `ReadonlyRootfs` true; `CapDrop` contains ALL; the logging driver is `json-file` with 10 MiB and 3 files.
- Node load: `docker stats` of the Paper and Body containers before and after N3, with the same window, to show no regression (the survey's sample: 1 of 16 CPUs in use).
- The `/mnt/nvme` utilisation reading (`df`), and the queue directory's use, after the first day.

Negative tests (T-02 implementation):
- Caddy: a request without the token gets 401; with a wrong token 401; a GET gets 405; a path other than the three gets 404; a body over 8 MiB gets 413.
- Config: `otelcol validate` passes; the RCON and address fixtures behave as in section 5.

## 17. Rollout and rollback summary

Order: N1, N2, N3 (gateway, with Geldar services still on their default and their endpoint unset, so no change for them), then Geldar services switched on one by one by the T-03 and T-06 to T-08 cards (each its own change), then N4, N5, N6 (Caddy, after the owner approves), then N7 and N8 (after data flows), N9 at the owner's pace.

Rollback for the whole T-02 stack, in order: unset `GELDAR_OTEL_ENABLED` and recreate the Geldar services through CD (their SDKs go off); stop and remove `otel-gateway` and `nats-exporter` (only those two services, `docker compose ... rm -s`); put `otel-off.caddy` in place and reload; drop the monitoring role; restore the retention values; remove the queue directory. Each step leaves the other services running.

## 18. Risks

1. **Shared SigNoz.** Another tenant's stack has no CPU or memory limit and no `memory_limiter`, and its OTLP ports are published on all interfaces without a key (survey 1.2). If the gateway's network join puts it next to other tenants' containers, any container on that network can write into Geldar's data or the other tenant's. Mitigation: the join is recorded; the other tenant's containers on that network are listed in N1; the owner decides (F9).
2. **Shared ClickHouse budget and retention** (F7, F8).
3. **Docker-network coupling.** Joining the other tenant's network couples the stacks (survey 4.1). The alternative is `host-gateway` to the published 4317, which uses the all-interfaces port; that depends on the node firewall, which is unverified (survey 1.2). Not chosen here.
4. **Host `/proc` and `/sys` read-only mounts** expose host process data (F3); mitigated by disabling the process scraper.
5. **Disk cap** (F2): no native byte cap; a volume or a derived queue size is needed.
6. **Token on Mind hosts** (F6, F4); a leaked token lets anyone write telemetry into Geldar's data (not read it). Rotation is a manual step; a rotation procedure is needed before N9.
7. **Public hostname** (section 10); the expected list must be updated before the first scan after N6.
8. **Trace-context leakage to the model.** No telemetry word or trace id may reach a model-readable surface (0350 item 7, T-19). The gateway is not in the model's path, so it is not a leak by itself; the SDK and the kit's env handling (T-14) are.
9. **Image pin drift**: the digest recorded here is a survey value (section 3); a newer contrib release is not used until its own two-week window.
10. **Content in SigNoz** (0350 items 2 and 3): the one-year, full-content policy applies to telemetry; erasure per life is a KNOWN GAP (0350 item 3) and must be closed before any outside player's agent runs.
11. **`pg_monitor` reads query text** (section 12).
12. **Gateway down**: the SDK drops silently after its bounded queue (T-03). Data loss during an outage is accepted by design (0350 item 7), and the start-record and absence alerts (survey 4.7) detect it.
13. **Operator error**: a wrong `caddy reload` (without the token variable) would route all traffic to 401. The reload is validated first, and the kill switch is one file swap.

## 19. Findings for the orchestrator

- **F1**: T-02 says "OTLP on the colo network only"; Caddy needs a loopback publish (section 4 and 9). Owner to confirm the exception.
- **F2**: the file queue has no native byte cap in 0.164.0 (**UNVERIFIED**); section 6 gives two options.
- **F3**: host `/proc` mount exposes the process list; the process scraper is off.
- **F4**: the Caddy token would enter the reload environment; choose the placeholder mechanism after checking the Caddy version.
- **F5**: header comparison is not constant-time (low risk; token length rule).
- **F6**: the Mind host holds the ingest token; isolation by uid is the control, tested in T-14.
- **F7**: 0350's "Geldar database" is not a separate database; the 100 GB budget is measured from a shared ClickHouse (section 13).
- **F8**: retention is a workspace setting; the one-year rule changes the other tenant's retention. Owner decision.
- **F9**: joining the other tenant's network is a trust decision; the alternative is `host-gateway`. Owner decision.

## 20. Sources

- Telemetry survey, 2026-11-15: sections 1.2, 1.3, 4.1, 4.2, 4.5, 4.6, 4.7, 5.5, 6, 7 (T-02, T-04, T-09, T-10, T-15), 9.0, 9.6, 9.7.
- Decisions: 0350 (accepted 2026-11-15), 0082 (proposed, 2026-11-10), 0071 (accepted 2026-11-10), 0096 (proposed 2026-11-11), 0260, 0088.
- Repo: `compose/colo.yml` (anchors and limits, 0082 pattern), `compose/colo-kino.yml` (overlay pattern), `compose/colo-public.yml` (single-publish overlay pattern, 0096 item 5), `deploy/caddy/mcp.caddy` and `deploy/caddy/README.md` (site-file pattern, reload rule, kill switch).
- Not checked in this session: the registry digest, the node's network names, cgroup layout, Caddy version, SigNoz retention values, the exporter flag names, and the OTTL function names. Each is marked **UNVERIFIED** above and is a read-only check in N1 or a test in T-02.
