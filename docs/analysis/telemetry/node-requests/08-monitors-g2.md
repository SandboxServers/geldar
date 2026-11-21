# Node request 08: the G2 monitors (Postgres role and secret, gateway restage, NATS exporter)

Status: DRAFT for the owner and the orchestrator geldar-69. Nothing here has been run. Nothing in this request runs on the node until
its own owner OK and window are given. Nothing is run from this file: it is the brief for each step.
Format: the step layout of `docs/analysis/telemetry/node-requests/01-gateway-restage-and-clickhouse-recreate.md`.
Design and facts: `docs/runbooks/telemetry-monitors.md`, `docs/analysis/telemetry/collector-design.md` sections 11 and 12,
`deploy/telemetry/gateway.yaml`, `deploy/telemetry/compose.gateway.yml`, `deploy/telemetry/postgres-monitor.sql`,
`compose/opt-in/colo-nats-exporter.yml`, `deploy/common.sh`, `deploy/README.md`, and the window log in `deploy/telemetry/README.md`.
Labels: **UNVERIFIED** = not checked against the repo or the node; `[UNV]` marks one command or fact inside a step that has no repo source.
No URL, address, password or secret value is written in this file. Placeholders: `<merge>` (the full sha of the merge that holds the G2 files;
`1c0e0c60` is the base of this branch and holds them), `<TELEMETRY_PG_SECRETS_DIR>` (the telemetry secrets directory, owner option (a), settled 2026-11-21, section 6), `<colo checkout>`
(the colo stack's compose directory on the node, **UNVERIFIED**), `<migration role>` (the database role that runs psql, **UNVERIFIED**), `<ts>` (UTC timestamp).

Owner approval needed: yes. Each step below needs a fresh direct owner OK with a window from the orchestrator geldar-69
before it runs. The steps are: S1 secret file, S2 monitoring role, S3 stage (extract, validate, swap), S4 gateway restage (window W1),
S5 exporter start (window W2). W1 and W2 are separate windows, never the same window.

## Rules for the operator

1. Every compose or deploy-script command carries `GELDAR_SERVICE_UID=1001` (under sudo write `sudo env GELDAR_SERVICE_UID=1001 ...`).
2. Any compose command on the node carries the explicit deploy environment from the colo env files and always `up -d --no-deps <service>`.
3. Prove that the render matches the RUNNING container before restarting anything (docker compose config diff against docker inspect of the running container).
4. NOTHING may be written outside the named paths (list them explicitly in each document: the stage directory, the secrets file, a temp dir that is removed).
5. No scratch files.
6. Never run anything that stops, removes or recreates containers or networks other than the one named.
7. No secrets, account names or IPs in the document.
8. Each step needs a fresh direct owner OK with a window from the orchestrator geldar-69 before it runs.

## 1. What changes

1. S1: a new file `<TELEMETRY_PG_SECRETS_DIR>/otel-pg.txt` (the Postgres monitor password), owner `10001`, group `10001`, mode `0400`.
2. S2: the Postgres role `geldar_monitor` (LOGIN, `pg_read_all_stats`, CONNECT on the database `geldar`). The role owns nothing (the SQL file creates no object).
3. S3: the telemetry tree `/mnt/nvme/geldar-telemetry/src` is replaced by one extracted from `<merge>` (the old tree is kept as `src.old-g2`).
   The new `gateway.yaml` adds the `nats` scrape (`nats:7777`, 30 s) and the `postgresql` receiver (`postgres:5432`, database `geldar`, user `geldar_monitor`).
   The redaction rules are unchanged from the tree now on the node (`1e4f2078`, per the window log N10 and N11).
4. S4 (W1): `geldar-gateway` is recreated, with the secret mounted at `/run/secrets/otel-pg.txt` (read-only) and the new receivers. Nothing else is recreated.
5. S5 (W2): `nats-exporter` is started (`natsio/prometheus-nats-exporter`, flags `-varz -jsz all -port 7777`) in the NATS network namespace. `nats` is not recreated.

## 2. Not touched

- Every container except `geldar-gateway` (S4) and `nats-exporter` (S5). Named: `geldar-ch`, `geldar-ch-keeper`, `geldar-signoz`,
  `geldar-signoz-otelcol`, `geldar-signoz-query`, `geldar-signoz-ui`, `board-proxy` (Caddy), Paper, Velocity, Bodies, Minds, every other tenant.
- `nats` (never recreated; no restart; its config and permissions are not changed). The Postgres server, its config and its restart
  (`pg_stat_statements` is a separate request that needs a Postgres restart).
- Every other file in the colo secrets directory, and the ClickHouse password files in `/mnt/nvme/geldar-telemetry/secrets/` (the telemetry
  secrets directory holds only `otel-pg.txt`); the queue directory's contents (the gateway writes them at run time, nothing here writes them);
  the ClickHouse and SigNoz data directories; `src.old*` trees other than the one this request creates; the stage tarballs.
- The Caddy route and `otel.caddy`; the gateway's loopback publish (its port mapping stays as in `compose.gateway.yml`).

## 3. Named paths (the only places anything is written)

- `<TELEMETRY_PG_SECRETS_DIR>/`: the directory (created by `sudo mkdir` in S1; root-owned; its mode is not set by this request). It holds only
  `otel-pg.txt`. Nothing else is created in it.
- `<TELEMETRY_PG_SECRETS_DIR>/otel-pg.txt`: the secret file (S1), owner `10001:10001`, mode `0400`. Removed only by rollback R1.
- `/mnt/nvme/geldar-telemetry/`: `telemetry-<merge>.tar.gz` (the tarball, S3), `src.new-g2/` (the extracted tree, S3, becomes `src`),
  `src` renamed to `src.old-g2` (kept, S3). Nothing else in that directory is written.
- `/mnt/nvme/geldar-telemetry/stage/`: `baseline-g2-<ts>.txt` (the baseline, section 5 step 1) and the W1 and W2 check outputs, named with `<ts>`.
- `/mnt/nvme/geldar-telemetry/stage/g2-tmp-<ts>/`: a temp dir for the render and inspect outputs (`render-*.json`, `inspect-*.txt`).
  It is removed at the end of each step (the step is not done until it is gone).
- The database `geldar`: the role `geldar_monitor` (S2) and its grants, nothing else. No table is written.
- The operator machine: none, except the copy of the tarball used to move it (`<OP_TMP>`, removed after the copy, UNVERIFIED route).

## 4. Caps (from the compose files; no new limit)

| Container | CPU | Memory | pids | Source |
|---|---|---|---|---|
| geldar-gateway | 0.5 (NanoCpus 500000000) | 1g (bytes 1073741824), memswap 1g, GOMEMLIMIT 800MiB | 256 | `deploy/telemetry/compose.gateway.yml` |
| nats-exporter | 0.1 (NanoCpus 100000000) | 64m (bytes 67108864), memswap 64m | 64 | `compose/opt-in/colo-nats-exporter.yml` |

Expected: `docker inspect -f '{{.HostConfig.NanoCpus}} {{.HostConfig.Memory}} {{.HostConfig.PidsLimit}}' geldar-gateway` prints `500000000 1073741824 256`;
the same for `nats-exporter` prints `100000000 67108864 64`. Measured usage: `docker stats --no-stream geldar-gateway nats-exporter` shows memory under the limit.

## 5. Baseline and pre-checks (read-only)

1. Node, read-only, into `/mnt/nvme/geldar-telemetry/stage/baseline-g2-<ts>.txt` (umask 077), in the style of request 01 section 5:
   ```
   docker ps --format '{{.Names}} {{.Image}} {{.Status}}'
   docker inspect -f '{{.Name}} {{.RestartCount}} {{.State.StartedAt}} {{.Id}}' geldar-ch geldar-ch-keeper geldar-signoz geldar-signoz-otelcol geldar-gateway nats
   docker inspect -f '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{println}}{{end}}' geldar-gateway
   docker stats --no-stream geldar-gateway
   df -h /mnt/nvme
   ```
   [UNV: `nats` as the container name; the colo stack's names are in `compose/colo.yml`, not checked.] Do NOT record `docker inspect` of `.Config.Env`:
   the values are not needed and must not be written to a file.
2. Gateway queue (the queue must be under 50 percent of capacity, as in request 01): read the gateway's own metrics endpoint (loopback port 8888 inside the container,
   `deploy/telemetry/gateway.yaml`) from the gateway's network namespace with the pinned curl image (`curlimages/curl`, digest in `deploy/telemetry/README.md`, "Gateway (N8)").
   Record `otelcol_exporter_queue_size`, `otelcol_exporter_queue_capacity`, `otelcol_exporter_enqueue_failed_*`, `otelcol_exporter_send_failed_*`,
   `otelcol_processor_refused_*`. The failure series appear only after a first increment (README N10), so an absent series is recorded as absent.
3. Colo deploy environment, names only, never values: the release file is `GELDAR_RELEASE_FILE` (default `/etc/geldar-colo/release.env`, `deploy/common.sh`).
   Check the keys with `sudo grep -o '^[A-Z_]*=' /etc/geldar-colo/release.env` (prints names, not values). [UNV: whether the file is sourced as shell; `deploy/common.sh` is the reference.]
4. Stop if `geldar-gateway` is not running, if the queue is above 50 percent, or if `nats` is not running.

## 6. Secrets directory (settled: owner option (a), geldar-69, 2026-11-21)

- The Postgres monitor secret lives in its own telemetry secrets directory, `<TELEMETRY_PG_SECRETS_DIR>`, which holds only `otel-pg.txt`
  (owner `10001`, mode `0400`). The colo secrets directory (`/etc/geldar-colo/secrets`, `deploy/common.sh`) and its ownership check
  (`deploy/README.md`, around line 156) are not touched, so the colo refusal does not apply to this file.
- Placement: the placeholder stands for a directory under the telemetry state tree `/mnt/nvme/geldar-telemetry/` (`deploy/telemetry/README.md`,
  "Host paths"). The existing `/mnt/nvme/geldar-telemetry/secrets/` is NOT used: it holds the ClickHouse passwords, so it would hold more than
  `otel-pg.txt`. No path in that README names a directory for this file, so the name is left as the placeholder `<TELEMETRY_PG_SECRETS_DIR>`,
  to be named by the orchestrator (a new directory directly under `/mnt/nvme/geldar-telemetry/`, which `sudo` may `mkdir` and `chown`).
- `GELDAR_SECRETS_DIR` is set explicitly to `<TELEMETRY_PG_SECRETS_DIR>` on the psql run (section 9) and on the gateway compose commands
  (sections 11 and 13). No colo command sets it (section 12, rollback R5). Nothing else is set in that variable.
- The compose default `${GELDAR_SECRETS_DIR:-../../compose/secrets}` (`deploy/telemetry/compose.gateway.yml`) can still apply if the variable
  is unset: it resolves to the repo's `compose/secrets`. So the variable is treated as required: a command that would run without it is not run,
  and the operator stops. The code change that makes Compose refuse an unset variable is a follow-up (section 15, item 6), not made here.

## 7. S1: create the secret file (no output of the value)

Owner OK and window for S1. First create the directory (inside `/mnt/nvme/geldar-telemetry`, the only tree the sudo scope allows): `sudo mkdir "<TELEMETRY_PG_SECRETS_DIR>"`.
Then run on the node as root, from one command, so the value is generated inside the shell and never printed or sent:
```
sudo sh -c 'umask 077; head -c 24 /dev/urandom | od -An -tx1 | tr -d " \n" > "$1"' sh "<TELEMETRY_PG_SECRETS_DIR>/otel-pg.txt"
sudo chown 10001:10001 "<TELEMETRY_PG_SECRETS_DIR>/otel-pg.txt"
sudo chmod 0400 "<TELEMETRY_PG_SECRETS_DIR>/otel-pg.txt"
```
- The value is 48 hex characters with no newline (`od` and `tr` remove the spaces and newlines). Nothing is printed. Do not echo, cat or `set -x`.
- Verify without reading the value: `sudo stat -c '%U:%G %a %s' "<TELEMETRY_PG_SECRETS_DIR>/otel-pg.txt"` must print `10001:10001 400 48`.
  A size other than 48 means the file is wrong: delete it (R1) and stop.
- The value is never put in a chat, a log, a command line or this repo. Rollback is section 13 (R1).

## 8. S3a: extract the tree (before S2, because S2 reads the SQL file from it)

The SQL file reaches the node only with the tarball, so the extraction (3a) runs before the role (S2), and the swap (3b) after it.
This is the only change to the order of the brief: S1, S3a, S2, S3b, S4, S5.

1. Dev machine: `git archive --format=tar.gz -o <OP_TMP>/telemetry-<merge>.tar.gz <merge> deploy/telemetry` and `Get-FileHash -Algorithm SHA256` on it
   (`<OP_TMP>` is a new empty directory outside the repo, removed after the copy). Keep the printed checksum.
   The route for copying it to `/mnt/nvme/geldar-telemetry/` is the one the first staging used (**UNVERIFIED**: not recorded in the repo).
2. Node: `cd /mnt/nvme/geldar-telemetry && echo "<sha256>  telemetry-<merge>.tar.gz" | sha256sum -c -` must print `telemetry-<merge>.tar.gz: OK`.
   On any mismatch delete the tarball and stop.
3. Node: `mkdir src.new-g2 && tar -xzf telemetry-<merge>.tar.gz -C src.new-g2`. No swap yet.

## 9. S2: the monitoring role (one psql run, as the migration role)

Owner OK and window for S2. The SQL file is `src.new-g2/deploy/telemetry/postgres-monitor.sql` (from S3a). The psql run needs
`GELDAR_SECRETS_DIR` in its environment, so the `\set` in the file reads the secret inside psql (the password is in no command line):
```
cd /mnt/nvme/geldar-telemetry && sudo -u <migration role> env GELDAR_SECRETS_DIR=<TELEMETRY_PG_SECRETS_DIR> psql -v ON_ERROR_STOP=1 -d geldar -f src.new-g2/deploy/telemetry/postgres-monitor.sql
```
[UNV: the migration role's OS user, how psql connects (socket or host), and whether the operator needs sudo for the secret file (it is owned by 10001, mode 0400, so root or the 10001 user reads it). The runbook says "as the migration role" and "as root (or through sudo)".]

- The script is re-runnable: it creates the role only when missing, sets the password on every run and re-grants the same two privileges.
- Verify, read-only: `SELECT rolname, rolcanlogin FROM pg_roles WHERE rolname = 'geldar_monitor';` returns one row with `rolcanlogin` true.
  `SELECT pg_has_role('geldar_monitor', 'pg_read_all_stats', 'member');` returns true. `SELECT has_database_privilege('geldar_monitor', 'geldar', 'CONNECT');` returns true.
- Write check (must fail): connect as `geldar_monitor` (password passed only through an environment variable set for that one command, [UNV]) and run
  `INSERT INTO <an existing table named by the owner> SELECT * FROM <same table> WHERE false;`. The expected result is `permission denied`. A success is a failure of this step: stop and roll back (R2).
- The role owns nothing: `SELECT count(*) FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE r.rolname = 'geldar_monitor';` returns 0 [UNV: the catalog query].

## 10. S3b: swap and validate, then the restage

Owner OK for S3b (the swap changes the tree the gateway reads at its next recreate; no container is recreated by the swap).

1. Validate the NEW config before the swap, on the pinned collector image, with the secret mounted (the `${file:...}` is read at load):
   ```
   docker run --rm --network none -e GELDAR_SIGNOZ_OTLP_ENDPOINT=geldar-signoz-otelcol:4317 --entrypoint /otelcol-contrib -v /mnt/nvme/geldar-telemetry/src.new-g2/deploy/telemetry/gateway.yaml:/etc/otelcol/gateway.yaml:ro -v /mnt/nvme/geldar-telemetry/queue:/var/lib/otelcol/queue -v "<TELEMETRY_PG_SECRETS_DIR>/otel-pg.txt:/run/secrets/otel-pg.txt:ro" otel/opentelemetry-collector-contrib@sha256:340c9ca6a36617084c6661bdc4f0fe92b7cda5a805d61673ec8db375fddc522b validate --config=/etc/otelcol/gateway.yaml
   ```
   It must print nothing and exit 0 (the form of request 01 step 4, plus the secret mount). Any output: `rm -rf src.new-g2` and stop (nothing else has changed).
   The image digest is the one in `deploy/telemetry/compose.gateway.yml`. This command is not a compose command, so rule 1 does not apply to it.
2. Swap: `cd /mnt/nvme/geldar-telemetry && mv src src.old-g2 && mv src.new-g2 src`. `src.old-g2` is the rollback tree: it holds the `1e4f2078` tree
   that is on the node now (request 03 removed `src.old-n10`; the tarball `telemetry-1e4f2078.tar.gz` also stays). Keep it until the owner says.
3. Verify: `ls -ld /mnt/nvme/geldar-telemetry/src /mnt/nvme/geldar-telemetry/src.old-g2` and `sha256sum` of the new gateway.yaml against the one in the tarball
   (both paths read-only; no content printed).

## 11. S4 (window W1): restage the gateway only

Owner OK and window for W1. It must not share a window with S5 (W2).

1. Render, before the recreate (rule 3). Into the temp dir `g2-tmp-<ts>`:
   ```
   cd /mnt/nvme/geldar-telemetry/src && GELDAR_SERVICE_UID=1001 GELDAR_SECRETS_DIR=<TELEMETRY_PG_SECRETS_DIR> docker compose -f deploy/telemetry/compose.yml -f deploy/telemetry/compose.gateway.yml config --format json > /mnt/nvme/geldar-telemetry/stage/g2-tmp-<ts>/render-gateway.json
   docker inspect geldar-gateway > /mnt/nvme/geldar-telemetry/stage/g2-tmp-<ts>/inspect-gateway.json
   ```
   [UNV: `config --format json` on the node's Compose version; `deploy/telemetry/README.md` asks for Compose 2.24 or later for `--dry-run`, not checked here.]
2. Diff the fields that must match (user, read_only, cap_drop, security_opt, image digest, networks, published ports, pids, memory, cpus,
   and the mount list minus the secret) with `jq` on both files [UNV: the jq paths]. The ONLY accepted differences are:
   (a) one new read-only mount, the secret, `<TELEMETRY_PG_SECRETS_DIR>/otel-pg.txt` to `/run/secrets/otel-pg.txt`;
   (b) the `gateway.yaml` mount with the same source path and a new file (new inode after the S3b swap);
   (c) the gateway's config hash label changes (expected; it is the proof after the recreate, section 12).
   Any other difference stops the step. A difference in the image digest, in limits, in networks or in published ports stops it.
   [UNV: a non-jq method if jq is not on the node.]
3. The dry run, to read the plan (names only): `GELDAR_SERVICE_UID=1001 GELDAR_SECRETS_DIR=<TELEMETRY_PG_SECRETS_DIR> docker compose -f deploy/telemetry/compose.yml -f deploy/telemetry/compose.gateway.yml up -d --no-deps --dry-run geldar-gateway`
   [UNV: `--dry-run` on the node's Compose]. The plan must name `geldar-gateway` only. Any other service named stops the step.
4. The recreate (rule 2 applies. The telemetry stack has no colo env file of its own, so its explicit deploy environment is the two variables set on the command, `GELDAR_SERVICE_UID=1001` and `GELDAR_SECRETS_DIR`; [UNV] whether the colo release file must also be sourced for this project):
   ```
   cd /mnt/nvme/geldar-telemetry/src && GELDAR_SERVICE_UID=1001 GELDAR_SECRETS_DIR=<TELEMETRY_PG_SECRETS_DIR> docker compose -f deploy/telemetry/compose.yml -f deploy/telemetry/compose.gateway.yml up -d --no-deps geldar-gateway
   ```
   Under sudo: `sudo env GELDAR_SERVICE_UID=1001 GELDAR_SECRETS_DIR=<TELEMETRY_PG_SECRETS_DIR> docker compose ...` (the same arguments).
   The compose output must name `geldar-gateway` only.

### W1 verification (gateway)

1. Config hash now equals the render: `docker inspect -f '{{index .Config.Labels "com.docker.compose.config-hash"}}' geldar-gateway` equals
   `GELDAR_SERVICE_UID=1001 GELDAR_SECRETS_DIR=<TELEMETRY_PG_SECRETS_DIR> docker compose -f deploy/telemetry/compose.yml -f deploy/telemetry/compose.gateway.yml config --hash=geldar-gateway` (run in `src`) [UNV: the hash option on the node's Compose].
2. Running, restarts 0; `docker logs geldar-gateway --since <ts>`: no error line; `password authentication failed` absent (the postgresql receiver reads the secret);
   `connection refused` for `nats:7777` is expected until S5. The `postgresql` receiver logs no secret value (check the names only).
3. Mount: `docker inspect -f '{{range .Mounts}}{{.Source}} -> {{.Destination}} {{.RW}}{{println}}{{end}}' geldar-gateway` lists the secret at `/run/secrets/otel-pg.txt` with RW false.
4. Hardening unchanged: `docker inspect -f '{{.HostConfig.ReadonlyRootfs}} {{.HostConfig.CapDrop}} {{.HostConfig.SecurityOpt}} {{.Config.User}}' geldar-gateway` prints `true [ALL] [no-new-privileges:true] 10001:10001`.
5. Caps: `500000000 1073741824 256` (section 4). Health: the one-shot curl check of the health extension, as in `deploy/telemetry/README.md` ("Gateway (N8)" verification 6).
6. Queue and counters flat: `otelcol_exporter_queue_size` below the 50 percent mark; `otelcol_exporter_enqueue_failed_*`, `otelcol_exporter_send_failed_*`, `otelcol_processor_refused_*`
   absent or zero, read in the same way as the baseline.
7. Series `postgresql` (metric names `postgresql.*`, [UNV: exact names]) present in SigNoz after two scrape intervals (60 s), through the tunnel (`docs/runbooks/signoz-import.md`).
8. Other containers: `docker ps` names and StartedAt of every container in the baseline are unchanged except `geldar-gateway`.
9. Delete the temp dir `g2-tmp-<ts>` (its render and inspect outputs).

Stop criteria during W1: the gateway not running after 120 s; a `password authentication failed` line; a queue above 80 percent; any container other than the gateway restarted.

## 12. S5 (window W2): start nats-exporter only

Owner OK and window for W2, given after W1 has passed and has been quiet for at least 30 minutes. W2 is a separate window of at most 20 minutes.

1. Render and hash, before the start (rule 3). `nats` must not change:
   ```
   cd <colo checkout> && set -a && . /etc/geldar-colo/release.env && set +a
   docker compose -p "${GELDAR_PROJECT:-geldar-colo}" -f compose/colo.yml -f compose/nats-auth.yml -f deploy/compose.secrets.yml -f compose/opt-in/colo-nats-exporter.yml config --hash=nats
   docker inspect -f '{{index .Config.Labels "com.docker.compose.config-hash"}}' nats
   ```
   The two hashes must be equal. Any difference stops the step: `nats` would be recreated by this compose set.
   [UNV: the colo release file is sourced like this; `deploy/common.sh` is the reference; the colo checkout path; `--hash` on the node's Compose; the `nats` container name.]
   The release file is `GELDAR_RELEASE_FILE`, default `/etc/geldar-colo/release.env`. Its values are not printed.
2. The dry run (names only): `GELDAR_SERVICE_UID=1001 docker compose -p "${GELDAR_PROJECT:-geldar-colo}" -f compose/colo.yml -f compose/nats-auth.yml -f deploy/compose.secrets.yml -f compose/opt-in/colo-nats-exporter.yml up -d --no-deps --dry-run nats-exporter`
   [UNV: `--dry-run`]. The plan names `nats-exporter` only.
3. The start (the runbook's command, with the colo deploy environment and no `GELDAR_SECRETS_DIR`, so the colo secrets directory applies; `--no-deps` is required):
   ```
   GELDAR_SERVICE_UID=1001 docker compose -p "${GELDAR_PROJECT:-geldar-colo}" -f compose/colo.yml -f compose/nats-auth.yml -f deploy/compose.secrets.yml -f compose/opt-in/colo-nats-exporter.yml up -d --no-deps nats-exporter
   ```
   Under sudo: `sudo env GELDAR_SERVICE_UID=1001 docker compose ...` (the same arguments).
   Without the auth and secrets overlays, or without `--no-deps`, `nats` would be converged. Never start the exporter with fewer files.

### W2 verification (exporter)

1. `nats-exporter` running, restarts 0. `nats` StartedAt unchanged (baseline value).
2. Caps: `docker inspect -f '{{.HostConfig.NanoCpus}} {{.HostConfig.Memory}} {{.HostConfig.PidsLimit}}' nats-exporter` prints `100000000 67108864 64`;
   `docker stats --no-stream nats-exporter` memory under 64 MiB.
3. No published port: `docker port nats-exporter` prints nothing.
4. Series `nats` present in SigNoz (through the tunnel), and no series derived from `/subsz`, `/connz`, `/routez`, `/gatewayz`, `/leafz` or `/accstatz`
   (the overlay reads `/varz` and `/jsz` only). [UNV: the exporter's exact series names.]
5. The gateway scrape of `nats:7777` succeeds (`otelcol_*` gateway counters flat; no new `connection refused` after the first scrape interval).
6. Delete the W2 output files under `stage/` if any were written.

## 13. Rollback (each step, in the reverse order: R5, R4, R2, R1, and the swap R3)

Each rollback needs its own owner OK and window, as the step did. Do them in this order: R5 (exporter), R4 (gateway, which needs R3's tree first), R2 (role),
R1 (secret). Nothing is deleted except the named files and the named role.

- **R5 exporter:** `docker compose -p "${GELDAR_PROJECT:-geldar-colo}" -f compose/colo.yml -f compose/nats-auth.yml -f deploy/compose.secrets.yml -f compose/opt-in/colo-nats-exporter.yml rm -sf nats-exporter`
  (the runbook's command; the output must name `nats-exporter` only). `nats` StartedAt unchanged. NATS is untouched.
  The gateway's `nats` scrape then logs `connection refused` (expected until R4).
- **R4 gateway (after R3):** restore the previous tree and recreate the gateway from it:
  `cd /mnt/nvme/geldar-telemetry && mv src src.failed-g2 && mv src.old-g2 src`, then render-check as in section 11 (the expected difference is now the removed secret mount),
  then `GELDAR_SERVICE_UID=1001 GELDAR_SECRETS_DIR=<TELEMETRY_PG_SECRETS_DIR> docker compose -f deploy/telemetry/compose.yml -f deploy/telemetry/compose.gateway.yml up -d --no-deps geldar-gateway`
  from `src`. The queue persists across this (records queued under the new rules stay as they are). `src.failed-g2` is kept until the owner says.
  If `src.old-g2` is missing, extract `telemetry-1e4f2078.tar.gz` (checksum on file, `deploy/telemetry/README.md` window log N10) into a new directory and swap.
- **R2 role:** the runbook's statements, through the same psql run as S2:
  `REVOKE pg_read_all_stats FROM geldar_monitor; REVOKE CONNECT ON DATABASE geldar FROM geldar_monitor; DROP ROLE geldar_monitor;`
  The role owns nothing (section 9). Run R2 after R4, because the gateway's `postgresql` receiver uses the role until then.
- **R1 secret (last):** `sudo rm -f "<TELEMETRY_PG_SECRETS_DIR>/otel-pg.txt"`. Only after R4, so that no running gateway mounts it. Nothing else in the directory changes.
- **R3 swap:** part of R4 above (`mv src src.failed-g2 && mv src.old-g2 src`). The tarball `telemetry-<merge>.tar.gz` and `src.failed-g2` are kept.

Verification after each rollback: the gateway is running with restarts 0 and no mount of the secret; `pg_roles` has no `geldar_monitor` row; the secret file is absent;
`nats` StartedAt unchanged; the other containers are unchanged (section 5 baseline).

## 14. Blast radius and risks (from the repo; the owner accepts them at each OK)

- The `geldar_monitor` role reads other sessions' query text (`pg_read_all_stats`, `deploy/telemetry/postgres-monitor.sql`, risk 13 in
  `docs/analysis/telemetry/rollout-plan.md`). Literal values in query text reach telemetry. Decision 0350 allows content; the effect is UNVERIFIED for this release.
- `/jsz` and `/varz` are reachable on `nats:7777` from the colo network by any container there (`docs/runbooks/telemetry-monitors.md`, Risks). Accepted for now.
- The exporter runs without `cap_drop`, `no-new-privileges` or a read-only root (the overlay does not set them). Accepted for now.
- The gateway's memory and queue: unchanged caps; the new receivers add scrape and query load every 30 s. [UNV: its size.]
- `pg_stat_statements` is not part of G2.

## 15. Owner decisions

1. Settled: option (a), a telemetry secrets directory holding only `otel-pg.txt` (owner `10001`), by the owner via geldar-69 on 2026-11-21
   (section 6). The directory's name is still the placeholder `<TELEMETRY_PG_SECRETS_DIR>`: S1 does not run until the orchestrator names it.
2. The migration role's OS user and the psql connection method (section 9). [UNV]
3. The W1 window, and the W2 window (separate, after W1 has been quiet for 30 minutes).
4. Accept the `pg_read_all_stats` risk and the `/jsz` exposure (section 14).
5. Keep `src.old-g2` (the rollback tree) until the owner says it can go.
6. Follow-up, code change (not made in this request): make `deploy/telemetry/compose.gateway.yml` refuse an unset `GELDAR_SECRETS_DIR`
   (for example `${GELDAR_SECRETS_DIR:?...}`), so the `compose/secrets` default cannot apply. Until it lands, section 6 is the rule.

## 16. UNVERIFIED list

- The name of the telemetry secrets directory `<TELEMETRY_PG_SECRETS_DIR>` (a placeholder; not chosen; section 6).
- The migration role's OS user and the psql connection method; whether root or the 10001 user reads the secret for psql.
- The colo checkout path on the node; the sourcing of `/etc/geldar-colo/release.env`; the `nats` container name.
- `docker compose ... config --format json`, `config --hash`, `up --dry-run` and `--no-deps` behaviour on the node's Compose version (Compose 2.24 or later is also an unchecked need).
- The jq paths of the render diff in section 11, and the non-jq method if jq is absent.
- The exact `postgresql.*` and nats exporter series names in SigNoz.
- The route for copying the tarball to the node (the first staging's route is not recorded in the repo).
- That the telemetry compose and the colo compose both use the same `GELDAR_SERVICE_UID` semantics (only the file-owner check in `deploy/README.md` is read).
- The Postgres catalog queries in section 9, and the password route for the write-denied check.
- The memory and CPU effect of the new receivers and the exporter on the node.

## 17. Report-back (the orchestrator records it in the telemetry window log)

UTC start and end of each window (W1, W2) and the step numbers that ran; the baseline file name; the render-diff result for S4 (the accepted
differences only); the config-hash equality for `nats` before S5 and for `geldar-gateway` after S4; the restart counts and StartedAt of every container
in the baseline; the queue size before and after; each W1 and W2 check result; any rollback with its step; the series checks in SigNoz; and every UNVERIFIED item
that was verified during the run, with the evidence (names and counts only, no values).
