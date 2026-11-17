---
title: "Scratch stack"
type: how-to
audience: operators
status: draft
last_verified: 2026-11-16 against 03c1f5de
companions: [README.md, nats-auth-inplace.md]
sources: [../../deploy/scratch/scratch.sh, compose/opt-in/scratch.yml, shards/character-fixture.yaml]
---

# Scratch stack

A throwaway copy of the Phase 0 shard stack (`compose/phase0.yml`) for the sheet campaign validation. It runs beside the
live phase0 stack and the Colo stack without clashing: its own compose project (`scratch-<suffix>`), its own volumes,
loopback-only ports on high defaults, and hard caps. `down` removes its containers, its volumes, its eventsink image
and its secrets directory. The Docker build cache is not removed (prune it by hand if the disk needs it).

The sheet sink is not enabled. The overlay does not include `compose/opt-in/sheet-sink.yml` and `GELDAR_SHEET_SHARD` is
unset, so a scratch run does not write to the sheet.

Not approved for any run on the shared node: open NATS (see NATS auth below).

## Before up

1. Build the two plugin jars on the machine that runs the stack: `cd plugin; ./gradlew build`. The stack bind-mounts
   `plugin/core/build/libs/geldar-core.jar` and `plugin/velocity-identity/build/libs/geldar-velocity-identity.jar`.
   `up` refuses (exit 1) if either is missing, and does not create anything.
2. Run as any non-root account. The eventsink runs as that account's uid:gid (see the next section), so it reads the
   secret files, which are mode 0600 and owned by the account. If `GELDAR_SERVICE_UID` is set it must be digits and equal
   the account's uid: digits-only fails with exit 2, a different uid with exit 1. `up` refuses (exit 1) under root.
3. Compose 2.24.4 or newer (the `!override` tag). `up` checks.
4. Set up NATS auth (next section).

## Commands

    sh deploy/scratch/scratch.sh up [suffix]       # gates, then starts the stack (default suffix a)
    sh deploy/scratch/scratch.sh status [suffix]   # compose ps, CPU and memory per container, NATS warning if open
    sh deploy/scratch/scratch.sh down [suffix]     # down -v --rmi local, removes the secrets directory, lists leftover volumes

The suffix is `[a-z0-9]{1,9}`. Anything else exits 2. Host ports come from `deploy/scratch/<suffix>.env`, which the
script reads itself (it never sources the file; only the four `SCRATCH_*_PORT` keys with digit values 1 to 65535 are
accepted, anything else exits 2, and a variable you already set in your environment wins over the file). The file is
required for `telemetry` (a missing file exits 2) and optional for every other suffix, which then gets the defaults:

| Project | Postgres | NATS | NATS monitor | Minecraft (Velocity) |
| --- | --- | --- | --- | --- |
| `scratch-a` and other suffixes (defaults) | 15432 | 14222 | 18222 | 35565 |
| `scratch-telemetry` (`telemetry.env`, defaults + 10000) | 25432 | 24222 | 28222 | 45565 |
| `scratch-nf` (`nf.env`, defaults + 20000, NeoForge; RCON 55575) | 35432 | 34222 | 38222 | 55565 |

## Running as an account whose uid differs from the image's uid

The eventsink image (`eventsink/Dockerfile`) sets `USER node`, uid 1000, and its files are copied in root-owned without
`--chown`. The scratch script sets `SCRATCH_RUN_UID` and `SCRATCH_RUN_GID` from `id -u` and `id -g` (both always set, so
under uid 1000 they are `1000` and `1000`), and the overlay (`compose/opt-in/scratch.yml`) uses them as follows:

- eventsink: `user: SCRATCH_RUN_UID:SCRATCH_RUN_GID`, so it runs as the account.
- paper and velocity: no `user:`. They get the itzg `UID` and `GID` environment variables set to the same two values, as
  `compose/colo.yml` does with `GELDAR_SERVICE_UID`. The image starts as root, reads the 0600 files, then drops to that
  uid, so the Paper and Velocity JVMs read the forwarding secret and their `GELDAR_NATS_PASSWORD_FILE` and own `/data`.
- postgres and nats: unchanged, with their image users and no override. The postgres image's root entrypoint reads
  `POSTGRES_PASSWORD_FILE` before it drops privilege. NATS keeps its image user; the first-start check below shows it.

- This is the no-ACL path. The script changes no file mode: the state directory stays 0700, the secret files stay 0600
  (umask 077). It requires the four NATS files in `SCRATCH_NATS_AUTH_DIR` to be readable and non-empty; it does not check
  their owner and never touches them. The account owns those files, so the eventsink, Paper and Velocity, running as
  that uid, read them as the owner.
- `GELDAR_SERVICE_UID`, when set, must be digits only (exit 2 otherwise) and must equal the account's uid (exit 1).
- `SCRATCH_CONTAINER_UID` (digits only, not 0; empty is refused, exit 2) names the uid the image was built for. It is
  checked and reported when it differs from the account's uid; it changes no mode and no compose value.
- Before the first `up`, a hard step: the eventsink's `/app` files are root-owned and copied in without `--chown`, so
  they are readable as the account uid only if they are world-readable. Run
  `docker run --rm --user <uid>:<gid> --entrypoint ls <eventsink image> -l /app` and confirm the listing shows
  read permission for others. If it does not, stop and say so; do not change the mode by hand.
- On the first `up`, check the drop: `docker exec <container> id` for the paper and velocity containers (from
  `docker compose -p scratch-<suffix> ps -q paper` and `... ps -q velocity`) must print `uid=<account uid> gid=<account gid>`.
  `docker top <container>` shows the same uid for the eventsink, Paper, Velocity and NATS processes. If Paper or Velocity
  shows uid 1000 (or any other uid), stop and run `down`.
- Real-node assumptions, not yet verified: the node's ssh account has uid 1001, so the run uses
  `SCRATCH_CONTAINER_UID=1000` and the eventsink runs as `1001:1001`. The Docker data root, the `/app` check and the
  first-start check above are still to be run on that node.
- Supersedes the ACL design of PR #540 (`ops/scratch-uid-fix`): that design changed secret modes to 0711/0644 and needed
  `setfacl` on the NATS auth dir. The node has no `setfacl` and no sudo, so it is not used here.

## NeoForge variant (suffix nf)

Run the game server as NeoForge instead of Paper, behind the same scratch Velocity, for the Body-join test (P0):

    SCRATCH_PLATFORM=neoforge SCRATCH_NATS_AUTH_DIR=<dir> sh deploy/scratch/scratch.sh up nf

- The `paper` service runs NeoForge 26.1.2 (build 126) with Proxy Compatible Forge 1.3.1 (the mod that gives NeoForge Velocity's
  modern forwarding) instead of Paper with geldar-core. `compose/neoforge/neoforge-entrypoint.sh` fetches the installer
  and the mod and checks each against a pinned hash; a mismatch stops the start.
- The overlay is `compose/opt-in/scratch-neoforge.yml`, layered after `scratch.yml`. Only `SCRATCH_PLATFORM=neoforge`
  adds it. `status` and `down` take the same setting, so `down -v` removes what `up` made.
- The NeoForge variant uses the same three secret files as Paper (postgres, rcon, velocity-forwarding) in the same
  `scratch-nf` state directory, and the same eventsink user override from `scratch.yml` applies. The overlay itself
  sets no user.
- No geldar-core jar is mounted, so the eventsink sees no game events from this server. The caps are the scratch caps
  (3072m, 1.5 CPUs). Ports come from `deploy/scratch/nf.env`, loopback only.
- The first start is slow: it downloads the mod and the installer, runs the installer, and waits for the health check's
  15 minute start period. Allow about 15 to 18 minutes before `up` returns (the 15 minute start period plus the health retries).
- RCON is published only in this variant, on `127.0.0.1:55575`, with the run's own `rcon.txt` secret. The live tests use
  `GELDAR_RCON_PORT=55575`, `GELDAR_RCON_PASSWORD_FILE` set to the path of that `rcon.txt` (a path, never the value),
  `GELDAR_MC_PORT=55565`, `GELDAR_NATS_URL` on 127.0.0.1 port 34222, and `GELDAR_MC_HOST` and `GELDAR_RCON_HOST` 127.0.0.1.

### If the node cannot reach the NeoForge Maven or the Modrinth CDN

Each download is retried 6 times, 10 s apart, with a 60 s connect timeout. If it still fails, the entrypoint stops and names the file to pre-seed. A file already in place with its pinned hash is used as it is, and curl is not called. To pre-seed the two files before `up`:

1. On a machine that can reach them, download the installer from the `INSTALLER_URL` default and the mod from the `MOD_URL` default in `compose/neoforge/neoforge-entrypoint.sh`. The installer URL uses `NEOFORGE_VERSION`, which `compose/opt-in/scratch-neoforge.yml` builds from the 26.1.2 line and `SCRATCH_NEOFORGE_BUILD`.
2. Check each file against its pin, the default after `:-` in `INSTALLER_SHA256` (sha256sum) and `MOD_SHA512` (sha512sum) in that script. On a mismatch, delete the file and do not copy it.
3. Stage the two files in an empty directory `<dir>` as `<dir>/in/neoforge-installer.jar` and `<dir>/in/mods/proxy-compatible-forge.jar`. Then copy them into the world volume `scratch-nf_paper-data` (`<project>_paper-data`) with a throwaway container from the `paper` image in `compose/phase0.yml` (the tag and digest there), run before `up` so no container holds the volume:

        docker run --rm --user 0 -v scratch-nf_paper-data:/data -v "<dir>/in:/in:ro" --entrypoint sh <image> -c \
          'mkdir -p /data/mods && cp /in/neoforge-installer.jar /data/ && cp /in/mods/proxy-compatible-forge.jar /data/mods/ && chown --reference=/data /data/neoforge-installer.jar /data/mods /data/mods/proxy-compatible-forge.jar'

4. The copies must be readable by the server user. The entrypoint re-owns them to the owner of `/data` on every start, and `chown --reference` above does the same, so the server user can read them. Then `up` as before. Delete `<dir>` afterwards.

Exit codes: 2 usage or NATS auth refused, 3 a gate failed,
1 anything else. On 2 and 3 nothing is started. `down` works after a failed `up`: run it to clean up. If `down` fails
the secrets directory is kept, and `up` refuses until `down` succeeds.

### Offline bundle (when the node cannot reach the NeoForge Maven)

The node may not reach `maven.neoforged.net` at all. Then the image's installer cannot run there, and the offline bundle carries
the install instead. It is built on a trusted machine that has network and docker, and it is never committed or pasted into chat.

1. Build it on the trusted machine, from a checkout of this repo:

        sh deploy/scratch/build-neoforge-bundle.sh <output-dir>

   The output dir must not exist or must be empty. The script runs the image pinned in `compose/phase0.yml` (by digest) with the
   real entrypoint and `SETUP_ONLY=TRUE`, which installs NeoForge and stops before the server starts. The forwarding secret is
   a throwaway one made for the build. It is never printed.
2. The output is two files: `neoforge-26.1.2-build<N>-bundle.tar.gz` and `bundle.sha256` (the sha256 of the tarball). The tarball
   holds only the immutable install: `.neoforge-manifest.json`, `neoforge-installer.jar`, `run.sh`, `run.bat`, `libraries/` and
   `mods/`, plus the marker `.geldar-bundle.sha256`, which lists each of those files with its sha256. It holds no
   `server.properties`, `user_jvm_args.txt`, `.run-neoforge.env`, world, `config/`, `logs/`, `eula.txt`, ops or whitelist files, and
   no secrets, so `up` regenerates them. The build prints the tarball size in bytes, the file count and the tarball sha256. Compare
   that hash with the value ops receives over a DIFFERENT channel than the tarball: if both travel together, the check guards only
   corruption. A mismatch means do not use the bundle. `bundle-files.sha256` is not delivered; the marker inside the tarball is the
   list. Measured on 2026-11-16: 81 files, 144507643 bytes (about 138 MiB), 65 s, tarball sha256 starting `bc628311` (example: a
   rebuild changes it if the content changes).
3. Ops carries the tarball and `bundle.sha256` to the node (scp or similar). Nothing else is needed.
4. Extract it into the volume with a throwaway container from the `paper` image in `compose/phase0.yml` (the same tag and digest),
   run before `up`, so no container holds the volume:

        docker run --rm --user 0 -v scratch-nf_paper-data:/data -v "<dir>:/in:ro" --entrypoint sh <image> -c \
          'tar -xzf /in/neoforge-26.1.2-build<N>-bundle.tar.gz -C /data && chown -R --reference=/data /data'

   `<dir>` holds the tarball. Check `sha256sum -c` against `bundle.sha256` before the extract. The volume must be empty before the
   extract: an old `config/` or `server.properties` would break the bundle's assumptions. Check it with a throwaway container,
   `docker run --rm -v scratch-nf_paper-data:/data --entrypoint sh <image> -c 'ls -A /data'` (no output means empty), or run
   `down -v` first.
5. Then `up` as before. The entrypoint reads `/data/.geldar-bundle.sha256`, the list in the tarball, and checks it strictly: a
   malformed or truncated line fails. It refuses a list entry with an absolute path, a drive letter, a leading `-` or a `..`
   segment; a list without the manifest, the installer, `mods/proxy-compatible-forge.jar` or `run.sh`; a symlink under `mods/` or
   `libraries/`; and a jar in `mods/` that the list does not name (the name is printed). Each listed file must match its hash, and
   all of this runs before anything is fetched. Extra files in `libraries/` are allowed: the classpath is fixed by the
   `unix_args.txt` the installer wrote. The bundle mode never prints file contents. When every check passes, it sets
   `NEOFORGE_FORCE_REINSTALL=false`, so the image's helper does not reinstall. The image rewrites `server.properties`,
   `user_jvm_args.txt` and `.run-neoforge.env` on every start, so they are not listed: a second start must pass the same check
   (UNVERIFIED until the first real node run).
6. What the first start should log, if it worked: lines saying the install is already done (the helper's "already installed"
   message) and that the server stays offline. These are UNVERIFIED expectations until the first real run; check them against the
   real log, not this list.

Limits:

- A bundle is valid only for the itzg image digest it was built with. A digest bump in `compose/phase0.yml` means rebuild it.
- The Java major of the bundle must match the image's (the image tag names it: `java25`). A bundle from another Java major is not
  valid.
- The installer pin is one network plus the Maven's own published checksums: the `.sha256`, `.sha1`, `.md5` and `.sha512` files
  all agree with the local file. That protects against corruption and a bad copy. It is not an independent source, so it does not
  protect against a compromised Maven server. The installer's sha512 is pinned next to its sha256 in the entrypoint; both must match.
- 26.1.2 (build 126) is pinned on purpose, although the package-level metadata lists a later 26.3 build as the latest. Moving the pin
  is a separate change with its own checks.

## NATS auth (fail closed)

`up` needs `SCRATCH_NATS_AUTH_DIR`: a readable directory holding non-empty `nats-auth.conf`, `nats-paper.txt`,
`nats-velocity.txt` and `nats-eventsink.txt`. Without it `up` exits 2 and prints why:

    scratch: NATS auth is required. Set SCRATCH_NATS_AUTH_DIR to a directory holding the four files made by ...

The files come from the generator on the desktop, `./geldar.ps1 shard nats-auth <shard>` (`Initialize-NatsAuth` in
`geldar.ps1`). It writes into the repo's `compose/secrets/` (git-ignored).

`SCRATCH_NATS_OPEN=1` is the only other way to start, and it runs open NATS with no role ACLs. It prints a multi-line
WARNING, and `status` repeats it. Open NATS lets every local user on the node connect to `127.0.0.1:14222`, publish to
the subjects Paper consumes and read JetStream. Open NATS is not approved for any run on the shared node. It is for a
run that does not test the NATS roles, and such a run cannot test them. (The warning `deploy/scratch/scratch.sh`
prints, line 87, calls this "item 5"; no file in the repo defines that numbered list.) If `SCRATCH_NATS_AUTH_DIR` is set but
invalid, `up` exits 2 even with `SCRATCH_NATS_OPEN=1`.

The flow, in order:

1. On the desktop, from the repo root: `./geldar.ps1 shard nats-auth <shard>`. It never overwrites a file that exists,
   so a file that was already there belongs to someone else's stack.
2. Make a temp dir outside the repo. Copy only `nats-auth.conf`, `nats-paper.txt`, `nats-velocity.txt` and
   `nats-eventsink.txt` into it. Those are the four files `compose/nats-auth.yml` mounts. Do not copy anything else.
3. Delete the repo-side copies that step 1 created (the lines `created compose/secrets/...` in its output name them).
   Leave alone any file that was already there.
4. After the review passes and the start gates are met, copy the temp dir to a node temp dir. Do not copy it
   anywhere else.
5. On the node: `SCRATCH_NATS_AUTH_DIR=<absolute path of the node temp dir> sh deploy/scratch/scratch.sh up [suffix]`.
   The path must be absolute and on one line; a relative path or a newline exits 2 with nothing started. The script
   checks the four files, then points the `nats-auth.yml` secrets at that dir. It does not read, print or copy the files.
6. At teardown run `sh deploy/scratch/scratch.sh down [suffix]`, then delete both copies: the desktop temp dir (if
   it still exists) and the node temp dir. `down` never removes `SCRATCH_NATS_AUTH_DIR`.

The conf and the passwords never go in the repo, in logs or in messages. Do not paste their contents into a
terminal, a chat or a report.

## Gates

`up` refuses to start unless both hold, and exits 3 when a figure cannot be read as a number:

- free RAM is at least 10 GB (Linux: `MemAvailable` in `/proc/meminfo`; elsewhere PowerShell's `FreePhysicalMemory`);
- free disk is at least 20 GB on both the repo filesystem and Docker's data root (`docker info`, `DockerRootDir`).
  The smaller of the two figures counts.

The script prints the figures before deciding. It also refuses (exit 1) if the project already has containers or if a
secrets directory from an earlier `up` still exists. Run `down` first.

## Resource caps

Per-service limits in `compose/opt-in/scratch.yml`, with `memswap_limit` equal to the memory cap:

| Service   | Memory | CPUs |
|-----------|--------|------|
| paper     | 3072m  | 1.5  |
| velocity  | 768m   | 0.5  |
| postgres  | 768m   | 0.5  |
| nats      | 256m   | 0.25 |
| eventsink | 384m   | 0.25 |

The total is 5248 MiB (about 5.1 GiB) and 3.0 CPUs. The gate's 10 GB RAM floor is the margin for the rest of the node.
Paper's heap defaults to 2G (`PAPER_MEMORY` overrides it). Every container has `restart: "no"`, so nothing comes back
after a reboot. The image build (`--build`) runs outside these caps.

## Shared servers

On a shared Linux server, before `up`, record the load average, free RAM and free disk. Stop the stack with `down`
if other tenants, or the game server's TPS, show strain. The gates are a floor, not a licence to run.

## One stack at a time

Run one scratch stack at a time. Its ports are 15432 (Postgres), 14222 and 18222 (NATS client and monitor) and
35565 (Velocity). Override them with `SCRATCH_PG_PORT`, `SCRATCH_NATS_PORT`, `SCRATCH_NATS_MON_PORT` and `SCRATCH_MC_PORT`.
The secrets directory is `${XDG_STATE_HOME:-$HOME/.local/state}/geldar-scratch/scratch-<suffix>`, mode 0700.
`SCRATCH_NATS_AUTH_DIR` and `XDG_STATE_HOME` must be absolute paths on one line (`/...` on the node); the script exits 2
on a relative path or a newline and starts nothing.

## Migrations

Postgres applies `sql/` in name order by itself, but only on a fresh volume. `up` always makes one, so every
scratch stack starts from a fresh schema. To confirm nothing is pending, with the stack up, from the repo root:

    STATE=${XDG_STATE_HOME:-$HOME/.local/state}/geldar-scratch
    PGHOST=127.0.0.1 PGPORT=${SCRATCH_PG_PORT:-15432} PGUSER=geldar PGDATABASE=geldar \
      PGPASSWORD="$(cat "$STATE/scratch-<suffix>/postgres.txt")" node tools/migrate/src/cli.ts --dry-run

The output should show no pending migrations. The password is read into the environment of that one command and
never printed.

## Turning on the character config

The character fixture is `shards/character-fixture.yaml`. To use it, point the scratch shard file at that path
instead of `shards/phase0.yaml`, using the shard tooling in `geldar.ps1`. Do not copy its values into
`shards/phase0.yaml`, `shards/colo.yaml` or `shards/colo-mind.yaml`.

## Rules

- Loopback only. Every published port is bound to 127.0.0.1. Do not change that, and do not add a bind to another
  address.
- Never run this on the Colo node without the owner's word. Ask through the node operator.
- Evidence from a scratch run is for operators only. Agents in the run are never told they are being watched.
- The secrets directory is created under the caller's state directory, never in the repo or in a shared temp
  directory. Nothing prints its values. `down` removes it, and only when it is a real directory the caller owns.
