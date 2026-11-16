# Geldar Collector: options for findings F1 to F9 (T-02)

- Date: 2026-11-15
- Source: `docs/analysis/telemetry/collector-design.md` on branch `phase1/telemetry-t02-collector-design` (sections 4, 6, 8, 9, 18 and 19). Read with `git show phase1/telemetry-t02-collector-design:docs/analysis/telemetry/collector-design.md`.
- Decision context: `docs/decisions/0352-telemetry-dedicated-clickhouse-database.md` (accepted, option B: Geldar-owned ClickHouse server and SigNoz stack on a Geldar-owned network) and 0350 (accepted).
- Scope: docs only. Nothing here is implemented, deployed or run. Versions are those named in the design: contrib 0.164.0, Caddy on the node (version unverified).
- Re-check: F1, F3, F4, F5 and F6 were re-checked under 0352 option B on 2026-11-15 (the recommendations stand unless a note says otherwise). F9 is resolved by option B: no Geldar container joins the other tenant's network.
- Owner ruling, 2026-11-16: no change to the shared Caddy, and the SigNoz UI is reached by SSH tunnel only. F1, F4 and F5 assume a Caddy route for Mind hosts, which the ruling conflicts with; they stay as written but are conditional on F10. The UI has no Caddy route.

Each finding gets a safer option and a recommendation. "Unverified" marks a claim this document could not check against the pinned versions or the node.

## F1. Gateway publish for Caddy widens the colo network

**Problem.** The design said "OTLP on the colo network only". Caddy runs in host networking (`deploy/caddy/README.md`, 0096 item 1), so it can reach the gateway only through a host port. Joining Caddy to the colo network would widen that network to the public-facing proxy.

**Options.**

1. **Loopback publish of one port (design as written in section 4).** `127.0.0.1:<port>:4318` on the gateway only. Caddy reverse-proxies to `127.0.0.1:<port>`. The gateway stays on `geldar-colo` and the Geldar SigNoz side only. The MCP (8788) and Glass (8787) routes already work this way (0096 item 2).
2. **Unix socket.** Caddy's `reverse_proxy` takes unix socket upstreams (from memory of Caddy's docs, not checked here; unverified for the node's version). The gateway's OTLP/HTTP receiver would need a unix listener, which I could not confirm for 0.164.0 (unverified). Reachability is then by file permission, not by port.
3. **Caddy on the colo network.** Rejected: it widens the proxy's reach into every Geldar service.

**Recommendation: option 1.** It matches the existing MCP and Glass pattern, needs no change to Caddy's networking, and adds exactly one loopback entry to `tools/repo-checks/src/loopback-ports.ts`. Harden it: the gateway requires the bearer check on its own side too (F5, option A), so a local process that reaches the port without the token gets nothing. If the owner prefers no loopback port at all, option 2 is the next choice after a 0.164.0 check of the receiver.

**Under 0352 option B.** The gateway's downstream is now the Geldar SigNoz collector on the Geldar network. The SigNoz UI has no Caddy route: by the owner ruling of 2026-11-16 it is bound to `127.0.0.1` on the node and reached by SSH tunnel (0352 read path). The Caddy side of this finding is open, because the owner ruled no change to the shared Caddy and the Mind-host route depends on one (F10).

## F3. Host `/proc` and `/sys` expose the host's process list

**Problem.** Mounting host `/proc` read-only lets the gateway read every process's command line. The design disables the process scraper, but the mount still exposes the list to the gateway, and `root_path: /hostfs` reads the host's files for every scraper.

**Options.**

1. **Drop the host mounts and use the container's own `/proc` and `/sys`.** Without `pid: host`, the container's pid namespace shows only its own processes, so the process scraper sees only the collector. Node-wide CPU, memory and load files (`/proc/stat`, `/proc/meminfo`, `/proc/loadavg`) are not per-pid, so they report host values from inside the container (unverified for every scraper in 0.164.0). Network counters from `/proc/net/dev` are scoped to the container's network namespace, which is a limit: they are not the node's (unverified).
2. **Bind only the mount points that matter, read-only.** For filesystem utilisation, bind `/mnt/nvme` (and the root filesystem if needed) read-only under `/hostfs/...`, and restrict the `filesystem` scraper to those mount points (the option keys for that in 0.164.0 are unverified). This gives the `/mnt/nvme` 60% alarm without a host `/proc`.
3. **`hidepid=2` on the host's `/proc` mount.** A host mount option, changed by root on the node, affecting every tenant. It hides other users' pids; it does not remove the `/proc/stat` values. Owner decision, not needed if option 1 is used.
4. **Curated `/proc` files as single-file bind mounts** (`/proc/stat`, `/proc/meminfo`, and so on). Possible but fragile: a scraper that lists a directory fails, and the list of files each scraper reads is unverified for 0.164.0.
5. **Drop `hostmetrics` and read cgroups.** The T-02 Option A cgroup reader (section 8) already reads per-container files; node-wide values could come from the same reader. More custom code to review.

**Recommendation: options 1 and 2 together.** Use the container's own procfs for CPU, memory and load; bind only `/mnt/nvme` read-only for the disk alarm; disable the process scraper; and ask the owner for option 3 only as a separate node change if the owner wants the other tenants' process lists hidden. Check the network-counter limit (the node's `/proc/net/dev`) in T-02's soak test, because the container view may not show the node.

**Under 0352 option B.** No change. The `/mnt/nvme` bind is still needed for the 60% node-wide alarm, which is the only alarm that covers the other tenant's data. Node CPU and memory still come from the container's procfs. The new Geldar ClickHouse disk is under `/mnt/nvme/geldar-telemetry`, so the same bind covers its disk use.

## F4. The Caddy token enters the reload environment

**Problem.** `{$GELDAR_OTEL_INGEST_TOKEN}` is substituted when the Caddy CLI parses the file. `caddy reload` runs inside `docker exec`, so the token sits in that exec's environment, visible to root on the node and in shell history if typed.

**Options.**

1. **File placeholder.** Caddy 2 has a `{file.<path>}` placeholder that reads a file (from memory of Caddy's docs, not checked here; **unverified**; whether the node's Caddy version evaluates it per request or at load is unverified). The token file is a secret mount, not an environment variable. The Caddyfile then reads `header Authorization "Bearer {file./run/secrets/otel-ingest-token}"`. The token never appears in `docker exec` arguments or the environment of the reload command.
2. **Separate secrets mount for Caddy only.** The same as option 1, with the file bound into the Caddy container read-only, not into the reload exec.
3. **Keep `{$VAR}` and pass the token with `docker exec -e` from a file read by the script.** Still visible to root in the process table during the reload; not recommended.

**Recommendation: option 1 (or 2 where the Caddy version does not support `{file.*}`).** Check the node's Caddy version first (N1). Keep the token out of the repo and out of the reload command. The file is owned by root, mode 0400, and the Caddy process reads it. Rotation is: write the new file, reload, then revoke the old token at the gateway (F6).

**Under 0352 option B.** No change. The Caddy route is the same whichever stack is behind the gateway. The token is the Mind-host ingest token, not a ClickHouse credential; the ClickHouse writer and reader users (0352) are separate secrets and must not be placed in Caddy at all.

## F5. Header comparison is not constant-time

**Problem.** Caddy's `header` matcher compares strings, which is not constant-time. The design calls the risk low: the token is long and random, and the path is TLS. That is an argument, not a measurement.

**Options.**

1. **Move the check into the gateway with the `bearertokenauth` extension** (contrib). It is described as using a constant-time compare (**unverified** for 0.164.0; read the extension's source at the pinned digest before relying on it). The gateway then holds the token, and Caddy only filters method and path.
2. **A Caddy plugin for a constant-time check.** A third-party build of Caddy. Rejected: a custom Caddy build is a larger supply-chain surface than the risk.
3. **Keep the Caddy header check and add a length rule.** Require at least 32 random bytes (design section 9). Low cost, does not change the comparison.

**Recommendation: option 1, plus option 3.** Caddy keeps the method, path and header-presence checks. The gateway's `bearertokenauth` is the real check (after verifying its compare). The token must be at least 32 random bytes. Verify the claim about constant-time comparison before the change; mark it unverified until then. Tradeoff: the gateway then holds the token, so F6's options apply to the gateway too.

**Under 0352 option B.** No change. The gateway's `bearertokenauth` is the check for the Mind-host token. The Geldar SigNoz collector behind the gateway is on the Geldar network and is not reached from Caddy, so it needs no second token check, but it must accept writes only from the gateway (a network-level rule on the Geldar network, not a shared secret).

## F6. The token is held outside the Mind host's trust boundary

**Problem.** The Mind host holds the ingest token. The model child runs as another uid and does not inherit the supervisor's environment (T-14 proves this). A leaked token lets anyone write telemetry into Geldar's data (not read it, 0350 item 7).

**Options.**

1. **Short-lived per-host tokens.** Each host gets a token with an expiry, issued by a small issuer. Needs an issuer, a renewal path and clock handling. More moving parts than the risk needs.
2. **mTLS client certificate per Mind host.** Caddy requires and verifies a client certificate signed by a Geldar CA (`tls { client_auth { ... } }`; Caddy support and the directive names are unverified for the node's version). The key stays on the host, mode 0400, owned by the supervisor's uid. Revoke by host. The OTLP exporter has client-certificate options (the environment variable names are unverified for JS SDK 3.0.0; check in T-03). The gateway then does not need the token at all.
3. **An authenticating forwarder run by the supervisor.** A local process on the Mind host, run as the supervisor's uid, holds the token and forwards to Caddy. The model child cannot read its files. The token is still on the host, so this moves the trust boundary; it does not remove the token. Store it in an OS secret store (Windows Credential Manager or DPAPI on the owner's PC; systemd credentials on Linux) so a plain file read is not enough.

**Recommendation: option 2, with option 3 as the fallback.** A certificate per host is revocable by host and never sent as a bearer value. Its cost is a small CA and a rotation procedure, which the design already needs before N9 (risk 6). Until the certificate path is verified, use option 3 with the OS secret store, and keep the token scoped to telemetry writes.

**Under 0352 option B.** No change to the Mind-host side. The Geldar ClickHouse writer and reader credentials (`geldar_writer`, `geldar_reader`, 0352) are a separate trust boundary: they live on the node and on the operator workstation, never on a Mind host. A leaked Mind-host token still only writes into Geldar's own server, which is now a server Geldar owns, so the blast radius is Geldar's data and nothing of the other tenant's.

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
    endpoint: ${env:GELDAR_OTEL_STACK_ENDPOINT}        # the Geldar SigNoz collector on the Geldar network (0352 option B)
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

Resolved by 0352 option B. The Geldar ClickHouse server holds only Geldar's data, so `system.parts` grouped by database is an exact budget measure (F7 gone). The one-year TTL and the Geldar stack's retention setting apply to Geldar's own workspace, not the other tenant's (F8 gone). Details in `docs/decisions/0352-telemetry-dedicated-clickhouse-database.md`.

## F9. Joining the other tenant's Docker network

**Problem.** Any Geldar writer on the other tenant's SigNoz side had to join that tenant's Docker network. Any container on that network can reach the other tenant's services, and the reverse.

**Options considered (under the earlier shared-stack design).**

1. **Send through a published loopback port of the other tenant's collector.** Not available: the other tenant publishes its ports on all interfaces, not loopback, and a loopback publish would change that tenant's configuration (0350 item 4). Rejected.
2. **`host-gateway` to the other tenant's published 4317 or 4318.** Uses the all-interfaces port with no ingestion key; relies on the node firewall (unverified). Rejected: it depends on exposure that already exists.
3. **Socat-style forwarder on the host to the other tenant's ClickHouse container address.** Not joined, one port, but it still writes Geldar data into the other tenant's server, which 0352 rejects.
4. **A Geldar-owned SigNoz stack and ClickHouse server (0352 option B).** The gateway joins only Geldar's own network.

**Resolution: option 4, accepted in 0352.** No Geldar container joins the other tenant's network, and no port of the other tenant is published or changed. F9 is no longer open. The only node-level action is creating Geldar's own Docker network and stack, which needs owner approval (N3 and N7). Nothing changes on the other tenant: no config, no network membership, no published port.

## F10. Mind-host ingest conflicts with the no-Caddy-change ruling (OPEN, owner decision)

**Problem.** Mind hosts post OTLP through an authenticated Caddy route (design section 9, T-15, N6). The owner ruled on 2026-11-16 that the shared Caddy is not changed or restarted. The route is therefore on hold. This finding does not decide it.

**Options (detail in design section 9.1).**

1. **SSH tunnel per Mind host to a loopback gateway port.** A dedicated key restricted to one `permitopen` port. No Caddy change; the bearer token and F4 to F6 are not needed for the tunnel.
2. **WireGuard to the Colo.** Strong, but a new interface, a key per host and a new UDP listener on the node.
3. **Colo-only ingest for now.** No Mind-host telemetry; the Mind transcript stays in session files.

**Recommendation (for the owner).** Option 1 with the restricted key; option 3 as the interim until the owner approves option 1. Not decided. No node step is requested.

## Summary

| Finding | Recommendation | Under 0352 option B | Owner decision needed |
|---|---|---|---|
| F1 | Loopback publish of one port; bearer check also on the gateway | Unchanged | Yes: the one loopback entry |
| F2 | Fixed-size volume with an items count; `sizer: bytes` only after the soak test | Unchanged; the downstream is the Geldar collector | Node step N2 |
| F3 | Container procfs for node CPU and memory; bind `/mnt/nvme` read-only; no process scraper | Unchanged; the bind also covers the Geldar disk | Only if `hidepid` is wanted |
| F4 | `{file.*}` placeholder or a secret mount for Caddy; not the reload environment | Unchanged | Caddy version check first |
| F5 | Gateway `bearertokenauth` after verifying its compare; token at least 32 random bytes | Unchanged | No |
| F6 | mTLS client certificate per Mind host; OS secret store as the fallback | Unchanged; Geldar writer and reader credentials are separate | Yes: the certificate CA and rotation |
| F7, F8 | Resolved: Geldar-owned ClickHouse and SigNoz stack (0352 option B) | Resolved | Owner ruling accepted (0352) |
| F9 | Resolved: no network join (0352 option B) | Resolved | Node steps N3 and N7 |

## Unverified (collected)

- Every 0.164.0 key named here: `sizer`, `queue_size` units, `file_storage` `max_size` and compaction keys (taken from the main-branch README), the `bytes` sizer, `bearertokenauth`'s compare, the `hostmetrics` and `filesystem` option keys for `root_path` and mount points.
- Caddy's `{file.*}` placeholder and `client_auth` directives for the node's Caddy version.
- The JS SDK's client-certificate environment names (T-03).
- Whether the container's `/proc/net/dev` and `/proc/stat` show node values on the node.
- The node's free RAM and CPU for option B were measured read-only on 2026-11-15 (0352 fit check); the peak under ClickHouse merges is not measured until a scratch run.
- Whether SigNoz 0.135 or later runs on one ClickHouse node without ZooKeeper or keeper (0352).
