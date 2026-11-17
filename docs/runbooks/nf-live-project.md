# The live NeoForge shard: compose project geldar-nf

Status: the compose file and its repo test exist (compose/nf-live.yml, tools/repo-checks/src/nf-live-compose.test.ts).
Nothing here is deployed. The file renders; it has not been started on the node. Public exposure, the shared Caddy and
the human route are out of scope (owner decisions for the final-instance step). Nothing is published beyond loopback.

The per-shard storage design is in docs/analysis/neoforge/per-shard-storage-design.md (one NATS, one Postgres database,
one sink per shard; see also docs/decisions/0026-one-database-per-shard.md). Read that first for why the shard is separate.

## 1. What the project is

- Project name `geldar-nf` (top-level `name:` in compose/nf-live.yml, so a plain `-f` call also lands here).
- Shard token `nf`. Its own NATS (JetStream), its own Postgres database `geldar_nf`, its own sink, its own network
  (`geldar-nf_nf`) and its own named volumes (`geldar-nf_*`). None is external. The file is not an overlay and names no
  other compose file.
- Services: `nats`, `postgres`, `eventsink`, `identity-seed` (one-shot), `velocity`, `neoforge` (the NeoForge 26.1.2 server
  with Proxy Compatible Forge for forwarding, bundle install, pinned mod jar).

## 2. Port block (loopback only)

| Host port | Service  | Container port | Published | Note |
|-----------|----------|----------------|-----------|------|
| 46565     | velocity | 25565          | yes, `127.0.0.1` | the only published port; loopback game ingress |
| 46222     | nats     | 4222           | no | reserved: NATS client, never published by this file |
| 46432     | postgres | 5432           | no | reserved: Postgres, never published by this file |
| 46575     | neoforge | 25575          | no | reserved: RCON, not used (ENABLE_RCON is FALSE) |

The block collides with none of compose/*.yml (the colo, phase0, opt-in and telemetry ports), deploy/scratch/*.env, or the
scratch defaults. The repo test reads all of them and fails on a shared host port. 25565 and 25566 are never published
(deploy/README.md). Caveat the test cannot check: an operator-chosen GELDAR_MC_PORT for the autonomous shard's public
overlay must also avoid 46565 on the node.

## 3. Caps (proposal; re-measure at deploy)

Node figures are the lead's measurement at about 13:55Z on 2026-11-17: about 100 GiB memory available and 16 cores,
autonomous Paper at a 14 GiB cap. Re-measure before the first start.

| Service | CPUs | Memory | Pids | Notes |
|---------|------|--------|------|-------|
| neoforge | 3 | 12 GiB (12288m) | 512 | 9G heap (MEMORY); the colo Paper ratio |
| postgres | 1 | 2 GiB | 256 | the colo Postgres budget |
| nats | 0.5 | 512m | 256 | the colo NATS budget |
| eventsink | 0.5 | 512m | 256 | the colo sink budget |
| velocity | 0.5 | 1 GiB | 256 | the colo Velocity budget; MEMORY 512M |
| identity-seed | 0.25 | 256m | 256 | one-shot |
| **total** | **5.75** | **about 16.25 GiB** | | |

Other tenants (as the lead gave them): autonomous Paper 14 GiB, scratch-telemetry Paper 15 GiB, nf scratch Paper 3 GiB.
Their other services are UNVERIFIED here. Paper-equivalent sum about 32 GiB plus this shard's 16.25 GiB leaves room in the
100 GiB headline. Every service has memswap equal to memory (no swap), and a restart policy of unless-stopped (identity-seed: no).

## 4. Secrets

Per-project directory `compose/secrets-nf/` (gitignored; the repo ignore line is added). The file reads `${NF_SECRETS_DIR:-./secrets-nf}`.
Names, one file each, mode 0600, owned by the account:

- `nats-auth.conf` (the per-shard NATS server config), `nats-sink.txt`, `nats-neoforge.txt`, `nats-velocity.txt`, `nats-deploy.txt`
  (the four NATS users of the design: neoforge, sink, deploy, velocity; the `nats-auth.conf` file is the server side);
- `postgres.txt` (the Postgres password), `velocity-forwarding.txt` (the Velocity forwarding secret, shared with the NeoForge side).

No secret value is in the file or in this runbook. The files are written by `./geldar.ps1 shard nats-auth nf --live` (section 4b,
deploy/nats-auth-nf.ps1); do not create them by hand. The NATS user table itself is the per-shard NATS auth packet's (a3 in the design).

## 4b. The NATS auth set (generated on the node)

When: on the NF node, once, before the first start (section 8). Never in a git checkout. Make a clean export
(`git archive -o <file> <commit>`, extracted into an empty directory), run the command there, then keep the secrets
directory with the node's secrets. The generator refuses a checkout (a `.git` entry) unless `--local` is also given. `--local` is accepted in a
clean export and changes nothing there; the test harness needs it. Flags are case-sensitive (`--LIVE` is refused).

Command: `./geldar.ps1 shard nats-auth nf --live`. Without `--live` it refuses and writes nothing. An unknown flag is refused.

Files, in `compose/secrets-nf/` (git-ignored; `NF_SECRETS_DIR` points nf-live.yml at it): `nats-auth.conf` (the server
config), then one password file per user: `nats-neoforge.txt`, `nats-sink.txt`, `nats-velocity.txt`, `nats-deploy.txt`,
`nats-seed.txt`. Existing files are reused and never overwritten. If `nats-auth.conf` exists and a password file is missing,
the run fails and writes nothing. Restore the missing file, or delete the directory and generate again before any start.
The files are mode 0600 and the directory 0700 on POSIX (checked by the test there); owner-only (ACL) on Windows.
An empty password file, or one with a double quote or a line break, is refused by name and nothing is written.

Mapping to nf-live.yml: `nats-auth.conf` is the nats service's config; `nats-sink.txt` the eventsink; `nats-neoforge.txt`
the neoforge service; `nats-velocity.txt` velocity; `nats-seed.txt` identity-seed (user `seed`). `nats-deploy.txt` is
declared but no compose service mounts it: the maintenance notice is published by the operator's deploy as that user, on
the node, outside the stack.

Not generated: `postgres.txt` and `velocity-forwarding.txt` (a later packet), and no Thinker token (this shard has no
Thinker hub). A test checks that the files nf-live.yml declares are these, minus those two names.

Users and allow lists (every subject is `geldar.nf.*`, a JetStream API subject for the two streams below or the two identity
buckets, or the inbox; no user has `>` or `geldar.*`):

| User | May publish | May subscribe |
|------|-------------|---------------|
| neoforge | `geldar.nf.*` except `geldar.nf.maintenance` and `geldar.nf.dlq`; JetStream STREAM.INFO and STREAM.CREATE for the two streams; `_INBOX.>` | `geldar.nf.maintenance`; `_INBOX.>` |
| sink | `geldar.nf.dlq`, `geldar.nf.state.>`, `$JS.API.INFO`; the durable consumer `eventsink` on the two streams (CONSUMER.CREATE with its filter, `.eventsink.>`; INFO; MSG.NEXT; ACK); STREAM.INFO and CREATE; `_INBOX.>` | `geldar.nf.state.*.proficiency`; `_INBOX.>` |
| deploy | `geldar.nf.maintenance` | `_INBOX.>` |
| velocity | watch and get on the two identity buckets (read only) | `_INBOX.>` |
| seed | `$JS.API.INFO`; create, inspect and update of the two identity buckets | `_INBOX.>` |

The two stream names are `GELDAR_EVENTS` (the name the plugin and the sink use today) and `GELDAR_EVENTS_NF` (decision
0380). The `GELDAR_EVENTS` allow is a default: remove it when the sink's per-shard config lands.

The password is plaintext inside `nats-auth.conf`, as the colo shard's config is. Treat the directory as a secret: do not
copy it into a checkout, a ticket or a log.

UNVERIFIED: the JetStream API subjects above come from the code and the @nats-io/jetstream 3.4.0 client; the test computes the
sink's subjects from that client. The sink and seed permissions remain UNVERIFIED against a live server until the node run;
nats-server 2.15 acceptance of this config is checked only there. The mod's export type list is not defined yet, so its publish is `geldar.nf.*` and narrows later.

## 5. Environment (all optional at render time)

`NF_SECRETS_DIR`, `NF_MOD_JAR_HOST` (the pinned geldar NeoForge mod jar; default path does not exist, so `up` refuses the bind),
`NF_MOD_SHA256` (64 lowercase hex, the jar's sha256; the entrypoint refuses a mismatch), `NF_NEOFORGE_BUILD` (default 126, the only
build the entrypoint pin accepts), `NF_NEOFORGE_HEAP` (default 9G), `NF_SERVICE_UID` (default 1000; set it to the account that owns the
secret files), `NF_EVENTSINK_IMAGE`, `NF_ADMIN_IMAGE`.

The file renders with no environment (ci.yml renders every compose/*.yml with none), and with dummy secret files and a dummy jar
(the repo test does both).

## 6. The deploy path (findings)

Checked against deploy/common.sh, colo-up.sh, colo-cd.sh, colo-down.sh, colo-rollback.sh, colo-status.sh, colo-admin.sh,
colo-notice.sh, colo-cd-players.sh and .github/workflows/colo-deploy.yml. Not run.

- **None of the colo deploy scripts applies to this project as written.** deploy/common.sh defaults `PROJECT` to `geldar-colo` and
  `COMPOSE_FILE` to compose/colo.yml, and every compose wrapper adds the colo overlays (nats-auth, secrets, public, extra) whatever
  the caller passes. Its defaults also point at the colo secrets directory (/etc/geldar-colo/secrets), release file
  (/etc/geldar-colo/release.env) and state dir (/var/lib/geldar-colo). Setting `GELDAR_PROJECT=geldar-nf` would therefore pull colo
  overlays and colo secrets into this project. Do not run them for `geldar-nf`.
- **colo-deploy.yml and colo-cd.sh** deploy only the geldar-colo services by digest from the colo release file, into
  `GELDAR_COLO_ROOT` (default /mnt/nvme/geldar-colo/src). They do not apply here. The job runs on a self-hosted runner and deploys
  from main only.
- **So this project needs its own deploy script** (a later packet, under deploy/ as a new file). It must always pass
  `-p geldar-nf -f compose/nf-live.yml`, read its own release file and secrets directory, and never source the colo defaults.
  Until it exists, the only compose action the operator may take is one with those two flags, by hand, after the secrets exist.
- **A compose action on this project must always pass** `-p geldar-nf -f compose/nf-live.yml`. No other project flag, no overlay.
  Never run it without `-p` and with a colo file in the same command.

### What must never restart the autonomous shard (concrete, from the repo)

- `deploy/colo-down.sh` (stops the geldar-colo project), `deploy/colo-up.sh`, `deploy/colo-cd.sh`, `deploy/colo-rollback.sh`,
  `deploy/colo-admin.sh` (any subcommand), `deploy/colo-notice.sh` (the in-game notice), `deploy/colo-cd-players.sh`: all of these
  name the geldar-colo project by default.
- `./geldar.ps1 shard up colo` and any `docker compose -f compose/colo.yml ...` (the file's name defaults to geldar-colo).
- Host-wide docker verbs: `docker rm`, `docker stop`, `docker restart` or `docker compose down` against names or labels that match
  the autonomous shard (containers carry `com.geldar.stack: colo` and the geldar-colo project label); `docker system prune` and
  `docker volume prune` (they touch every project's volumes and stopped containers).
- The node's Watchtower: this file opts every service out (`com.centurylinklabs.watchtower.enable: "false"`), as the colo file does.
- Changes to compose/colo.yml, the shared Caddy (deploy/caddy/**) or the node's colo env, which would reach the autonomous shard on its next start.

`deploy/colo-status.sh` is read-only and scoped to geldar-colo by label; it will not show this project.

## 7. UNVERIFIED (not confirmed in code or on a server)

1. **The NeoForge offline bundle is not seeded by this file.** The entrypoint runs bundle mode when `.geldar-bundle.sha256` exists in
   the data dir (the neoforge-data volume). deploy/scratch/build-neoforge-bundle.sh builds the bundle; how scratch.sh copies it into the
   volume was not read. The seeding step is UNVERIFIED.
2. **identity-seed uses the NATS user seed.** Its allow list (section 4b) is create, inspect and update on the two identity buckets
   and `$JS.API.INFO`. Whether the bucket creates succeed with those permissions is UNVERIFIED until the node run.
3. **The Postgres init runs sql/ from empty.** The file mounts ../sql into docker-entrypoint-initdb.d (as colo does). That 0001 to 0066 run
   cleanly into an empty geldar_nf database is UNVERIFIED. The admin migrate one-shot is the other path; the deploy picks one.
4. **The eventsink NATS and database keys.** The sink reads GELDAR_NATS_URL, POSTGRES_HOST, POSTGRES_DB, POSTGRES_USER and
   POSTGRES_PASSWORD_FILE (eventsink/src/config.ts). The NATS user and password keys (GELDAR_NATS_USER, GELDAR_NATS_PASSWORD_FILE) come from
   compose/nats-auth.yml's comment and contract/src/nats-connect.ts; the second file was not re-read.
5. **The per-shard sink config is not in the file.** GELDAR_EVENTS_STREAM, GELDAR_EVENTSINK_SHARD and the retention keys do not exist
   in eventsink/ today; they need the sink per-shard config packet. This project's NATS holds only its own events, so the default stream
   name is correct for now.
6. **NF_SERVICE_UID default 1000** is the colo default; the live account uid is UNVERIFIED.
7. **The caps in section 3** are proposals from the lead's measurement. The other tenants' non-Paper services are UNVERIFIED.
8. **Alpine nc, mc-health and the NeoForge start script** are used as scratch uses them; not run here.
9. **Nothing was started.** No container, no node contact, no live lane.

## 8. Before the first start (checklist, in order)

1. Per-shard NATS auth set generated into compose/secrets-nf/ (the later packet) and the secret files written 0600.
2. The neoforge bundle seeded (item 7.1); compose/velocity/velocity-nf.toml is in place (bot ingress, backend neoforge:25565).
3. `docker compose -p geldar-nf -f compose/nf-live.yml config --quiet` with the real environment.
4. Re-measure the node's memory and cores; confirm the caps in section 3 still fit beside the autonomous shard.
5. Start `nats`, then `postgres`, then `eventsink`, then `identity-seed`, then `neoforge`, then `velocity`. Read-only probes only
   (`docker compose -p geldar-nf ... ps`, `tick query`, `list`, `version`).
