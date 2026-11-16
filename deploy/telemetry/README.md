# Geldar telemetry stack (T-20): deploy files

Status: files only. Nothing here has been started, pulled or validated on the node. Decision record: `docs/decisions/0370-telemetry-clickhouse-25-12-pin.md` (amends 0352). Design: `docs/analysis/telemetry/collector-design.md`. Research and the facts behind each file: `docs/analysis/telemetry/t20-stack-files.md`. The scratch reports (2 to 8) are in the campaign scratchpad, not in this repo; the "Scratch run results" table is the evidence of record (references such as "report 6 step A" point to those reports, which are not in the repo). The final passing local run is report8 (config e6a08a4b).

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
3. **Collector healthcheck** `wget --spider -q localhost:13133`. The collector image is debian with only ca-certificates; `wget` is not confirmed. The compose file leaves this healthcheck off until checked. **Blocks the collector's healthcheck only.** [OBSERVED-NOT-REPEATED] One earlier ops run (round 3) saw `wget` in the collector image exit 127 (command not found). It was not repeated and is not in the scratch reports; recheck on the node with `docker run --rm --entrypoint wget <collector image> --help`. The healthcheck stays off.
4. **Reader user versus SigNoz retention changes.** SigNoz may run DDL for TTL or retention changes through the API. The reader is read-only (`readonly=2` as in 0352: settings may change, data may not). Its grants are SELECT on the `signoz_*` databases only. If the UI or API changes retention, that call fails. **Blocks any retention change from the UI** (not the start).
5. **Async insert settings.** None of the SigNoz files searched set `async_insert`. The file sets none. **Blocks nothing; a tuning question.**
6. **Histogram quantile init.** The `histogramQuantile` binary is fetched from GitHub by an init container in the upstream compose. This packet does not do that. The operator must vendor the binary into `/mnt/nvme/geldar-telemetry/clickhouse/user_scripts/histogramQuantile` and check its sha256 before start. **Blocks SigNoz metrics queries that use histogramQuantile.** The binary is not in the repo. [VER on Docker Desktop with a named volume; node check still needed (N4 step f)] Tarball sha256 matched the pinned value; the extracted binary (sha256 prefix fc3168f9) was installed as `user_scripts/histogramQuantile`, owner 101:101, mode 755; the function loads and returns correct values for cumulative inputs with a +Inf bucket (the earlier nan results came from non-cumulative test input). Sources: reports 4 to 6 and the scratch function check.
7. **ClickHouse 25.12.5 (build 44) and migrator compatibility.** The migrator v0.144.6 is tested by SigNoz CI with 25.12.5. Run the migrator once against this server and check its exit status before the collector starts. The writer profile (`max_execution_time` 60, `max_memory_usage` 2 GB) also applies to the migrator, which runs as `geldar_writer` (item 28). **Blocks start of the collector.** [VER] Migrator exit code 0 (State.ExitCode 0, OOM false) on 25.12.5 build 44 with the grants of item 32; its logs have no error-level line (report8 step C; report 6 step C).
8. **Keeper command.** Compose overrides the keeper entrypoint with `/usr/bin/clickhouse-keeper --config-file=...` (as Foundry does [SRC]) and sets `user: "101:101"`, so the `/entrypoint.sh` drop is not used. `[UNV]` that the binary path and the 101 data-dir owner match the 25.12.5 (build 44) image. **Blocks start of geldar-ch-keeper** until the id check and the chown are done. [VER on Docker Desktop with a named volume; node check still needed] Keeper started healthy with restarts 0 using this command and a 101:101 data dir (report 6, step A). The `id` check was not run.
9. **ClickHouse `ON CLUSTER` with the `default` user.** The cluster entry in `cluster.xml` has no user, so DDL runs as `default`. `default` is kept, with networks restricted to loopback (`127.0.0.1`, `::1`, item 21), for this reason. If the scratch run shows ON CLUSTER refused from the container's own address, widen it to the Geldar telemetry subnet, never `::/0`. The plan: after the scratch run confirms DDL works, set `<user>` and `<password>` for `writer` in `remote_servers` and remove the `default` user. **Blocks the decision to remove `default`.** report8 step C: ON CLUSTER DDL ran with the restricted grants; the initiating user was not recorded, so which user runs it stays open. The removal decision is still open.
10. **Container `wget` for ClickHouse** (`http://127.0.0.1:8123/ping`; `127.0.0.1` because `listen_host` is `0.0.0.0`, so `localhost` may resolve to `::1` and fail, item 23). `[SRC]` from SigNoz devenv and Foundry; not checked inside the image. **Blocks start of geldar-ch and everything behind it** (see "Healthchecks and restarts"). [VER] geldar-ch reached healthy with restarts 0 (report 6, step A), so the healthcheck command passed.
11. **Keeper healthcheck** `clickhouse-keeper-client -h 127.0.0.1 -p 9181 -q ls` (the Keeper uses the client protocol here, so the four-letter-word list `ruok,mntr,srvr` does not matter to it). `[SRC]` Foundry; the binary's presence in the 25.12.5 (build 44) image is not checked. **Blocks start of geldar-ch and everything behind it** (see "Healthchecks and restarts"). [VER] geldar-ch-keeper reached healthy with restarts 0 (report 6, step A).
12. **SigNoz healthcheck** `wget --spider -q http://localhost:8080/api/v1/health`. busybox `wget` in alpine `[INF]`. **Blocks nothing**: no service depends on `geldar-signoz`, so a failing check only marks it unhealthy. [VER] `GET 127.0.0.1:8095/api/v1/health` returned 200 `{status:ok}` and the container reached healthy with restarts 0 (report 6, step D).
13. **Collector DSN wrapper.** The collector and migrator read the password from a file through a shell wrapper. The collector's `${env:}` expansion is `[SRC]`; `${file:}` is not used. Whether the image has `/bin/sh` is unchecked. **Blocks start of the collector and migrator.** [VER] Both run the wrapper: the migrator exited 0 (item 7) and the collector started with restarts 0 and no error-level log line (report 6, steps C and E).
14. **Secret file owner and mode.** Compose keeps the host file's owner and mode for file secrets `[INF]`, on any engine (not only Docker Desktop), and the Compose version on the node is not checked. Create the files per the Secrets table, then run `ls -ln /mnt/nvme/geldar-telemetry/secrets` and check the numbers match. In the scratch run, check reachability: `docker exec geldar-signoz test -r /run/secrets/ch_reader_password` and `docker exec geldar-signoz-otelcol test -r /run/secrets/ch_writer_password` must both exit 0. The one-shot migrator is not running after its exit, so for it only the `ls -ln` check applies. **Blocks start of geldar-signoz (reader) and of the migrator and collector (writer).** Partly seen in the scratch run: the migrator wrote as the writer and SigNoz held an established connection to ClickHouse, but `ls -ln` and `test -r` were not recorded.
15. **Logs and ports of SigNoz.** The server's listener on 8080 is `[SRC]` from the SigNoz config. The OpAMP listener on 4320 is not used here (no manager config), so it is not published. **Blocks nothing; check with `docker port`.** [VER] `docker port` showed `8080/tcp` published to `127.0.0.1:8095` (report 6, step D). Per the round 1 and round 8 evidence, 4320 (OpAMP) and 6060 (pprof) are open inside `geldar-signoz` on all interfaces. They are not published to the host; they are reachable only from containers on the shared `geldar-telemetry` network (including `geldar-gateway`). Node check: `docker exec geldar-signoz` socket listing, and `docker port geldar-signoz` shows only 8080. Decision rule: decide at N4 whether to accept this reach; if not, block it with an internal network or a firewall rule before leaving the stack up.
16. **Collector pipeline config.** Copied from the SigNoz devenv config at v0.148.1 (`[SRC]`). Components were checked at v0.144.6 only by the devenv pairing `[INF]`. The `memory_limiter` processor (first in each pipeline, `limit_mib` 800, matched by `GOMEMLIMIT` in compose) must exist in v0.144.6 `[UNV]`; if it does not, the collector fails to start. Run `otelcol validate` (or `/signoz-otel-collector --config ... ` with a dry flag if one exists) in the scratch run. **Blocks start of the collector.** [VER] The collector started with 0 error and 0 warn log lines (report 6, step E), which a missing processor would prevent; `otelcol validate` was not run separately.

17. **ClickHouse capabilities.** `geldar-ch` has `cap_drop: [ALL]` and `cap_add: [CHOWN, DAC_OVERRIDE, SETUID, SETGID]` (compose). That set is what the entrypoint's uid drop is assumed to need `[INF]`; no smaller set has been tested. A binary in the image with file capabilities outside the bounding set fails to exec with EPERM. Whether the image's binaries carry file capabilities is not checked (`getcap` in the scratch run). **Blocks start of geldar-ch.** [VER on Docker Desktop with a named volume; node check still needed] geldar-ch started healthy with restarts 0 under this cap set (report 6, step A). `getcap` was not run.
18. **ClickHouse `<grants>` syntax and `from_env` on 25.12.5.** The reader's grants use `<grants><query>GRANT SELECT ON ...</query></grants>` in `users.xml`, and the hashes are read with `from_env` (see "Password hashes"). Both are `[INF]` for 25.12.5. A malformed grant or an unsupported `from_env` stops ClickHouse from loading users, so it fails to start. **Blocks start of geldar-ch.** [VER] Users loaded with the env hashes: the reader's `SELECT` works with the secret and an empty password is refused (report 4, step 3; report 6, steps B and F).
19. **Reader quota.** 0352 gives no per-hour read quota value, so `geldar_reader` has no quota of its own and uses `quota default` (`users.xml`). 0352 (its line 104) also asks for a per-hour quota on the writer; `geldar_writer` uses `quota default` too (item 28). This is an owner decision, not a check. **Blocks nothing.**
20. **Node-only hash file.** `/mnt/nvme/geldar-telemetry/secrets/ch-hashes.env` (`GELDAR_CH_WRITER_SHA256`, `GELDAR_CH_READER_SHA256`) must exist on the node before `geldar-ch` starts. Compose marks it `required: false` so that `docker compose config` runs off the node. On the node, a missing file leaves the variables unset and ClickHouse fails to start. Nothing has checked the file on the node. **Blocks start of geldar-ch.** Whether an unset `from_env` is an error or an empty hash is `[UNV]`; if ClickHouse accepts an empty hash, the start succeeds and the refusal test in N4 step g.1 (geldar-ch must refuse to start without the file) fails. The `required: false` form needs Compose 2.24.0 or later `[INF]`, not checked on the node. Partly seen in the scratch run: the file was written and geldar-ch came up healthy with it; the refusal without the file was not run.
21. **`default` user network restriction (B1).** `users.xml` sets `replace="replace"` on `<networks>` and on each `<ip>`, so the stock `::/0` should not be kept. The merge semantics of `replace` on 25.12.5 are `[INF]`. If the merge appends instead, `default` (no password, no `access_management`) is reachable from every container on `geldar-telemetry`, including `geldar-gateway`. Negative test, from a second container on the external network. It must fail (non-zero exit, an authentication or address error, and no `1` printed):

    ```
    docker run --rm --network geldar-telemetry --entrypoint /usr/bin/clickhouse clickhouse/clickhouse-server@sha256:cacf32d6884291dc2ff5e0156a97f46fc53ff7c929a7906d114e268a929dfd3a client --host geldar-ch --user default --query "SELECT 1"
    ```

    Positive check from inside geldar-ch: `docker exec geldar-ch clickhouse-client -q "SELECT name, host_ip, host_names, host_names_regexp, host_names_like FROM system.users WHERE name = 'default'"` shows empty host lists (untested replacement; `SHOW CREATE USER default` showed `HOST LOCAL` only when `default` had all privileges, and is probably refused for the restricted `default`; see step g.6). The expected form is `HOST LOCAL` with an empty `host_ip` in `system.users`, not a list of addresses. **Blocks start of everything behind geldar-ch.** If the negative test succeeds, stop the stack and do not start the migrator, SigNoz or the collector. [VER] `SHOW CREATE USER default` shows `HOST LOCAL` (report 4, step 3), and a second container on the telemetry network got code 516 AUTHENTICATION_FAILED for `default`.

22. **Log `remove` attributes (S-C a).** `cluster.xml` sets `<log remove="remove"/>` and `<errorlog remove="remove"/>` so logs go to the console only. If the merge ignores them, ClickHouse writes up to 10 files of 1000 MB each into the container layer on the Docker data root (0352 saw about 20 GB free there). Check after a day of run: `docker exec geldar-ch ls -la /var/log/clickhouse-server` shows no growing files. **Blocks the disk budget, not the start.** [VER, partly] The stock logger sections are removed from the config. Startup prints non-fatal `Not found: logger.log` notices (these are logger notices, not failures). The check after a day of run has not been done.
23. **`config.d` mount and listen addresses (S-C b).** The read-only mount of `./clickhouse/config.d` over `/etc/clickhouse-server/config.d` hides any file the image ships there. The upstream image is believed to ship `docker_related_config.xml` with `listen_host` `::` and `0.0.0.0` `[INF]`. This repo sets `listen_host` `0.0.0.0` (IPv4 only), so ClickHouse listens on IPv4 only. Check: `docker exec geldar-ch wget --spider -q http://127.0.0.1:8123/ping` exits 0, and `docker exec geldar-ch-keeper clickhouse-keeper-client -h 127.0.0.1 -p 9181 -q ls` exits 0. **Blocks start of geldar-ch and everything behind it.** [VER] Inside geldar-ch the listeners are `0.0.0.0:8123` and `0.0.0.0:9000`; the HTTP ping and the Keeper client check passed (report 5, step B2; report 6, step A).
24. **UDF file glob (S-C c).** `user_defined_executable_functions_config` is `*function.xml`, resolved against the server config directory `/etc/clickhouse-server/`. The histogram file is mounted at `/etc/clickhouse-server/histogram_function.xml`, so the glob should match it. Check: `docker exec geldar-ch clickhouse-client -q "SELECT name FROM system.functions WHERE name = 'histogramQuantile'"` returns one row. **Blocks SigNoz metrics queries that use histogramQuantile.** [VER] The function loads through the glob (scratch function check; the query text is not in the reports).
25. **System log tables enabled by `config.d` (S-C d).** `system-log-ttl.xml` has 23 sections: 13 for tables with a standard `event_date` TTL and 10 others, including `opentelemetry_span_log`, whose TTL is inside its engine because the stock config sets one. A section can enable a table the base config has off, and `<text_log>` with no `<level>` stores every level `[INF]`. At a 30-day TTL these can grow past the 0352 budget. Check: `docker exec geldar-ch clickhouse-client -q "SELECT name FROM system.tables WHERE database='system' AND name LIKE '%_log'"` against the expected list, and the disk use after a day. **Blocks nothing; blocks the disk budget decision.** [VER, partly] On 25.12.5 (build 44) the scratch run saw 24 system `*_log` tables after a workload in round 1, and 11 in round 4 before the migrator and collector ran. In round 4 all 11 had a TTL at that moment (report 5, step B3). The count depends on the workload, so a table created later may have none. The disk use after a day was not measured, and later rounds did not repeat the count. N4 check: after the stack has run 10 minutes, list every system `*_log` table without a TTL; decision rule: any table without a TTL gets a section in `system-log-ttl.xml` before the stack is left up unattended.

26. **SigNoz vendor reporting (S-D).** SigNoz v0.148.1 may send usage data to the vendor by default. This compose file sets `SIGNOZ_ANALYTICS_ENABLED=false` for `geldar-signoz`. The SigNoz default value is unknown, and the analytics services still start at boot (the analytics service start line is in the logs, report8). Whether the flag stops all vendor reporting is not shown. Check: `docker inspect geldar-signoz` shows the variable, and item 33 observes outbound sockets. **Blocks nothing; an outbound report from a shared host is an owner decision.** [VER, partly] `SIGNOZ_ANALYTICS_ENABLED=false` is set in the container and visible in `docker inspect` (report 6, step G; report8). The outbound connection seen in the scratch run is item 33.

27. **Reader grants coverage (N4).** `geldar_reader` has SELECT on `signoz_traces`, `signoz_logs`, `signoz_metrics` and `signoz_metadata` only. If SigNoz queries another database (for example `signoz_analytics`, which no source here names) or a `system.*` table, the query returns ACCESS_DENIED. This is a query-time failure, not a start failure. **Blocks the UI pages that read that data, not the start.** [VER, partly] The reader's `SELECT` on `signoz_traces` returns the marker row (report 6, step F). Other databases were not queried.
28. **Writer quota and timeouts (N5, N6).** `geldar_writer` has `quota default`, and its profile (60 s `max_execution_time`, 2 GB `max_memory_usage`) is also used by the migrator, which runs as `geldar_writer`. A long `sync up` or `async up` step can hit the 60 s limit. The writer has no `access_management`, so a `migrate bootstrap` step that needs SQL user management would fail. **Blocks start of the collector** (the migrator's exit status, item 7). [VER, partly] The migrator ran to exit 0 under the writer profile (report 6, step C). The 60 s limit and the quota under load were not tested.
29. **Cluster replica alias `geldar-ch-sql` (A7, A8).** `cluster.xml` names the replica `geldar-ch-sql`, an alias that exists only on `geldar-telemetry`. Verify: `docker exec geldar-ch clickhouse-client -q "SELECT host_name, host_address FROM system.clusters WHERE cluster='cluster'"` shows the telemetry-network address, and the migrator reaches it. Round 1 of the scratch run passed and round 3 failed. The cause was not investigated. The failure message showed the name `geldar-ch` resolving to the backend-network address, which the migrator cannot route to; why the order differed between rounds was not examined. The alias fix removed the symptom in rounds 4 to 8. **Blocks start of the migrator and collector.** [VER] The cluster row's `host_address` matches the telemetry-network address (report 5, step B1). The migrator reached the alias in rounds 4 to 8 (reports 5, 6 and 8). Round 3 (report4) failed on the name resolution described above, so repeat this check on the node.
30. **Remove attributes for the MySQL and PostgreSQL listeners [AUTH].** `cluster.xml` sets `<mysql_port remove="remove"/>` and `<postgresql_port remove="remove"/>` so that only the native port 9000 and HTTP 8123 are served. The scratch run found 9004 and 9005 on `0.0.0.0`. `remove` attributes must be verified: `ss` inside geldar-ch must show only 8123 and 9000, plus 9009 on loopback and 9181 not present. **Blocks the network exposure claim, not the start.** [VER] Inside geldar-ch, LISTEN shows 8123 and 9000 on `0.0.0.0`, 9009 on loopback, and no 9004 or 9005 (report 5, step B2, round 4). Round 5 did not repeat the socket check.
31. **ClickHouse interserver port (R3 residual).** The stock config listens for interserver traffic on port 9009, which is inferred to bind on every interface and so on both networks. Not verified. Any container on `geldar-telemetry` that knows a replica path could request data parts, and no `interserver_http_credentials` is set. Check: `docker exec geldar-ch ss -ltn` (or `netstat -ltn` if `ss` is not in the image) and read the bound address of 9009. Also check whether `interserver_listen_host` can be restricted to the backend address. **Blocks nothing if the port is bound to the backend only; otherwise close it before the gateway shares the network.** [VER] Port 9009 is bound to loopback only (report 4, step 3; report 5, step B2).
32. **Writer grants: REMOTE and table engines (A11).** `geldar_writer` has `GRANT REMOTE ON *.*`, which gives the `remote()` and `cluster()` table functions to any host, and one `GRANT TABLE ENGINE ON` per engine the migrator creates (Distributed and the MergeTree variants). Whether the Distributed engine grant needs REMOTE was not isolated (item 32 row). Residual, observed in report8: through `remote()` the writer acts as `default`, which holds only SELECT and INSERT on the six `signoz_*` databases and SELECT on `system.*` (explicit grants in `users.xml`), so the writer gets no more than it already has on those databases. Escalation to an all-privileges `default` was closed by those explicit grants and by removing the stock `access_management` and `named_collection_control` keys. Through `remote()` the `url()` and `s3()` functions were refused (READ ON URL, READ ON S3) and `file()` was refused by the path restriction; reading `system.query_log` through `remote()` is allowed (accepted residual). The writer's password is held only by the migrator and the collector. Check the grants: `SHOW GRANTS FOR geldar_writer` is refused for `default` (Code 497, needs SHOW USERS ON *.*, report8). Read the writer's effective rows from `system.grants WHERE user_name = 'geldar_writer'` (report8 read 92 rows this way) and the configured list from `users.xml`; the rows show no SYSTEM, FILE, URL, S3, KILL or SOURCES, and the REMOTE grant is not shown as a row (READ and WRITE rows are present; not resolved, report8). Then, as `geldar_writer` (password read from the node secret file, not typed on the command line): `SELECT * FROM remote('127.0.0.2:9000', view(SELECT currentUser()))` prints `default` (127.0.0.1 is the local shard: the query then runs in process as the writer and `currentUser()` is folded on the initiator, so it would print `geldar_writer` and hide the residual). `url()` and `s3()` are refused with ACCESS_DENIED (Code 497), `file()` is refused only by its path (Code 291, not a privilege proof), and `SYSTEM FLUSH LOGS` is refused (Code 497). For `KILL QUERY`: as the admin connection start `SELECT sleep(3)` with a fixed `query_id` in the background, then as `geldar_writer` run `KILL QUERY WHERE query_id = '<that id>' SYNC` (or `TEST`); expect Code 497 (report8: "attempts to kill query created by default"). A KILL that matches no row exits 0 and proves nothing (report4, report6). **Blocks start of the migrator and collector** if the Distributed grant needs another privilege; the REMOTE residual is an owner acceptance, not a start check. [VER] The grants listed as expected, and `file()`, `url()`, `s3()`, `SYSTEM FLUSH LOGS` and `KILL QUERY` refused; `remote()` allowed (report 4, step 3; report 6, step B). The migrator passed with explicit TABLE ENGINE grants and REMOTE (report 6, step C). Whether REMOTE alone is needed was not isolated (see the results table).
33. **OPEN, blocker for leaving the stack running unattended: outbound connection from `geldar-signoz`.** In the scratch run, with `SIGNOZ_ANALYTICS_ENABLED=false`, `geldar-signoz` had one outbound socket in `SYN_SENT` to a public address on port 80, seen right after start (report 6, step D; report8). It was gone after 60 s and the address had no reverse DNS (report8). The reports do not name the process, the destination or the purpose. The address is not recorded in this repo. **A blocker for unattended running, not for the N4 start.**

    Check (N4 step i): from a one-shot helper container sharing the network namespace of `geldar-signoz`, read the socket tables right after start and again after 60 s:

    ```
    docker run --rm --net container:geldar-signoz busybox cat /proc/net/tcp /proc/net/tcp6
    ```

    State `02` is SYN_SENT and `01` is ESTABLISHED. Decode the remote field `RRRRRRRR:PPPP` (column 3). For IPv4 the 8 hex digits are the address with the byte order reversed (little-endian), and the port is plain big-endian hex. Recipe:

    ```
    docker run --rm --net container:geldar-signoz busybox sh -c 'tail -n +2 /proc/net/tcp | while read sl loc rem st rest; do case $st in 01|02) h=${rem%:*}; p=${rem#*:}; printf "state=%s remote=%d.%d.%d.%d port=%d\n" $st 0x$(echo $h|cut -c7-8) 0x$(echo $h|cut -c5-6) 0x$(echo $h|cut -c3-4) 0x$(echo $h|cut -c1-2) 0x$p;; esac; done'
    ```

    This one-liner was written for this README and has not been run; if it fails, decode by hand: split `0100007F:1F90` into byte pairs `01 00 00 7F`, reverse them to `7F 00 00 01` (127.0.0.1), and read `1F90` as 8080. For `/proc/net/tcp6` each 4-byte group is reversed separately; a mapped IPv4 address ends in `0000FFFF` plus the reversed IPv4 group. Record only the port, public or private, and the reverse-DNS name (`getent hosts <address>` or `nslookup`) in the N4 report, not the address.

    Decision rule: if the connection persists, recurs, or resolves to a vendor or analytics host, stop and ask the owner about egress. Until decided, do not leave `geldar-signoz` running unattended. A possible block is an internal network that carries only the ClickHouse path. That needs care: a Docker internal network does not publish the `127.0.0.1:8095` port, so the SSH-tunnel access would need another route.

## Scratch run results (local Docker Desktop, 2026-11-16; final run report8, config e6a08a4b)

Scratch reports 2 to 8 are in the campaign scratchpad, not in the repo. The runs used a lowered-cap override kept in the scratch folder (not in the repo), so the memory and CPU figures are not the 0352 caps.

- report4 (round 3): FAIL at step 4. The migrator could not reach `geldar-ch` because the name resolved to the backend-network address (item 29).
- report5 (round 4): FAIL at step C. The writer lacked `TABLE ENGINE` on Distributed and the `USAGE` privilege the error named, so the migrator exited 1. Steps D to G were not run.
- report6 (config b5020016): PASS for steps A to H. The migrator exited 0 after the explicit TABLE ENGINE grants and `GRANT REMOTE` for `geldar_writer` (item 32).
- report8 (config e6a08a4b, final): PASS for steps A to H. ClickHouse starts on this config with the restricted `default` user (explicit grants; the stock `access_management` and `named_collection_control` keys removed). The migrator exited 0 with 4/14/6/7/66/36 tables and the engine mix in N4 step h.2. SigNoz health returned 200, with one non-fatal ERROR line (no active-queries log directory). The collector had no error or warning lines, and the marker trace landed: 1 row in `signoz_index_v3` and 1 through `distributed_signoz_index_v3`. The reader reads through the distributed table; its INSERT, `system.query_log` and `remote()` were refused. The writer reaches `default` through `remote()` (item 32). One outbound SYN_SENT was seen (item 33).

Status key: **VERIFIED** = the item's claim was exercised and held; **PARTIAL** = part of it was exercised, the rest is in the note; **OPEN** = a finding with no answer yet; **NOT-CHECKED** = not exercised in the scratch run.

| Item | Status | Evidence (report number and step) |
|---|---|---|
| 1 | PARTIAL | SigNoz started healthy on SQLite (report 6, D). The env names and the DB file path were not read back. |
| 2 | PARTIAL | Started on the default provider. No JWT or tokenizer setting was tested. Blocks nothing. |
| 3 | OBSERVED-NOT-REPEATED | Exit 127 for `wget` in the collector image, seen by one earlier ops run (round 3); not repeated, not in the scratch reports. The healthcheck stays off. |
| 4 | NOT-CHECKED | No retention change was made through the SigNoz UI or API. |
| 5 | NOT-CHECKED | Tuning question; not measured. |
| 6 | VERIFIED (Docker Desktop, named volume; node check needed) | Tarball sha256 matched; binary sha256 prefix fc3168f9; installed 101:101 0755; function returns correct values with the +Inf bucket (reports 4 to 6). |
| 7 | VERIFIED | Migrator exit 0, OOM false, no error-level log line (report8 C; report 6, C). |
| 8 | VERIFIED (Docker Desktop, named volume; node check needed) | Keeper healthy, restarts 0, with this command and 101:101 data dir (report 6, A). The `id` check was not run. |
| 9 | PARTIAL | ON CLUSTER DDL ran with the restricted grants, initiating user not recorded (report8, C). `default` refused from a second container (report 4, 3). Removal of `default` not decided. |
| 10 | VERIFIED | geldar-ch healthy, restarts 0 (report 6, A). |
| 11 | VERIFIED | geldar-ch-keeper healthy, restarts 0 (report 6, A). |
| 12 | VERIFIED | Health 200 `{status:ok}`; healthy, restarts 0 (report 6, D). |
| 13 | VERIFIED | Migrator exit 0 and collector up with restarts 0, no error line (report 6, C and E). |
| 14 | PARTIAL | Services reached ClickHouse with their secrets. `ls -ln` and `test -r` as container uid not recorded. |
| 15 | PARTIAL | `8080/tcp` published to `127.0.0.1:8095` (report 6, D). 4320 and 6060 open inside on all interfaces, not published (rounds 1 and 8); the N4 acceptance decision is open. |
| 16 | VERIFIED | Collector started with 0 error and 0 warn lines (report 6, E). `otelcol validate` not run separately. |
| 17 | VERIFIED (Docker Desktop, named volume; node check needed) | geldar-ch healthy under cap_drop ALL and the four caps (report 6, A). `getcap` not run. |
| 18 | VERIFIED | Env hashes loaded; reader SELECT works; empty password refused (report 4, 3; report 6, B and F). |
| 19 | NOT-CHECKED | Owner decision. |
| 20 | PARTIAL | Hash file written; geldar-ch healthy with it (report 6, A). The refusal without the file was not run. |
| 21 | VERIFIED | `SHOW CREATE USER default` showed `HOST LOCAL` (empty host_ip) when `default` had all privileges; second-container login code 516 (report 4, 3). Not re-run on the restricted `default`; the `system.users` query in item 21 is an untested replacement. |
| 22 | PARTIAL | Logger sections removed (brief); non-fatal `Not found: logger.log` notices at startup. The after-a-day file check is not done. |
| 23 | VERIFIED | LISTEN 8123 and 9000 on 0.0.0.0; HTTP ping and Keeper client checks pass (report 5, B2; report 6, A). |
| 24 | VERIFIED | `histogramQuantile` loads through the glob (scratch function check; not in the reports). |
| 25 | PARTIAL | Round 4 (report 5, B3): 11 system `*_log` tables, all with a TTL at that moment, before the migrator and collector ran; round 1 saw 24 after a workload. Disk use after a day not measured; the 10-minute no-TTL check is open. |
| 26 | PARTIAL | `SIGNOZ_ANALYTICS_ENABLED=false` visible in `docker inspect` (report 6, G). An outbound connection attempt was still seen: item 33. |
| 27 | PARTIAL | Reader SELECT on `signoz_traces` works (report 6, F). Other databases not queried. |
| 28 | PARTIAL | Migrator completed under the writer profile (report 6, C). The 60 s limit and quota under load not tested. |
| 29 | VERIFIED | Cluster `host_name` `geldar-ch-sql`; `host_address` matches the telemetry network (report 5, B1). Migrator reached the alias in rounds 4 to 8; the round 3 cause was not investigated. |
| 30 | VERIFIED | LISTEN: 8123, 9000 on 0.0.0.0; 9009 on loopback; no 9004 or 9005 (report 5, B2, round 4). |
| 31 | VERIFIED | 9009 bound to loopback only (report 4, 3; report 5, B2). |
| 32 | PARTIAL | url, s3, KILL QUERY, SYSTEM FLUSH LOGS refused as writer; file path-refused (report8, B). remote() gives the writer `default` (accepted residual, see item 32). Migrator passes (report8, C). Whether REMOTE alone is needed was not isolated. |
| 33 | OPEN | See item 33. |

report5 (round 4) reported the error as `Missing permissions: USAGE ON *.*`, not `REMOTE`, so that run did not name the REMOTE grant as the missing privilege. The REMOTE grant was added together with the explicit engine grants in the same fix, and the two were not tested apart.

## N4 checks

Run on the node as root, from the repo checkout that CD placed (so `deploy/telemetry/compose.yml` resolves). Do the steps in order. Each step must pass before the next. The commands marked "written for this README" were not run in the scratch runs; the expected outputs marked "report8" come from the final passing local run (Docker Desktop, scratch reports are not in the repo). `<digest>` placeholders appear only for helper images that are not pinned in the repo; record the digest you pulled in the N4 report.

**Step a. Preconditions.**

1. The network exists (N2): `docker network inspect geldar-telemetry --format '{{.Name}}'` prints `geldar-telemetry`. If not, stop.
2. The directories exist (N3): `ls -ld /mnt/nvme/geldar-telemetry/clickhouse /mnt/nvme/geldar-telemetry/keeper /mnt/nvme/geldar-telemetry/query /mnt/nvme/geldar-telemetry/queue` lists all four. (`queue` is not mounted by this compose file.)
3. Create the secrets directory: `install -d -m 0700 /mnt/nvme/geldar-telemetry/secrets`.
4. The loopback port 8095 is free: `ss -ltn | grep -c ':8095 '` prints `0`.
5. The vendor reporting variable is set in compose (item 26): `grep -c SIGNOZ_ANALYTICS_ENABLED deploy/telemetry/compose.yml` prints at least `1`.

**Step b. Pull the four images by digest** (the compose references; the migrator uses the collector image):

```
docker pull clickhouse/clickhouse-keeper@sha256:525b8b0f93ccb371131c46f22a066ea43d33d74aba314203e8044609945d8524
docker pull clickhouse/clickhouse-server@sha256:cacf32d6884291dc2ff5e0156a97f46fc53ff7c929a7906d114e268a929dfd3a
docker pull signoz/signoz@sha256:a7d1a968a1f7f65c518106150ac05424ca8e91c52d7076077dfce034980e9c34
docker pull signoz/signoz-otel-collector@sha256:7e4e539a73f1f88fbc1cd7e659ab3950908e83ce1f2a37a297452f910d072174
docker image inspect --format '{{.RepoDigests}}' clickhouse/clickhouse-keeper@sha256:525b8b0f93ccb371131c46f22a066ea43d33d74aba314203e8044609945d8524 clickhouse/clickhouse-server@sha256:cacf32d6884291dc2ff5e0156a97f46fc53ff7c929a7906d114e268a929dfd3a signoz/signoz@sha256:a7d1a968a1f7f65c518106150ac05424ca8e91c52d7076077dfce034980e9c34 signoz/signoz-otel-collector@sha256:7e4e539a73f1f88fbc1cd7e659ab3950908e83ce1f2a37a297452f910d072174
```

Expected: each pull succeeds and each inspect line contains the same digest as the pull. Compare against the Pins table. Any difference stops the start.

**Step c. uid check, before any `chown` and before Keeper starts (items 8 and 17).**

```
docker run --rm --entrypoint id clickhouse/clickhouse-server@sha256:cacf32d6884291dc2ff5e0156a97f46fc53ff7c929a7906d114e268a929dfd3a clickhouse
docker run --rm --entrypoint id clickhouse/clickhouse-keeper@sha256:525b8b0f93ccb371131c46f22a066ea43d33d74aba314203e8044609945d8524 clickhouse
```

Expected on both: `uid=101(clickhouse) gid=101(clickhouse)`. **Stop on any other output.** Only then:

```
chown 101:101 /mnt/nvme/geldar-telemetry/clickhouse /mnt/nvme/geldar-telemetry/keeper
chown 0:0 /mnt/nvme/geldar-telemetry/query
ls -ldn /mnt/nvme/geldar-telemetry/clickhouse /mnt/nvme/geldar-telemetry/keeper /mnt/nvme/geldar-telemetry/query
```

The listing shows `101 101` for the first two and `0 0` for `query`.

**Step d. Create the secret files and check owner, mode and readability (item 14).** Passwords are written by shell builtins, so they never appear in a process argument list:

```
cd /mnt/nvme/geldar-telemetry/secrets
(umask 277; printf %s "$(openssl rand -hex 32)" > ch_writer_password; printf %s "$(openssl rand -hex 32)" > ch_reader_password)
chown 10001:10001 ch_writer_password
chown 0:0 ch_reader_password
ls -ln
```

Expected: `ch_writer_password` is `10001 10001` mode `-r--------`, `ch_reader_password` is `0 0` mode `-r--------`. `ch-hashes.env` does not exist yet (step e). Then read each file as its container uid through a one-shot container, with a read-only mount of that one file and `--cap-drop ALL` (as the service):

```
docker run --rm --user 10001:10001 --cap-drop ALL -v /mnt/nvme/geldar-telemetry/secrets/ch_writer_password:/run/secrets/ch_writer_password:ro --entrypoint sh signoz/signoz-otel-collector@sha256:7e4e539a73f1f88fbc1cd7e659ab3950908e83ce1f2a37a297452f910d072174 -c 'test -r /run/secrets/ch_writer_password && echo readable'
docker run --rm --user 0:0 --cap-drop ALL -v /mnt/nvme/geldar-telemetry/secrets/ch_reader_password:/run/secrets/ch_reader_password:ro --entrypoint sh signoz/signoz@sha256:a7d1a968a1f7f65c518106150ac05424ca8e91c52d7076077dfce034980e9c34 -c 'test -r /run/secrets/ch_reader_password && echo readable'
docker run --rm --user 10001:10001 --cap-drop ALL -v /mnt/nvme/geldar-telemetry/secrets/ch_reader_password:/run/secrets/ch_reader_password:ro --entrypoint sh signoz/signoz-otel-collector@sha256:7e4e539a73f1f88fbc1cd7e659ab3950908e83ce1f2a37a297452f910d072174 -c 'test -r /run/secrets/ch_reader_password && echo readable'
```

Expected: the first two print `readable`; the third (the wrong uid, a negative control) prints nothing. Written for this README. If an image has no `/bin/sh`, stop and resolve item 13.

**Step e. Hash file (guarded; the passwords stay out of argv).** One block, run in a subshell so a failure aborts all of it:

```
(
set -eu
cd /mnt/nvme/geldar-telemetry/secrets
umask 277
empty=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
h() { pw=$(cat "$1"); [ "${#pw}" -eq 64 ] || { echo "ABORT: $1 is not 64 characters" >&2; exit 1; }; printf %s "$pw" | sha256sum | cut -d' ' -f1; }
w=$(h ch_writer_password)
r=$(h ch_reader_password)
if [ -z "$w" ] || [ -z "$r" ] || [ "$w" = "$empty" ] || [ "$r" = "$empty" ] || [ "$w" = "$r" ]; then echo "ABORT: empty, empty-string or equal hash" >&2; exit 1; fi
printf 'GELDAR_CH_WRITER_SHA256=%s\nGELDAR_CH_READER_SHA256=%s\n' "$w" "$r" > ch-hashes.env
)
```

Abort rule: if the block prints `ABORT` or exits non-zero, delete `ch-hashes.env` if it exists and start again. Then `ls -ln ch-hashes.env` shows mode `-r--------` and `grep -c e3b0c442 ch-hashes.env` prints `0` (grep exits 1 when the count is 0; judge by the number). Do not print the file. Do not put password values in a command line or shell history.

**Step f. Histogram binary (item 6), before `geldar-ch` starts.** Use a new empty scratch directory outside the repo, and keep any script out of it.

1. `curl -fsSL -o hq.tar.gz https://github.com/SigNoz/signoz/releases/download/histogram-quantile%2Fv0.0.1/histogram-quantile_linux_amd64.tar.gz`
2. `echo "33997073eb6d82b7be4f27f9fc8ec9e28a395e0f20674d5d54bb2fa28a75488d  hq.tar.gz" | sha256sum -c -` must print `hq.tar.gz: OK`. **On any mismatch delete the tarball and stop. Do not extract.**
3. `tar -tzf hq.tar.gz` lists the contents; record the list in the N4 report (the release ships license and readme files beside the binary).
4. `tar -xzf hq.tar.gz histogram-quantile` extracts only the binary (use the member name from step 3).
5. `sha256sum histogram-quantile`: record the full value in the N4 report. The round 1 value began `fc3168f9`; a different value is a finding to report before install.
6. `install -d -o 101 -g 101 -m 0755 /mnt/nvme/geldar-telemetry/clickhouse/user_scripts` then `install -o 101 -g 101 -m 0755 histogram-quantile /mnt/nvme/geldar-telemetry/clickhouse/user_scripts/histogramQuantile`; `ls -ln /mnt/nvme/geldar-telemetry/clickhouse/user_scripts` shows `101 101` and `-rwxr-xr-x`.
7. Delete the tarball and the extracted copy from the scratch directory.
8. Value check, after `geldar-ch` is healthy (step g): `docker exec geldar-ch clickhouse-client -q "SELECT histogramQuantile([0.5,1,2,inf],[1,3,6,6],0.9)"` expects `1.8000000000000003`, and `... histogramQuantile([0.5,1,2,inf],[1,3,6,6],0.5)` expects `1`. Both are cumulative inputs with a `+Inf` bucket. Also `SELECT name FROM system.functions WHERE name = 'histogramQuantile'` returns one row (item 24).

**Step g. Hash-file refusal, Keeper and ClickHouse, network tests.**

1. Refusal first (item 20): `mv /mnt/nvme/geldar-telemetry/secrets/ch-hashes.env /mnt/nvme/geldar-telemetry/secrets/ch-hashes.env.aside`, then `docker compose -f deploy/telemetry/compose.yml up -d geldar-ch` (starts `geldar-ch-keeper` first and creates the backend network). Wait 2 minutes. `docker inspect -f '{{.State.Health.Status}}' geldar-ch` must not print `healthy` (`starting`, `unhealthy` or `restarting` all pass), and `docker logs geldar-ch` names a missing `GELDAR_CH_WRITER_SHA256` or `GELDAR_CH_READER_SHA256`. If it is `healthy`, stop and resolve item 20 (this refusal was not run in the scratch runs).
2. `docker compose -f deploy/telemetry/compose.yml down` exits 0 (removes the backend network). Then `mv /mnt/nvme/geldar-telemetry/secrets/ch-hashes.env.aside /mnt/nvme/geldar-telemetry/secrets/ch-hashes.env` and repeat `ls -ln` (mode `-r--------`).
3. `docker compose -f deploy/telemetry/compose.yml up -d geldar-ch`. Within 3 minutes both `docker inspect -f '{{.State.Health.Status}}' geldar-ch` and the same for `geldar-ch-keeper` print `healthy`. If either stays unhealthy, stop. Expected restarts: `docker inspect -f '{{.RestartCount}}' geldar-ch geldar-ch-keeper` prints `0` twice.
4. Network: `docker network inspect geldar-telemetry_geldar-telemetry-backend --format '{{.Internal}}'` prints `true`; `docker network inspect geldar-telemetry --format '{{range .Containers}}{{.Name}} {{end}}'` lists `geldar-ch` and not `geldar-ch-keeper`.
5. Run step f.8 (value check) now.
6. Negative and positive tests, from a one-shot container on the external network. Base form (item 21): `docker run --rm --network geldar-telemetry --entrypoint /usr/bin/clickhouse clickhouse/clickhouse-server@sha256:cacf32d6884291dc2ff5e0156a97f46fc53ff7c929a7906d114e268a929dfd3a client --host geldar-ch <options>`. Negative lines must exit non-zero with an authentication or address error and print no `1`; record the error text.
    - `--user default --query "SELECT 1"` must fail (report8: refused for the second container).
    - `--user geldar_writer --password '' --query "SELECT 1"` must fail.
    - `--user geldar_reader --password '' --query "SELECT 1"` must fail.
    - Positive control: `docker run ... -e CLICKHOUSE_PASSWORD ... client --host geldar-ch --user geldar_reader --query "SELECT 1"` with `CLICKHOUSE_PASSWORD="$(cat /mnt/nvme/geldar-telemetry/secrets/ch_reader_password)"` set in the calling shell for that one command (the `-e` form without a value passes it without putting it in argv). Expected `1`. Whether the client reads `CLICKHOUSE_PASSWORD` is not confirmed; if it prints a login error, use `--ask-password` interactively.
    - `docker exec geldar-ch clickhouse-client -q "SELECT name, host_ip, host_names, host_names_regexp, host_names_like FROM system.users WHERE name = 'default'"` shows empty host lists (the `HOST LOCAL` form). Untested replacement: only `SHOW CREATE USER default` was run (report 4 and round 1, when `default` had all privileges); neither it nor this query was run against the restricted `default` (report8 did not run them). `SHOW CREATE USER default` is probably refused for the restricted `default` (explicit-name SHOW needs SHOW USERS, which report8 saw refused for `SHOW GRANTS FOR geldar_writer`). `system.users` was readable as `default` through `remote()` in report8 (6).

**Step h. Migrator, SigNoz, collector, end-to-end, reader and writer checks.**

1. Migrator: `docker compose -f deploy/telemetry/compose.yml up -d geldar-signoz-migrator`, wait for exit, then `docker inspect -f '{{.State.ExitCode}} {{.State.OOMKilled}}' geldar-signoz-migrator` prints `0 false` (report8: exit 0).
2. Tables: `docker exec geldar-ch clickhouse-client -q "SELECT database, count() FROM system.tables WHERE startsWith(database, 'signoz_') GROUP BY database ORDER BY database"` gives `signoz_analytics` 4, `signoz_logs` 14, `signoz_metadata` 6, `signoz_meter` 7, `signoz_metrics` 66, `signoz_traces` 36 (report8). Engines: `... SELECT engine, count() ... GROUP BY engine ORDER BY engine` gives `Distributed` 54, `MaterializedView` 24, `ReplicatedAggregatingMergeTree` 7, `ReplicatedMergeTree` 16, `ReplicatedReplacingMergeTree` 31, `ReplicatedSummingMergeTree` 1. Any other count stops the start; a plain `MergeTree` means replication was off.
3. Start SigNoz and the collector, in that order, as separate starts: `docker compose -f deploy/telemetry/compose.yml up -d geldar-signoz`, then `docker compose -f deploy/telemetry/compose.yml up -d geldar-signoz-otelcol`.
4. SigNoz health: `docker inspect -f '{{.State.Health.Status}}' geldar-signoz` prints `healthy` and `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8095/api/v1/health` prints `200`. Report8 saw one non-fatal ERROR line in the SigNoz log (a missing active-queries log directory); any other ERROR line is a finding. `docker inspect geldar-signoz --format '{{range .Config.Env}}{{println .}}{{end}}' | grep SIGNOZ_ANALYTICS_ENABLED` prints `SIGNOZ_ANALYTICS_ENABLED=false`.
5. Collector: `docker logs geldar-signoz-otelcol 2>&1 | grep -ciE 'error|warn'` prints `0` (report8: 0 error and warn lines); the process listens on 4317, 4318 and 13133 inside (`docker run --rm --net container:geldar-signoz-otelcol busybox netstat -ltn`). No collector port is published.
6. No password in the environment or command of the three services: `docker inspect geldar-signoz-migrator geldar-signoz geldar-signoz-otelcol | grep -cFf /mnt/nvme/geldar-telemetry/secrets/ch_writer_password` prints `0`, and the same with `ch_reader_password`. (`-f` reads the pattern from the file, so it is not in argv. Report8 found none; the only hashes are the two sha256 values in the `geldar-ch` environment.)
7. End-to-end marker (the collector has no published port, so send from a one-shot container on `geldar-telemetry`): make a marker `openssl rand -hex 6` and keep it in the N4 report only. `docker run --rm --network geldar-telemetry curlimages/curl@sha256:<digest> -sS -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '<minimal OTLP/HTTP JSON trace with the marker as span name>' http://geldar-signoz-otelcol:4318/v1/traces` prints `200` (report8: HTTP 200). The scratch run used `curlimages/curl:8.11.1`; its digest is not in the repo.
8. After the collector's flush interval, run `DESCRIBE signoz_traces.signoz_index_v3` to find the span-name column (not recorded in the reports), then count the marker as `default` inside geldar-ch: `docker exec geldar-ch clickhouse-client -q "SELECT count() FROM signoz_traces.signoz_index_v3 WHERE <span name column> = '<marker>'"` expects `1` (local table, report8), and the same through `signoz_traces.distributed_signoz_index_v3` expects `1` (report8 used the distributed table).
9. Reader (read the password as in step g.6, via `CLICKHOUSE_PASSWORD` in the calling shell and `docker exec -e CLICKHOUSE_PASSWORD geldar-ch clickhouse-client --user geldar_reader ...`). Expected (report8): `SELECT count()` through the distributed table works, a filter on the marker works, an INSERT is refused (code 497), `SELECT count() FROM system.query_log` is refused, and `SELECT * FROM remote('127.0.0.1:9000', system, one)` is refused (needs READ ON REMOTE). The exact query text was not recorded; these were written for this README.
10. Writer through `remote()` (item 32, same method with `--user geldar_writer`). Expected (report8): `SELECT * FROM remote('127.0.0.2:9000', view(SELECT currentUser()))` prints `default` (the writer acts as `default`; do not use 127.0.0.1, it is the local shard and `currentUser()` is folded on the initiator, so it prints `geldar_writer`); `url()` and `s3()` wrapped in `remote(... view(...))` are refused (READ ON URL, READ ON S3), `file()` is refused by the path restriction (code 291); `SELECT count() FROM remote('127.0.0.2:9000', system, query_log)` is allowed (accepted residual; report8 got 7). Directly as the writer: `url()`, `s3()` and `SYSTEM FLUSH LOGS` are each refused (Code 497), and `file()` gives Code 291 (path only). `KILL QUERY`: start `SELECT sleep(3)` as the admin connection with a fixed `query_id` in the background, then as the writer run `KILL QUERY WHERE query_id = '<that id>' SYNC` (or `TEST`); expect Code 497. A KILL that matches no row exits 0 and proves nothing. Record the exact query text you used in the N4 report; the reports do not keep it. As `default` inside geldar-ch, `SHOW GRANTS FOR geldar_writer` is refused (needs SHOW USERS, report8), so the grant list is read from `users.xml` and the effective rows from `system.grants WHERE user_name = 'geldar_writer'` (report8: 92 rows, rc 0); `SHOW GRANTS` as `default` is not part of the check.

**Step i. Node-only checks and the remaining unverified items.**

1. Real caps (item 17 and the compose caps): with the 0352 caps in place, `docker stats --no-stream` once the stack is up; record the figures. The caps are `geldar-ch` 3.0 CPU and 8g, Keeper 0.5 and 1g, `geldar-signoz` 1.0 and 1g, the collector 0.5 and 1g, the migrator 0.5 and 512m. The scratch figures came from lowered caps and prove nothing about these.
2. Secret owner and mode, and the uid check: steps c and d, done on the node.
3. Item 29 (cluster alias): `docker exec geldar-ch clickhouse-client -q "SELECT host_name, host_address FROM system.clusters WHERE cluster='cluster'"` shows `geldar-ch-sql` and the telemetry-network address (not the backend address); the migrator already reached it in step h.1.
4. Items 30 and 31 (listeners): `docker run --rm --net container:geldar-ch busybox netstat -ltn` shows 8123 and 9000 on `0.0.0.0`, 9009 on `127.0.0.1`, and no 9004 or 9005. Record any other listener.
5. Item 32: see step h.10. Also `docker exec geldar-ch clickhouse-client -q "SELECT count() FROM system.grants WHERE user_name = 'default'"` is not evidence for REMOTE (report8: the REMOTE grant does not appear as a row there), so do not use it.
6. Item 25 and the system-log TTL check. After the stack has run 10 minutes: `docker exec geldar-ch clickhouse-client -q "SELECT name FROM system.tables WHERE database = 'system' AND name LIKE '%\_log' AND create_table_query NOT LIKE '%TTL%'"`. The file `system-log-ttl.xml` has 23 sections. Decision rule: any table listed without a TTL gets a section in `system-log-ttl.xml` before the stack is left up unattended. A table with its TTL in the engine (for example `opentelemetry_span_log`) can show `TTL` only in `engine_full`; check that column for a listed name before adding a section.
7. Item 22: after a day, `docker exec geldar-ch ls -la /var/log/clickhouse-server` shows no growing files. The `Not found: logger.log` notices at startup are not failures.
8. Item 15: `docker port geldar-signoz` prints only `8080/tcp -> 127.0.0.1:8095`; `docker run --rm --net container:geldar-signoz busybox netstat -ltn` shows 4320 and 6060 on all interfaces (rounds 1 and 8). Decide at N4 whether to accept their reach from `geldar-telemetry` containers; record the decision.
9. Item 33 (outbound sockets of `geldar-signoz`): run the decode recipe from item 33 about 60 seconds after start and again after 10 minutes. Record only the port, public or private, and the reverse-DNS name in the N4 report. If the connection persists, recurs or resolves to a vendor or analytics host, stop and ask the owner about egress. Until decided, do not leave `geldar-signoz` running unattended. This blocks unattended running, not the N4 start.

**Step j. Rollback.** `docker compose -f deploy/telemetry/compose.yml down` stops and removes the containers and the backend network (data stays on the host, and the external `geldar-telemetry` is not removed). Check with `docker network ls` that `geldar-telemetry_geldar-telemetry-backend` is gone. Delete the data directories under `/mnt/nvme/geldar-telemetry` only on the owner's say.

## Start order (for the scratch run, not this packet)

1. `geldar-ch-keeper` healthy.
2. `geldar-ch` healthy, and the histogram binary present.
3. `geldar-signoz-migrator` runs once and exits 0 (`restart: "no"`).
4. `geldar-signoz`, then `geldar-signoz-otelcol`.

Each step is a separate start. Do not start the collector before the migrator exits 0.

## Checks for this packet

- `docker compose -f deploy/telemetry/compose.yml config` with dummy secret paths and dummy environment (see the file's header comment). No start, no pull.
- The otelcol config validation in the scratch run (item 16).
