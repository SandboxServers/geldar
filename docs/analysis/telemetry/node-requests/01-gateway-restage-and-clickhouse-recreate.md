# Node request 01: restage the telemetry tree (PT-12 gateway rules) and recreate the gateway, geldar-ch and keeper

Status: DRAFT for the owner and the orchestrator geldar-93. Nothing here has been run. Format: `docs/analysis/telemetry/collector-design.md` section 14 (step number, exact commands, caps, window, rollback, verification of section 16). Facts come from `deploy/telemetry/README.md` (window log 2026-11-17, "Gateway (N8)", item G10). Placeholders: `<merge>` the merge commit that holds the files, `<sha256>` the tarball checksum, `<ts>` a UTC timestamp, `<ssh-user>` the node account. No secret, address or account name is in this file.

Owner approval needed: yes (restart of a running ingest path, new gateway rules live, RAM already approved at N4).

## 1. What changes

1. The tree `/mnt/nvme/geldar-telemetry/src` is replaced by one extracted from `<merge>` (old tree kept as `src.old-n10`). The new tree carries `deploy/telemetry/gateway.yaml` with the PT-12 rules (G10: drop `RCON Client` / `Thread RCON` log lines that carry no `event.name`; delete `process.command_line`, `process.command_args`, `process.environment_variables` from resources; mask IPv4 and IPv6 in string log attribute values). The running gateway still has the pre-PT-12 file.
2. `geldar-gateway` is recreated from the new tree (a restart is not enough: the single-file bind of `gateway.yaml` follows the old inode, which the `mv src src.old-n10` swap leaves behind).
3. `geldar-ch-keeper` and `geldar-ch` are recreated from the new tree. Their bind mounts (`clickhouse/config.d`, `users.d`, `histogram_function.xml`, `keeper/keeper.yaml`) still point into the old `src` inodes from N4 (README window log: "the geldar-ch and keeper bind mounts still reference the old src inode until those containers are recreated"). After this request no container references any `src.old*` tree, so request 03 can delete them.
4. `geldar-signoz-otelcol` and `geldar-signoz`: not recreated unless the compose output of step 6 names them (see the stop rule there). `signoz-otelcol-config.yaml` was restaged at N7; if `<merge>` changes it, that is a separate request.

Content of `users.xml` in `<merge>`: on main today `users.xml` still defines `geldar_signoz_admin` (3 hits), so the hash line `GELDAR_CH_SIGNOZ_ADMIN_SHA256` MUST stay in `ch-hashes.env` and `ch_signoz_admin_password` stays. This request does not touch either file (editing `ch-hashes.env` also triggers a recreate). Check `<merge>`: if its `users.xml` no longer defines the user, still do not delete the line here; the teardown order is in the README ("Remaining teardown").

## 2. Not touched

Other tenants' containers and configuration; Paper, Velocity, `board-proxy` (Caddy), NATS, Postgres; all player Bodies, Minds and Geldar services (never restarted; the SDK retries, see section 5 outage); `geldar-colo` network; secrets and `ch-hashes.env`; the SigNoz data directory `query`; ClickHouse and Keeper data directories (contents stay, only containers are recreated); the queue directory contents; the `src.old*` trees and stage tarballs (kept).

## 3. Caps (unchanged, from compose files; no new limit)

| Container | CPU | RAM | pids |
|---|---|---|---|
| geldar-ch-keeper | 0.5 | 1g | 256 |
| geldar-ch | 3.0 | 8g | 1024 |
| geldar-gateway | 0.5 | 1g (GOMEMLIMIT 800MiB) | 256 |

Disk: tarball and a second extracted tree, about the size of `deploy/telemetry` (a few MB; check `du -sh src`). Queue worst case about 1.5 GiB (README "Limits"); ClickHouse data grows as before.

## 4. Window

Proposed: a low-load window of the owner's choice, 20 minutes reserved, no Paper, Caddy or Body change in the same day (rollout plan rule). Expected outage per component (all ESTIMATES, to be measured and written back; none verified):

| Component | Estimate | Effect |
|---|---|---|
| geldar-gateway recreate | 5 to 15 s | OTLP posts from Geldar services get a connection error; SDK retries; no Body restarts |
| geldar-ch-keeper recreate | 10 to 30 s (to `healthy`) | no ingest effect by itself; geldar-ch waits for it |
| geldar-ch recreate | 30 to 120 s (to `healthy`, depends on part count; UNVERIFIED) | the SigNoz collector retries; the gateway queues (persisted, 256 MiB per signal); the UI queries fail |
| Total telemetry gap | up to about 3 minutes | data produced meanwhile is held in the gateway queue and delivered afterwards; drops only if a queue fills (256 MiB each) |

Gateway rules go live at the gateway recreate: records already queued under the old rules are not re-filtered.

## 5. Baseline, captured BEFORE (read-only; write to `/mnt/nvme/geldar-telemetry/stage/baseline-n10-<ts>.txt`)

```
umask 077; b=/mnt/nvme/geldar-telemetry/stage/baseline-n10-<ts>.txt
{
docker ps --format '{{.Names}} {{.Image}} {{.Status}}'
docker inspect -f '{{.Name}} {{.RestartCount}} {{.State.Health.Status}} {{.Id}}' geldar-ch geldar-ch-keeper geldar-signoz geldar-signoz-otelcol
docker inspect -f '{{.Name}} {{.RestartCount}} {{.Id}}' geldar-gateway
docker inspect -f '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{println}}{{end}}' geldar-ch geldar-ch-keeper geldar-gateway
docker exec geldar-ch clickhouse-client -q "SELECT 'logs', count() FROM signoz_logs.distributed_logs_v2 UNION ALL SELECT 'traces', count() FROM signoz_traces.distributed_signoz_index_v3"
docker exec geldar-ch clickhouse-client -q "SELECT database, round(sum(bytes_on_disk)/1e9,2) AS gb FROM system.parts WHERE active GROUP BY database"
docker run --rm -v /mnt/nvme/geldar-telemetry/queue:/q:ro busybox@sha256:73aaf090f3d85aa34ee199857f03fa3a95c8ede2ffd4cc2cdb5b94e566b11662 du -sh /q
df -h /mnt/nvme
ls -ld /mnt/nvme/geldar-telemetry/src* ; ls -l /mnt/nvme/geldar-telemetry/*.tar.gz
docker stats --no-stream geldar-ch geldar-ch-keeper geldar-gateway
} > "$b" 2>&1
```
Also record the gateway queue state in SigNoz (or via the 8888 scrape): `otelcol_exporter_queue_size`, `otelcol_exporter_enqueue_failed_*`, `otelcol_exporter_send_failed_*`, `otelcol_processor_refused_*` (all expected flat or zero). Row-count queries use the same tables as README verification step 7 (adjust names if `DESCRIBE` differs). Stop if the stack is not already `healthy` or the queue is above 50 percent of capacity.

## 6. Steps (templates)

1. Stage, on the dev machine: `git archive --format=tar.gz -o telemetry-<merge>.tar.gz <merge> deploy/telemetry && sha256sum telemetry-<merge>.tar.gz` (Windows: `Get-FileHash -Algorithm SHA256`). Copy to `/mnt/nvme/geldar-telemetry/` by the route of the first staging.
2. Node: `cd /mnt/nvme/geldar-telemetry && echo "<sha256>  telemetry-<merge>.tar.gz" | sha256sum -c -` must print `OK` (else delete the tarball and stop). Keep every earlier tarball.
3. Swap: `mkdir src.new && tar -xzf telemetry-<merge>.tar.gz -C src.new && mv src src.old-n10 && mv src.new src`. `src.old`, `src.old-n6d`, `src.old-n7`, `src.old-n8` and `src.old-n10` all stay.
4. Validate the gateway config on the pinned image before any restart (README "Node steps" step 4; the queue directory must be mounted): `docker run --rm --network none -e GELDAR_SIGNOZ_OTLP_ENDPOINT=geldar-signoz-otelcol:4317 --entrypoint /otelcol-contrib -v /mnt/nvme/geldar-telemetry/src/deploy/telemetry/gateway.yaml:/etc/otelcol/gateway.yaml:ro -v /mnt/nvme/geldar-telemetry/queue:/var/lib/otelcol/queue otel/opentelemetry-collector-contrib@sha256:340c9ca6a36617084c6661bdc4f0fe92b7cda5a805d61673ec8db375fddc522b validate --config=/etc/otelcol/gateway.yaml`. Must print nothing and exit 0. On any output: `mv src src.failed && mv src.old-n10 src` and stop.
5. Render before applying: `cd /mnt/nvme/geldar-telemetry/src && docker compose -f deploy/telemetry/compose.yml -f deploy/telemetry/compose.gateway.yml config -q` exits 0; `docker compose ... up -d --no-start --dry-run` (or read the plan) and confirm which services compose would recreate. Stop rule: if `geldar-signoz` or `geldar-signoz-otelcol` would be recreated and the owner has not approved it, stop.
6. Keeper first, then ClickHouse, then the gateway, each its own command with a health wait:
   - `docker compose -f deploy/telemetry/compose.yml -f deploy/telemetry/compose.gateway.yml up -d --force-recreate --no-deps geldar-ch-keeper`; wait until `docker inspect -f '{{.State.Health.Status}}' geldar-ch-keeper` prints `healthy` (poll, 120 s limit).
   - `... up -d --force-recreate --no-deps geldar-ch`; wait `healthy` (poll, 300 s limit). Check `docker exec geldar-ch clickhouse-client -q "SELECT name FROM system.users ORDER BY name"` lists the writer, reader and (until teardown) the admin user; a "Env variable is not set" start failure means `ch-hashes.env` lacks a line `users.xml` needs: stop (README "Third hash").
   - `... up -d --force-recreate --no-deps geldar-gateway`. Name every service in the compose output; any not named above is a stop.
7. Never `docker compose down`, never `restart` of a service in place (bind mounts), never touch another project.

## 7. Verify, AFTER (end to end; README "Gateway" Verification and collector-design section 16)

1. Bind mounts left the old tree: `docker inspect -f '{{range .Mounts}}{{.Source}}{{println}}{{end}}' geldar-ch geldar-ch-keeper geldar-gateway` shows paths under `src`; and no container holds a deleted inode: for each, `docker exec <c> ls -li <mounted file>` equals `ls -li` of the file in the new `src` on the node (same inode number).
2. Health: `geldar-ch`, `geldar-ch-keeper` `healthy`, restart count 0; gateway `docker run --rm --network geldar-telemetry curlimages/curl@sha256:c1fe1679c34d9784c1b0d1e5f62ac0a79fca01fb6377cdd33e90473c6f9f9a69 -s -o /dev/null -w '%{http_code}\n' http://geldar-gateway:13133/` prints `200`; `docker logs geldar-gateway --since <ts>` has no error line (connection refused during the ClickHouse window is expected until it is healthy).
3. Data flows: spans and metrics from the Geldar services and logs from Paper (if present) keep arriving: row counts of section 5 higher after 5 minutes than at the baseline; in SigNoz (tunnel or the operator read-only route) `geldar-*` services show current traces; `geldar_*` metrics present.
4. Drops zero: `otelcol_exporter_enqueue_failed_*` and `otelcol_processor_refused_*` flat (they restart from zero with the gateway: read them from the new process start); `otelcol_exporter_send_failed_*` stops rising once ClickHouse is healthy; queue size falls back to near zero within 10 minutes.
5. PT-12 rules live (README verification step 7 as the pattern, with the PT-12 cases): post a log whose body is `Thread RCON Client test` without `event.name`, and one with `event.name` set and the same words: first absent, second present; post a resource with `process.command_line`: key absent in `resources_string`; post a log attribute value holding a documentation address: stored as `<addr>`. Delete the payload files under `stage/` afterwards. Verification payloads use documentation addresses only (`203.0.113.x`).
6. Retained rows: rows with attribute `n9.run` still present (data survived the recreate).
7. Free space: `df -h /mnt/nvme` not lower than the baseline by more than the new tree plus normal growth.

Stop criteria during the window: geldar-ch not `healthy` after 300 s; the gateway validate fails; any Body, Paper or other tenant container restarts; queue above 80 percent of capacity.

## 8. Rollback

The old trees and stage tarballs are kept, and nothing is deleted in this request.

- Gateway only (rules misbehave): `cd /mnt/nvme/geldar-telemetry && mv src src.new-n10 && cp -a src.old-n10 src` (or `mv`; keep both names), then recreate the gateway as in step 6. Records already redacted by PT-12 stay redacted.
- ClickHouse or Keeper (does not become healthy): restore the tree the same way and recreate `geldar-ch-keeper` then `geldar-ch` with `--force-recreate --no-deps`. The data directories were not touched, so no restore of data is needed. If the data directory itself is damaged (never expected: only containers were recreated), stop and ask the owner before any change.
- Last resort: extract the previous stage tarball (`telemetry-<older merge>.tar.gz`, checksum on file) into a new directory and swap.
- The queue holds data across a gateway rollback (persisted).

After a rollback the requests 03 (delete old trees) stays blocked.

## 9. Report-back (orchestrator writes into `deploy/telemetry/README.md` window log)

UTC start and end, measured outage seconds per component, row counts before and after, queue peak, the baseline file name, whether any compose service outside the three was named, and the result of every check in section 7.

## 10. Open facts (cannot be settled in the repo)

- Measured recreate time of `geldar-ch` (part count unknown).
- Whether `<merge>` changes `compose.yml`, `compose.gateway.yml` or `signoz-otelcol-config.yaml` (then compose may name more services).
- The current compose project working directory on the node and whether `src` is it (README says `cd .../src`).
- Whether the `--dry-run` flag exists on the node's Compose version (Compose 2.24 or later is also an unchecked need).
- Real column names of the logs and traces tables are as in the window log; recheck with `DESCRIBE`.
