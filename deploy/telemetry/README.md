# Geldar telemetry stack (T-20): deploy files

Status: files only. Nothing here has been started, pulled or validated on the node. Decision record: `docs/decisions/0370-telemetry-clickhouse-25-12-pin.md` (amends 0352). Design: `docs/analysis/telemetry/collector-design.md`. Research and the facts behind each file: `docs/analysis/telemetry/t20-stack-files.md`.

Labels used in the comments of these files: `[SRC]` quoted from the cited file at the cited tag; `[INF]` inferred; `[AUTH]` written here, not from SigNoz; `[UNV]` unverified, must be checked in the scratch run before any start.

## Pins

Compose references every image as `repo@sha256:<index digest>` (digest only, no tag; the tag is listed in the table). The amd64 digest is recorded for the node check (`docker manifest inspect`), not used in compose.

| Image | Tag | Index digest | linux/amd64 digest | Push date (UTC) | Runtime user |
|---|---|---|---|---|---|
| clickhouse/clickhouse-server | 25.12.5 (build 44) | sha256:cacf32d6884291dc2ff5e0156a97f46fc53ff7c929a7906d114e268a929dfd3a | sha256:10f54f04de6c61b756c4eaf9f1d17464a4ac3e1f94b5b410e0dec92a24dbeda8 | 2026-02-02 | starts as root, drops to 101:101 [INF, see Owner uids] |
| clickhouse/clickhouse-keeper | 25.12.5 (build 44) | sha256:525b8b0f93ccb371131c46f22a066ea43d33d74aba314203e8044609945d8524 | sha256:5493b0fba2fdfc3bf51115db4fb378fac8b0a953c116db442fd4297a8f49a9d7 | 2026-02-02 | starts as root, drops to 101:101 [INF, see Owner uids] |
| signoz/signoz | v0.148.1 | sha256:a7d1a968a1f7f65c518106150ac05424ca8e91c52d7076077dfce034980e9c34 | sha256:909443fb98d16048df866d49f6efe5e8b19dd60e20821bee2c45c46090700027 | 2026-10-29 | root (no drop) [SRC] |
| signoz/signoz-otel-collector | v0.144.6 | sha256:7e4e539a73f1f88fbc1cd7e659ab3950908e83ce1f2a37a297452f910d072174 | sha256:13fca6050f79c49a0bdc644ccdc65a9248f22f3b4337d1e0680da026a764d77e | 2026-07-14 | 10001 [SRC] |
| signoz/signoz-schema-migrator | v0.144.6 | sha256:4e57475fbf8b24168dcfbe6fc5799bb3f3d965819b72663580d0926185b68bf5 | sha256:1b58ff410181d8708bc032c3d5bd5e4e4863cda2464dfa444090be423d7cda4b | 2026-07-14 | 10001 [SRC] |

Why these tags: 25.12.5 (build 44) is the ClickHouse line SigNoz v0.148.1 tests in CI. v0.144.6 is the collector version the v0.148.1 `go.mod` pins. The newer 25.12.11 (build 4) and 26.3.62 (build 3) are not used (see 0370). The digests were read from the Docker Hub registry API on 2026-11-16 and were not pulled.

## Owner uids

- **clickhouse-server and clickhouse-keeper**: the image config `User` is empty, so the container starts as root. The entrypoint then chowns the data directory and drops to `clickhouse` (uid 101, gid 101). The drop is inferred from upstream `docker/server` and `docker/keeper` (`groupadd -r clickhouse --gid=101`) and is **not checked in the image**. Check on the node before any `chown` of `/mnt/nvme/geldar-telemetry/clickhouse` or `/keeper`:

  ```
  docker run --rm --entrypoint id clickhouse/clickhouse-server@sha256:cacf32d6884291dc2ff5e0156a97f46fc53ff7c929a7906d114e268a929dfd3a clickhouse
  docker run --rm --entrypoint id clickhouse/clickhouse-keeper@sha256:525b8b0f93ccb371131c46f22a066ea43d33d74aba314203e8044609945d8524 clickhouse
  ```

  Expected: `uid=101(clickhouse) gid=101(clickhouse)`. **Stop on any other output** and do not chown. (The check runs a container and is a scratch-run step, not part of this packet.)
- **signoz-schema-migrator and signoz-otel-collector**: uid 10001 [SRC, image `User`]. The secret files are mounted for uid 10001 (see the compose file).
- **signoz**: root [SRC]. Data dir `/mnt/nvme/geldar-telemetry/query` is owned by root.

## Host paths

All host paths are under `/mnt/nvme/geldar-telemetry`. Nothing outside it is mounted. No `docker.sock` is mounted in any service.

- `/mnt/nvme/geldar-telemetry/clickhouse` (server data, logs, config as read-only mounts)
- `/mnt/nvme/geldar-telemetry/keeper` (Keeper data)
- `/mnt/nvme/geldar-telemetry/query` (SigNoz SQLite directory)
- `/mnt/nvme/geldar-telemetry/secrets` (password files, mode 0400 for uid 10001, see Secrets)

## Deviation from collector-design section 4

- **One SigNoz container, not two.** SigNoz v0.148.1 serves the query API and the frontend from one container (`signoz/signoz`, port 8080) [SRC, `conf/example.yaml` `web.enabled: true`; `cmd/enterprise/Dockerfile.multi-arch` copies the frontend build to `/etc/signoz/web`]. So this stack has one `geldar-signoz` (1.0 CPU, 1g memory, 1g memswap, 256 pids) and no `geldar-signoz-ui`.
- The name `geldar-signoz-query` is **not used**.
- The one published port is `127.0.0.1:8095:8080` (loopback only, reached over an SSH tunnel). Port 8095 was free on the node at the 2026-11-16 check. Host port 3301 is not used (the packet does not allow it).
- Caps for the other containers are the 0352 table values, as in collector-design section 4. The ClickHouse caps (3.0 CPU, 8g, 1024 pids) and the Keeper caps (0.5, 1g, 256) are not changed. The migrator is 0.5, 512m, 128. The collector is 0.5, 1g, 256.

## Secrets

Passwords are never inline. Compose mounts them as file secrets from `/mnt/nvme/geldar-telemetry/secrets/`:

- `ch_writer_password`: the writer password (`<writer password from secret file>`). Used by the migrator and the collector.
- `ch_reader_password`: the reader password. Used by the query service.

### Password hashes

`clickhouse/users.d/users.xml` is well-formed and contains no hash. Each user reads its hash with `<password_sha256_hex from_env="..."/>`: `GELDAR_CH_WRITER_SHA256` (writer) and `GELDAR_CH_READER_SHA256` (reader). `geldar-ch` loads them from `/mnt/nvme/geldar-telemetry/secrets/ch-hashes.env` (compose `env_file`, not in git). Write that file on the node, mode 0400, with two lines `GELDAR_CH_WRITER_SHA256=<hex>` and `GELDAR_CH_READER_SHA256=<hex>`. Make each hex with `printf %s "$pw" | sha256sum | cut -d' ' -f1`, where `$pw` is the password read from the matching secret file. Do not put the values in a command line that is saved in shell history.

- `from_env` in ClickHouse config is `[INF]`, unverified on 25.12.5. **Blocks start of geldar-ch** (a missing variable is a start failure, which fails closed).
- Residual exposure: the hash is in the container environment, so `docker inspect geldar-ch` shows it to anyone with Docker access. A sha256 of a password can be brute-forced offline. Docker access is root-equivalent on this host, so this is accepted, not removed.

### Secret wrappers (migrator, SigNoz, collector)

The DSNs are built by a short shell wrapper that reads the secret file at start (see the compose `command:` lines). The wrapper text contains `$(cat /run/secrets/...)`, not the value, so no password is in argv or in `docker inspect`. The value lives in the environment of the running process, which is readable by root and by the same uid through `/proc/<pid>/environ`. That residual exposure is accepted for this single-node host. The migrator uses the collector image (`signoz/signoz-otel-collector`, see the Pins), so its DSN is an environment variable, as the SigNoz `migrate` subcommands expect. The wrapper relies on `/bin/sh` in the image: `[UNV]` for the collector and the SigNoz image is alpine.

No secret value, token or account name is in this directory.

## Unverified, check in the scratch run

Each item says what it blocks. Nothing starts on the node until the items marked **blocks start** are checked.

1. **SQLite env names** (`SIGNOZ_SQLSTORE_PROVIDER`, `SIGNOZ_SQLSTORE_SQLITE_PATH`) and the SQLite path `/var/lib/signoz/signoz.db`. The default path is `[SRC]` from `conf/example.yaml`. The SQLite path env name is `[INF]` from the key naming. **Blocks start of geldar-signoz.**
2. **JWT and tokenizer env names** (`SIGNOZ_TOKENIZER_PROVIDER=opaque` default; `SIGNOZ_TOKENIZER_JWT_SECRET` only if provider is jwt). `[INF]`. Not needed while the provider is opaque. **Blocks nothing if opaque is kept.**
3. **Collector healthcheck** `wget --spider -q localhost:13133`. The collector image is debian with only ca-certificates; `wget` is not confirmed. The compose file leaves this healthcheck off until checked. **Blocks the collector's healthcheck only.**
4. **Reader user versus SigNoz retention changes.** SigNoz may run DDL for TTL or retention changes through the API. The reader is read-only (`readonly=2` as in 0352: settings may change, data may not). Its grants are SELECT on the `signoz_*` databases only. If the UI or API changes retention, that call fails. **Blocks any retention change from the UI** (not the start).
5. **Async insert settings.** None of the SigNoz files searched set `async_insert`. The file sets none. **Blocks nothing; a tuning question.**
6. **Histogram quantile init.** The `histogramQuantile` binary is fetched from GitHub by an init container in the upstream compose. This packet does not do that. The operator must vendor the binary into `/mnt/nvme/geldar-telemetry/clickhouse/user_scripts/histogramQuantile` and check its sha256 before start. **Blocks SigNoz metrics queries that use histogramQuantile.** The binary is not in the repo.
7. **ClickHouse 25.12.5 (build 44) and migrator compatibility.** The migrator v0.144.6 is tested by SigNoz CI with 25.12.5. Run the migrator once against this server and check its exit status before the collector starts. **Blocks start of the collector.**
8. **Keeper command.** Compose overrides the keeper entrypoint with `/usr/bin/clickhouse-keeper --config-file=...` (as Foundry does [SRC]) and sets `user: "101:101"`, so the `/entrypoint.sh` drop is not used. `[UNV]` that the binary path and the 101 data-dir owner match the 25.12.5 (build 44) image. **Blocks start of geldar-ch-keeper** until the id check and the chown are done.
9. **ClickHouse `ON CLUSTER` with the `default` user.** The cluster entry in `cluster.xml` has no user, so DDL runs as `default`. `default` is kept, with networks restricted to loopback (`127.0.0.1`, `::1`), for this reason. If the scratch run shows ON CLUSTER refused from the container's own address, widen it to the Geldar telemetry subnet, never `::/0`. The plan: after the scratch run confirms DDL works, set `<user>` and `<password>` for `writer` in `remote_servers` and remove the `default` user. **Blocks the decision to remove `default`.**
10. **Container `wget` for ClickHouse** (`http://localhost:8123/ping`). `[SRC]` from SigNoz devenv and Foundry; not checked inside the image. **Blocks ClickHouse healthcheck.**
11. **Keeper healthcheck** `clickhouse-keeper-client -h localhost -p 9181 -q ls`. `[SRC]` Foundry; the binary's presence in the 25.12.5 (build 44) image is not checked. **Blocks Keeper healthcheck.**
12. **SigNoz healthcheck** `wget --spider -q http://localhost:8080/api/v1/health`. busybox `wget` in alpine `[INF]`. **Blocks SigNoz healthcheck.**
13. **Collector DSN wrapper.** The collector and migrator read the password from a file through a shell wrapper. The collector's `${env:}` expansion is `[SRC]`; `${file:}` is not used. Whether the image has `/bin/sh` is unchecked. **Blocks start of the collector and migrator.**
14. **Compose `secrets:` uid and mode.** Compose's file-secret ownership for uid 10001 is `[INF]` and may be ignored on Docker Desktop. Check with `docker exec ... ls -l /run/secrets` on the node. **Blocks start of the collector and migrator.**
15. **Logs and ports of SigNoz.** The server's listener on 8080 is `[SRC]` from the SigNoz config. The OpAMP listener on 4320 is not used here (no manager config), so it is not published. `[UNV]` whether the server also opens 4320 by default. **Blocks nothing; check with `docker port`.**
16. **Collector pipeline config.** Copied from the SigNoz devenv config at v0.148.1 (`[SRC]`). Components were checked at v0.144.6 only by the devenv pairing `[INF]`. Run `otelcol validate` (or `/signoz-otel-collector --config ... ` with a dry flag if one exists) in the scratch run. **Blocks start of the collector.**

## Start order (for the scratch run, not this packet)

1. `geldar-ch-keeper` healthy.
2. `geldar-ch` healthy, and the histogram binary present.
3. `geldar-signoz-migrator` runs once and exits 0 (`restart: "no"`).
4. `geldar-signoz`, then `geldar-signoz-otelcol`.

Each step is a separate start. Do not start the collector before the migrator exits 0.

## Checks for this packet

- `docker compose -f deploy/telemetry/compose.yml config` with dummy secret paths and dummy environment (see the file's header comment). No start, no pull.
- The otelcol config validation in the scratch run (item 16).
