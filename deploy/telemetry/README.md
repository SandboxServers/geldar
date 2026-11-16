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
- **signoz-otel-collector** (also the migrator, which runs its `migrate` subcommands from the same image): uid 10001 [SRC, image `User`]. The writer secret file is owned by 10001 and read by it; the owner and mode of each secret file are in the table under "Secrets" (compose sets neither uid nor mode).
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

- `geldar-telemetry`: external, created on the node at N2 (not by this file). Shared with `geldar-gateway`. Joined by `geldar-ch`, the migrator, SigNoz and the collector. On this network `geldar-ch` also has the alias `geldar-ch-sql` (not on `geldar-telemetry-backend`). `cluster.xml` uses that alias as the replica host, so the address ClickHouse reports is reachable from every client on this network (item 29).
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

Each item says what it blocks. Nothing starts on the node until the items marked **blocks start** are checked. Items marked **[VER]** were verified in the local scratch run; the result table is in "Scratch run results" below.

1. **SQLite env names** (`SIGNOZ_SQLSTORE_PROVIDER`, `SIGNOZ_SQLSTORE_SQLITE_PATH`) and the SQLite path `/var/lib/signoz/signoz.db`. The default path is `[SRC]` from `conf/example.yaml`. The SQLite path env name is `[INF]` from the key naming. **Blocks start of geldar-signoz.**
2. **JWT and tokenizer env names** (`SIGNOZ_TOKENIZER_PROVIDER=opaque` default; `SIGNOZ_TOKENIZER_JWT_SECRET` only if provider is jwt). `[INF]`. Not needed while the provider is opaque. **Blocks nothing if opaque is kept.**
3. **Collector healthcheck** `wget --spider -q localhost:13133`. The collector image is debian with only ca-certificates; `wget` is not confirmed. The compose file leaves this healthcheck off until checked. **Blocks the collector's healthcheck only.** [VER] The collector image has no `wget` (fact supplied for this pass, not from the scratch reports), so the healthcheck stays off.
4. **Reader user versus SigNoz retention changes.** SigNoz may run DDL for TTL or retention changes through the API. The reader is read-only (`readonly=2` as in 0352: settings may change, data may not). Its grants are SELECT on the `signoz_*` databases only. If the UI or API changes retention, that call fails. **Blocks any retention change from the UI** (not the start).
5. **Async insert settings.** None of the SigNoz files searched set `async_insert`. The file sets none. **Blocks nothing; a tuning question.**
6. **Histogram quantile init.** The `histogramQuantile` binary is fetched from GitHub by an init container in the upstream compose. This packet does not do that. The operator must vendor the binary into `/mnt/nvme/geldar-telemetry/clickhouse/user_scripts/histogramQuantile` and check its sha256 before start. **Blocks SigNoz metrics queries that use histogramQuantile.** The binary is not in the repo. [VER] Tarball sha256 matched the pinned value; the extracted binary (sha256 prefix fc3168f9) was installed as `user_scripts/histogramQuantile`, owner 101:101, mode 755; the function loads and returns correct values for cumulative inputs with a +Inf bucket (the earlier nan results came from non-cumulative test input). Sources: reports 4 to 6 and the scratch function check.
7. **ClickHouse 25.12.5 (build 44) and migrator compatibility.** The migrator v0.144.6 is tested by SigNoz CI with 25.12.5. Run the migrator once against this server and check its exit status before the collector starts. The writer profile (`max_execution_time` 60, `max_memory_usage` 2 GB) also applies to the migrator, which runs as `geldar_writer` (item 28). **Blocks start of the collector.** [VER] Migrator exit code 0 (State.ExitCode 0, OOM false) on 25.12.5 build 44 with the explicit grants of item 32; its logs have no error-level line (report 6, step C).
8. **Keeper command.** Compose overrides the keeper entrypoint with `/usr/bin/clickhouse-keeper --config-file=...` (as Foundry does [SRC]) and sets `user: "101:101"`, so the `/entrypoint.sh` drop is not used. `[UNV]` that the binary path and the 101 data-dir owner match the 25.12.5 (build 44) image. **Blocks start of geldar-ch-keeper** until the id check and the chown are done. [VER] Keeper started healthy with restarts 0 using this command and a 101:101 data dir (report 6, step A). The `id` check was not run.
9. **ClickHouse `ON CLUSTER` with the `default` user.** The cluster entry in `cluster.xml` has no user, so DDL runs as `default`. `default` is kept, with networks restricted to loopback (`127.0.0.1`, `::1`, item 21), for this reason. If the scratch run shows ON CLUSTER refused from the container's own address, widen it to the Geldar telemetry subnet, never `::/0`. The plan: after the scratch run confirms DDL works, set `<user>` and `<password>` for `writer` in `remote_servers` and remove the `default` user. **Blocks the decision to remove `default`.** The scratch run shows the migrator's ON CLUSTER DDL working as `geldar_writer`; the removal decision is still open.
10. **Container `wget` for ClickHouse** (`http://127.0.0.1:8123/ping`; `127.0.0.1` because `listen_host` is `0.0.0.0`, so `localhost` may resolve to `::1` and fail, item 23). `[SRC]` from SigNoz devenv and Foundry; not checked inside the image. **Blocks start of geldar-ch and everything behind it** (see "Healthchecks and restarts"). [VER] geldar-ch reached healthy with restarts 0 (report 6, step A), so the healthcheck command passed.
11. **Keeper healthcheck** `clickhouse-keeper-client -h 127.0.0.1 -p 9181 -q ls` (the Keeper uses the client protocol here, so the four-letter-word list `ruok,mntr,srvr` does not matter to it). `[SRC]` Foundry; the binary's presence in the 25.12.5 (build 44) image is not checked. **Blocks start of geldar-ch and everything behind it** (see "Healthchecks and restarts"). [VER] geldar-ch-keeper reached healthy with restarts 0 (report 6, step A).
12. **SigNoz healthcheck** `wget --spider -q http://localhost:8080/api/v1/health`. busybox `wget` in alpine `[INF]`. **Blocks nothing**: no service depends on `geldar-signoz`, so a failing check only marks it unhealthy. [VER] `GET 127.0.0.1:8095/api/v1/health` returned 200 `{status:ok}` and the container reached healthy with restarts 0 (report 6, step D).
13. **Collector DSN wrapper.** The collector and migrator read the password from a file through a shell wrapper. The collector's `${env:}` expansion is `[SRC]`; `${file:}` is not used. Whether the image has `/bin/sh` is unchecked. **Blocks start of the collector and migrator.** [VER] Both run the wrapper: the migrator exited 0 (item 7) and the collector started with restarts 0 and no error-level log line (report 6, steps C and E).
14. **Secret file owner and mode.** Compose keeps the host file's owner and mode for file secrets `[INF]`, on any engine (not only Docker Desktop), and the Compose version on the node is not checked. Create the files per the Secrets table, then run `ls -ln /mnt/nvme/geldar-telemetry/secrets` and check the numbers match. In the scratch run, check reachability: `docker exec geldar-signoz test -r /run/secrets/ch_reader_password` and `docker exec geldar-signoz-otelcol test -r /run/secrets/ch_writer_password` must both exit 0. The one-shot migrator is not running after its exit, so for it only the `ls -ln` check applies. **Blocks start of geldar-signoz (reader) and of the migrator and collector (writer).** Partly seen in the scratch run: the migrator wrote as the writer and SigNoz held an established connection to ClickHouse, but `ls -ln` and `test -r` were not recorded.
15. **Logs and ports of SigNoz.** The server's listener on 8080 is `[SRC]` from the SigNoz config. The OpAMP listener on 4320 is not used here (no manager config), so it is not published. `[UNV]` whether the server also opens 4320 by default. **Blocks nothing; check with `docker port`.** [VER] `docker port` showed `8080/tcp` published to `127.0.0.1:8095` (report 6, step D). The 4320 listener inside the container was not checked.
16. **Collector pipeline config.** Copied from the SigNoz devenv config at v0.148.1 (`[SRC]`). Components were checked at v0.144.6 only by the devenv pairing `[INF]`. The `memory_limiter` processor (first in each pipeline, `limit_mib` 800, matched by `GOMEMLIMIT` in compose) must exist in v0.144.6 `[UNV]`; if it does not, the collector fails to start. Run `otelcol validate` (or `/signoz-otel-collector --config ... ` with a dry flag if one exists) in the scratch run. **Blocks start of the collector.** [VER] The collector started with 0 error and 0 warn log lines (report 6, step E), which a missing processor would prevent; `otelcol validate` was not run separately.

17. **ClickHouse capabilities.** `geldar-ch` has `cap_drop: [ALL]` and `cap_add: [CHOWN, DAC_OVERRIDE, SETUID, SETGID]` (compose). That set is what the entrypoint's uid drop is assumed to need `[INF]`; no smaller set has been tested. A binary in the image with file capabilities outside the bounding set fails to exec with EPERM. Whether the image's binaries carry file capabilities is not checked (`getcap` in the scratch run). **Blocks start of geldar-ch.** [VER] geldar-ch started healthy with restarts 0 under this cap set (report 6, step A). `getcap` was not run.
18. **ClickHouse `<grants>` syntax and `from_env` on 25.12.5.** The reader's grants use `<grants><query>GRANT SELECT ON ...</query></grants>` in `users.xml`, and the hashes are read with `from_env` (see "Password hashes"). Both are `[INF]` for 25.12.5. A malformed grant or an unsupported `from_env` stops ClickHouse from loading users, so it fails to start. **Blocks start of geldar-ch.** [VER] Users loaded with the env hashes: the reader's `SELECT` works with the secret and an empty password is refused (report 4, step 3; report 6, steps B and F).
19. **Reader quota.** 0352 gives no per-hour read quota value, so `geldar_reader` has no quota of its own and uses `quota default` (`users.xml`). 0352 (its line 104) also asks for a per-hour quota on the writer; `geldar_writer` uses `quota default` too (item 28). This is an owner decision, not a check. **Blocks nothing.**
20. **Node-only hash file.** `/mnt/nvme/geldar-telemetry/secrets/ch-hashes.env` (`GELDAR_CH_WRITER_SHA256`, `GELDAR_CH_READER_SHA256`) must exist on the node before `geldar-ch` starts. Compose marks it `required: false` so that `docker compose config` runs off the node. On the node, a missing file leaves the variables unset and ClickHouse fails to start. Nothing has checked the file on the node. **Blocks start of geldar-ch.** Whether an unset `from_env` is an error or an empty hash is `[UNV]`; if ClickHouse accepts an empty hash, the start succeeds and the N4 check below (geldar-ch must refuse to start without the file) fails. The `required: false` form needs Compose 2.24.0 or later `[INF]`, not checked on the node. Partly seen in the scratch run: the file was written and geldar-ch came up healthy with it; the refusal without the file was not run.
21. **`default` user network restriction (B1).** `users.xml` sets `replace="replace"` on `<networks>` and on each `<ip>`, so the stock `::/0` should not be kept. The merge semantics of `replace` on 25.12.5 are `[INF]`. If the merge appends instead, `default` (no password, no `access_management`) is reachable from every container on `geldar-telemetry`, including `geldar-gateway`. Negative test, from a second container on the external network. It must fail (non-zero exit, an authentication or address error, and no `1` printed):

    ```
    docker run --rm --network geldar-telemetry --entrypoint /usr/bin/clickhouse clickhouse/clickhouse-server@sha256:cacf32d6884291dc2ff5e0156a97f46fc53ff7c929a7906d114e268a929dfd3a client --host geldar-ch --user default --query "SELECT 1"
    ```

    Positive check from inside geldar-ch: `docker exec geldar-ch clickhouse-client -q "SHOW CREATE USER default"` shows `HOST LOCAL`. The expected form is `HOST LOCAL` with an empty `host_ip` in `system.users`, not a list of addresses. **Blocks start of everything behind geldar-ch.** If the negative test succeeds, stop the stack and do not start the migrator, SigNoz or the collector. [VER] `SHOW CREATE USER default` shows `HOST LOCAL` (report 4, step 3), and a second container on the telemetry network got code 516 AUTHENTICATION_FAILED for `default`.

22. **Log `remove` attributes (S-C a).** `cluster.xml` sets `<log remove="remove"/>` and `<errorlog remove="remove"/>` so logs go to the console only. If the merge ignores them, ClickHouse writes up to 10 files of 1000 MB each into the container layer on the Docker data root (0352 saw about 20 GB free there). Check after a day of run: `docker exec geldar-ch ls -la /var/log/clickhouse-server` shows no growing files. **Blocks the disk budget, not the start.** [VER, partly] The stock logger sections are removed from the config. Startup prints non-fatal `Not found: logger.log` notices. The check after a day of run has not been done.
23. **`config.d` mount and listen addresses (S-C b).** The read-only mount of `./clickhouse/config.d` over `/etc/clickhouse-server/config.d` hides any file the image ships there. The upstream image is believed to ship `docker_related_config.xml` with `listen_host` `::` and `0.0.0.0` `[INF]`. This repo sets `listen_host` `0.0.0.0` (IPv4 only), so ClickHouse listens on IPv4 only. Check: `docker exec geldar-ch wget --spider -q http://127.0.0.1:8123/ping` exits 0, and `docker exec geldar-ch-keeper clickhouse-keeper-client -h 127.0.0.1 -p 9181 -q ls` exits 0. **Blocks start of geldar-ch and everything behind it.** [VER] Inside geldar-ch the listeners are `0.0.0.0:8123` and `0.0.0.0:9000`; the HTTP ping and the Keeper client check passed (report 5, step B2; report 6, step A).
24. **UDF file glob (S-C c).** `user_defined_executable_functions_config` is `*function.xml`, resolved against the server config directory `/etc/clickhouse-server/`. The histogram file is mounted at `/etc/clickhouse-server/histogram_function.xml`, so the glob should match it. Check: `docker exec geldar-ch clickhouse-client -q "SELECT name FROM system.functions WHERE name = 'histogramQuantile'"` returns one row. **Blocks SigNoz metrics queries that use histogramQuantile.** [VER] The function loads through the glob (scratch function check; the query text is not in the reports).
25. **System log tables enabled by `config.d` (S-C d).** `system-log-ttl.xml` has 23 sections: 13 for tables with a standard `event_date` TTL and 10 others, including `opentelemetry_span_log`, whose TTL is inside its engine because the stock config sets one. A section can enable a table the base config has off, and `<text_log>` with no `<level>` stores every level `[INF]`. At a 30-day TTL these can grow past the 0352 budget. Check: `docker exec geldar-ch clickhouse-client -q "SELECT name FROM system.tables WHERE database='system' AND name LIKE '%_log'"` against the expected list, and the disk use after a day. **Blocks nothing; blocks the disk budget decision.** [VER, partly] On 25.12.5 (build 44) the scratch run found 11 system `*_log` tables, all with a TTL and none without (report 5, step B3, round 4). The disk use after a day was not measured, and report 6 did not repeat the count.

26. **SigNoz vendor reporting (S-D).** SigNoz v0.148.1 may send usage data to the vendor by default. The setting is not in the stack facts file, and no env var is set in this compose file. unverified: disable telemetry reporting (find the setting before N4 compose up). Check in the scratch run: `ss -tnp` on the host for connections of the `geldar-signoz` process. **Blocks nothing; an outbound report from a shared host is an owner decision.** [VER, partly] `SIGNOZ_ANALYTICS_ENABLED=false` is set in the container and visible in `docker inspect` (report 6, step G). The outbound connection seen in the scratch run is item 33.

27. **Reader grants coverage (N4).** `geldar_reader` has SELECT on `signoz_traces`, `signoz_logs`, `signoz_metrics` and `signoz_metadata` only. If SigNoz queries another database (for example `signoz_analytics`, which no source here names) or a `system.*` table, the query returns ACCESS_DENIED. This is a query-time failure, not a start failure. **Blocks the UI pages that read that data, not the start.** [VER, partly] The reader's `SELECT` on `signoz_traces` returns the marker row (report 6, step F). Other databases were not queried.
28. **Writer quota and timeouts (N5, N6).** `geldar_writer` has `quota default`, and its profile (60 s `max_execution_time`, 2 GB `max_memory_usage`) is also used by the migrator, which runs as `geldar_writer`. A long `sync up` or `async up` step can hit the 60 s limit. The writer has no `access_management`, so a `migrate bootstrap` step that needs SQL user management would fail. **Blocks start of the collector** (the migrator's exit status, item 7). [VER, partly] The migrator ran to exit 0 under the writer profile (report 6, step C). The 60 s limit and the quota under load were not tested.
29. **Cluster replica alias `geldar-ch-sql` (A7, A8).** `cluster.xml` names the replica `geldar-ch-sql`, an alias that exists only on `geldar-telemetry`. Verify: `docker exec geldar-ch clickhouse-client -q "SELECT host_name, host_address FROM system.clusters WHERE cluster='cluster'"` shows the telemetry-network address, and the migrator reaches it. Round 1 of the scratch run passed and round 3 failed. The cause was non-deterministic DNS order: the name `geldar-ch` resolved to either of its two IPs, and the backend IP is unroutable from the migrator. **Blocks start of the migrator and collector.** [VER] The cluster row's `host_address` matches the telemetry-network address (report 5, step B1). The migrator reached the alias in rounds 4 and 5 (reports 5 and 6). Round 3 (report 4) failed on the DNS order, so repeat this check on the node.
30. **Remove attributes for the MySQL and PostgreSQL listeners [AUTH].** `cluster.xml` sets `<mysql_port remove="remove"/>` and `<postgresql_port remove="remove"/>` so that only the native port 9000 and HTTP 8123 are served. The scratch run found 9004 and 9005 on `0.0.0.0`. `remove` attributes must be verified: `ss` inside geldar-ch must show only 8123 and 9000, plus 9009 on loopback and 9181 not present. **Blocks the network exposure claim, not the start.** [VER] Inside geldar-ch, LISTEN shows 8123 and 9000 on `0.0.0.0`, 9009 on loopback, and no 9004 or 9005 (report 5, step B2, round 4). Round 5 did not repeat the socket check.
31. **ClickHouse interserver port (R3 residual).** The stock config listens for interserver traffic on port 9009, which is inferred to bind on every interface and so on both networks. Not verified. Any container on `geldar-telemetry` that knows a replica path could request data parts, and no `interserver_http_credentials` is set. Check: `docker exec geldar-ch ss -ltn` (or `netstat -ltn` if `ss` is not in the image) and read the bound address of 9009. Also check whether `interserver_listen_host` can be restricted to the backend address. **Blocks nothing if the port is bound to the backend only; otherwise close it before the gateway shares the network.** [VER] Port 9009 is bound to loopback only (report 4, step 3; report 5, step B2).
32. **Writer grants: REMOTE and table engines (A11).** `geldar_writer` has `GRANT REMOTE ON *.*`, which gives the `remote()` and `cluster()` table functions to any host, and one `GRANT TABLE ENGINE ON` per engine the migrator creates (Distributed and the MergeTree variants). The REMOTE grant is a hypothesis: that the Distributed engine grant needs it is `[UNV]`, and scratch round 5 confirms it (a failure names the missing privilege). The residual risk is accepted: the writer's password is held only by the migrator and the collector, and the container network is private. Check, as `default` from inside geldar-ch, that `SHOW GRANTS FOR geldar_writer` lists the REMOTE and TABLE ENGINE grants and none of SYSTEM, FILE, URL, S3, MYSQL, POSTGRES, SOURCES or KILL QUERY. Then, as `geldar_writer` (password read from the node secret file, not typed on the command line): `SELECT * FROM remote('127.0.0.1:9000','system.one')` is allowed (expected, since REMOTE is granted; record the result), and `file()`, `url()`, `s3()`, `SYSTEM FLUSH LOGS` and `KILL QUERY` are each refused with ACCESS_DENIED. **Blocks start of the migrator and collector** if the Distributed grant needs another privilege; the REMOTE residual is an owner acceptance, not a start check. [VER] The grants listed as expected, and `file()`, `url()`, `s3()`, `SYSTEM FLUSH LOGS` and `KILL QUERY` refused; `remote()` allowed (report 4, step 3; report 6, step B). The migrator passed with explicit TABLE ENGINE grants and REMOTE (report 6, step C). Whether REMOTE alone is needed was not isolated (see the results table).

## Scratch run results (local, 2026-11-16, config at b5020016)

Three rounds on the local Docker Desktop host, with a lowered-cap override kept in the scratch folder (not in the repo). So the memory and CPU figures are not the 0352 caps.

- Round 3 (report 4): FAIL at step 4. The migrator could not reach `geldar-ch` because the name resolved to the backend-network address (item 29).
- Round 4 (report 5): FAIL at step C. The writer lacked `TABLE ENGINE` on Distributed and the `USAGE` privilege the error named, so the migrator exited 1. Steps D to G were not run.
- Round 5 (report 6, this config): PASS for steps A to H. The migrator exited 0 after the explicit TABLE ENGINE grants and `GRANT REMOTE` for `geldar_writer` (item 32).

Status key: **VERIFIED** = the item's claim was exercised and held; **PARTIAL** = part of it was exercised, the rest is in the note; **OPEN** = a finding with no answer yet; **NOT-CHECKED** = not exercised in the scratch run.

| Item | Status | Evidence (report number and step) |
|---|---|---|
| 1 | PARTIAL | SigNoz started healthy on SQLite (report 6, D). The env names and the DB file path were not read back. |
| 2 | PARTIAL | Started on the default provider. No JWT or tokenizer setting was tested. Blocks nothing. |
| 3 | VERIFIED | The collector image has no `wget` (fact supplied for this pass, not in the reports). The healthcheck stays off. |
| 4 | NOT-CHECKED | No retention change was made through the SigNoz UI or API. |
| 5 | NOT-CHECKED | Tuning question; not measured. |
| 6 | VERIFIED | Tarball sha256 matched; binary sha256 prefix fc3168f9; installed 101:101 0755; function returns correct values with the +Inf bucket (reports 4 to 6). |
| 7 | VERIFIED | Migrator exit 0, OOM false, no error-level log line (report 6, C). |
| 8 | VERIFIED | Keeper healthy, restarts 0, with this command and 101:101 data dir (report 6, A). The `id` check was not run. |
| 9 | PARTIAL | ON CLUSTER DDL ran as `geldar_writer` (report 6, C). `default` refused from a second container (report 4, 3). Removal of `default` not decided. |
| 10 | VERIFIED | geldar-ch healthy, restarts 0 (report 6, A). |
| 11 | VERIFIED | geldar-ch-keeper healthy, restarts 0 (report 6, A). |
| 12 | VERIFIED | Health 200 `{status:ok}`; healthy, restarts 0 (report 6, D). |
| 13 | VERIFIED | Migrator exit 0 and collector up with restarts 0, no error line (report 6, C and E). |
| 14 | PARTIAL | Services reached ClickHouse with their secrets. `ls -ln` and `test -r` as container uid not recorded. |
| 15 | VERIFIED | `8080/tcp` published to `127.0.0.1:8095` (report 6, D). The 4320 listener was not checked. |
| 16 | VERIFIED | Collector started with 0 error and 0 warn lines (report 6, E). `otelcol validate` not run separately. |
| 17 | VERIFIED | geldar-ch healthy under cap_drop ALL and the four caps (report 6, A). `getcap` not run. |
| 18 | VERIFIED | Env hashes loaded; reader SELECT works; empty password refused (report 4, 3; report 6, B and F). |
| 19 | NOT-CHECKED | Owner decision. |
| 20 | PARTIAL | Hash file written; geldar-ch healthy with it (report 6, A). The refusal without the file was not run. |
| 21 | VERIFIED | `SHOW CREATE USER default` shows `HOST LOCAL` (empty host_ip); second-container login code 516 (report 4, 3). |
| 22 | PARTIAL | Logger sections removed (brief); non-fatal `Not found: logger.log` notices at startup. The after-a-day file check is not done. |
| 23 | VERIFIED | LISTEN 8123 and 9000 on 0.0.0.0; HTTP ping and Keeper client checks pass (report 5, B2; report 6, A). |
| 24 | VERIFIED | `histogramQuantile` loads through the glob (scratch function check; not in the reports). |
| 25 | PARTIAL | 11 system `*_log` tables, all with TTL, none without (report 5, B3, round 4). Disk use after a day not measured. |
| 26 | PARTIAL | `SIGNOZ_ANALYTICS_ENABLED=false` visible in `docker inspect` (report 6, G). An outbound connection attempt was still seen: item 33. |
| 27 | PARTIAL | Reader SELECT on `signoz_traces` works (report 6, F). Other databases not queried. |
| 28 | PARTIAL | Migrator completed under the writer profile (report 6, C). The 60 s limit and quota under load not tested. |
| 29 | VERIFIED | Cluster `host_name` `geldar-ch-sql`; `host_address` matches the telemetry network (report 5, B1). Migrator reached the alias in rounds 4 and 5. |
| 30 | VERIFIED | LISTEN: 8123, 9000 on 0.0.0.0; 9009 on loopback; no 9004 or 9005 (report 5, B2, round 4). |
| 31 | VERIFIED | 9009 bound to loopback only (report 4, 3; report 5, B2). |
| 32 | VERIFIED | Grants as expected; file, url, s3, SYSTEM FLUSH LOGS, KILL QUERY refused; remote() allowed (report 4, 3; report 6, B). Migrator passes with the explicit grants (report 6, C). Whether REMOTE alone is needed was not isolated. |
| 33 | OPEN | See item 33. |

Round 4 reported the error as `Missing permissions: USAGE ON *.*`, not `REMOTE`, so the round did not name the REMOTE grant as the missing privilege. The REMOTE grant was added together with the explicit engine grants in the same fix, and the two were not tested apart.

## Checks before the first compose up (N4)

Run these in order. Each must pass before the next start.

1. Create the secret and hash files per "Secrets", then `ls -ln /mnt/nvme/geldar-telemetry/secrets` matches the table (item 14).
2. **Hash file refusal (runs first, before any N4 network check).** The backend network exists only while the project is up.
    a. `mv /mnt/nvme/geldar-telemetry/secrets/ch-hashes.env /mnt/nvme/geldar-telemetry/secrets/ch-hashes.env.aside`
    b. `docker compose -f deploy/telemetry/compose.yml up -d geldar-ch`. This starts `geldar-ch-keeper` first and creates the backend network.
    c. Wait 2 minutes, then `docker inspect -f '{{.State.Health.Status}}' geldar-ch`. Expected: not `healthy`. A restart loop is the expected refusal, so `starting`, `unhealthy` or `restarting` all pass. `docker logs geldar-ch` shows a missing-variable error for `GELDAR_CH_WRITER_SHA256` or `GELDAR_CH_READER_SHA256`. If the status is `healthy`, stop and resolve item 20.
    d. `docker compose -f deploy/telemetry/compose.yml down`. Expected: exit 0. This removes the backend network.
    e. `mv /mnt/nvme/geldar-telemetry/secrets/ch-hashes.env.aside /mnt/nvme/geldar-telemetry/secrets/ch-hashes.env`, then repeat step 1's `ls -ln` check (mode `0400`).
3. **Bring geldar-ch up with the hash file restored.** `docker compose -f deploy/telemetry/compose.yml up -d geldar-ch`. Wait up to 3 minutes until `docker inspect -f '{{.State.Health.Status}}' geldar-ch` prints `healthy` and `docker inspect -f '{{.State.Health.Status}}' geldar-ch-keeper` prints `healthy`. If either stays unhealthy, stop.
4. **Network (geldar-ch is up).**
    a. `docker network inspect geldar-telemetry_geldar-telemetry-backend --format '{{.Internal}}'` prints `true`.
    b. `docker network inspect geldar-telemetry --format '{{range .Containers}}{{.Name}} {{end}}'` lists `geldar-ch` and does not list `geldar-ch-keeper`.
5. **Negative and positive tests (geldar-ch is healthy).** Run the `docker run --rm --network geldar-telemetry --entrypoint /usr/bin/clickhouse clickhouse/clickhouse-server@sha256:cacf32d6884291dc2ff5e0156a97f46fc53ff7c929a7906d114e268a929dfd3a client --host geldar-ch ...` form from item 21 for each line below. Negative lines must exit non-zero with an authentication or address error and print no `1`. Record the exact error text in the report.
    a. `--user default --query "SELECT 1"`: negative (item 21). Must fail.
    b. `--user geldar_writer --password '' --query "SELECT 1"`: negative (item 7, M1). Must fail.
    c. `--user geldar_reader --password '' --query "SELECT 1"`: negative (item 7, M1). Must fail.
    d. Positive control: `--user geldar_reader --password "$(cat /mnt/nvme/geldar-telemetry/secrets/ch_reader_password)" --query "SELECT 1"`, run as host root with the password not printed. Expected: prints `1`. This shows the network path and client work, so the negatives above fail for the right reason.
    e. Positive check from inside geldar-ch: `docker exec geldar-ch clickhouse-client -q "SHOW CREATE USER default"` shows `HOST LOCAL` (item 21).
6. **No empty-string hash (M1).** `grep -c e3b0c442 /mnt/nvme/geldar-telemetry/secrets/ch-hashes.env` must print `0`. `grep` exits 1 when the count is 0, so judge by the printed number. Do not print the file.
7. The vendor reporting setting is found and disabled (item 26).
8. The N4 request names the extra network `geldar-telemetry_geldar-telemetry-backend` (see "Networks").
9. **Histogram binary (item 6).** Use a new empty scratch directory outside the repo, and keep the script that runs these steps out of it.
    a. Download the pinned tarball only: `curl -fsSL -o hq.tar.gz https://github.com/SigNoz/signoz/releases/download/histogram-quantile%2Fv0.0.1/histogram-quantile_linux_amd64.tar.gz`.
    b. `echo "33997073eb6d82b7be4f27f9fc8ec9e28a395e0f20674d5d54bb2fa28a75488d  hq.tar.gz" | sha256sum -c -`. **Abort on any mismatch**: delete the tarball and stop.
    c. `tar -tzf hq.tar.gz` lists the contents. The release also ships license and readme files beside the binary; record the list in the N4 report.
    d. `tar -xzf hq.tar.gz histogram-quantile` extracts only the binary (use the member name shown in step c).
    e. `sha256sum histogram-quantile`: record the full value in the N4 report (the scratch run's prefix was `fc3168f9`).
    f. `install -d -o 101 -g 101 -m 0755 /mnt/nvme/geldar-telemetry/clickhouse/user_scripts` then `install -o 101 -g 101 -m 0755 histogram-quantile /mnt/nvme/geldar-telemetry/clickhouse/user_scripts/histogramQuantile`.
    g. Delete the tarball and the extracted copy from the scratch directory.
    h. After `geldar-ch` is healthy (N4 step 3), run `docker exec geldar-ch clickhouse-client -q "SELECT name FROM system.functions WHERE name = 'histogramQuantile'"` (one row). Then run a value check with cumulative bucket counts that include a `+Inf` bucket (non-cumulative input gave `nan` in the scratch run, so do not use it). The scratch function query is not kept in the repo or the reports: write the query and its expected result into the N4 report before the check.
10. **Migrator and tables (after start order step 3).**
    a. `docker inspect -f '{{.State.ExitCode}} {{.State.OOMKilled}}' geldar-signoz-migrator` prints `0 false`.
    b. `SELECT database, count() FROM system.tables WHERE startsWith(database, 'signoz_') GROUP BY database ORDER BY database` (run with `docker exec geldar-ch clickhouse-client`) must give `signoz_analytics` 4, `signoz_logs` 14, `signoz_metadata` 6, `signoz_meter` 7, `signoz_metrics` 66, `signoz_traces` 36 (133 in all). Any other count stops the start.
    c. `SELECT engine, count() FROM system.tables WHERE startsWith(database, 'signoz_') GROUP BY engine ORDER BY engine` must give `Distributed` 54, `MaterializedView` 24, `ReplicatedAggregatingMergeTree` 7, `ReplicatedMergeTree` 16, `ReplicatedReplacingMergeTree` 31, `ReplicatedSummingMergeTree` 1. A plain `MergeTree` or `ReplacingMergeTree` here means the migrator ran with replication off.
11. **End-to-end trace marker (through the collector).** The collector's ports are not published on the node, so send from a one-shot container on the `geldar-telemetry` network.
    a. Make a 12-hex-character marker (`openssl rand -hex 6`) and keep it in the N4 report, not in the repo.
    b. `docker run --rm --network geldar-telemetry curlimages/curl@sha256:<full digest> -sS -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '<minimal OTLP/HTTP JSON trace with the marker in the span name>' http://geldar-signoz-otelcol:4318/v1/traces`. Expected `200`. Pin the helper by the full digest recorded at pull time: the scratch run used `curlimages/curl:8.11.1`, digest starting `c1fe1679`, which is not in the repo.
    c. After the collector's flush interval, count as the reader: `docker exec geldar-ch clickhouse-client --user geldar_reader --password "$(cat /mnt/nvme/geldar-telemetry/secrets/ch_reader_password)" -q "SELECT count() FROM signoz_traces.signoz_index_v3 WHERE <span name column> = '<marker>'"`. Expected `1`. The column name is not recorded in the reports, so run `DESCRIBE signoz_traces.signoz_index_v3` first. Count the local table `signoz_index_v3`, not the `distributed_` table.
    d. Run the command with the password read from the file and not printed. Do not paste the value into a saved shell history.
12. **Node-only checks (cannot be done on Docker Desktop).**
    a. Secret owner and mode: `ls -ln /mnt/nvme/geldar-telemetry/secrets` matches the Secrets table (item 14). Then `test -r` as each service's uid through a one-shot container with the same user, read-only mount of that one file, and the same capability set as the service. For the writer, `--user 10001:10001`; for the reader, `--user 0:0 --cap-drop ALL`. Each must exit 0. The one-shot needs `/bin/sh` in the image (item 13).
    b. The inferred uid 101 for the two ClickHouse images: run the `id` commands in "Owner uids" on the node and stop on any other output.
    c. Real memory and CPU caps: with the 0352 caps in place (not the scratch override), run `docker stats --no-stream` once the stack is up and record the figures in the N4 report. The caps are `geldar-ch` 3.0 CPU and 8g, Keeper 0.5 and 1g, `geldar-signoz` 1.0 and 1g, the collector 0.5 and 1g, and the migrator 0.5 and 512m. The scratch figures (for example `geldar-ch` at 2 GiB) are from lowered caps and do not prove the 0352 values.

## Start order (for the scratch run, not this packet)

1. `geldar-ch-keeper` healthy.
2. `geldar-ch` healthy, and the histogram binary present.
3. `geldar-signoz-migrator` runs once and exits 0 (`restart: "no"`).
4. `geldar-signoz`, then `geldar-signoz-otelcol`.

Each step is a separate start. Do not start the collector before the migrator exits 0.

## Checks for this packet

- `docker compose -f deploy/telemetry/compose.yml config` with dummy secret paths and dummy environment (see the file's header comment). No start, no pull.
- The otelcol config validation in the scratch run (item 16).
