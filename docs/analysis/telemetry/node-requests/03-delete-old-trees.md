# Node request 03: retire the retention admin user (part B) and delete the old staged trees (part A)

Status: DRAFT. Nothing has been run. Part B needs a SigNoz and ClickHouse sanity check first. Part A needs request 01 finished and the timing in section 4 met. The owner must say go for each part.

Source of the rules: README "Remaining teardown" (steps 1 to 3) and RESUME.md "Held": the `src.old*` trees and stage tarballs stay until `geldar-ch` and keeper are recreated from the new `src`.

Owner approval: yes for both parts (irreversible deletions on the node, inside the Geldar data path only).

Order: part B first, then part A. Part A keeps the old trees until part B's `geldar-ch` recreate has been verified.

## 1. What changes

**Part A.** Delete these directories under `/mnt/nvme/geldar-telemetry/`: `src.old`, `src.old-n6d`, `src.old-n7`, `src.old-n8`, `src.old-n10`. These names come from the README window log and request 01. Read the actual list on the node first; there may be others. Stage tarballs (`telemetry-<merge>.tar.gz` and friends) are NOT deleted by this request: the newest two stay as the rollback source for the next restage, and older ones are deleted only if the owner names them.

**Part B.** Retire the retention-window admin user `geldar_signoz_admin`. The `users.xml` in 1e4f2078 no longer defines it (request 01 confirmed it: `system.users` lists `default`, `geldar_reader` and `geldar_writer` only). What is left on the node:

- the line `GELDAR_CH_SIGNOZ_ADMIN_SHA256` in `/mnt/nvme/geldar-telemetry/secrets/ch-hashes.env`;
- the file `/mnt/nvme/geldar-telemetry/secrets/ch_signoz_admin_password`.

Part B deletes both, then recreates `geldar-ch` so that its `env_file` matches.

**Not changed by either part:** `stage/` payload files (except the backup in part B, which is deleted after verify), secrets other than the two above, data, queue, the live `src`, `clickhouse`, `keeper`, `query`, `queue`.

## 2. Not touched

Everything outside the named paths: other tenants, Paper, Velocity, Caddy, Bodies, Docker objects, the live `src`, `clickhouse`, `keeper`, `query`, `queue`, the secrets other than the two named in part B. `compose.retention.yml` is not applied, and is not edited.

## 3. Caps

Disk only for part A (frees space; no CPU or RAM). Part B changes one env value and recreates `geldar-ch` (its ingest stops for the recreate, about 5 to 10 s to healthy as seen in request 01). Sudo scope: none expected (the files are owned by the ssh user). If a path or file is root-owned, stop and ask; sudo scope is `mkdir` and `chown` inside the telemetry root only.

## 4. Timing

- **Part B:** any time after a SigNoz and ClickHouse sanity check (section 5, steps B0 and B1). It goes before part A.
- **Part A:** not before 2026-11-18T14:00Z. Request 01 finished at 2026-11-17T13:55Z, so this is 24 h of clean running, so a late-found problem could still roll back to the old trees. Earlier only if geldar-93 says so.

Expected outage: none for part A (no container reads these paths after request 01). Part B: `geldar-ch` restarts once (recreate), so ingest pauses for that recreate.

## 5. Part B: baseline, steps, verify, rollback

**Baseline (read-only, before any change).** Run from the repo checkout root `/mnt/nvme/geldar-telemetry/src`:

- B0 SigNoz and ClickHouse sanity: `docker ps --format '{{.Names}} {{.Status}}' | grep '^geldar-'` (all healthy); `docker exec geldar-ch clickhouse-client -q "SELECT name FROM system.users ORDER BY name"` lists no `geldar_signoz_admin`; SigNoz API health returns 200 on `http://127.0.0.1:8095` [UNV: health path not checked on the node; use the path the README uses for SigNoz checks]. Stop if any of these fail.
- B1 Row counts and queue: `docker exec geldar-ch clickhouse-client -q "SELECT 'logs', count() FROM signoz_logs.distributed_logs_v2 UNION ALL SELECT 'traces', count() FROM signoz_traces.distributed_signoz_index_v3"` (record both; the table names are the ones used in request 01). `du -sh /mnt/nvme/geldar-telemetry/queue`.
- B2 Files (names, owner and mode only; never print contents): `ls -ln /mnt/nvme/geldar-telemetry/secrets/ch-hashes.env /mnt/nvme/geldar-telemetry/secrets/ch_signoz_admin_password`. Expect owner = the ssh user (not `0`), mode `-r--------` or `-rw-------`. Hash line count: `grep -c '^GELDAR_CH_SIGNOZ_ADMIN_SHA256=' /mnt/nvme/geldar-telemetry/secrets/ch-hashes.env` prints `1` (do not print the file).
- B3 No consumer besides the retention override: `grep -rl ch_signoz_admin_password /mnt/nvme/geldar-telemetry/src`. Expect only `deploy/telemetry/compose.retention.yml` and `deploy/telemetry/README.md`. Any other hit stops part B. (`-l` prints file names only, so no secret line is printed.)
- B4 Override not applied: `docker inspect -f '{{.Config.Cmd}}' geldar-signoz | grep -c geldar_signoz_admin` prints `0`. `docker compose -f deploy/telemetry/compose.yml config | grep -c geldar_signoz_admin` prints `0`. If `geldar-signoz` still names the admin user, stop: the override is on, and it must be closed first (README "End the window").

**Backup.** `cd /mnt/nvme/geldar-telemetry && (umask 077; cp -p secrets/ch-hashes.env stage/ch-hashes.env.bak-<ts>) && chmod 0400 stage/ch-hashes.env.bak-<ts>`. Keep `<ts>` as a UTC timestamp. No value in argv: this copies the file, it prints nothing.

**Steps.**

1. Edit the env file: `chmod u+w secrets/ch-hashes.env`, remove the line `GELDAR_CH_SIGNOZ_ADMIN_SHA256=` with an editor (no value in argv), then `chmod 0400 secrets/ch-hashes.env`.
2. Delete the secret file with its full literal path: `rm -- /mnt/nvme/geldar-telemetry/secrets/ch_signoz_admin_password`.
3. Dry run first: `(cd /mnt/nvme/geldar-telemetry/src && docker compose -f deploy/telemetry/compose.yml up -d --dry-run)`. Expect only `geldar-ch` to be recreated (its `env_file` content changed). Any other container named for recreate stops part B; restore the backup (see rollback) before going further.
4. Recreate: `(cd /mnt/nvme/geldar-telemetry/src && docker compose -f deploy/telemetry/compose.yml up -d)`. `geldar-ch` must start, because `users.xml` no longer names the user, so no `from_env` needs the variable (README "Hazard").
5. Wait for `geldar-ch` to be healthy. **Stop rule:** not healthy within 300 s: go to rollback at once.

**Verify (after step 5).**

- `docker inspect -f '{{.State.Health.Status}} {{.RestartCount}}' geldar-ch geldar-ch-keeper` prints `healthy 0` twice.
- `docker ps --format '{{.Names}} {{.Status}}' | grep '^geldar-'` lists every `geldar-*` container healthy or running as in the baseline; no container restarted except `geldar-ch`.
- `docker exec geldar-ch clickhouse-client -q "SELECT count() FROM system.users WHERE name = 'geldar_signoz_admin'"` prints `0`.
- `grep -c '^GELDAR_CH_SIGNOZ_ADMIN_SHA256=' secrets/ch-hashes.env` prints `0` (grep exits 1 on zero matches; that is expected here). `ls secrets/ch_signoz_admin_password` reports no such file.
- `docker compose -f deploy/telemetry/compose.yml config | grep -c GELDAR_CH_SIGNOZ_ADMIN` prints `0`.
- Gateway: `http://geldar-gateway:13133/` returns 200 (from the telemetry network, as in request 01 section 7.2). SigNoz API health returns 200 (B0).
- Row counts rising against B1; `du` of the queue at or near the baseline.
- Then delete the backup: `rm -- /mnt/nvme/geldar-telemetry/stage/ch-hashes.env.bak-<ts>`.

**Rollback.** Before the backup is deleted:

1. `chmod u+w secrets/ch-hashes.env`, copy the backup over it (`cp -p stage/ch-hashes.env.bak-<ts> secrets/ch-hashes.env`), `chmod 0400 secrets/ch-hashes.env`.
2. `(cd /mnt/nvme/geldar-telemetry/src && docker compose -f deploy/telemetry/compose.yml up -d --force-recreate geldar-ch)`; wait for healthy with restart count 0.

**The secret file cannot be restored if it was deleted in step 2.** It is only used by `compose.retention.yml`, and the README says a later window needs a fresh password and a fresh hash, never the old password. So a rollback restores the hash line and not the file. That is acceptable: the admin user is not defined in `users.xml`, so the file has no consumer until a later window.

## 6. Part A: steps

1. Print the exact list to delete and get the owner's word on it (names only). The list is read on the node: `cd /mnt/nvme/geldar-telemetry && ls -ldn src src.old*` and `du -sh src.old*`.
2. Baseline and mount check. `docker ps --format '{{.Names}}' | grep '^geldar-' | while read -r c; do docker inspect -f '{{.Name}}{{println}}{{range .Mounts}}  {{.Source}}{{println}}{{end}}' "$c"; done > stage/mounts-before-delete-<ts>.txt`, then `grep -c 'src\.old' stage/mounts-before-delete-<ts>.txt`. The count must be `0`: no running container mounts an old tree. Any hit stops the request (that container was not recreated; go back to request 01). Also `df -h /mnt/nvme` before.
3. For each directory: `rm -rf -- /mnt/nvme/geldar-telemetry/<name>` with the full literal path, never a glob, never a variable that could be empty.
4. `ls -ld /mnt/nvme/geldar-telemetry/*` and `df -h /mnt/nvme`.

**Verify after part A.** `docker ps` unchanged and every `geldar-*` container healthy or running as in the baseline; `df` shows the freed size; gateway `13133` returns 200; no new restart count (`docker inspect -f '{{.RestartCount}}'`); telemetry still flowing (row count higher than the B1 baseline).

**Rollback for part A.** None for the deleted files. The recovery path is `git archive <merge>` plus the kept tarballs. That is why the newest two tarballs stay and why part A waits a day after request 01. If a container turns out to hold an old inode (it would show as `Exited` or a changed file), recreate that container from `src` as in request 01 section 6.

## 7. Verify section: drops and counters (both parts)

The gateway's `otelcol_exporter_*` failure series are not exposed until their first increment (OpenTelemetry counters appear on first use). So an absent series is the expected result when nothing has failed, and it is not a proof of zero drops by itself. Verify drops are zero by one of:

- absence of the failure series (`otelcol_exporter_enqueue_failed_*`, `otelcol_exporter_send_failed_*`, `otelcol_receiver_refused_*` names [UNV: exact names not read on the node]) together with a readable `otelcol_exporter_queue_size` series; or
- sending a test record that is expected to fail, and seeing the failure series appear. Use a record that fails for a known reason (for example a malformed payload), and remove the test record from the stage afterwards.

The gateway metrics endpoint is loopback-only (`127.0.0.1:8888` inside the container), so read it from inside the container's network namespace, as in request 01.

## 8. Open facts

The exact list of old trees and tarballs on the node; whether any is root-owned; whether anything other than compose refers to the old trees or the secret file (cron or scripts: not known from the repo); the SigNoz API health path (B0, [UNV]); the exact gateway failure-series names (section 7, [UNV]).
