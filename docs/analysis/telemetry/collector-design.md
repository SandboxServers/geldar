# Geldar Collector: design (T-02)

Status: design only. Written 2026-11-15 for card T-02 of the telemetry survey; aligned on 2026-11-16 with decision 0352 option B. Nothing here is built, merged or switched on. No compose overlay or deploy file is added by this document; those come in the implementation packets, after the owner approvals in section 14.

Governing records: [0350](../../decisions/0350-telemetry-scope-and-full-capture.md) (scope, full capture, one-year retention, 100 GB budget, operator-only readers; clarified 2026-11-16), [0352](../../decisions/0352-telemetry-dedicated-clickhouse-database.md) (option B: Geldar-owned ClickHouse server and SigNoz stack on a Geldar-owned network; caps, budget, TTL, loopback UI, read-only user), [0082](../../decisions/0082-colo-compose-network-and-limits.md) (compose layout, limits, log limits), [0071](../../decisions/0071-public-endpoints-and-ports.md) and [0096](../../decisions/0096-public-topology-as-built.md) (public endpoints, shared Caddy), [0260](../../decisions/0260-body-container-control-by-host-helper.md) (no Docker socket in containers), [0088](../../decisions/0088-metrics-exporters-and-replay-window.md) (metric labels, amended by 0350).

Source for the facts: the telemetry survey of 2026-11-15 (sections 1.2, 1.3, 4.1, 4.2, 4.5, 6, 7, 9.6, 9.7) and the 0352 fit check (read-only node measurement, 2026-11-15). Anything not checked in this session is marked **UNVERIFIED**. Values this document proposes are marked **PROPOSED**.

## 1. Scope and non-goals

In scope: the Geldar Collector gateway on the Colo (`geldar-gateway`, formerly `otel-gateway`); the Geldar-owned SigNoz stack on the Geldar network (ClickHouse server, keeper if needed, migrator, query service, SigNoz-side collector, UI); host metrics; NATS and Postgres scrape paths; caps, budget, alarms, retention; rollout and rollback; verification; risks.

Out of scope: the other tenant's SigNoz stack, ClickHouse, network and configuration (never changed, never joined; 0352, 0350 item 4); the SDK (T-03); the Paper agent (T-11); the Mind-side exporter (T-13); dashboards (T-17). The Mind-host ingest route is decided for ingest only: a Caddy route (section 9, caddy-ingest-route.md), owner ruling 2026-11-16.

## 2. Topology

```
Colo node (16 CPUs, 128 GB RAM, /mnt/nvme 1.8 TB; fit check 2026-11-15, 0352)
  network geldar-colo (compose/colo.yml and compose/colo-otel.yml)
    nats <-- nats-exporter (network_mode: service:nats)                              [T-09]
    postgres <-- postgresql receiver, monitoring role                                 [T-10]
    Geldar services, paper, velocity --OTLP/HTTP--> geldar-gateway:4318
    geldar-gateway --127.0.0.1:<port>:4318--> Mind-host route on the shared Caddy (section 9; decided 2026-11-16 for ingest only)
  network geldar-telemetry (new, Geldar-owned; compose/colo-telemetry.yml)           [PROPOSED name]
    geldar-gateway --OTLP gRPC--> geldar-signoz-otelcol:4317 --> geldar-ch (ClickHouse 26.3)
    geldar-signoz-query --> geldar-ch;  geldar-signoz-ui --> geldar-signoz-query
    geldar-signoz-migrator (one-shot) --> geldar-ch
    geldar-ch-keeper (only if the keeper rule in section 4 needs it)
    published: geldar-signoz-ui 127.0.0.1:<ui port>:<ui port inside>; geldar-ch 127.0.0.1:<http port>:8123 (optional read path)
  host /proc, /sys, /mnt/nvme (read-only): hostmetrics (section 8)

Operator workstation: SSH local port forward to the node's 127.0.0.1 ports (UI; ClickHouse HTTP if used). No Caddy route.
Other tenant's stack (its network, its ClickHouse, its collector): not joined, not published to, not changed (0352).
```

Rules: no service publishes a port except the loopback ports named here; no container mounts the Docker socket (section 8); the other tenant's containers and configuration are untouched; no change to the shared Caddy except the ingest route (section 9, ruling 2026-11-16), and no restart of it except the one owner-approved recreate for the ingest token. Loopback port numbers are chosen at implementation and checked free by read-only `ss` (N1). **UNVERIFIED**: no free port has been checked.

## 3. Images

- Gateway: `otel/opentelemetry-collector-contrib:0.164.0`, pinned by digest. The survey digest is `sha256:340c9ca6a36617084c6661bdc4f0fe92b7cda5a805d61673ec8db375fddc522b`. **UNVERIFIED for this packet**: read the digest from the registry at implementation time, compare, and record the comparison in the T-02 report. If they differ, stop and ask.
- Release 0.164.0 dated 2026-10-27 (survey 9.0); do not pick 0.165.0 until its two-week window passes.
- Use the snake_case component names of 0.164 (`file_log`, `host_metrics`, `resource_detection`); the old names are deprecated aliases (survey 9.7). Not used: `docker_stats`, the Docker resource detector, `tail_sampling` (0350 keeps 100% of traces).
- Whether the contrib image runs as non-root is **UNVERIFIED** (check `docker inspect` of the pulled image).
- Stack images (**PROPOSED**, all **UNVERIFIED**): ClickHouse server 26.3 (version named by 0352); one SigNoz release for query, UI, collector and migrator, at or above 0.135 if V2 dashboards are wanted (0352 risk 2). The exact tags and digests are chosen at N4 and N5, at least two weeks old, and must match the MCP server version (section 18).

## 4. Services, network, ports and caps

Gateway and exporter:

| Service | Networks | Published | Caps (cpus, mem, memswap, pids) | Notes |
|---|---|---|---|---|
| `geldar-gateway` | `geldar-colo`, `geldar-telemetry` | none, or one loopback port if section 9 is decided | 0.5, 512m, 512m, 256 | `GOMEMLIMIT=400MiB`, read-only root, `cap_drop: ALL`, healthcheck on the in-container health extension |
| `nats-exporter` | `network_mode: service:nats` | none | 0.1, 64m, 64m, 64 (pids **UNVERIFIED** choice) | scrapes the NATS monitor on loopback inside the NATS namespace |

Geldar stack (0352 table; all on `geldar-telemetry`; **PROPOSED** caps, not measured):

| Container | Role | cpus | mem_limit | memswap | pids | Host disk path |
|---|---|---|---|---|---|---|
| `geldar-ch` | ClickHouse 26.3, Geldar server | 3.0 | 8g | 8g | 1024 | `/mnt/nvme/geldar-telemetry/clickhouse` (data, logs, config) |
| `geldar-ch-keeper` | Keeper, only if needed (rule below) | 0.5 | 1g | 1g | 256 | `/mnt/nvme/geldar-telemetry/keeper` |
| `geldar-signoz-migrator` | schema migrator, one-shot | 0.5 | 512m | 512m | 128 | none |
| `geldar-signoz-query` | query service (MCP and UI back end) | 1.0 | 1g | 1g | 256 | `/mnt/nvme/geldar-telemetry/query` |
| `geldar-signoz-otelcol` | SigNoz collector, writes to `geldar-ch` | 0.5 | 1g | 1g | 256 | none (bounded in-memory queue) |
| `geldar-signoz-ui` | SigNoz frontend, loopback only | 0.25 | 256m | 256m | 64 | none |

Rules:
- Totals: the long-running containers (ClickHouse, keeper if used, query, SigNoz collector, gateway) are 5.5 CPUs and 11.5 GiB at the caps. With the UI and the one-shot migrator: 6.25 CPUs and 12.25 GiB. These are ceilings, not usage (0352 fit check: 29 GB of 128 GB used on 2026-11-15).
- **F11, gateway pids**: 0350 item 9 and 0082 give the gateway 128 pids; the 0352 table gives 256. This design uses 256 (the 0352 table, as the brief directs). The orchestrator reconciles it.
- Keeper rule (0352, **UNVERIFIED** until checked on SigNoz 0.135 or later and ClickHouse 26.3): prefer no keeper if the migrator's schema runs on one node; otherwise embedded ClickHouse Keeper inside `geldar-ch` if supported; use `geldar-ch-keeper` only if neither works. The other tenant's `signoz-zookeeper-1` is not used.
- Every container: `json-file` log limits as in 0082 (this document's anchor is 10m and 3 files, **UNVERIFIED** against the 0082 text at implementation), `restart: unless-stopped` except the migrator, `memswap` equal to `mem_limit`.
- Gateway networks: `geldar-colo` and `geldar-telemetry`, both Geldar-owned. No external network, so no network name is passed in by variable.
- Gateway publish: `127.0.0.1:<port>:4318` for the section 9 Caddy ingest route (decided 2026-11-16, ingest only).
- `geldar-ch` publishes only `127.0.0.1` HTTP, and only if the optional SSH-tunnelled read path is used (0352). No ClickHouse native port is published.

## 5. Pipelines

The Collector's `service.pipelines` (order matters; `memory_limiter` first in every pipeline; a sketch, not a final file):

```yaml
receivers:
  otlp:
    protocols:
      grpc: {endpoint: 0.0.0.0:4317}   # geldar-colo and geldar-telemetry only; not published
      http: {endpoint: 0.0.0.0:4318}
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
        - 'IsMatch(body, ".*Thread RCON Client .*(started|shutting down).*")'   # keep [Rcon: ...] echoes
    traces:
      span:
        - 'attributes["http.route"] == "/healthz"'   # route name to confirm
  transform/redact:
    error_mode: ignore
    log_statements:
      - context: log
        statements:
          - 'replace_pattern(body, "(?:\\d{1,3}\\.){3}\\d{1,3}", "<addr>")'   # IPv4 in Paper's login lines; IPv6 pattern written in T-02
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
  batch: {send_batch_size: 2048, timeout: 5s}   # PROPOSED; not tuned
exporters:
  otlp/geldar_signoz:
    endpoint: ${env:GELDAR_SIGNOZ_OTLP_ENDPOINT}   # geldar-signoz-otelcol:4317 on geldar-telemetry; port UNVERIFIED
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
    traces:  {receivers: [otlp], processors: [memory_limiter, resource, filter/noise, transform/redact, batch], exporters: [otlp/geldar_signoz]}
    logs:    {receivers: [otlp], processors: [memory_limiter, resource, filter/noise, transform/redact, batch], exporters: [otlp/geldar_signoz]}
    metrics: {receivers: [otlp, prometheus, postgresql, hostmetrics], processors: [memory_limiter, resource, transform/metric_labels, batch], exporters: [otlp/geldar_signoz]}
```

Notes:
- OTTL function names and regex escaping are **UNVERIFIED** against 0.164.0. T-02 checks each statement with `otelcol validate` (run inside the image) and a fixture that feeds a Paper address line and a `Thread RCON Client` line through the pipeline.
- Trace context is forwarded as `traceparent` and `tracestate`, not Baggage (0350 item 7).
- The exporter's only downstream is the Geldar collector. No other tenant's collector is named anywhere in this file.

## 6. Sending queue and disk cap

- `file_storage` holds the persisted queue on a named volume, `/var/lib/otelcol/queue`. A restart of the Geldar collector loses nothing that is queued (survey 4.1).
- `queue_size` counts requests (default 1,000); with `block_on_overflow: false` the queue drops when full (survey 9.7).
- **F2**: `file_storage` and `sending_queue` count items, not bytes, in 0.164.0 (**UNVERIFIED** that no byte cap exists). The disk cap is therefore a bound on the volume itself: a fixed-size volume (N2) with `queue_size = cap_bytes / largest_request_bytes` (about 400 items for 1 GiB at 2.5 MB a request; **UNVERIFIED** estimate). Options and their recommendation are in `collector-options.md` F2.
- Alarm on the queue directory's `system.filesystem.utilization` (section 13).

## 7. Caps, logs and hardening

- `deploy.resources.limits`: `cpus: "${GELDAR_COLO_OTEL_GATEWAY_CPUS:-0.5}"`, `memory: "${GELDAR_COLO_OTEL_GATEWAY_MEM:-512m}"`, `pids: 256` (F11, section 4).
- `GOMEMLIMIT=400MiB` (80% of 512 MiB). The `memory_limiter` soft limit is 400 MiB with an 80 MiB spike.
- Gateway logs at `warn`. Log limits as section 4.
- Read-only root, `tmpfs` for `/tmp`, the queue volume as the only writable path, `cap_drop: ALL`, `security_opt: [no-new-privileges:true]`.
- Config is a read-only bind of `deploy/otel/gateway.yaml`. Secrets are read-only binds; the gateway has no ClickHouse credential.
- No `docker.sock` mount in any Geldar telemetry container (0260, 0350 item 9), checked by a repo test on the overlays.

## 8. Host metrics without the Docker socket

Node-wide: bind the host `/proc` and `/sys` read-only only as the options in `collector-options.md` F3 allow (recommended: container procfs for CPU, memory and load; `/mnt/nvme` bound read-only for the disk alarm; the process scraper disabled). **UNVERIFIED** that `hostmetrics` honours `root_path` for every scraper in 0.164.0, and whether the container's `/proc/net/dev` shows node values.

Per-container (the caps check in section 16, for both Geldar projects): `docker_stats` needs the socket and is ruled out (0260, 0350 item 9). Two substitutes:
- **Option A, read-only cgroup reads**: mount the host cgroup tree read-only and read `cpu.stat`, `memory.current` and `pids.current` under the per-container scopes (cgroup v2 `docker-<id>.scope`, **UNVERIFIED** on the node). Cost: a custom reader to review.
- **Option B, a read-only stats route on the host helper**: the helper already holds the socket (0260). It adds one loopback-only `GET` route for the Geldar projects. The gateway scrapes it with the contrib `prometheus` receiver. Cost: a root-run unit change with its own review (N15).

**Recommendation: Option B**, with Option A as the fallback if the owner rules that the helper must not grow. The owner decides. Operator checks with `docker stats` need no change: they run from the workstation shell, not from a container.

## 9. Mind-host ingest through the shared Caddy (T-15)

**Status (owner ruling, geldar-93, 2026-11-16): APPROVED IN PRINCIPLE, FOR OTLP INGEST ONLY.** The owner ruled that the OTLP ingest gets a Caddy route on the shared Caddy, authenticated with the ingest token the owner already holds. This replaces the earlier interim "option C, Colo-only" and the earlier "no shared-Caddy change" ruling, for the ingest route only. The SigNoz UI is not affected: it stays SSH-tunnel only with no Caddy route (section 2, 0352 read path). The exact config is in `docs/analysis/telemetry/caddy-ingest-route.md`. Nothing is loaded by this document. Each node change to Caddy (the first env secret and recreate, each load, any rollback) needs the owner's approval at the time.

Path: the `otel-agent` on each Mind host (outside the player containers, 4.6) posts OTLP/HTTP protobuf to `https://{$GELDAR_INGEST_HOST}/v1/{traces,logs,metrics}` with `Authorization: Bearer <ingest token>`. The shared Caddy terminates TLS, checks the token, applies the body and rate limits, and reverse-proxies to the gateway's loopback publish `127.0.0.1:<port>` (the port is chosen at N1). The gateway then exports to the Geldar SigNoz collector on the Geldar network (section 5).

Route rules (each is tested in T-15; the checks are in section 14 and in `caddy-ingest-route.md`):
- **Hostname**: one new public hostname, given only as an env placeholder. The value is owner-held and not in the repo. It is added to the public route list by the amendments in section 10.
- **TLS**: Caddy's automatic certificate for that hostname. No plain-HTTP listener is added for it.
- **Methods**: only POST passes; any other method gets 405.
- **Paths**: only `/v1/traces`, `/v1/metrics` and `/v1/logs`. A missing or wrong token on those three gets 401. Any other path gets 404.
- **Token check**: a header matcher on `Authorization: Bearer <token>`, with the token read from the Caddy environment. **Constant-time compare: Caddy does not provide one for this check.** The `header` matcher compares strings with ordinary equality, and stock Caddy has no bearer-token directive with a constant-time compare. Used instead: a token of at least 32 random bytes, generated by the owner, so a timing probe over TLS gains nothing usable in practice. Unverified against the node's Caddy version; check at N1. The token must not be empty: an unset variable would make the matcher `Bearer ` (see the validation step in `caddy-ingest-route.md`).
- **Body limit**: `request_body` `max_size 8MiB` at site level. A 2048-span batch is about 2.5 MB (section 6); a larger post gets 413.
- **Rate limit**: **stock Caddy has no rate-limit directive.** The route needs a third-party `rate_limit` module compiled into a custom Caddy image, pinned by version and digest and reviewed like any other pin. There are two zones: one for authenticated OTLP posts and one for requests that fail the token check, so token guessing is limited too. The numbers are PROPOSED in `caddy-ingest-route.md`. If the node's Caddy has no such module, the route is not loaded.
- **Logs**: Caddy must not log the `Authorization` header. The site's `log` block uses the filter encoder to delete that field before the line is written. The T-15 test sends a request with a test token (never the real one) and checks the access log.
- **Headers**: the route drops any client-sent address header and sets the one Caddy vouches for, as `deploy/caddy/mcp.caddy` does. The upstream Host is `localhost`, because the gateway accepts only loopback names.
- **Surface**: a new public ingress, named in the amendments to 0071 and 0096 (section 10).

Token handling. The owner places the ingest token; its value is never written in the repo, a compose file, a log or a chat:
- on the node, as a Caddy environment secret, read by the Caddy process through `{$GELDAR_INGEST_TOKEN}`;
- in the gateway and exporter environment, for the gateway-side check if T-02 uses one;
- on each Mind host, as the OTEL headers environment of the `otel-agent` only.

It is kept out of the repo, the compose files and the logs, and Caddy must not log the header (above). The Caddy environment is visible to root on the node (through `docker inspect`); that is the same trust as the node's root and is accepted. A running Caddy process sees a new or rotated environment secret only after its container is recreated, so each such change is one restart of the shared Caddy, with the owner's approval at the time.

Findings carried from the 2026-11-15 draft:
- **F1, gateway loopback publish**: needed by this route, `127.0.0.1:<port>:4318` only.
- **F4, token in the reload environment**: resolved by the environment secret. `caddy validate` and `caddy reload` run in the Caddy container, which already holds the variable, so the token is not typed on a command line or into shell history. `docker exec -e` is not used.
- **F5, comparison**: see the token check above; accepted with a 32-byte token.
- **F6, Mind host side**: the token is on the Mind host. The model child runs as another uid and does not inherit the supervisor's environment (4.6, T-14). That isolation is tested in T-14's HC-26 extension, not assumed.

The kill switch is `deploy/caddy/otel-off.caddy`, the 0094 pattern in `deploy/caddy/README.md`.

### 9.1 Decision record: Mind-host ingest

- **Decided (owner ruling, geldar-93, 2026-11-16)**: the Caddy route in section 9, for OTLP ingest only.
- **Superseded for ingest**: the interim "option C, Colo-only" (no Mind-host telemetry) and the "no shared-Caddy change" ruling. Neither is in force for ingest. Both still hold for the SigNoz UI, which has no Caddy route.
- **Not chosen, not built**: the per-host SSH tunnel and the WireGuard alternatives in the 2026-11-15 draft of this section. They are not part of T-15.
- **Still open, for the owner**:
  1. The rate-limit module: its choice, pin and custom image build (section 9, rate limit).
  2. The node's Caddy version and build (read-only, N1). These decide whether the rate-limit module and the token comparison are as described.
  3. Each change to the shared Caddy at the time: the environment secret with one recreate, the load (validate, then reload), and any rollback.
- The UI is unchanged: no Caddy route (section 2).
- For the owner's decision: the rate limit needs a pinned third-party Caddy module in a custom image, and the ingest token secret needs one approved recreate of the shared Caddy container.

## 10. Portscan, loopback allow-list and decision amendments

- `tools/portscan`: the expected open-port list does not change while no Caddy route is added. If section 9 is decided as a Caddy route, confirm by scan after the reload; a new listener would need its own decision.
- The loopback-ports check (`tools/repo-checks/src/loopback-ports.ts`) allows exactly these publishes, each named in its overlay and nothing else: the gateway's loopback port (for the section 9 Caddy ingest route), the SigNoz UI's `127.0.0.1` port, and the optional ClickHouse HTTP `127.0.0.1` port. Each entry carries a limits check. **UNVERIFIED** port numbers.
- Amend 0071 and 0096 for the section 9 Caddy ingest route (decided 2026-11-16); the expected public hostname list then gains `otel.<domain>` (owner-held value, not in the repo).
- 0350 needs no further amendment for this design: item 4 is unchanged (no change to the other tenant), and 0352 records the stack decision.
- The spec is not edited (0073).

## 11. NATS monitor (T-09)

- The `nats-exporter` runs in the NATS network namespace (`network_mode: service:nats`) and reads the monitor on loopback there. It is scraped by the gateway as `nats:<exporter port>` on `geldar-colo`.
- Scope: `/varz` and `/jsz` only. The exporter's flags must enable only those endpoints (**UNVERIFIED** flag names for the pinned release, 0.20.3 per the survey). `/subsz`, `/connz` and `/routez` stay off (0350 item 9, `docs/runbooks/kino.md`).
- Neither the NATS monitor port nor the exporter port is published.
- Image: `natsio/prometheus-nats-exporter:0.20.3`, digest `sha256:4b8ddc1c86fec360b5cd3d5e1fbc6fb52bdafd5805bba3901cc52926538af255` (survey 9.0; re-read at implementation, **UNVERIFIED** for this packet).
- Adding this service does not restart NATS (**UNVERIFIED**; the T-09 packet confirms with a `docker compose` dry run).

## 12. Postgres monitoring role (T-10)

A separate read-only role, created once by the migration role. Its password comes from a file secret (`/run/secrets/otel-pg.txt`), not from the repo. Placeholders in angle brackets.

```sql
-- Run once, as the migration role. The password is read from a secret file at runtime; it is not written here.
CREATE ROLE <monitoring role> LOGIN;
ALTER ROLE <monitoring role> PASSWORD :'otel_pg_password';   -- psql variable from the secret file
GRANT pg_monitor TO <monitoring role>;
GRANT CONNECT ON DATABASE <application database> TO <monitoring role>;
```

- `pg_monitor` lets the role read other sessions' query text in `pg_stat_activity` (**UNVERIFIED** effect on literal values). That is a content path, and 0350 allows content in telemetry; it is a listed risk, not a blocker.
- The role has no write grant, no `CREATE`, and is not a superuser.
- `pg_stat_statements` is not part of T-02 or T-10: it needs a Postgres restart, which is its own node request.

## 13. Budget, alarms, retention and TTL

Budget (0350 item 5, 0352): 100 GB for Geldar's telemetry on `geldar-ch`. Alarm at 70 GB. The budget is measured per server, which is exact because `geldar-ch` holds only Geldar's data (0352, F7 resolved). The 100 GB figure is the owner's ruling and is not raised by an agent.

```sql
SELECT database, sum(bytes_on_disk) AS bytes
FROM system.parts
WHERE active AND database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')
GROUP BY database ORDER BY bytes DESC;
```

Run once a day on `geldar-ch` by the operator's cron or the query service (**PROPOSED** schedule; **UNVERIFIED** that the query service can run it).

Alarms (operators only, 0350 item 8; the channel is not chosen, 0350 open item):
- **Geldar 70 GB**: the sum above is at or above 70 x 10^9 bytes.
- **Budget stop**: the sum passes 100 x 10^9, or the estimate passes 100 GB. The operator stops and tells the owner.
- **Node `/mnt/nvme` above 60%**: `system.filesystem.utilization` from `hostmetrics`, node-wide. It covers the other tenant's data too; it is the only alarm that does.
- **Queue volume**: a separate alarm (section 6).

Retention and TTL (0350 item 5, 0352):
- **Hard TTL of one year (365 days)** on every telemetry table in `geldar-ch`, set in two places: the Geldar stack's SigNoz retention for traces, logs and metrics (it is a setting of the Geldar workspace, so it does not touch the other tenant), and a ClickHouse TTL on each table. Check the TTL after the first merge and again after each SigNoz upgrade, because the migrator may overwrite it (0352 risk 5).
- Table names, the TTL column and the migrator's behaviour on upgrade are **UNVERIFIED**.
- **System-log TTL (our server)**: the `system` log tables of `geldar-ch` (`query_log`, `part_log`, and the rest) get a TTL so they do not grow without limit. **PROPOSED** 30 days; the config keys are **UNVERIFIED** on 26.3.

Size and disk growth:
- Estimate: 0.1 to 0.15 GB a day after compression, about 37 to 55 GB a year (0350 survey estimate, not re-verified). Measure in the first week and record it daily.
- Merges need free disk on the same volume while they run (**UNVERIFIED** peak). The Docker data root on the node's root filesystem had 20 GB free at the sample (0352); whether the data root is on the root filesystem is **UNVERIFIED**.
- Per-life erasure is still a KNOWN GAP (0350 item 3): a ClickHouse mutation on one server, heavy and operator-run. Section 14 keeps it open.

## 14. Owner approvals and rollout requests

Each node step is a separate request to the orchestrator geldar-93, with its own caps, window and rollback. Nothing here is run by this document. Steps N1 to N9 build the Geldar stack and gateway; N10 to N15 are later cards.

| # | Node step | Caps | Window | Rollback | Owner approval |
|---|---|---|---|---|---|
| N1 | Read-only checks: free loopback ports (`ss`), the Geldar network name free, the node's Docker data root, Caddy version, cgroup layout, NATS monitor port | read-only | any | none needed | no |
| N2 | Create the Geldar network `geldar-telemetry` (`docker network create`); no published ports | none | low-load | remove the network after its containers are gone | yes (new Geldar network) |
| N3 | Create the volumes and directories `/mnt/nvme/geldar-telemetry/{clickhouse,keeper,query}` and the gateway queue (1 GiB, fixed-size) with the owner uids of the images (**UNVERIFIED**) | queue 1 GiB; no quota on ClickHouse | low-load | remove the empty directories; keep any data until the owner decides | yes (new data path, disk) |
| N4 | Start `geldar-ch` (and `geldar-ch-keeper` only if the keeper rule needs it), with the writer and reader users and the settings profiles (0352) | 3.0 CPU, 8g; keeper 0.5, 1g | low-load, Paper not restarted | `docker compose rm -s geldar-ch`; keep the data directory | yes (new server, RAM) |
| N5 | Run `geldar-signoz-migrator` (one-shot) against `geldar-ch`; set the 365-day retention on the Geldar stack | 0.5 CPU, 512m | low-load | drop the Geldar database the migrator created (empty at this point; checked first); remove the container | yes (schema, retention) |
| N6 | Start `geldar-signoz-query` and `geldar-signoz-ui` (UI on loopback only) | query 1.0 CPU, 1g; UI 0.25, 256m | low-load | `rm -s` the two containers; remove the UI loopback publish | yes (UI access path, 0352) |
| N7 | Start `geldar-signoz-otelcol` (writer to `geldar-ch`) | 0.5 CPU, 1g | low-load | `rm -s` the container | yes (new writer) |
| N8 | Start `geldar-gateway` with `GELDAR_OTEL_ENABLED` set, Geldar services still on endpoint unset | 0.5 CPU, 512m, 256 pids | low-load, Paper not restarted | unset `GELDAR_OTEL_ENABLED` and recreate the Geldar services through CD (SDK goes off, T-03); `rm -s geldar-gateway` | yes (gateway on the Geldar network) |
| N9 | Verify (section 16): a scratch run first, then one test event on the node | read-only checks; one test event | owner's window | as N8 | yes (test event and stack in use) |
| N10 | Start `nats-exporter` (NATS namespace) | 0.1 CPU, 64m | any | remove the service; NATS untouched | no (within `/varz` and `/jsz`, already approved) |
| N11 | Create the monitoring role (section 12) | none | low-load | revoke grants, then `DROP ROLE` (none owned) | yes (database role) |
| N12 | SigNoz alert rules (Geldar share, `/mnt/nvme`, queue) | none | any | disable the rule | yes (alert channel not chosen) |
| N13 | Mind-host `otel-agent` install (owner's machine) | agent 0.25 CPU, 256m | owner's session | stop and remove the agent | yes (token or key; section 9) |
| N14 | Caddy route for Mind hosts (section 9, ingest only): one env secret and one recreate of the shared Caddy for the token, then `otel.caddy` validate and reload | one recreate of the shared Caddy; reload | low-load, owner's window | remove the `otel.caddy` snippet and reload (`otel-off.caddy`); the token can stay until the next recreate | yes: owner-approved at the time (ruling 2026-11-16) |
| N15 | Helper read-only stats route (section 8, Option B) | helper unit as is | separate window | remove the route; redeploy the helper | yes (root-run unit change) |

Each request carries the step number, the exact command or file, the caps, the window, the rollback and the verification in section 16.

## 15. Compose and deploy files (for the implementation packets only)

- `compose/colo-telemetry.yml`: the Geldar stack and the `geldar-telemetry` network. Merged only when `GELDAR_OTEL_ENABLED` is set.
- `compose/colo-otel.yml`: the gateway and `nats-exporter`, with caps, `geldar-colo` and `geldar-telemetry` networks, and the loopback publishes named in section 10. Merged the same way.
- `deploy/otel/gateway.yaml`: the Collector config in section 5, read-only bind. Stack configs under `deploy/clickhouse/` and `deploy/signoz/` (the T-17 dashboards directory); **UNVERIFIED** names.
- `deploy/caddy/otel.caddy` and `deploy/caddy/otel-off.caddy`: for the section 9 Caddy ingest route (N14).
- `deploy/colo-up.sh` and `deploy/common.sh`: the overlay merges, gated by env.
- `tools/repo-checks`: the loopback allow-list (section 10) and a test that no overlay mounts `docker.sock`.
- Env names only (values stay out of the repo): `GELDAR_OTEL_ENABLED`, `GELDAR_SIGNOZ_OTLP_ENDPOINT`, `GELDAR_OTEL_ENDPOINT` (the Geldar services' endpoint, `http://geldar-gateway:4318`), `GELDAR_CH_WRITER_PASSWORD_FILE`, `GELDAR_CH_READER_PASSWORD_FILE` (secret file paths; the reader password is never on a Mind host), `GELDAR_COLO_OTEL_GATEWAY_CPUS`, `GELDAR_COLO_OTEL_GATEWAY_MEM`, `GELDAR_OTEL_PG_PASSWORD_FILE`. `GELDAR_OTEL_INGEST_TOKEN` and `GELDAR_OTEL_UPSTREAM` for the section 9 Caddy ingest route.

## 16. Verification checklist

Scratch run first (before N8 on the node): the same stack shapes in a scratch compose project, with no player Bodies. **UNVERIFIED**: the scratch host is not named in the repo; the owner names it.

SigNoz (read through the viewer-role key on the workstation, or the UI through the SSH tunnel; no change to the other tenant's views):
- Services `geldar-*` appear with `service.namespace=geldar` and `deployment.environment.name=colo`.
- A Geldar trace has `life_id` (or the T-03 name) on the span, and no life or player label on any metric series. None of `geldar.life_id`, `player_id`, `token`, `email` appears as a metric label.
- Logs contain no IPv4 or IPv6 literal where Paper logs `[/<address>]`: search for `[/` followed by digits; expect zero hits.
- No `Thread RCON Client ... started|shutting down` lines; `[Rcon:` echoes present.
- No attribute named `user.email`, `*token*`, `*password*`, `*authorization*`, `*cookie*`.
- Queue: `otelcol_exporter_queue_size` below capacity under normal load; `otelcol_exporter_send_failed_*` flat; `otelcol_processor_refused_*` zero.
- `nats` series present (`/varz`, `/jsz`); no `subsz` or connection series. `postgresql` series present; the monitoring role cannot write (a `psql` `INSERT` as that role, expecting permission denied).

Docker stats (operator, read-only verbs only), for every Geldar container against its caps in section 4:
- `docker stats --no-stream`: each container at or below its CPU and memory caps; PIDs at or below its limit.
- `docker inspect` of the gateway and the stack: no `docker.sock` in `Mounts`; `ReadonlyRootfs` true for the gateway; `CapDrop` contains ALL; `json-file` log driver.
- `docker port geldar-ch` and `docker port geldar-signoz-ui`: only the loopback entries named in section 10. No other publish.
- The other tenant's containers: no change. Compare `docker ps` names before and after N2 to show no change.

ClickHouse (the query in section 13 and the read-only user only):
- `system.parts` for the Geldar database: bytes after the first day and after the first week, recorded against the 70 GB alarm.
- TTL on each telemetry table after the first merge (`SHOW CREATE TABLE`, read-only).
- The writer user cannot read `system` tables it does not need; the reader user cannot write (negative tests, 0352).

Paper tick unchanged during merges:
- `tick query` on Paper in a baseline window and in a window where `system.merges` on `geldar-ch` is non-empty, at the same player load. TPS and MSPT match within the noise of the baseline (**PROPOSED** tolerance: to be set from the baseline run).
- Node load: `docker stats` of the Paper and Body containers before and after N8, same window.

End-to-end test event (scratch stack, then the node):
- One test log and one test span with a known marker value sent to `geldar-gateway`; found in the SigNoz UI through the tunnel and in `system.parts` growth. The marker is not an agent-readable string (0350 item 7).

Negative tests:
- The UI is not reachable from any interface but loopback (`ss -ltn` shows `127.0.0.1` only for its port).
- If section 9 is decided: the Caddy checks in section 9 (401, 405, 404, 413).
- Config: `otelcol validate` passes; the RCON and address fixtures behave as in section 5.

## 17. Rollout and rollback summary

Order: N1; N2 (network); N3 (volumes); N4 (ClickHouse, plus keeper if the keeper rule needs it); N5 (migrator, retention); N6 (query and UI); N7 (SigNoz collector); N8 (gateway, Geldar services still on endpoint unset); N9 (verify). Then the Geldar services are switched on one by one by the T-03 and T-06 to T-08 cards (each its own change). Then N10 to N12. N13 at the owner's pace. N14 is a normal owner-approved step: one Caddy reload, or one recreate for the token, each with the owner's approval at the time. Rollback = remove the snippet and reload.

Rollback for the whole stack, in order: unset `GELDAR_OTEL_ENABLED` and recreate the Geldar services through CD (SDKs go off); `docker compose ... rm -s` for `geldar-gateway`, `geldar-signoz-otelcol`, `geldar-signoz-ui`, `geldar-signoz-query`, `geldar-signoz-migrator` and `geldar-ch` (and `geldar-ch-keeper` if used); remove `nats-exporter` and the monitoring role if they were added; remove the `geldar-telemetry` network once empty; keep the Geldar data directories until the owner decides. The shared Caddy is not touched, and the other tenant is not touched at any step.

## 18. Risks

1. **ClickHouse merges vs the Paper tick.** Merges use CPU and disk on the host Paper runs on. Mitigation: the caps in section 4, the tick check in section 16, and a merge-time limit set from the scratch run (**PROPOSED**).
2. **Disk growth.** The estimate (section 13) may be wrong; merges need headroom; the root filesystem's free space is small. Mitigation: the 70 GB alarm, the 60% node alarm, the 100 GB stop, and the system-log TTL.
3. **SigNoz version vs the MCP server.** The Geldar stack, the Geldar gateway and the MCP server (T-18) must use compatible SigNoz releases. Mitigation: one pin for the stack, and T-18 pinned to it (0352 risk 2). Compatibility is **UNVERIFIED**.
4. **Unverified single-node support without keeper.** Whether SigNoz 0.135 or later runs one ClickHouse node without ZooKeeper or keeper is **UNVERIFIED** (0352). The keeper rule in section 4 is the plan until it is checked.
5. **RAM overcommit.** The sum of set container limits on the node is 185 GB (0352 fit check). Real use was 29 GB. The caps are ceilings. Mitigation: the caps; the owner's approval at N4.
6. **Host `/proc` and `/sys` mounts** expose host process data (F3); mitigated by the options in `collector-options.md` F3.
7. **Disk cap for the queue** (F2): no native byte cap; a volume or a derived queue size is needed.
8. **Mind-host token** (F6, F4): a leaked token lets anyone write telemetry into Geldar's own server (not read it). Rotation is manual; a procedure is needed before N13. Conditional on section 9.
9. **Public hostname** (section 10): conditional on section 9. The expected list is updated before the first scan after any Caddy route.
10. **Trace-context leakage to the model.** No telemetry word or trace id may reach a model-readable surface (0350 item 7, T-19). The gateway is not in the model's path; the SDK and the kit's env handling (T-14) are.
11. **Image pin drift.** The digests recorded here are survey values or unset (sections 3 and 11); a newer release waits for its own two-week window.
12. **Content in SigNoz** (0350 items 2 and 3): the one-year, full-content policy applies to telemetry; per-life erasure is a KNOWN GAP (0350 item 3), to close before any outside player's agent runs.
13. **`pg_monitor` reads query text** (section 12).
14. **Gateway down**: the SDK drops silently after its bounded queue (T-03). Data loss during an outage is accepted (0350 item 7); the absence alerts detect it.
15. **UI and tunnel access.** The UI is loopback-only and reached by SSH tunnel (0352). A holder of the operator's SSH key can reach it. Mitigation: no Caddy route, no published external port, the operator's key kept as it is.
16. **Operator error**: a wrong `caddy reload` would route all traffic to 401. Conditional on section 9; the reload is validated first, and the kill switch is one file swap.

## 19. Findings for the orchestrator

- **F1**: the gateway's loopback publish for Caddy. Conditional on section 9 (owner ruling 2026-11-16).
- **F2**: the file queue has no native byte cap in 0.164.0 (**UNVERIFIED**); section 6 gives the options.
- **F3**: host `/proc` mount exposes the process list; the process scraper is off.
- **F4**: the Caddy token would enter the reload environment; conditional on section 9.
- **F5**: header comparison is not constant-time; conditional on section 9.
- **F6**: the Mind host holds the ingest token; isolation by uid is the control, tested in T-14; conditional on section 9.
- **F7 and F8**: resolved by 0352 option B. The budget is measured per server; the retention is the Geldar workspace's.
- **F9**: resolved by 0352 option B. No Geldar container joins the other tenant's network, and no port of the other tenant changes.
- **F10**: Mind-host ingest needed a Caddy route, which the earlier no-Caddy-change ruling ruled out. Decided by the owner on 2026-11-16 for ingest only (section 9.1); the UI stays without a Caddy route.
- **F11**: gateway pids: 128 in 0350 item 9 and 0082, 256 in the 0352 table. This design uses 256. Orchestrator to reconcile.

## 20. Sources

- Telemetry survey, 2026-11-15: sections 1.2, 1.3, 4.1, 4.2, 4.5, 4.6, 4.7, 5.5, 6, 7, 9.0, 9.6, 9.7.
- 0352 fit check, 2026-11-15 (read-only node measurement); 0352 option B and the 0350 clarification of 2026-11-16.
- Decisions: 0350, 0352, 0082, 0071, 0096, 0260, 0088.
- Repo: `compose/colo.yml`, `compose/colo-kino.yml`, `compose/colo-public.yml`, `deploy/caddy/mcp.caddy`, `deploy/caddy/README.md`.
- Not checked in this session: the registry digests, the node's network and volume names, cgroup layout, Caddy version, SigNoz version and retention values, the exporter flag names, the OTTL function names, the ClickHouse 26.3 TTL and async-insert keys. Each is marked **UNVERIFIED** above and is a read-only check in N1 or a test in the implementation packets.
