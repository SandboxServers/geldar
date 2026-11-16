# Geldar telemetry stack (T-20): deploy files

Status: files only. Nothing here has been started, pulled or validated on the node. Decision record: `docs/decisions/0370-telemetry-clickhouse-25-12-pin.md` (amends 0352). Design: `docs/analysis/telemetry/collector-design.md`. Research and the facts behind each file: `docs/analysis/telemetry/t20-stack-files.md`.

Labels used in the comments of these files: `[SRC]` quoted from the cited file at the cited tag; `[INF]` inferred; `[AUTH]` written here, not from SigNoz; `[UNV]` unverified, must be checked in the scratch run before any start.

## Pins

Compose references every image as `repo@sha256:<index digest>` (digest only, no tag; the tag is listed in the table). The amd64 digest is recorded for the node check (`docker manifest inspect`), not used in compose.

| Image | Tag | Index digest | linux/amd64 digest | Push date (UTC) | Runtime user |
|---|---|---|---|---|---|
| clickhouse/clickhouse-server | 25.12.5 (build 44) | sha256:cacf32d6884291dc2ff5e0156a97f46fc53ff7c929a7906d114e268a929dfd3a | sha256:10f54f04de6c61b756c4eaf9f1d17464a4ac3e1f94b5b410e0dec92a24dbeda8 | 2026-02-02 | starts as root; its entrypoint drops to 101:101 [INF, see Owner uids] |
| clickhouse/clickhouse-keeper | 25.12.5 (build 44) | sha256:525b8b0f93ccb371131c46f22a066ea43d33d74aba314203e8044609945d8524 | sha256:5493b0fba2fdfc3bf51115db4fb378fac8b0a953c116db442fd4297a8f49a9d7 | 2026-02-02 | runs as 101:101 directly (compose `user:`, entrypoint overridden, no drop) [INF, see Owner uids] |
| signoz/signoz | v0.148.1 | sha256:a7d1a968a1f7f65c518106150ac05424ca8e91c52d7076077dfce034980e9c34 | sha256:909443fb98d16048df866d49f6efe5e8b19dd60e20821bee2c45c46090700027 | 2026-10-29 | root (no drop) [SRC] |
| signoz/signoz-otel-collector | v0.144.6 | sha256:7e4e539a73f1f88fbc1cd7e659ab3950908e83ce1f2a37a297452f910d072174 | sha256:13fca6050f79c49a0bdc644ccdc65a9248f22f3b4337d1e0680da026a764d77e | 2026-07-14 | 10001 [SRC] |
| signoz/signoz-schema-migrator (UNUSED) | v0.144.6 | sha256:4e57475fbf8b24168dcfbe6fc5799bb3f3d965819b72663580d0926185b68bf5 | not recorded | 2026-07-14 | n/a (not run by compose) |
Why these tags: 25.12.5 (build 44) is the ClickHouse line SigNoz v0.148.1 tests in CI. v0.144.6 is the collector version the v0.148.1 `go.mod` pins. The newer 25.12.11 (build 4) and 26.3.62 (build 3) are not used (see 0370). The digests were read from the Docker Hub registry API on 2026-11-16 and were not pulled.

**Unused:** the `signoz/signoz-schema-migrator` row is kept for the record only. Compose does not run it. The one-shot migrator runs the `migrate` subcommands of the collector image (`signoz/signoz-otel-collector`, same digest as the collector), so no separate migrator image is pinned. Its entry in `tools/repo-checks/src/release-dates.json` is therefore unused as well.

## Owner uids

- **clickhouse-server**: the image config `User` is empty, so the container starts as root. Its entrypoint then chowns the data directory and drops to `clickhouse` (uid 101, gid 101). The drop is inferred from upstream `docker/server` (`groupadd -r clickhouse --gid=101`) and is **not checked in the image**.
- **clickhouse-keeper**: compose sets `user: "101:101"` and overrides the entrypoint with `/usr/bin/clickhouse-keeper`, so the Keeper process never runs as root and the `/entrypoint.sh` drop is not used. The uid 101 is inferred and **not checked in the image**. The Keeper data directory `/mnt/nvme/geldar-telemetry/keeper` must be owned by 101:101 before start.

  Check both images on the node before any `chown` of `/mnt/nvme/geldar-telemetry/clickhouse` or `/keeper`:

  ```
  docker run --rm --entrypoint id clickhouse/clickhouse-server@sha256:cacf32d6884291dc2ff5e0156a97f46fc53ff7c929a7906d114e268a929dfd3a clickhouse
  docker run --rm --entrypoint id clickhouse/clickhouse-keeper@sha256:525b8b0f93ccb371131c46f22a066ea43d33d74aba314203e8044609945d8524 clickhouse
  ```

  Expected: `uid=101(clickhouse) gid=101(clickhouse)`. **Stop on any other output** and do not chown. (The check runs a container and is a scratch-run step, not part of this packet.)
- **signoz-otel-collector** (also the migrator, which runs its `migrate` subcommands from the same image): uid 10001 [SRC, image `User`]. The secret files are mounted for uid 10001 (see the compose file).
- **signoz**: root [SRC]. Data dir `/mnt/nvme/geldar-telemetry/query` is owned by root.

## Host paths

All writable host paths are under `/mnt/nvme/geldar-telemetry`. Besides them, the compose file has five read-only mounts from the repo checkout (relative paths, so they resolve to the CD checkout on the node, outside that root):

- `./clickhouse/config.d` (ClickHouse config)
- `./clickhouse/users.d` (ClickHouse users and profiles)
- `./clickhouse/histogram_function.xml` (histogram UDF)
- `./clickhouse/keeper/keeper.yaml` (Keeper config)
- `./signoz-otelcol-config.yaml` (collector config)

No `docker.sock` is mounted in any service.

- `/mnt/nvme/geldar-telemetry/clickhouse` (server data; config comes from the read-only repo mounts above; logs go to the console)
- `/mnt/nvme/geldar-telemetry/keeper` (Keeper data)
- `/mnt/nvme/geldar-telemetry/query` (SigNoz SQLite directory)
- `/mnt/nvme/geldar-telemetry/secrets` (password files and the hash env file, owners and modes per file in the Secrets table)

## Networks

- `geldar-telemetry`: external, created on the node at N2 (not by this file). Shared with `geldar-gateway`. Joined by `geldar-ch`, the migrator, SigNoz and the collector.
- `geldar-telemetry-backend`: created by Compose for this project (`internal: true`, bridge). Docker name `geldar-telemetry_geldar-telemetry-backend`. Joined only by `geldar-ch` and `geldar-ch-keeper`, so Keeper (unauthenticated ZooKeeper protocol) is not reachable from `geldar-gateway`. `cluster.xml` reaches Keeper by its service name there.
- This adds **one extra Docker network at N4**. The N4 request must name it, and the N4 checks below must include it.
- Rollback: `docker compose -f deploy/telemetry/compose.yml down` removes it with the project. Check with `docker network ls` that `geldar-telemetry_geldar-telemetry-backend` is gone. The external `geldar-telemetry` is not removed by compose.

## Deviation from collector-design section 4

- **One SigNoz container, not two.** SigNoz v0.148.1 serves the query API and the frontend from one container (`signoz/signoz`, port 8080) [SRC, `conf/example.yaml` `web.enabled: true`; `cmd/enterprise/Dockerfile.multi-arch` copies the frontend build to `/etc/signoz/web`]. So this stack has one `geldar-signoz` (1.0 CPU, 1g memory, 1g memswap, 256 pids) and no `geldar-signoz-ui`.
- The name `geldar-signoz-query` is **not used**.
- The one published port is `127.0.0.1:8095:8080` (loopback only, reached over an SSH tunnel). Port 8095 is assumed free: no N1 source for it is in the repo; confirm with `ss -ltn` before N4. Host port 3301 is not used (the packet does not allow it).
- Caps for the other containers are the 0352 table values, as in collector-design section 4. The ClickHouse caps (3.0 CPU, 8g, 1024 pids) and the Keeper caps (0.5, 1g, 256) are not changed. The migrator is 0.5, 512m, 128. The collector is 0.5, 1g, 256.

## Secrets

Passwords are never inline. Compose mounts them as file secrets from `/mnt/nvme/geldar-telemetry/secrets/`:

- `ch_writer_password`: the writer password. Used by the migrator and the collector.
- `ch_reader_password`: the reader password. Used by the query service.

**Password format (S-E):** each password is 32 random bytes as 64 lowercase hex characters (`[0-9a-f]` only, for example `openssl rand -hex 32`). No other characters: the value is placed in a `tcp://user:password@host` URL, where `@ / : ? # %` break the parse. Each file has no trailing text; `$(cat)` strips the final newline.

**File owner and mode.** Compose ignores `uid`, `gid` and `mode` on file secrets on a non-Swarm engine `[INF]`, and this compose file does not set them. The container sees the host file's owner and mode. Create the files with the owner and mode below, then check with `ls -ln` (see item 14). The owner is numeric because the container has no name for it.

| File (host) | Read by | Runs as | Required owner:mode |
|---|---|---|---|
| `secrets/ch_writer_password` | `geldar-signoz-migrator`, `geldar-signoz-otelcol` (wrapper) | uid 10001 (image `User`) | `10001:10001` `0400` |
| `secrets/ch_reader_password` | `geldar-signoz` (wrapper) | uid 0 (root, no USER; `cap_drop: ALL`, so no DAC_OVERRIDE) | `0:0` `0400` |
| `secrets/ch-hashes.env` | the compose client, which passes it to `geldar-ch` as env (`env_file`); no container reads the file | the operator running compose | operator's own uid, `0400` |

A reader file owned by 10001 would be unreadable to `geldar-signoz` (root without DAC_OVERRIDE cannot read a 0400 file owned by another uid); a writer file owned by root would be unreadable to 10001.

### Password hashes

`clickhouse/users.d/users.xml` is well-formed and contains no hash. Each user reads its hash with `<password_sha256_hex from_env="..."/>`: `GELDAR_CH_WRITER_SHA256` (writer) and `GELDAR_CH_READER_SHA256` (reader). `geldar-ch` loads them from `/mnt/nvme/geldar-telemetry/secrets/ch-hashes.env` (compose `env_file`, not in git). Write that file on the node, mode 0400, with two lines `GELDAR_CH_WRITER_SHA256=<hex>` and `GELDAR_CH_READER_SHA256=<hex>`. Make each hex with the guarded form below, run as host root (`sudo`), which can read both 0400 secret files whatever their owner. The form stops on an empty or short password, so an unreadable file cannot produce a hash:

```
pw=$(cat /mnt/nvme/geldar-telemetry/secrets/ch_writer_password) && [ "${#pw}" -eq 64 ] && printf %s "$pw" | sha256sum | cut -d' ' -f1
```

Use the same form for `ch_reader_password`. If a command prints nothing or exits non-zero, stop and do not write that hash. The hash `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` is the SHA-256 of the empty string (what an empty password would give); if it appears in `ch-hashes.env`, delete that file and start again. Do not put the values in a command line that is saved in shell history.

- `from_env` in ClickHouse config is `[INF]`, unverified on 25.12.5. **Blocks start of geldar-ch** (a missing variable is a start failure, which fails closed).
- Residual exposure: the hash is in the container environment, so `docker inspect geldar-ch` shows it to anyone with Docker access. A sha256 of a password can be brute-forced offline. Docker access is root-equivalent on this host, so this is accepted, not removed.

### Secret wrappers (migrator, SigNoz, collector)

The DSNs are built by a short shell wrapper that reads the secret file at start (see the compose `command:` lines). The wrapper text contains `$(cat /run/secrets/...)`, not the value, so no password is in argv or in `docker inspect`. The value lives in the environment of the running process, which is readable by root and by the same uid through `/proc/<pid>/environ`. That residual exposure is accepted for this single-node host. The migrator uses the collector image (`signoz/signoz-otel-collector`, see the Pins), so its DSN is an environment variable, as the SigNoz `migrate` subcommands expect. The wrapper relies on `/bin/sh` in the image: `[UNV]` for the collector and the SigNoz image is alpine.

No secret value, token or account name is in this directory.

## Healthchecks and restarts

Compose gates start on health. `geldar-ch` waits for `geldar-ch-keeper` to be healthy. The migrator, `geldar-signoz` and `geldar-signoz-otelcol` wait for `geldar-ch` to be healthy. So a failing Keeper healthcheck stops `geldar-ch` from starting, and a failing ClickHouse healthcheck stops the migrator, SigNoz and the collector from starting. The blocked services are not restarted and do not start at all.

Nothing restarts a service because of a healthcheck: plain Docker does not act on `unhealthy`, and there is no autoheal sidecar. Restart loops (`restart: unless-stopped`) come only from a process exit, for example a ClickHouse config parse error. Those do not damage data.

## Unverified, check in the scratch run

Each item says what it blocks. Nothing starts on the node until the items marked **blocks start** are checked.

1. **SQLite env names** (`SIGNOZ_SQLSTORE_PROVIDER`, `SIGNOZ_SQLSTORE_SQLITE_PATH`) and the SQLite path `/var/lib/signoz/signoz.db`. The default path is `[SRC]` from `conf/example.yaml`. The SQLite path env name is `[INF]` from the key naming. **Blocks start of geldar-signoz.**
2. **JWT and tokenizer env names** (`SIGNOZ_TOKENIZER_PROVIDER=opaque` default; `SIGNOZ_TOKENIZER_JWT_SECRET` only if provider is jwt). `[INF]`. Not needed while the provider is opaque. **Blocks nothing if opaque is kept.**
3. **Collector healthcheck** `wget --spider -q localhost:13133`. The collector image is debian with only ca-certificates; `wget` is not confirmed. The compose file leaves this healthcheck off until checked. **Blocks the collector's healthcheck only.**
4. **Reader user versus SigNoz retention changes.** SigNoz may run DDL for TTL or retention changes through the API. The reader is read-only (`readonly=2` as in 0352: settings may change, data may not). Its grants are SELECT on the `signoz_*` databases only. If the UI or API changes retention, that call fails. **Blocks any retention change from the UI** (not the start).
5. **Async insert settings.** None of the SigNoz files searched set `async_insert`. The file sets none. **Blocks nothing; a tuning question.**
6. **Histogram quantile init.** The `histogramQuantile` binary is fetched from GitHub by an init container in the upstream compose. This packet does not do that. The operator must vendor the binary into `/mnt/nvme/geldar-telemetry/clickhouse/user_scripts/histogramQuantile` and check its sha256 before start. **Blocks SigNoz metrics queries that use histogramQuantile.** The binary is not in the repo.
7. **ClickHouse 25.12.5 (build 44) and migrator compatibility.** The migrator v0.144.6 is tested by SigNoz CI with 25.12.5. Run the migrator once against this server and check its exit status before the collector starts. The writer profile (`max_execution_time` 60, `max_memory_usage` 2 GB) also applies to the migrator, which runs as `geldar_writer` (item 28). **Blocks start of the collector.**
8. **Keeper command.** Compose overrides the keeper entrypoint with `/usr/bin/clickhouse-keeper --config-file=...` (as Foundry does [SRC]) and sets `user: "101:101"`, so the `/entrypoint.sh` drop is not used. `[UNV]` that the binary path and the 101 data-dir owner match the 25.12.5 (build 44) image. **Blocks start of geldar-ch-keeper** until the id check and the chown are done.
9. **ClickHouse `ON CLUSTER` with the `default` user.** The cluster entry in `cluster.xml` has no user, so DDL runs as `default`. `default` is kept, with networks restricted to loopback (`127.0.0.1`, `::1`, item 21), for this reason. If the scratch run shows ON CLUSTER refused from the container's own address, widen it to the Geldar telemetry subnet, never `::/0`. The plan: after the scratch run confirms DDL works, set `<user>` and `<password>` for `writer` in `remote_servers` and remove the `default` user. **Blocks the decision to remove `default`.**
10. **Container `wget` for ClickHouse** (`http://127.0.0.1:8123/ping`; `127.0.0.1` because `listen_host` is `0.0.0.0`, so `localhost` may resolve to `::1` and fail, item 23). `[SRC]` from SigNoz devenv and Foundry; not checked inside the image. **Blocks start of geldar-ch and everything behind it** (see "Healthchecks and restarts").
11. **Keeper healthcheck** `clickhouse-keeper-client -h 127.0.0.1 -p 9181 -q ls` (the Keeper uses the client protocol here, so the four-letter-word list `ruok,mntr,srvr` does not matter to it). `[SRC]` Foundry; the binary's presence in the 25.12.5 (build 44) image is not checked. **Blocks start of geldar-ch and everything behind it** (see "Healthchecks and restarts").
12. **SigNoz healthcheck** `wget --spider -q http://localhost:8080/api/v1/health`. busybox `wget` in alpine `[INF]`. **Blocks nothing**: no service depends on `geldar-signoz`, so a failing check only marks it unhealthy.
13. **Collector DSN wrapper.** The collector and migrator read the password from a file through a shell wrapper. The collector's `${env:}` expansion is `[SRC]`; `${file:}` is not used. Whether the image has `/bin/sh` is unchecked. **Blocks start of the collector and migrator.**
14. **Secret file owner and mode.** Compose keeps the host file's owner and mode for file secrets `[INF]`, on any engine (not only Docker Desktop), and the Compose version on the node is not checked. Create the files per the Secrets table, then run `ls -ln /mnt/nvme/geldar-telemetry/secrets` and check the numbers match. In the scratch run, check reachability: `docker exec geldar-signoz test -r /run/secrets/ch_reader_password` and `docker exec geldar-signoz-otelcol test -r /run/secrets/ch_writer_password` must both exit 0. The one-shot migrator is not running after its exit, so for it only the `ls -ln` check applies. **Blocks start of geldar-signoz (reader) and of the migrator and collector (writer).**
15. **Logs and ports of SigNoz.** The server's listener on 8080 is `[SRC]` from the SigNoz config. The OpAMP listener on 4320 is not used here (no manager config), so it is not published. `[UNV]` whether the server also opens 4320 by default. **Blocks nothing; check with `docker port`.**
16. **Collector pipeline config.** Copied from the SigNoz devenv config at v0.148.1 (`[SRC]`). Components were checked at v0.144.6 only by the devenv pairing `[INF]`. The `memory_limiter` processor (first in each pipeline, `limit_mib` 800, matched by `GOMEMLIMIT` in compose) must exist in v0.144.6 `[UNV]`; if it does not, the collector fails to start. Run `otelcol validate` (or `/signoz-otel-collector --config ... ` with a dry flag if one exists) in the scratch run. **Blocks start of the collector.**

17. **ClickHouse capabilities.** `geldar-ch` has `cap_drop: [ALL]` and `cap_add: [CHOWN, DAC_OVERRIDE, SETUID, SETGID]` (compose). That set is what the entrypoint's uid drop is assumed to need `[INF]`; no smaller set has been tested. A binary in the image with file capabilities outside the bounding set fails to exec with EPERM. Whether the image's binaries carry file capabilities is not checked (`getcap` in the scratch run). **Blocks start of geldar-ch.**
18. **ClickHouse `<grants>` syntax and `from_env` on 25.12.5.** The reader's grants use `<grants><query>GRANT SELECT ON ...</query></grants>` in `users.xml`, and the hashes are read with `from_env` (see "Password hashes"). Both are `[INF]` for 25.12.5. A malformed grant or an unsupported `from_env` stops ClickHouse from loading users, so it fails to start. **Blocks start of geldar-ch.**
19. **Reader quota.** 0352 gives no per-hour read quota value, so `geldar_reader` has no quota of its own and uses `quota default` (`users.xml`). 0352 (its line 104) also asks for a per-hour quota on the writer; `geldar_writer` uses `quota default` too (item 28). This is an owner decision, not a check. **Blocks nothing.**
20. **Node-only hash file.** `/mnt/nvme/geldar-telemetry/secrets/ch-hashes.env` (`GELDAR_CH_WRITER_SHA256`, `GELDAR_CH_READER_SHA256`) must exist on the node before `geldar-ch` starts. Compose marks it `required: false` so that `docker compose config` runs off the node. On the node, a missing file leaves the variables unset and ClickHouse fails to start. Nothing has checked the file on the node. **Blocks start of geldar-ch.** Whether an unset `from_env` is an error or an empty hash is `[UNV]`; if ClickHouse accepts an empty hash, the start succeeds and the N4 check below (geldar-ch must refuse to start without the file) fails. The `required: false` form needs Compose 2.24.0 or later `[INF]`, not checked on the node.
21. **`default` user network restriction (B1).** `users.xml` sets `replace="replace"` on `<networks>` and on each `<ip>`, so the stock `::/0` should not be kept. The merge semantics of `replace` on 25.12.5 are `[INF]`. If the merge appends instead, `default` (no password, no `access_management`) is reachable from every container on `geldar-telemetry`, including `geldar-gateway`. Negative test, from a second container on the external network. It must fail (non-zero exit, an authentication or address error, and no `1` printed):

    ```
    docker run --rm --network geldar-telemetry --entrypoint /usr/bin/clickhouse clickhouse/clickhouse-server@sha256:cacf32d6884291dc2ff5e0156a97f46fc53ff7c929a7906d114e268a929dfd3a client --host geldar-ch --user default --query "SELECT 1"
    ```

    Positive check from inside geldar-ch: `docker exec geldar-ch clickhouse-client -q "SELECT host_ip FROM system.users WHERE name='default'"` (or `SHOW CREATE USER default`) lists only `127.0.0.1` and `::1`. **Blocks start of everything behind geldar-ch.** If the negative test succeeds, stop the stack and do not start the migrator, SigNoz or the collector.

22. **Log `remove` attributes (S-C a).** `cluster.xml` sets `<log remove="remove"/>` and `<errorlog remove="remove"/>` so logs go to the console only. If the merge ignores them, ClickHouse writes up to 10 files of 1000 MB each into the container layer on the Docker data root (0352 saw about 20 GB free there). Check after a day of run: `docker exec geldar-ch ls -la /var/log/clickhouse-server` shows no growing files. **Blocks the disk budget, not the start.**
23. **`config.d` mount and listen addresses (S-C b).** The read-only mount of `./clickhouse/config.d` over `/etc/clickhouse-server/config.d` hides any file the image ships there. The upstream image is believed to ship `docker_related_config.xml` with `listen_host` `::` and `0.0.0.0` `[INF]`. This repo sets `listen_host` `0.0.0.0` (IPv4 only), so ClickHouse listens on IPv4 only. Check: `docker exec geldar-ch wget --spider -q http://127.0.0.1:8123/ping` exits 0, and `docker exec geldar-ch-keeper clickhouse-keeper-client -h 127.0.0.1 -p 9181 -q ls` exits 0. **Blocks start of geldar-ch and everything behind it.**
24. **UDF file glob (S-C c).** `user_defined_executable_functions_config` is `*function.xml`, resolved against the server config directory `/etc/clickhouse-server/`. The histogram file is mounted at `/etc/clickhouse-server/histogram_function.xml`, so the glob should match it. Check: `docker exec geldar-ch clickhouse-client -q "SELECT name FROM system.functions WHERE name = 'histogramQuantile'"` returns one row. **Blocks SigNoz metrics queries that use histogramQuantile.**
25. **System log tables enabled by `config.d` (S-C d).** `system-log-ttl.xml` has sections for 14 system log tables. A section can enable a table the base config has off, and `<text_log>` with no `<level>` stores every level `[INF]`. At a 30-day TTL these can grow past the 0352 budget. Check: `docker exec geldar-ch clickhouse-client -q "SELECT name FROM system.tables WHERE database='system' AND name LIKE '%_log'"` against the expected list, and the disk use after a day. **Blocks nothing; blocks the disk budget decision.**

26. **SigNoz vendor reporting (S-D).** SigNoz v0.148.1 may send usage data to the vendor by default. The setting is not in the stack facts file, and no env var is set in this compose file. unverified: disable telemetry reporting (find the setting before N4 compose up). Check in the scratch run: `ss -tnp` on the host for connections of the `geldar-signoz` process. **Blocks nothing; an outbound report from a shared host is an owner decision.**

27. **Reader grants coverage (N4).** `geldar_reader` has SELECT on `signoz_traces`, `signoz_logs`, `signoz_metrics` and `signoz_metadata` only. If SigNoz queries another database (for example `signoz_analytics`, which no source here names) or a `system.*` table, the query returns ACCESS_DENIED. This is a query-time failure, not a start failure. **Blocks the UI pages that read that data, not the start.**
28. **Writer quota and timeouts (N5, N6).** `geldar_writer` has `quota default`, and its profile (60 s `max_execution_time`, 2 GB `max_memory_usage`) is also used by the migrator, which runs as `geldar_writer`. A long `sync up` or `async up` step can hit the 60 s limit. The writer has no `access_management`, so a `migrate bootstrap` step that needs SQL user management would fail. **Blocks start of the collector** (the migrator's exit status, item 7).

## Checks before the first compose up (N4)

Run these in order. Each must pass before the next start.

1. Create the secret and hash files per "Secrets", then `ls -ln /mnt/nvme/geldar-telemetry/secrets` matches the table (item 14).
2. Hash file refusal: move `ch-hashes.env` aside, run `docker compose -f deploy/telemetry/compose.yml up -d geldar-ch`. `geldar-ch` must not become healthy, because it must refuse to start without `GELDAR_CH_WRITER_SHA256` and `GELDAR_CH_READER_SHA256`. Restore the file name, then run `docker compose -f deploy/telemetry/compose.yml down`. If ClickHouse starts with an empty hash, stop and resolve item 20 first.
3. Network: `docker network inspect geldar-telemetry_geldar-telemetry-backend` shows `"Internal": true`, and `geldar-ch-keeper` is not listed in `docker network inspect geldar-telemetry`.
4. `default` negative test (item 21) fails as required.
5. The vendor reporting setting is found and disabled (item 26).
6. The N4 request names the extra network `geldar-telemetry_geldar-telemetry-backend` (see "Networks").
7. **Empty password refused (M1).** With `geldar-ch` healthy, run from a container on `geldar-telemetry`. Both must fail with an authentication or address error, and print no `1`:

    ```
    docker run --rm --network geldar-telemetry --entrypoint /usr/bin/clickhouse clickhouse/clickhouse-server@sha256:cacf32d6884291dc2ff5e0156a97f46fc53ff7c929a7906d114e268a929dfd3a client --host geldar-ch --user geldar_writer --password '' --query "SELECT 1"
    ```

    The same command with `--user geldar_reader` must fail the same way.
8. **No empty-string hash (M1).** `grep -c e3b0c442 /mnt/nvme/geldar-telemetry/secrets/ch-hashes.env` must print `0`. `grep` exits 1 when the count is 0, so judge by the printed number. Do not print the file.

## Start order (for the scratch run, not this packet)

1. `geldar-ch-keeper` healthy.
2. `geldar-ch` healthy, and the histogram binary present.
3. `geldar-signoz-migrator` runs once and exits 0 (`restart: "no"`).
4. `geldar-signoz`, then `geldar-signoz-otelcol`.

Each step is a separate start. Do not start the collector before the migrator exits 0.

## Checks for this packet

- `docker compose -f deploy/telemetry/compose.yml config` with dummy secret paths and dummy environment (see the file's header comment). No start, no pull.
- The otelcol config validation in the scratch run (item 16).
