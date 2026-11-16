# TM-30: otel-agent collector config and its tests (scriptorium repo)

Repo: geldar-scriptorium. Depends on: none. Unblocks: TM-31. Mind redeploy: none (the agent is a separate container, not the kit image). `colo-images` path: n/a. Node step: none (N13 installs it, TM-34).

## Goal

The per-host `otel-agent` is an OpenTelemetry Collector (contrib, the same version and digest as the Colo gateway) that receives OTLP/HTTP from the supervisors on the Mind host's private network and forwards it over HTTPS to the shared Caddy ingest route with the bearer token (collector-design section 9; survey 4.6). It holds the token; no other container does. Write its config.

## Files (exactly these)

- `image/otel-agent/config.yaml` (new)
- `image/otel-agent/config.test.ts` (new)

## The config (write exactly this shape; keys per the collector's docs for the pinned version, verify each against the pinned release notes and report any key that differs)

```yaml
extensions:
  health_check:
    endpoint: 127.0.0.1:13133
receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318            # reachable only on the internal geldar-otel network (TM-31)
        max_request_body_size: 4194304     # 4 MiB: stays under the route's 8 MiB limit
processors:
  memory_limiter:
    check_interval: 1s
    limit_mib: 200                         # container limit is 256 MiB
    spike_limit_mib: 40
  transform/scrub:
    error_mode: ignore
    trace_statements:
      - context: span
        statements:
          - delete_key(attributes, "user.email")
          - delete_matching_keys(attributes, "^(enduser|http\\.request\\.header\\.(authorization|cookie)).*")
    log_statements:
      - context: log
        statements:
          - delete_key(attributes, "user.email")
          - delete_matching_keys(attributes, "^(enduser|http\\.request\\.header\\.(authorization|cookie)).*")
  batch:
    send_batch_size: 512
    send_batch_max_size: 1024
    timeout: 5s
exporters:
  otlphttp:
    endpoint: https://${env:GELDAR_INGEST_HOST}
    headers:
      Authorization: "Bearer ${env:GELDAR_INGEST_TOKEN}"
    compression: gzip
    timeout: 10s
    retry_on_failure: { enabled: true, initial_interval: 5s, max_interval: 60s, max_elapsed_time: 300s }
    sending_queue: { enabled: true, num_consumers: 2, queue_size: 200 }   # in memory, bounded, drops when full
service:
  extensions: [health_check]
  telemetry:
    logs: { level: warn }
    metrics: { level: none }
  pipelines:
    traces:  { receivers: [otlp], processors: [memory_limiter, transform/scrub, batch], exporters: [otlphttp] }
    logs:    { receivers: [otlp], processors: [memory_limiter, transform/scrub, batch], exporters: [otlphttp] }
    metrics: { receivers: [otlp], processors: [memory_limiter, batch], exporters: [otlphttp] }
```

The exporter appends `/v1/traces`, `/v1/logs`, `/v1/metrics` to the endpoint itself. Content attributes (`geldar.content.*`) must pass untouched: the scrub deletes nothing under that prefix. Full-text capture is the owner's ruling; the agent never filters content.

## Steps

1. Write the file as above. No literal host, token or IP anywhere; both values come only from the environment.
2. The Collector's own log level stays `warn` and no `debug` or `logging` exporter exists, so request bodies and headers are never printed (the exporter's header values are opaque in the Collector's own config dump; verify in the release notes and say so).
3. Tests (`config.test.ts`, parse with the repo's YAML reader if present, else add `yaml` pinned exactly after checking the lockfile; do not hand-parse):
   - (a) `memory_limiter` is the first processor of every pipeline.
   - (b) the exporter endpoint and the `Authorization` header are `${env:...}` placeholders and the file contains no `Bearer ` followed by anything but `${env:GELDAR_INGEST_TOKEN}`.
   - (c) no `debug`, `logging` or `file` exporter, no `pprof`/`zpages` extension, no receiver other than OTLP HTTP, no gRPC protocol.
   - (d) the `health_check` endpoint starts with `127.0.0.1`.
   - (e) `sending_queue.enabled` is true and `queue_size` is at most 500; `max_request_body_size` is at most 8 MiB.
   - (f) the scrub statements do not match any key starting with `geldar.content` (evaluate the regex strings in the test against sample keys: `geldar.content.prompt` is kept; `user.email`, `enduser.id` are matched).
   - (g) the file contains no IPv4 literal except `127.0.0.1` and `0.0.0.0` (the 0.0.0.0 bind is the one the compose card puts on an internal network only).
4. Revert check: swap `memory_limiter` to second place; (a) must fail. Paste a fake `Bearer abc` literal; (b) must fail.
5. Offline validation is NOT run here (needs Docker). The ops agent validates once with the pinned image: `docker run --rm -v <config>:/c.yaml:ro -e GELDAR_INGEST_HOST=example.invalid -e GELDAR_INGEST_TOKEN=x <image@digest> validate --config /c.yaml`; the result goes in the TM-31 report. The image digest is TM-31's.

## Checks and commit

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm check:repo`, `git diff --check`. Commit: `T-13 TM-30: otel-agent collector config, bearer token from the environment only (image)` plus the two trailers.

## Do NOT

- Do not add a persistent queue or `file_storage` (the container is read-only; a lost minute of telemetry is acceptable; a file holding telemetry content on the Mind host is not wanted).
- Do not add a tail sampler, a content filter or a redaction processor for `geldar.content.*`.
- Do not add the `docker_stats`, `hostmetrics` or any scraping receiver (no socket, no host data).
- Do not put the host name or token in the file, a comment or a test.
