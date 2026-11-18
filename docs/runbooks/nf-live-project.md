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
- No server whitelist: `neoforge` sets `ENABLE_WHITELIST` and `ENFORCE_WHITELIST` to `FALSE` (owner decision 2026-11-17,
  decision 0387). Admission is the human lane only (online-mode login, the agent-name refusal); the bot ingress stays
  offline-mode and unpublished. The probe's `whitelist add` and `whitelist remove` are harmless on this shard. The
  autonomous Paper shard (compose/phase0.yml) keeps its whitelist. Enforced by tools/repo-checks/src/nf-no-whitelist.test.ts.

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
Names, one file each, mode 0600, owned by the ops account (uid `NF_SERVICE_UID`, 1001 on this node; section 5):

- `nats-auth.conf` (the per-shard NATS server config), `nats-sink.txt`, `nats-neoforge.txt`, `nats-velocity.txt`, `nats-deploy.txt`, `nats-seed.txt`
  (the five NATS users of the design: neoforge, sink, deploy, velocity, seed; the `nats-auth.conf` file is the server side);
- `postgres.txt` (the Postgres password), `velocity-forwarding.txt` (the Velocity forwarding secret, shared with the NeoForge side).

No secret value is in the file or in this runbook. The files are written by `./geldar.ps1 shard nats-auth nf --live` (section 4b,
deploy/nats-auth-nf.ps1); do not create them by hand. The NATS user table itself is the per-shard NATS auth packet's (a3 in the design).

## 4b. The NATS auth set (generated on the trusted machine)

When: once, before the first start (section 8), on the trusted machine (the owner's desktop). Not on the node: the node has
no pwsh and no node runtime, so the generator cannot run there. The generator writes plaintext passwords into whatever tree
it runs in, so the live checkout never runs it. The `--live` guard refuses a tree with a `.git` entry unless `--local` is also
given; the same guard reasoning as the scratch stack's (docs/runbooks/scratch-stack.md, the guard paragraph). `--local` is
accepted in a clean export and changes nothing there; the test harness needs it. Flags are case-sensitive (`--LIVE` is refused).

**SAFE-EXPORT procedure (trusted machine).** Use the reviewed commit. Keep the archive and the export outside any checkout.
Shown in POSIX shell; on the Windows desktop run the same steps in pwsh 7 (`tar` there is bsdtar). Stop at the first failed step.

1. `git archive -o "$ARCH" "$SHA"`. Never pipe the archive into tar: a failed archive must not be half-read.
2. `tar -tf "$ARCH" > "$LIST"`, then `grep -E '^/|^[A-Za-z]:|(^|/)\.\.(/|$)' "$LIST"` must print nothing. Any hit: stop.
3. Assert `$EXP` is an existing, empty directory (`[ -z "$(ls -A "$EXP")" ]`), then `tar -xf "$ARCH" -C "$EXP"`.
4. `cd "$EXP"`, assert `[ "$(pwd -P)" = "$EXP" ]` and `[ ! -e .git ]`. Only now run the generator, from this directory:
   `./geldar.ps1 shard nats-auth nf --live`. Never run it from the live checkout or from any other directory.
5. Check the set: `compose/secrets-nf/` holds `nats-auth.conf`, the five NATS password files (`nats-neoforge.txt`, `nats-sink.txt`,
   `nats-velocity.txt`, `nats-deploy.txt`, `nats-seed.txt`), `postgres.txt` and `velocity-forwarding.txt`, with no other file
   (eight names, the generator's full output).

**Copy to the node (the SAFE-EXPORT ends here on the desktop).**

6. Copy only the directory: `scp -r "$EXP/compose/secrets-nf" <ops account>@<node>:<node export>/compose/`. Use the ops account
   so the files arrive owned by its uid (1001, section 5). Do not copy the rest of the export.
7. On the node, as the ops account, set the modes explicitly (scp does not keep them): `chmod 700 <dir>` and
   `chmod 600 <dir>/*`. Then check `stat -c '%a %u %n' <dir> <dir>/*`: the directory must show `700 1001`, every file `600 1001`,
   and the file list must be the eight names of step 5. A wrong owner or mode stops the run here (the script refuses it too).
8. On the desktop, delete the copies: `rm -rf "$EXP" "$ARCH" "$LIST"` (the export holds the generated secrets). Keep no other copy.

The generator's output is owned by the desktop account, and its modes are set on the desktop only; the node copy is set by
step 7. The copy is the only one; do not paste the passwords into a ticket or a chat.

Command: `./geldar.ps1 shard nats-auth nf --live`. Without `--live` it refuses and writes nothing. An unknown flag is refused.

Files, in `compose/secrets-nf/` (git-ignored; `NF_SECRETS_DIR` points nf-live.yml at it): `nats-auth.conf` (the server
config), then one password file per user: `nats-neoforge.txt`, `nats-sink.txt`, `nats-velocity.txt`, `nats-deploy.txt`,
`nats-seed.txt`. Existing files are reused and never overwritten. If `nats-auth.conf` exists and a password file is missing,
the run fails and writes nothing. Restore the missing file, or delete the directory and generate again before any start.
The files are mode 0600 and the directory 0700 on POSIX (checked by the test there); owner-only (ACL) on Windows. Each file is
created empty, restricted, then written, so the secret is never in a file with a looser mode. On Windows the script sets no ACL on
the directory: it inherits its parent's. A re-run restricts an existing file again; an existing empty secret file is refused by name.
An empty password file, or one with a double quote or a line break, is refused by name and nothing is written.

Mapping to nf-live.yml: `nats-auth.conf` is the nats service's config; `nats-sink.txt` the eventsink; `nats-neoforge.txt`
the neoforge service; `nats-velocity.txt` velocity; `nats-seed.txt` identity-seed (user `seed`). `nats-deploy.txt` is
declared but no compose service mounts it: the maintenance notice is published by the operator's deploy as that user, on
the node, outside the stack.

Generated: the eight files of section 4b (`nats-auth.conf`, the five NATS password files, `postgres.txt` and
`velocity-forwarding.txt`). Not generated: no Thinker token (this shard has no Thinker hub). A test checks that the files
nf-live.yml declares are these eight.

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

`NF_SECRETS_DIR`, `NF_SERVICE_UID` and `NF_SERVICE_GID` (the service uid and gid, below), `NF_MOD_JAR_HOST` (the pinned geldar NeoForge mod jar; default path does not exist, so `up` refuses the bind),
`NF_MOD_SHA256` (64 lowercase hex, the jar's sha256; the entrypoint refuses a mismatch), `NF_NEOFORGE_BUILD` (default 126, the only
build the entrypoint pin accepts), `NF_NEOFORGE_HEAP` (default 9G), `NF_EVENTSINK_IMAGE`, `NF_ADMIN_IMAGE`.

**`NF_SERVICE_UID` (the service uid) is 1001 on this node.** It is the uid of the ops account, the account that runs
`deploy/nf-deploy.sh` and owns the secret files. The uid is read from `id -u` on the node, as that account; the value is 1001
(the ops account's uid as recorded for this node; confirm it with `id -u`). The script and compose default to 1000 (the colo default), so the variable must be set explicitly in
the shell for every verb, not left to the default:

- Set `export NF_SERVICE_UID=1001` (the value `id -u` printed) before `seed-bundle`, `plan` and `up`, which read it and refuse
  a bad value. `status`, `down` and `logs` do not check it, but use the same value in every shell and in any direct
  `docker compose -p geldar-nf -f compose/nf-live.yml` call, since compose interpolates the same variable into the containers'
  `user:` and `UID`. Nothing stores the value: the script reads the environment on each run.
- The script refuses a value that is not a number or is 0 ("NF_SERVICE_UID must be a number" or "the containers must not run as
  root"). It refuses a secret file whose owner is not the value: `secret file <name> is owned by uid <n>; expected <value>
  (NF_SERVICE_UID)`. A mismatch therefore stops before any state change; fix the file's owner or the variable, never the script.
- What it sets: compose runs `eventsink` and `identity-seed` with `user: <uid>:<gid>`, and the itzg images (`velocity`,
  `neoforge`) with `UID` and `GID` set to the same two numbers. `NF_SERVICE_GID` is the group; it defaults to `NF_SERVICE_UID`,
  so one uid alone gives uid:uid. The script checks the owner uid of the secret files, not their group; mode 0600 is owner-only,
  so the group does not affect the read.
- Data-volume ownership: `seed-bundle` extracts the tarball as root (`--user 0`, with only CHOWN, FOWNER and DAC_OVERRIDE), then
  in the same container runs `chown -R <uid>:<gid> /data` and `chmod -R u+rwX,go-w /data`, so the whole volume ends owned by the
  service uid:gid. The `sha256sum -c` marker check runs as that same uid:gid. Whether itzg re-owns `/data` when `UID` is 1001 is
  UNVERIFIED: check it on the node with a read-only `stat` in a throwaway container before `up`.

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
- **So this project needs its own deploy script.** It must always pass `-p geldar-nf -f compose/nf-live.yml`, read its own
  secrets directory, and never source the colo defaults. `deploy/nf-deploy.sh` is that script (below). The only other compose
  action the operator may take is one by hand with those two flags, after the secrets exist.
- **A compose action on this project must always pass** `-p geldar-nf -f compose/nf-live.yml`. No other project flag, no overlay.
  Never run it without `-p` and with a colo file in the same command.

### Running the project on the node: deploy/nf-deploy.sh

The operator script is `deploy/nf-deploy.sh`. Run it on the node from an exported tree (a directory with no `.git` at its
root; a checkout is refused, and `--local` is for the tests only). Run it as the operator account, never as root.

- Verbs: `plan` (runs every gate and prints the steps, changes nothing), `up` (refuses an unseeded neoforge-data volume),
  `seed-bundle` (once per volume; see "Seeding the NeoForge bundle" below), `status`, `down` (stops and removes the
  project's containers and networks; volumes are kept), `down --volumes` (also removes the volumes, after the operator types
  `geldar-nf` at the prompt), `logs <service>`.
- The project name (`geldar-nf`) and the file (`compose/nf-live.yml`) are constants. The script refuses to run when
  `GELDAR_PROJECT` or `GELDAR_COLO_COMPOSE` is set, and it does not source `deploy/common.sh`.
- `up` runs in this order: `up -d --wait nats postgres`, the `identity-seed` one-shot, `up -d --wait eventsink neoforge`, then
  `up -d --wait velocity` (the only published port, `127.0.0.1:46565`). It never starts golem-body or players-host.
- Inputs, all from the environment: `NF_MOD_JAR_HOST` and `NF_MOD_SHA256` (the pinned mod jar and its sha256);
  `NF_BUNDLE_TARBALL` and `NF_BUNDLE_TARBALL_SHA256` (the offline bundle tarball from `deploy/scratch/build-neoforge-bundle.sh`
  and its sha256; `seed-bundle` reads them, plan and up take no bundle input, see "What is staged on the node"); `NF_SECRETS_DIR`
  (default `compose/secrets-nf/`, which must hold the eight files the script lists, owner `NF_SERVICE_UID` (1001 on this node; the
  script's default is 1000, so export it, section 5), mode 0600 or 0400). The list is eight names: `postgres.txt` and
  `velocity-forwarding.txt` as well as the six NATS files of section 4b. The generator writes all eight (section 4b), so the
  files it wrote satisfy the list.
  `plan` and `up` read the secrets (through the gates); `seed-bundle`, `status`, `down` and `logs` do not.
- Refusals, before any state changes: a colo variable set; a checkout; a missing or badly owned secret file; a mod jar or
  bundle tarball whose sha256 differs (seed-bundle only); free RAM below the 16640 MiB of caps plus an 8192 MiB margin; free disk below 50 GiB;
  a listener on 46565 other than the project's own velocity; a `geldar-nf` container with a geldar-colo label.
- Port 46565: `plan` and `up` accept the project's own running velocity on it. That is a container with the exact
  project label `geldar-nf` and service label `velocity`, published as exactly `127.0.0.1:46565->25565/tcp`, with every
  listener socket on `127.0.0.1:46565`. So a re-`up` on a running project passes this gate. They still refuse any other
  listener: another project (colo or scratch), another service, a binding on `0.0.0.0` or `[::]`, a host process with no
  container, or a `docker ps` failure or unreadable output.
- `DEPLOY_DRY_RUN=1` prints the steps of `up` and `down` without running them. The gates still run.
- No CI workflow runs this script. It is operator-run. A continuous deploy for geldar-nf would be a separate change that the
  owner must approve.
- `up` checks that `geldar-nf_neoforge-data` is seeded: the volume exists and its `.geldar-bundle.sha256` marker verifies
  (`sha256sum -c --strict` in a throwaway container). If not, `up` refuses and names `seed-bundle`. `plan` does not check it.
- UNVERIFIED on a real node: `seed-bundle` and the `up` check have run only against stubs. `up` has not been run against a live node.

### What is staged on the node

- The mod jar and its sha256 file (the 64-hex value is passed as `NF_MOD_SHA256`).
- The bundle tarball and its sha256 file (passed as `NF_BUNDLE_TARBALL` and `NF_BUNDLE_TARBALL_SHA256`).
- Nothing else. `NF_BUNDLE_DIR` is gone: plan and up do not read a bundle directory.
- The seed ownership: `seed-bundle` extracts the tarball, then runs `chown -R NF_SERVICE_UID:NF_SERVICE_GID /data` and
  `chmod -R u+rwX /data` in the same throwaway container. The marker check runs as that same uid:gid
  (`NF_SERVICE_GID` defaults to `NF_SERVICE_UID`). Whether itzg re-owns `/data` when the uid is 1001 is UNVERIFIED on a node.
- The NATS and secret generator (`./geldar.ps1 shard nats-auth nf --live`) runs on the trusted machine in a clean export, and
  its result is copied to the node. It writes eight files: `nats-auth.conf`, five NATS password files (`nats-neoforge.txt`,
  `nats-sink.txt`, `nats-deploy.txt`, `nats-velocity.txt`, `nats-seed.txt`), `postgres.txt` and `velocity-forwarding.txt`.
  Existing files are reused, never overwritten.

### Seeding the NeoForge bundle: `nf-deploy.sh seed-bundle`

The entrypoint runs in bundle mode only when the `neoforge-data` volume already holds the extracted bundle and its marker.
`seed-bundle` puts it there. It runs once per volume.

1. On the trusted desktop, not the node, from the reviewed commit: `sh deploy/scratch/build-neoforge-bundle.sh <output-dir>`
   (`<output-dir>` is a new, empty directory; Docker is needed). It writes `neoforge-26.1.2-build<N>-bundle.tar.gz` and
   `bundle.sha256`, and prints the tarball's sha256. The bundle is valid only for the itzg image digest in `compose/nf-live.yml`
   (and the scratch runbook's rule applies: a digest bump means rebuild).
2. Compare the tarball's sha256 by a second channel: read it out, or send it apart from the tarball. The `bundle.sha256` that
   travels with the tarball only guards corruption. `NF_BUNDLE_TARBALL_SHA256` must come from the second channel.
3. Copy the tarball to the node (scp) into a directory the operator account owns.
4. On the node, from the exported tree, as the operator account (never root):
   `NF_BUNDLE_TARBALL=<absolute path of the tarball> NF_BUNDLE_TARBALL_SHA256=<64 lowercase hex> sh deploy/nf-deploy.sh seed-bundle`.
   `DEPLOY_DRY_RUN=1` in front prints the extract without running it.

What the verb does, in order, and stops at the first failure:
- Refuses unless the volume `geldar-nf_neoforge-data` is absent or empty. A seeded volume is never overwritten; there is no
  `--force-reseed`.
- Refuses a tarball path that is not absolute, a symlink or not a regular file, and a sha256 that differs from
  `NF_BUNDLE_TARBALL_SHA256` (the stdin form of `sha256sum`).
- Lists the archive (`tar -tzf`, `tar -tzvf`). Refuses an absolute path, a `..` segment, any entry that is not a regular file or
  a directory (so no symlink, hardlink or device), and an archive without `.geldar-bundle.sha256`.
- Extracts through one throwaway container of the image pinned in `compose/nf-live.yml` (the verb reads the reference from that
  file). It runs with `--network none`, `--rm`, as root inside that container only, the tarball mounted read-only, and
  `tar -xzf` into the volume, then `chown -R <uid>:<gid> /data` and `chmod -R u+rwX,go-w /data`. The container drops every
  capability except CHOWN, FOWNER and DAC_OVERRIDE (`--cap-drop ALL`), and gains none (`no-new-privileges`).
- Checks the marker with `sha256sum -c --strict` in another throwaway container. It prints OK, or fails closed. On failure, do not
  start the stack; leave the volume for the operator to inspect.

Nothing here removes a volume. The listing runs as root, so a volume that holds files is refused as "not empty", including a
half-seeded one whose `/data` is owned by another uid at mode 750 (the refusal names the volume and the root listing). To reseed
such a volume, by hand and in this order:
1. `nf-deploy.sh down`, without `--volumes`: it stops the project and keeps Postgres.
2. `docker volume rm geldar-nf_neoforge-data`, only when `docker ps -a` shows no container that uses that volume.
3. `seed-bundle` again, as above.

`down --volumes` also deletes the Postgres data, so it is never part of this recovery. UNVERIFIED on a node: the listing, the
extract, the chown and the marker check have run only against stubs.

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

## 7. Not yet confirmed on a server, and confirmed items

1. **DONE in the repo: the NeoForge offline bundle is seeded by `nf-deploy.sh seed-bundle`** (section 6, "Seeding the NeoForge
   bundle"). It copies the scratch flow's steps (empty volume, sha256, tar listing, extract through the pinned image with no network,
   chown to the service uid:gid, marker check as that owner). Its run on a node is UNVERIFIED.
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
6. **Confirmed: NF_SERVICE_UID is 1001 on this node, not the default 1000.** The ops account's uid is 1001: the secrets were created
   at owner uid 1001, scratch runs showed 1001 processes, and home files are owned by 1001. The script's and compose's default of
   1000 is the colo default and is not used here.
7. **The caps in section 3** are proposals from the lead's measurement. The other tenants' non-Paper services are UNVERIFIED.
8. **Alpine nc, mc-health and the NeoForge start script** are used as scratch uses them; not run here.
9. **Not run from this checkout.** No container was started and no node was contacted here; the live lane and the node run are the orchestrator's (section 8).

## 8. Before the first start (checklist, in order)

### Order of operations on the node

Each step is a stop point. The node steps run as the ops account (uid `NF_SERVICE_UID`, 1001 on this node), never as root,
from the exported tree, with `NF_SERVICE_UID` exported in the shell (section 5). The live checkout runs none of them.

1. **Trusted machine:** export the reviewed commit and generate the NATS auth set (section 4b, the SAFE-EXPORT steps 1 to 5).
2. **Copy to the node:** `compose/secrets-nf/` only, directory mode 700, files 600, owner the ops account (section 4b, steps 6 to 8).
   Verify the owner and modes with `stat` on the node. Delete the desktop copies.
3. **Stage:** build the pinned mod jar and the NeoForge bundle on the trusted machine, and compare each sha256 by a second channel
   (section 6, "Seeding the NeoForge bundle", step 2; `NF_MOD_SHA256` for the jar). Copy them to the node, into directories the
   ops account owns.
4. **Seed (node):** `nf-deploy.sh seed-bundle` with `NF_BUNDLE_TARBALL` and `NF_BUNDLE_TARBALL_SHA256` (section 6). Once per volume.
   Then check the volume's owner and the marker as section 5 describes.
5. **Plan (node, read-only):** `nf-deploy.sh plan` runs every gate and changes nothing. It refuses until `postgres.txt` and
   `velocity-forwarding.txt` exist, so the eight secret files of section 4b must all be present (section 6).
6. **Up (node):** `nf-deploy.sh up`. It starts the services in its own order (section 6): `nats` and `postgres`, then
   `identity-seed`, then `eventsink` and `neoforge`, then `velocity` (the only published port, loopback). Probes after it are
   read-only (`nf-deploy.sh status`, `logs`, and `tick query`, `list`, `version` in the game).

### Checklist

1. The NATS auth set is generated on the trusted machine and copied to the node (order steps 1 and 2). `postgres.txt` and
   `velocity-forwarding.txt` are generated with the other six (section 4b); the secret files must be 0600 (or 0400) and owned by the ops account.
2. The neoforge bundle seeded (order step 4; item 7.1 is done in the repo); compose/velocity/velocity-nf.toml is in place (bot
   ingress, backend neoforge:25565).
3. `docker compose -p geldar-nf -f compose/nf-live.yml config --quiet` with the real environment, including `NF_SERVICE_UID=1001`.
4. Re-measure the node's memory and cores; confirm the caps in section 3 still fit beside the autonomous shard.
5. Start with `up` (order step 6), not by hand. The old by-hand order (`nats`, `postgres`, `eventsink`, `identity-seed`,
   `neoforge`, `velocity`) differed from `up`'s order, so it is no longer the procedure.
6. **Tick and TPS check, without RCON** (added with the telemetry overlay; used from the probe packet; outside this packet's scope).
   RCON stays disabled (`ENABLE_RCON` is FALSE) until the probe packet, so this
   check reads the database. After about 30 s of neoforge uptime, run these read-only through the project's postgres service
   (database `geldar_nf`, user `geldar`, from compose/nf-live.yml):
   `docker compose -p geldar-nf -f compose/nf-live.yml exec -T postgres psql -U geldar -d geldar_nf -tAc "SELECT count(*) FROM events WHERE type = 'server_tps'"`
   The count must be greater than 0. Then `SELECT payload->>'tps' FROM events WHERE type = 'server_tps' ORDER BY at DESC LIMIT 1`
   must be near 20. A count above 0 proves the NATS and sink path. The `events` columns `type` and `payload` are from
   sql/0001_init.sql. The event name `server_tps` is UNVERIFIED in this repo until the first node run.

## 9. Telemetry (optional)

Off is the default. With `NF_TELEMETRY` unset, `nf-deploy.sh` renders and starts exactly the base file, `compose/nf-live.yml`
alone, and makes no network call. The base file is not changed, and a render test asserts that the base render carries no telemetry.

**`NF_TELEMETRY=on` has no effect on the JVM until the entrypoint of PR #701 (packet B) is merged. Do not set it before.**
Until then the script refuses `on`, because the entrypoint in the tree has no `GELDAR_NF_TELEMETRY`.

Inputs, read by `deploy/nf-deploy.sh` (all optional; `NF_TELEMETRY=on` needs the five others):

- `NF_TELEMETRY`: `on` or `off`. Any other value refuses.
- `NF_LEDGER_JAR_HOST`: absolute host path of the geldar NeoForge ledger jar.
- `NF_LEDGER_SHA256`: the sha256 of that jar, 64 lowercase hex.
- `NF_OTEL_AGENT_HOST`: absolute host path of the OpenTelemetry Java agent jar.
- `NF_OTEL_AGENT_PROPS_HOST`: absolute host path of the agent properties file.
- `NF_LEDGER_PROPS_HOST`: absolute host path of the ledger properties file.

Checks on `plan` and `up`, in the order the script runs them. Each refusal starts nothing. No docker call happens before
checks 1 to 5; check 6 follows the read-only `docker compose version` and `docker info` calls of the operator check.

1. `NF_TELEMETRY` is `on` or `off` (unset is off; an empty value refuses). On only: `compose/neoforge/neoforge-entrypoint.sh`
   contains `GELDAR_NF_TELEMETRY`.
2. Four host paths, in this order: `NF_LEDGER_JAR_HOST`, `NF_OTEL_AGENT_HOST`, `NF_OTEL_AGENT_PROPS_HOST`,
   `NF_LEDGER_PROPS_HOST`. Each is set, absolute, has no whitespace, quote, backslash or dollar, is a regular file (not a
   symlink, and not under a symlinked directory).
3. `NF_LEDGER_SHA256` is 64 lowercase hex.
4. The sha256 of the ledger jar equals `NF_LEDGER_SHA256`.
5. The agent pin in the overlay (`GELDAR_NF_OTEL_AGENT_SHA256`) is 64 lowercase hex, and the sha256 of the agent jar equals it.
6. `docker network inspect geldar-telemetry` succeeds on the node.

Only then does the script add the overlay. `down` and `status` never read these inputs, never add the overlay, and never
create, remove or prune the network.

What the overlay `compose/nf-live-telemetry.yml` adds, to the `neoforge` service only:

- Four read-only bind mounts with `create_host_path: false`, so a missing host file fails the start: the ledger jar, the
  OpenTelemetry agent jar, the agent properties and the ledger properties, at fixed container paths.
- The environment `GELDAR_NF_TELEMETRY`, `GELDAR_NF_LEDGER_SHA256` (from `NF_LEDGER_SHA256`) and `GELDAR_NF_OTEL_AGENT_SHA256`.
- A join to the EXTERNAL network `geldar-telemetry`. The telemetry stack owns that network; compose never creates or removes it.
  No other service joins it, and nothing in the overlay publishes a port.

The agent pin is a repo constant in the overlay: `GELDAR_NF_OTEL_AGENT_SHA256`, the sha256 of opentelemetry-javaagent 2.33.1
(26507624 bytes). It is not an operator input, and it has one copy: the script reads it from the overlay, and the entrypoint
reads it from the environment. The entrypoint builds the `-javaagent` flag itself; the overlay sets no `JAVA_AGENTS` or
`JVM_OPTS`. A change to the pin is a repo change, reviewed with the agent.

The OTLP endpoint is whatever the agent properties file says. This repo neither pins nor checks it.

Staging the files: copy the ledger jar, the agent jar and the two properties files into host directories the ops account owns,
as regular files, under paths with no spaces. Compare the ledger and agent sha256 by a second channel. Then export the `NF_*`
variables in the shell that runs `nf-deploy.sh`.

UNVERIFIED, and not covered by this packet:

- The agent attach itself: that the JVM loads the agent at start on the pinned image. Only the node run shows it.
- The join needs the `geldar-telemetry` stack up on the node first. The script refuses otherwise and does not create the network.
- The symlink refusal tests run on Linux CI only: they skip on Windows (the probe in the test file).
- The two properties files (`NF_OTEL_AGENT_PROPS_HOST`, `NF_LEDGER_PROPS_HOST`) are NOT hash-checked. The script checks only
  that they are regular files; the agent sends what they say.
- The repo test `tools/repo-checks/src/nf-live-telemetry.test.ts` (block "the entrypoint contract") checks that every env name and
  mount target of the overlay appears in `compose/neoforge/neoforge-entrypoint.sh`, that the `GELDAR_NF_TELEMETRY` grep of
  `deploy/nf-deploy.sh` matches, and that the old `GELDAR_NF_OTEL_AGENT_PIN` and `GELDAR_NF_OTEL_AGENT=` names are gone. It does
  NOT check that the entrypoint builds the `-javaagent` flag itself; that check is still open.
- RCON stays disabled until the probe packet; the tick and TPS check (checklist item 6) is outside this packet.
- The mechanism by which `JVM_OPTS` reaches `user_jvm_args.txt` on every start of the pinned itzg image is verified by the lead,
  not by this checkout. The attach is not.
