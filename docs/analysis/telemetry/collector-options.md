# Geldar Collector: options for findings F1 to F9 (T-02)

- Date: 2026-11-15
- Source: `docs/analysis/telemetry/collector-design.md` on branch `phase1/telemetry-t02-collector-design` (sections 4, 6, 8, 9, 18 and 19). Read with `git show phase1/telemetry-t02-collector-design:docs/analysis/telemetry/collector-design.md`.
- Decision context: `docs/decisions/0352-telemetry-dedicated-clickhouse-database.md` (proposed) and 0350 (accepted).
- Scope: docs only. Nothing here is implemented, deployed or run. Versions are those named in the design: contrib 0.164.0, Caddy on the node (version unverified).

Each finding gets a safer option and a recommendation. "Unverified" marks a claim this document could not check against the pinned versions or the node.

## F1. Gateway publish for Caddy widens the colo network

**Problem.** The design said "OTLP on the colo network only". Caddy runs in host networking (`deploy/caddy/README.md`, 0096 item 1), so it can reach the gateway only through a host port. Joining Caddy to the colo network would widen that network to the public-facing proxy.

**Options.**

1. **Loopback publish of one port (design as written in section 4).** `127.0.0.1:<port>:4318` on the gateway only. Caddy reverse-proxies to `127.0.0.1:<port>`. The gateway stays on `geldar-colo` and the SigNoz side only. The MCP (8788) and Glass (8787) routes already work this way (0096 item 2).
2. **Unix socket.** Caddy's `reverse_proxy` takes unix socket upstreams (from memory of Caddy's docs, not checked here; unverified for the node's version). The gateway's OTLP/HTTP receiver would need a unix listener, which I could not confirm for 0.164.0 (unverified). Reachability is then by file permission, not by port.
3. **Caddy on the colo network.** Rejected: it widens the proxy's reach into every Geldar service.

**Recommendation: option 1.** It matches the existing MCP and Glass pattern, needs no change to Caddy's networking, and adds exactly one loopback entry to `tools/repo-checks/src/loopback-ports.ts`. Harden it: the gateway requires the bearer check on its own side too (F5, option A), so a local process that reaches the port without the token gets nothing. If the owner prefers no loopback port at all, option 2 is the next choice after a 0.164.0 check of the receiver.

## F3. Host `/proc` and `/sys` expose the host's process list

**Problem.** Mounting host `/proc` read-only lets the gateway read every process's command line. The design disables the process scraper, but the mount still exposes the list to the gateway, and `root_path: /hostfs` reads the host's files for every scraper.

**Options.**

1. **Drop the host mounts and use the container's own `/proc` and `/sys`.** Without `pid: host`, the container's pid namespace shows only its own processes, so the process scraper sees only the collector. Node-wide CPU, memory and load files (`/proc/stat`, `/proc/meminfo`, `/proc/loadavg`) are not per-pid, so they report host values from inside the container (unverified for every scraper in 0.164.0). Network counters from `/proc/net/dev` are scoped to the container's network namespace, which is a limit: they are not the node's (unverified).
2. **Bind only the mount points that matter, read-only.** For filesystem utilisation, bind `/mnt/nvme` (and the root filesystem if needed) read-only under `/hostfs/...`, and restrict the `filesystem` scraper to those mount points (the option keys for that in 0.164.0 are unverified). This gives the `/mnt/nvme` 60% alarm without a host `/proc`.
3. **`hidepid=2` on the host's `/proc` mount.** A host mount option, changed by root on the node, affecting every tenant. It hides other users' pids; it does not remove the `/proc/stat` values. Owner decision, not needed if option 1 is used.
4. **Curated `/proc` files as single-file bind mounts** (`/proc/stat`, `/proc/meminfo`, and so on). Possible but fragile: a scraper that lists a directory fails, and the list of files each scraper reads is unverified for 0.164.0.
5. **Drop `hostmetrics` and read cgroups.** The T-02 Option A cgroup reader (section 8) already reads per-container files; node-wide values could come from the same reader. More custom code to review.

**Recommendation: options 1 and 2 together.** Use the container's own procfs for CPU, memory and load; bind only `/mnt/nvme` read-only for the disk alarm; disable the process scraper; and ask the owner for option 3 only as a separate node change if the owner wants the other tenants' process lists hidden. Check the network-counter limit (the node's `/proc/net/dev`) in T-02's soak test, because the container view may not show the node.

## F4. The Caddy token enters the reload environment

**Problem.** `{$GELDAR_OTEL_INGEST_TOKEN}` is substituted when the Caddy CLI parses the file. `caddy reload` runs inside `docker exec`, so the token sits in that exec's environment, visible to root on the node and in shell history if typed.

**Options.**

1. **File placeholder.** Caddy 2 has a `{file.<path>}` placeholder that reads a file (from memory of Caddy's docs, not checked here; **unverified**; whether the node's Caddy version evaluates it per request or at load is unverified). The token file is a secret mount, not an environment variable. The Caddyfile then reads `header Authorization "Bearer {file./run/secrets/otel-ingest-token}"`. The token never appears in `docker exec` arguments or the environment of the reload command.
2. **Separate secrets mount for Caddy only.** The same as option 1, with the file bound into the Caddy container read-only, not into the reload exec.
3. **Keep `{$VAR}` and pass the token with `docker exec -e` from a file read by the script.** Still visible to root in the process table during the reload; not recommended.

**Recommendation: option 1 (or 2 where the Caddy version does not support `{file.*}`).** Check the node's Caddy version first (N1). Keep the token out of the repo and out of the reload command. The file is owned by root, mode 0400, and the Caddy process reads it. Rotation is: write the new file, reload, then revoke the old token at the gateway (F6).

## F5. Header comparison is not constant-time

**Problem.** Caddy's `header` matcher compares strings, which is not constant-time. The design calls the risk low: the token is long and random, and the path is TLS. That is an argument, not a measurement.

**Options.**

1. **Move the check into the gateway with the `bearertokenauth` extension** (contrib). It is described as using a constant-time compare (**unverified** for 0.164.0; read the extension's source at the pinned digest before relying on it). The gateway then holds the token, and Caddy only filters method and path.
2. **A Caddy plugin for a constant-time check.** A third-party build of Caddy. Rejected: a custom Caddy build is a larger supply-chain surface than the risk.
3. **Keep the Caddy header check and add a length rule.** Require at least 32 random bytes (design section 9). Low cost, does not change the comparison.

**Recommendation: option 1, plus option 3.** Caddy keeps the method, path and header-presence checks. The gateway's `bearertokenauth` is the real check (after verifying its compare). The token must be at least 32 random bytes. Verify the claim about constant-time comparison before the change; mark it unverified until then. Tradeoff: the gateway then holds the token, so F6's options apply to the gateway too.

## F6. The token is held outside the Mind host's trust boundary

**Problem.** The Mind host holds the ingest token. The model child runs as another uid and does not inherit the supervisor's environment (T-14 proves this). A leaked token lets anyone write telemetry into Geldar's data (not read it, 0350 item 7).

**Options.**

1. **Short-lived per-host tokens.** Each host gets a token with an expiry, issued by a small issuer. Needs an issuer, a renewal path and clock handling. More moving parts than the risk needs.
2. **mTLS client certificate per Mind host.** Caddy requires and verifies a client certificate signed by a Geldar CA (`tls { client_auth { ... } }`; Caddy support and the directive names are unverified for the node's version). The key stays on the host, mode 0400, owned by the supervisor's uid. Revoke by host. The OTLP exporter has client-certificate options (the environment variable names are unverified for JS SDK 3.0.0; check in T-03). The gateway then does not need the token at all.
3. **An authenticating forwarder run by the supervisor.** A local process on the Mind host, run as the supervisor's uid, holds the token and forwards to Caddy. The model child cannot read its files. The token is still on the host, so this moves the trust boundary; it does not remove the token. Store it in an OS secret store (Windows Credential Manager or DPAPI on the owner's PC; systemd credentials on Linux) so a plain file read is not enough.

**Recommendation: option 2, with option 3 as the fallback.** A certificate per host is revocable by host and never sent as a bearer value. Its cost is a small CA and a rotation procedure, which the design already needs before N9 (risk 6). Until the certificate path is verified, use option 3 with the OS secret store, and keep the token scoped to telemetry writes.

## F2. The queue has no native byte cap

**Problem.** `file_storage` and `sending_queue` count items, not bytes, in 0.164.0 (design section 6; unverified that no byte cap exists). A fixed-size volume is one answer; a derived item count is the other.

**What the docs say (exporterhelper README on `main`, not checked against the 0.164.0 tag).** `sending_queue` keys: `sizer` (`requests`, `items` or `bytes`; default `requests`), `queue_size` (in the sizer's units; default 1000), `storage` (an extension id; with it, no in-memory queue), `block_on_overflow`, `wait_for_result`. `file_storage` keys: `max_size` (bytes per bbolt database file; 0 means unlimited), `compaction.on_start`, `compaction.on_rebound`, `compaction.rebound_needed_threshold_mib` (100), `compaction.rebound_trigger_threshold_mib` (10), `compaction.directory`, `compaction.check_interval`. bbolt files do not shrink without compaction.

**Options.**

1. **`sizer: bytes` with `queue_size` in bytes, plus a fixed-size volume.** The best fit if the bytes sizer exists in 0.164.0 for the traces, logs and metrics pipelines. **UNVERIFIED** in 0.164.0 and per signal. Test it in the T-02 soak test before use.
2. **`sizer: items` with `queue_size = cap_bytes / largest_request_bytes`.** Works on any version with the items sizer. Needs the largest request measured (the design's 2,048-span batch is about 2.5 MB, which gives about 400 items for 1 GiB; an estimate).
3. **A fixed-size loop-mounted volume (design option, N2).** A hard cap regardless of sizer. Needs a node step (N2) and a compaction plan, because bbolt files grow.

**Recommendation: option 3 as the hard cap, with option 2 for the count.** The volume is the real limit; the count keeps the queue below the volume's size. Use option 1 only after the soak test proves it. Set `max_size` and compaction so the bbolt files do not grow past the volume. Compaction needs free space on the same volume to write its copy, so size the volume with headroom (about 20%; an estimate). Alarm on the queue directory's `system.filesystem.utilization` (design section 6).

### Config sketch (env-var placeholders; not tested)

```yaml
extensions:
  file_storage/queue:
    directory: /var/lib/otelcol/queue
    max_size: ${env:GELDAR_OTEL_QUEUE_FILE_MAX_BYTES}   # per bbolt file; unverified against the volume size
    compaction:
      on_start: true
      on_rebound: true
      directory: /var/lib/otelcol/queue-compact        # same volume as the queue
      rebound_needed_threshold_mib: ${env:GELDAR_OTEL_QUEUE_REBOUND_MIB}
      rebound_trigger_threshold_mib: 10
      check_interval: ${env:GELDAR_OTEL_QUEUE_CHECK_INTERVAL}

exporters:
  otlphttp/geldar_stack:
    endpoint: ${env:GELDAR_OTEL_STACK_ENDPOINT}        # the Geldar stack's OTLP/HTTP (option B in 0352)
    sending_queue:
      enabled: true
      storage: file_storage/queue
      sizer: bytes                                     # UNVERIFIED in 0.164.0
      queue_size: ${env:GELDAR_OTEL_QUEUE_BYTES}       # bytes, when sizer is bytes
      # fallback if sizer: bytes is not in 0.164.0:
      # sizer: items
      # queue_size: ${env:GELDAR_OTEL_QUEUE_ITEMS}     # cap_bytes / largest_request_bytes
    retry_on_failure:
      enabled: true
```

The placeholders are `GELDAR_OTEL_QUEUE_FILE_MAX_BYTES`, `GELDAR_OTEL_QUEUE_REBOUND_MIB`, `GELDAR_OTEL_QUEUE_CHECK_INTERVAL`, `GELDAR_OTEL_STACK_ENDPOINT`, `GELDAR_OTEL_QUEUE_BYTES` and `GELDAR_OTEL_QUEUE_ITEMS`. Their values come from the operator's environment, not the repo. Keep the `${env:...}` form, which the collector substitutes at load time.

## F7 to F8: budget and retention

Not in this file's scope; decided in `docs/decisions/0352-telemetry-dedicated-clickhouse-database.md`. Option B there removes F7 and F8.

## F9. Joining the other tenant's Docker network

**Problem.** The gateway is on the SigNoz network so it can reach the other tenant's collector. Any container on that network can write into Geldar's data, and the reverse.

**Options.**

1. **Send through a published loopback port of the SigNoz collector on the host.** Not available as written: the other tenant publishes its collector ports on all interfaces, not on loopback. A loopback publish would change the other tenant's configuration, which 0350 item 4 forbids. Rejected unless the owner changes that ruling.
2. **`host-gateway` to the other tenant's published 4317 or 4318.** Uses the all-interfaces port with no ingestion key; relies on the node firewall (unverified). Worse than the design's join, because the exposure already exists and the gateway would depend on it. Rejected.
3. **A Geldar-owned collector that writes straight to ClickHouse.** Still has to reach the other tenant's ClickHouse, which means the same network problem. Only safe if the server is Geldar's own.
4. **A Geldar-owned SigNoz stack (option B in 0352).** The gateway joins only Geldar's own network. No join with the other tenant. The Geldar stack's ingress is the gateway on loopback (F1).

**Recommendation: option 4 (0352 option B).** It is the only option that avoids the join. If the owner keeps the other tenant's stack for Geldar's data, the least-bad form is option 3 on a Geldar-owned network with the other tenant's ClickHouse reached by an owner-approved route, which is still a trust decision (F9 stays owner-level).

## Summary

| Finding | Recommendation | Owner decision needed |
|---|---|---|
| F1 | Loopback publish of one port; bearer check also on the gateway | Yes: the one loopback entry |
| F2 | Fixed-size volume with an items count; `sizer: bytes` only after the soak test | Node step N2 |
| F3 | Container procfs for node CPU and memory; bind `/mnt/nvme` read-only; no process scraper | Only if `hidepid` is wanted |
| F4 | `{file.*}` placeholder or a secret mount for Caddy; not the reload environment | Caddy version check first |
| F5 | Gateway `bearertokenauth` after verifying its compare; token at least 32 random bytes | No |
| F6 | mTLS client certificate per Mind host; OS secret store as the fallback | Yes: the certificate CA and rotation |
| F7, F8 | Option B in 0352 | Yes: owner |
| F9 | Geldar-owned SigNoz stack (0352 option B) | Yes: owner |

## Unverified (collected)

- Every 0.164.0 key named here: `sizer`, `queue_size` units, `file_storage` `max_size` and compaction keys (taken from the main-branch README), the `bytes` sizer, `bearertokenauth`'s compare, the `hostmetrics` and `filesystem` option keys for `root_path` and mount points.
- Caddy's `{file.*}` placeholder and `client_auth` directives for the node's Caddy version.
- The JS SDK's client-certificate environment names (T-03).
- Whether the container's `/proc/net/dev` and `/proc/stat` show node values on the node.
- The node's free RAM and CPU for option B (0352).
