---
title: "Scratch stack"
type: how-to
audience: operators
status: draft
last_verified: 2026-11-17 against 423b6ceb
companions: [README.md, nats-auth-inplace.md]
sources: [../../deploy/scratch/scratch.sh, compose/opt-in/scratch.yml, shards/character-fixture.yaml]
---

# Scratch stack

The NATS auth generator (`./geldar.ps1 shard nats-auth phase0`) must never run in the live checkout: it would write scratch
passwords into that checkout's `compose/secrets/`. The guard enforces this. In a git checkout (a `.git` entry exists),
`--scratch` is refused and writes nothing, and a run with no flag is refused too. `--local` is the local desktop phase0
stack and works in a checkout. Scratch runs use `--scratch` inside a clean `git archive` export, as the steps below say.

A throwaway copy of the Phase 0 shard stack (`compose/phase0.yml`) for the sheet campaign validation. It runs beside the
live phase0 stack and the Colo stack without clashing: its own compose project (`scratch-<suffix>`), its own volumes,
loopback-only ports on high defaults, and hard caps. `down` removes its containers, its volumes, its eventsink image
and its secrets directory. The Docker build cache is not removed (prune it by hand if the disk needs it). The P0 probe image is not removed either; see "The probe image" under P0 probe.

The sheet sink is not enabled. The overlay does not include `compose/opt-in/sheet-sink.yml` and `GELDAR_SHEET_SHARD` is
unset, so a scratch run does not write to the sheet.

Not approved for any run on the shared node: open NATS (see NATS auth below).

## Before up

1. Build BOTH plugin jars before `up`, on the machine that runs the stack: `(cd plugin; ./gradlew build)`. It produces
   `plugin/core/build/libs/geldar-core.jar` and `plugin/velocity-identity/build/libs/geldar-velocity-identity.jar`, the two
   jars the stack bind-mounts. The NeoForge export run lost time because geldar-core.jar was missing. `up` refuses (exit 1)
   if either is missing, and does not create anything.
   Then check the rendered mounts with `sh deploy/scratch/scratch.sh config nf` (add `SCRATCH_PLATFORM=neoforge` and
   `SCRATCH_EXTRA_MODS=1` for the NeoForge extra mods). It runs `docker compose config` with the same -f list as `up`, starts
   nothing, creates no volume and needs no jars. Exit 0 means compose rendered it. In the extra-mods bind sources, each
   BlueMap source must resolve to a real path in the tree (`plugins/bluemap/neoforge` and
   `compose/neoforge/extra-mods-bluemap-config.sh`); a `bind source path does not exist` error means a source is wrong.
2. Run as any non-root account. The eventsink runs as that account's uid:gid (see the next section), so it reads the
   secret files, which are mode 0600 and owned by the account. If `GELDAR_SERVICE_UID` is set it must be digits and equal
   the account's uid: digits-only fails with exit 2, a different uid with exit 1. `up` refuses (exit 1) under root.
3. Compose 2.24.4 or newer (the `!override` tag). `up` checks.
4. Set up NATS auth (next section).
5. Export `GELDAR_ADMIN_IMAGE=geldar-admin:scratch-<suffix>` (for `nf`, `geldar-admin:scratch-nf`) in the shell that runs
   `up`, `status` and `down`. The `identity-seed` service in `compose/opt-in/scratch.yml` builds the admin image and tags it
   `${GELDAR_ADMIN_IMAGE:-geldar-admin:c1}`. `scratch.sh` does not set this variable, so without the export the build
   retags the shared `geldar-admin:c1` tag. Record `docker images geldar-admin` before `up` and compare it after, to show the
   shared tag kept its image ID. `down` should see the same value so it acts on this run's image; whether
   `down --rmi local` removes an image with a custom tag is not confirmed from the repo, so check `docker images` after `down`.

## Commands

    sh deploy/scratch/scratch.sh up [suffix]       # gates, then starts the stack (default suffix a)
    sh deploy/scratch/scratch.sh status [suffix]   # compose ps, CPU and memory per container, NATS warning if open
    sh deploy/scratch/scratch.sh down [suffix]     # down -v --rmi local, removes the secrets directory, lists leftover volumes

Never build the images by hand, for example `docker compose build eventsink`: it fails, because `GELDAR_WORLD_VOLUME` is
set only inside `scratch.sh` (`set_env`). `up` builds them (it passes `--build`).

The suffix is `[a-z0-9]{1,9}`. Anything else exits 2. Host ports come from `deploy/scratch/<suffix>.env`, which the
script reads itself (it never sources the file; only the four `SCRATCH_*_PORT` keys with digit values 1 to 65535 are
accepted, anything else exits 2, and a variable you already set in your environment wins over the file). The file is
required for `telemetry` (a missing file exits 2) and optional for every other suffix, which then gets the defaults:

| Project | Postgres | NATS | NATS monitor | Minecraft (Velocity) | RCON (Paper or NeoForge, loopback) |
| --- | --- | --- | --- | --- | --- |
| `scratch-a` and other suffixes (defaults) | 15432 | 14222 | 18222 | 35565 | 35575 |
| `scratch-telemetry` (`telemetry.env`, defaults + 10000) | 25432 | 24222 | 28222 | 45565 | 45575 |
| `scratch-nf` (`nf.env`, defaults + 20000, NeoForge) | 35432 | 34222 | 38222 | 55565 | 55575 |

RCON is published on `127.0.0.1` only, on `SCRATCH_RCON_PORT` (container port 25575), by the Paper overlay `compose/opt-in/scratch.yml` and by the NeoForge overlay. The game port is never published. The password is the run's own `rcon.txt` secret.

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
- A hard step after the first `up`: the eventsink's `/app` files are root-owned and copied in without `--chown`, so
  they are readable as the account uid only if they are world-readable. Run
  `docker run --rm --user <uid>:<gid> --entrypoint ls <eventsink image> -l /app` (the eventsink image is the one `up`
  built; its name is `scratch-<suffix>-eventsink` by compose's default naming, so check it with `docker images`) and confirm the listing shows
  read permission for others. If it does not, stop, run `down`, and say so; do not change the mode by hand.
- On the first `up`, check the drop. `docker exec <container> id` is not the check: it prints root, because `docker exec`
  defaults to the image user, not the JVM's. Check the JVM's uid instead: `docker top <container> -eo uid,pid,args`
  for the Paper container (from `docker compose -p scratch-<suffix> ps -q paper`) and the Velocity container (`... ps -q velocity`).
  **Paper is blocking:** the eventsink and Paper processes must show the account uid, not 1000 or any other uid. If Paper shows
  another uid, stop and run `down`.
  **Velocity is recorded, not blocking:** on run 4 and live, the Velocity java process is uid 0. Verified by ops reading the
  pinned `itzg/mc-proxy` script (`/usr/bin/run-bungeecord.sh`): its privilege drop is a hardcoded `exec gosu bungeecord java ...`
  (uid 1000), taken only when bash's `$UID` is 0 (script lines 159, 554, 584-587). It does not read UID, GID, PUID or PGID as a
  target user. Bash takes `$UID` from the environment, so our `UID=1001` turns the drop off and java runs as the real uid, root;
  the `/server` chown is skipped too. PUID and PGID have no effect. With UID unset the proxy would drop to uid 1000, which cannot
  read the 0600 forwarding secret owned by the account uid. Accepted for scratch: the scratch volume is the only writable mount
  (`velocity.toml` and the plugin jar are read-only), and `down` deletes it. Record the output and do not stop on it.
  Unverified command on this image, record the output: if `docker top`
  is not available on the node, run `docker exec <container> sh -c 'for p in /proc/[0-9]*; do grep -q java $p/cmdline 2>/dev/null && grep "^Uid" $p/status; done'`
  and read the first Uid field (real uid).
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
- The paper service also pins MAX_PLAYERS 10, VIEW_DISTANCE 8 and SIMULATION_DISTANCE 6. The scratch overlays keep these
  values. The live NeoForge shard goes to MAX_PLAYERS 100 (view and simulation distance the same) once PR #732 and the
  owner-approved node step land; until then the running NeoForge shard still enforces 10 (docs/runbooks/nf-live-project.md
  section 3b). The scratch values do not track the live shard. They override phase0.yml's Paper values in this stack only.
- The NeoForge variant uses the same three secret files as Paper (postgres, rcon, velocity-forwarding) in the same
  `scratch-nf` state directory, and the same eventsink user override from `scratch.yml` applies. The overlay itself
  sets no user.
- No geldar-core jar is mounted, so the eventsink sees no game events from this server. The caps are the scratch caps
  (3072m, 1.5 CPUs). Ports come from `deploy/scratch/nf.env`, loopback only.
- The first start is slow: it downloads the mod and the installer, runs the installer, and waits for the health check's
  15 minute start period. Allow about 15 to 18 minutes before `up` returns (the 15 minute start period plus the health retries).
- RCON is published on every scratch Paper or NeoForge stack, on `127.0.0.1` only (`SCRATCH_RCON_PORT`; 55575 here), with the run's own `rcon.txt` secret. The live tests use
  `GELDAR_RCON_PORT=55575`, `GELDAR_RCON_PASSWORD_FILE` set to the path of that `rcon.txt` (a path, never the value),
  `GELDAR_MC_PORT=55565`, `GELDAR_NATS_URL` on 127.0.0.1 port 34222, and `GELDAR_MC_HOST` and `GELDAR_RCON_HOST` 127.0.0.1.

### If the node cannot reach the NeoForge Maven or the Modrinth CDN

Each download is retried 6 times, 10 s apart, with a 60 s connect timeout. If it still fails, the entrypoint stops and names the file to pre-seed. A file already in place with its pinned hash is used as it is, and curl is not called. The copy-pasteable form, with the pinned values and each command in order, is [Pre-seed, copy-pasteable](#pre-seed-copy-pasteable), at the end of this section.

On this node the pre-seed route is the normal route, not a fallback: the node cannot reach `maven.neoforged.net` (HTTP 000). The pins are `INSTALLER_SHA256` and `INSTALLER_SHA512` (the installer) and `MOD_SHA512` (Proxy Compatible Forge 1.3.1), all in `compose/neoforge/neoforge-entrypoint.sh`. To pre-seed the two files before `up`:

1. On a machine that can reach them, download the installer from the `INSTALLER_URL` default and the mod from the `MOD_URL` default in `compose/neoforge/neoforge-entrypoint.sh`. The installer URL uses `NEOFORGE_VERSION`, which `compose/opt-in/scratch-neoforge.yml` builds from the 26.1.2 line and `SCRATCH_NEOFORGE_BUILD`.
2. Check each file against its pin, the default after `:-` in `INSTALLER_SHA256` (sha256sum) and `MOD_SHA512` (sha512sum) in that script. On a mismatch, delete the file and do not copy it.
3. Stage the two files in an empty directory `<dir>` as `<dir>/in/neoforge-installer.jar` and `<dir>/in/mods/proxy-compatible-forge.jar`. Then copy them into the world volume `scratch-nf_paper-data` (`<project>_paper-data`) with a throwaway container from the `paper` image in `compose/phase0.yml` (the tag and digest there), run before `up` so no container holds the volume:

        docker run --rm --user 0 -v scratch-nf_paper-data:/data -v "<dir>/in:/in:ro" --entrypoint sh <image> -c \
          'mkdir -p /data/mods && cp /in/neoforge-installer.jar /data/ && cp /in/mods/proxy-compatible-forge.jar /data/mods/ && chown --reference=/data /data/neoforge-installer.jar /data/mods /data/mods/proxy-compatible-forge.jar'

UNVERIFIED: this pre-seed was not reached in the real run. `up` MAY complain that the pre-seeded volume lacks the compose project
labels; no fix for that is recorded here yet. Do not run `down -v` to clear it: that removes the pre-seeded files.

4. The copies must be readable by the server user. The entrypoint re-owns them to the owner of `/data` on every start, and `chown --reference` above does the same, so the server user can read them. Then `up` as before. Delete `<dir>` afterwards.

Exit codes: 2 usage or NATS auth refused, 3 a gate failed,
1 anything else. On 2 and 3 nothing is started. `down` works after a failed `up`: run it to clean up. If `down` fails
the secrets directory is kept, and `up` refuses until `down` succeeds.

#### Pre-seed, copy-pasteable

The values are for NeoForge 26.1.2 build 126: the `SCRATCH_NEOFORGE_BUILD` default in `compose/opt-in/scratch-neoforge.yml`. Block A sets `B` to that build and `V` to `26.1.2.$B`, which is the `NEOFORGE_VERSION` the overlay builds. The steps above say the same in prose. A new build needs a new installer pin in `compose/neoforge/neoforge-entrypoint.sh` first; until then the entrypoint refuses the installer. `tools/repo-checks/src/scratch-preseed-docs.test.ts` keeps the blocks below equal to the pins and URLs in the repo.

**A. On a machine that can fetch.** `<dir>` is an empty absolute directory:

```sh
mkdir -p <dir>/in/mods <dir>/extra && cd <dir>
B=126
V=26.1.2.$B
curl -fLo in/neoforge-installer.jar "https://maven.neoforged.net/releases/net/neoforged/neoforge/$V/neoforge-$V-installer.jar"
curl -fLo in/mods/proxy-compatible-forge.jar 'https://cdn.modrinth.com/data/vDyrHl8l/versions/qiZ49HIW/proxy-compatible-forge-1.3.1.jar'
curl -fLo extra/chunky.jar 'https://cdn.modrinth.com/data/fALzjamp/versions/sDFaDSkE/Chunky-NeoForge-1.5.66.jar'
curl -fLo extra/bluemap.jar 'https://github.com/BlueMap-Minecraft/BlueMap/releases/download/v5.29/bluemap-5.29-neoforge.jar'
cat > SHA256SUMS <<'EOF'
1184ffee181bd7a940691539fea07f237096378da4c94795247ecdb9cb354a1b  in/neoforge-installer.jar
9f9303da0185fa0ae0e1d3f10a0f07b8d9e5a21e77931d4fc162dcc718a0ab4f  extra/chunky.jar
8938f4453af4b53970c86e43d0bd26b4a88980e4e6639f818fa770d0f61c43df  extra/bluemap.jar
EOF
cat > SHA512SUMS <<'EOF'
3ecc1cef40def9af5086449249dc621a860fb3c2af36084635396d152b5617560bfa0ace9376ef9ba05bfc9ab3d92348829472548e57e29a1fab4b63ad621bdb  in/neoforge-installer.jar
dba5b70fedcb0f5fdc014801ab43e6d048f24b531de8aea5b70ea223760b66ae9fba3033c2ccd9d78793b9ea2f9d3b47ae1f4caa95aa129d989f97e63636b4ab  in/mods/proxy-compatible-forge.jar
EOF
sha256sum -c SHA256SUMS && sha512sum -c SHA512SUMS
```

On a mismatch, delete the file and do not copy it (step 2 above).

**B. Copy to the node, then re-verify there.** `<node>` is the ssh name. The node's `<dir>` must not exist yet, and it is the same path as on this machine:

```sh
scp -r <dir> <node>:<dir>
ssh <node> 'cd <dir> && sha256sum -c SHA256SUMS && sha512sum -c SHA512SUMS'
```

**C. On the node, before `up`.** This fills the world volume `scratch-nf_paper-data` (`<project>_paper-data`; the project is `scratch-<suffix>` in `deploy/scratch/scratch.sh`). The image is the `paper` service's image in `compose/phase0.yml`, tag and digest; re-read that line if the pin has moved. No container may hold the volume:

```sh
docker run --rm --user 0 -v scratch-nf_paper-data:/data -v "<dir>/in:/in:ro" --entrypoint sh itzg/minecraft-server:2026.10.1-java25@sha256:d12aed7e35981dfe259b60fbfee77d23a19b5898a7a31dca298d18b47b7b5776 -c 'mkdir -p /data/mods && cp /in/neoforge-installer.jar /data/ && cp /in/mods/proxy-compatible-forge.jar /data/mods/ && chown --reference=/data /data/neoforge-installer.jar /data/mods /data/mods/proxy-compatible-forge.jar'
```

The paths match the entrypoint: the installer is `$data/neoforge-installer.jar` and the mod is `$data/mods/proxy-compatible-forge.jar`, with `data=/data` (lines 23 to 27). The entrypoint re-owns both to the owner of `/data` on every start (line 234).

**D. Start, with the extra mods.** `up` reads the two extra jars from `<dir>/extra`, so keep that directory until `up` has returned:

```sh
export SCRATCH_PLATFORM=neoforge
export SCRATCH_NATS_AUTH_DIR=<auth dir>
export SCRATCH_EXTRA_MODS=1
export SCRATCH_EXTRA_CHUNKY_JAR_HOST=<dir>/extra/chunky.jar
export SCRATCH_EXTRA_BLUEMAP_JAR_HOST=<dir>/extra/bluemap.jar
sh deploy/scratch/scratch.sh config nf
sh deploy/scratch/scratch.sh up nf
```

`config nf` renders the compose file and starts nothing. Step 4 above says to delete `<dir>`: delete `<dir>/in` after block C, and the rest only after `up` has returned.

**UNVERIFIED.** None of blocks A to D has run on the node. Each was checked against the entrypoint and overlay text only.

- `up` may refuse the pre-seeded volume. Block C creates it outside compose, so it has no compose project label. No fix is recorded. Do not run `down -v` to clear it: that removes the pre-seeded files.
- The download skip. The entrypoint's comment (line 62) says a file already in place with its pinned hash is used and curl is not called. `fetch` returns 0 before curl when the check passes (lines 65 to 67). The code reads that way; no run has shown it. The installer's sha512 is checked again on lines 226 to 231.
- Block C's command, including `--entrypoint sh` on the paper image, has not been run.
- The Chunky URL is the "Download URL" row of `docs/analysis/neoforge/pregen-and-extra-mods-design.md`. The BlueMap URL is in `docs/runbooks/map-neoforge.md` (line 77). Neither was fetched here. The sha256 pins come from the repo, and block A's `sha256sum -c` checks the downloaded bytes against them.
- Nothing is copied to the node for the BlueMap loader or config. The overlay mounts them from the checkout (`compose/neoforge/extra-mods-bluemap-config.sh` and `plugins/bluemap/neoforge`), so the checkout must have them.

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
   list. Size, file count and hash are recorded per build and differ between builds; compare the hash by a second channel, as above.
   No bundle size or hash is pinned in this runbook.
   Reuse: a built bundle may be reused only if the bundle script (`deploy/scratch/build-neoforge-bundle.sh`) has no content
   change after the tarball's build time. Compare `git log -1 --format=%cI -- deploy/scratch/build-neoforge-bundle.sh` with the
   tarball's mtime: reuse only if the commit time is earlier than the mtime. Otherwise rebuild. If the mtime was changed by a
   copy, rebuild. A digest bump or a different Java major also means rebuild (see Limits).
3. Ops carries the tarball and `bundle.sha256` to the node (scp or similar). Nothing else is needed.
4. Extract it into the volume with a throwaway container from the `paper` image in `compose/phase0.yml` (the same tag and digest),
   run before `up`, so no container holds the volume:

        docker run --rm --user 0 -v scratch-nf_paper-data:/data -v "<dir>:/in:ro" --entrypoint sh <image> -c \
          'tar -xzf /in/neoforge-26.1.2-build<N>-bundle.tar.gz -C /data && chown -R --reference=/data /data'

   `<dir>` holds the tarball. On the node, check the tarball with `sha256sum -c bundle.sha256` (run in `<dir>`) before the extract; a mismatch means do not extract. The volume must be empty before the
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

### First-run checks (NeoForge)

Run these after `up` returns healthy. Run the process-uid check in the section above first (Paper blocking, Velocity recorded). `<paper>` is `docker compose -p scratch-nf ps -q paper`. Items marked
UNVERIFIED are commands or reply wording not confirmed against the repo or a live NeoForge 26.1 server: run them, record
the real output in the run notes, and check it against the reply before calling it a failure.

1. Mod load. With no geldar jar mounted (see Mounting the mod jar), `/data/mods` holds only `proxy-compatible-forge.jar`,
   the expected count is 0, and 0 is not a failure: this check is N/A. With the jar mounted, this check is BLOCKING.
   Record `docker exec <paper> ls /data/mods` (it lists `geldar-neoforge.jar`) and the count from
   `docker logs <paper> 2>&1 | grep "geldar_neoforge loaded on the dedicated server"`. The expected count is exactly 1.
   If the count is 0, stop and copy the FULL paper log (`docker logs --timestamps <paper> 2>&1`) into the desktop temp dir,
   and record a load failure in the run's report. The grep matches the log line `GeldarNeoForge.java` writes at server
   start; the id is `ModInfo.modId()`, equal to `modId` in `neoforge.mods.toml`. Run 7 (2026-11-17, dedicated server)
   proved the load once; the count and log lines are in that run's report, not here. The check stays blocking on every
   run that mounts the jar. The blocking mod check is also Proxy Compatible
   Forge loading: the paper log must show the `Initializing ProxyCompatibleForge` and `Found status` lines. The loaded-mods
   list: `docker logs <paper> 2>&1 | grep -i "loaded"`; record the mod lines.
2. Tick time. `docker exec <paper> rcon-cli tick query` (vanilla; UNVERIFIED on this image) shows the target tick rate and
   the average time per tick. `docker exec <paper> rcon-cli neoforge tps` is a NeoForge command, UNVERIFIED on 26.1: record
   its reply, or the unknown-command reply. spark is not installed on the scratch NeoForge, so `rcon-cli spark tps`
   (the live equivalent in `deploy/README.md`) does not work here.
3. Vanilla join. `docker exec <paper> rcon-cli list` before and after one join shows the player count rising by one.
   `docker logs <paper> 2>&1 | grep -E "joined the game|UUID of player"` shows one "joined the game" line and one line
   with the player's UUID (UNVERIFIED wording on this image). Redact the name and UUID in the notes.
4. CPU and memory. Run `docker stats --no-stream` twice, 30 s apart, and record both. `scratch.sh status nf` prints the same
   per-container figures. Each must stay within its cap: memory at or below 3072m (paper) and 768m (velocity), CPU % at or
   below 150 (paper, 1.5 CPUs) and 50 (velocity, 0.5 CPUs; `docker stats` percent is per CPU).
   Measurements, labelled by run. Run 3 (2026-11-17, node not otherwise loaded): paper 1.62 GiB of 3 GiB, velocity 194 MiB;
   its CPU was not captured. Run 5 (one run, 2026-11-17): `tick query` 20/s with a 0.1 ms average; `neoforge tps` overall
   20.000 at 0.091 ms/tick; `docker stats`: paper 1.625 GiB of 3 GiB at 0.25% CPU, velocity 188 MiB of 768 MiB. These are
   one run's figures, not a baseline. The CPU samples from this step are the first CPU figures.
5. Proxy Compatible Forge config. `docker exec <paper> stat -c '%a %u:%g' /data/config/proxy-compatible-forge.toml /data`
   prints two lines: the file's mode and uid:gid first, then `/data`'s. The mode must be `600`; that is the requirement.
   Record the file's uid:gid and `/data`'s, but do not block on a difference. Run 4 saw the file at mode 600 with owner uid 1000
   while the Paper JVM ran as 1001. Run 5 saw mode 600, owner 1001:1000, with the Paper JVM as uid 1001. The itzg/minecraft-server
   image appears to remap its server user (observed; cause unverified).
6. Netty VarInt line (sender UNVERIFIED). After the stack is up, run
   `docker logs --timestamps <paper> 2>&1 | grep -n VarInt` on the FULL paper log, not a tail, and record the count and the
   timestamps. The line is an IndexOutOfBoundsException at PCF VarInt.read (ModernForwarding.handleClientIntention) with no
   client. Run 5 (2026-11-17) logged it once, at 14:21:29Z, about 4 s into start-up while the server was still preparing its
   level. The read buffer had capacity 1, so one byte was read. The count did not change over the next 60 s, so it did not
   repeat on the 30 s healthcheck interval. The most likely reading is a one-byte connection that reached the pre-Netty
   legacy-ping path before the world was ready, such as a start-up readiness probe; this is not verified. It did not stop
   the server. Then watch one minute: note the count, wait 60 s, count again. If it repeats about every 30 s, it is the
   healthcheck. If it appears more than once, or one appears after the server is ready, capture the full trace and the 20
   lines either side with timestamps (`docker logs --timestamps <paper> 2>&1`) and report it. If it appeared once at
   start-up, capture the full stack trace (the lines around the match in `docker logs <paper> 2>&1`). Never treat this
   line as a failure by itself.

Order. The blocking checks, in this order, are: the process-uid check (Paper), check 1 (the Proxy Compatible Forge lines,
and the geldar_neoforge count when a jar is mounted, as above), check 4 and check 5. Checks 2, 3 and 6 are recorded and do not block. When the blocking checks pass, the
probe (P0 probe section, step 4) may run when ops asks for it. Check 3 is recorded here as non-blocking; the owner should
confirm that.

Known start-up noise on NeoForge. Neither item is caused by our mod, and neither is a failure by itself:

- An ERROR `An exception occurred processing Appender DebugFile`, caused by a NoClassDefFoundError for
  `io.netty.channel.kqueue.Native` ("Only supported on OSX/BSD"). It was seen in runs 3 to 5 (no mod).
- The one-off netty IndexOutOfBoundsException at PCF VarInt.read (check 6). It was seen once, at start-up, in run 5 (no mod).

### Mounting the mod jar

Only for SCRATCH_PLATFORM=neoforge. Two optional variables mount one mod jar read-only into the server at
/geldar/mods/geldar-neoforge.jar: SCRATCH_NEOFORGE_MOD_JAR, the absolute path of the jar on this node (forward slashes; no
quotes, backslashes or dollar signs), and SCRATCH_NEOFORGE_MOD_SHA256, its sha256 as 64 lowercase hex digits. Set both or
neither. With SCRATCH_PLATFORM=paper, or with only one of them, scratch.sh exits 2 and starts nothing.

- `up` checks the jar's sha256 on the host before anything starts, and exits 2 on a mismatch.
- The entrypoint checks the same hash again inside the container. It copies the jar into the data dir's mods/ only when the
  hash matches, and refuses to start otherwise. While the jar is mounted, each start removes the old copy before the
  offline-bundle check and copies again after it, so the bundle's mods/ check still passes on a second start. Outside bundle mode nothing lists mods/, so a foreign jar placed beside a mounted one is not refused.
- Check 1 is N/A when no jar is mounted and BLOCKING when one is. Run 7 (2026-11-17) proved the load once, on a dedicated server.
- A failure to load the mod (no geldar_neoforge line, or a count other than 1) is blocking: stop, copy the full paper log, and record it in the
  report. It is not a reason to change the check or the mod by hand.

## NATS auth (fail closed)

`up` needs `SCRATCH_NATS_AUTH_DIR`: a readable directory holding non-empty `nats-auth.conf`, `nats-paper.txt`,
`nats-velocity.txt`, `nats-eventsink.txt` and `nats-seed.txt`. Without it `up` exits 2 and prints why:

    scratch: NATS auth is required. Set SCRATCH_NATS_AUTH_DIR to a directory holding the five files made by ...

`nats-seed.txt` is the password of the scratch-only `seed` NATS user. It may create only the two identity KV buckets
(`geldar-life-registry`, `geldar-skins`) and has no other subject. The `identity-seed` one-shot (`golem/src/seed-buckets.ts`,
the admin image) runs once after NATS is healthy and before velocity starts; velocity waits for it to exit 0. Velocity
only reads the buckets, and its healthcheck stays red until the life registry bucket exists. A failed seed fails `up`.
The seed user exists only in the phase0 table of `./geldar.ps1 shard nats-auth phase0 --scratch`, so a `nats-auth.conf` made
before this change lacks it: delete that file (no secret is lost; the generator rebuilds it from the password files)
and run the generator again, or the seed fails with an authorization error. The JetStream subjects of the seed user are
untested against a live server.

The auth dir is generated in a clean export (`git archive` of main), never in the live checkout. The generator is
`./geldar.ps1 shard nats-auth phase0 --scratch` (`Initialize-NatsAuth` in `geldar.ps1`). It writes into the export's
`compose/secrets/` (git-ignored) and reuses any file already there, so a clean export makes every scratch user fresh:
no live Body, Mind or MCP password can reach the node.

The generated `nats-auth.conf` embeds every role's password. Treat the whole auth dir as secret, and delete it from the
node after the run (step 6).

`SCRATCH_NATS_OPEN=1` is refused: `up` exits 2 with nothing started. Open NATS has no role ACLs, is not approved for any
run on the shared node, and cannot run the identity seed, which needs the auth dir. `status` for a project with state but
no override says it was not started with `SCRATCH_NATS_AUTH_DIR`. If `SCRATCH_NATS_AUTH_DIR` is set but invalid, `up`
exits 2.

The export procedure (every scratch run that generates auth files, and the probe, uses it). Use a file, never a pipe:

1. `git fetch origin`, then `git archive -o <absolute path to a file>.tar <commit>`, where `<commit>` is the commit of main
   (`git rev-parse origin/main`). The file is outside the live checkout. Never pipe `git archive` into `tar`.
   If this fails, STOP.
2. List the archive: `tar -tf <file>.tar`. Stop if any entry is an absolute path or contains `..`. A check that prints
   nothing when the archive is clean is `tar -tf <file>.tar | Select-String -Pattern '^/|^[A-Za-z]:|(^|/)\.\.(/|$)'`.
3. Extract into an empty directory outside the checkout: `tar -xf <file>.tar -C <empty-dir>`. If the directory already
   holds files, pick another one.
4. Check the directory exists, then change into it, and confirm the change worked (`Set-Location <empty-dir>` succeeds and
   `(Get-Location).Path` is that directory) before running anything. If any check fails, STOP.

The flow, in order:

1. On the desktop, make the clean export (the export procedure above), then from that export directory run
   `./geldar.ps1 shard nats-auth phase0 --scratch`. It never overwrites a file that exists; the export has none, so every
   file it writes is new for this run. If any export step fails, STOP. Do not run the generator in the checkout.
2. Make a second temp dir outside the repo. Copy only `nats-auth.conf`, `nats-paper.txt`, `nats-velocity.txt`,
   `nats-eventsink.txt` and `nats-seed.txt` from the export's `compose/secrets/` into it. The first four are the files
   `compose/nats-auth.yml` mounts; the fifth is the seed's (`compose/opt-in/scratch.yml`). Do not copy anything else.
3. Delete the export dir, which holds the generated files. Do not copy anything else out of it.
4. After the review passes and the start gates are met, copy the temp dir to a node temp dir. Do not copy it
   anywhere else.
5. On the node: `SCRATCH_NATS_AUTH_DIR=<absolute path of the node temp dir> sh deploy/scratch/scratch.sh up [suffix]`.
   The path must be absolute and on one line; a relative path or a newline exits 2 with nothing started. The script
   checks the five files, then points the `nats-auth.yml` secrets at that dir. It does not read, print or copy the files.
6. At teardown run `sh deploy/scratch/scratch.sh down [suffix]`, then delete the node temp dir and the desktop temp dir
   (if it still exists). The node dir holds the password-bearing `nats-auth.conf`, so delete it even when the run failed.
   `down` never removes `SCRATCH_NATS_AUTH_DIR`. Before `down`, copy the FULL output of `up` and the FULL paper log
   (`docker logs --timestamps <paper> 2>&1`, not only the tail) into the desktop temp dir, outside the repo.

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

## P0 probe

The P0 probe is one run of the golem probe (`golem/src/p0/probe.ts`) against a scratch stack that `up` already started.
It registers one Body, joins it through Velocity to Paper, runs one goto and one mine, and removes its own registry
entry and whitelist entry. The overlay is `compose/opt-in/scratch-probe.yml` (service `p0-probe`, profile `p0`). Only the
`probe` verb of `deploy/scratch/scratch.sh` starts it, so `up` never does. It never touches the Colo stack: the probe
refuses unless its project is `scratch-<suffix>`, and its NATS and RCON credentials are the scratch ones.

When to run: only when ops asks for it, on the scratch node, after `up` has reached healthy for that suffix.

Steps, in order:

1. In a clean export (the export procedure in the NATS auth section, from main), run
   `./geldar.ps1 shard nats-auth phase0 --scratch` from the export. If any export step fails, STOP; do not run it in the
   checkout.
2. Make a second temp dir outside the repo. Copy six files from the export's `compose/secrets/`: `nats-auth.conf`,
   `nats-paper.txt`, `nats-velocity.txt`, `nats-eventsink.txt`, `nats-seed.txt` and `nats-body.txt` (the body's NATS
   password, which only the probe reads). Copy nothing else.
3. Delete the export dir, which holds the generated files.
4. On the node, with the same absolute auth dir for both verbs:

        SCRATCH_NATS_AUTH_DIR=<absolute path of the six-file dir> SCRATCH_PLATFORM=neoforge sh deploy/scratch/scratch.sh up nf
        SCRATCH_NATS_AUTH_DIR=<same path> SCRATCH_PLATFORM=neoforge sh deploy/scratch/scratch.sh probe nf

   `up` checks five files and accepts the six-file dir. `probe` checks six and refuses with exit 2 and a message that
   names `nats-body.txt` if that file is missing or empty. Give `SCRATCH_PLATFORM` the value `up` used: the `nf` stack
   is NeoForge, and the probe's merged files must match its stack. `probe` also exits 2 when no container of the project
   is running, when the project has no NATS override (`up` was not run with an auth dir), when `nats`, `velocity` or
   `paper` has no healthy container (the message names the service), or when `SCRATCH_PLATFORM` is not `paper` or
   `neoforge`. Nothing starts in any refusal. The probe runs with `--no-deps`, so compose does not check the health
   of those services; the verb does.
5. Keep the probe's output: stdout and stderr both (`2>&1`). The verb passes the probe's exit code through. Exit 2 from a
   message that starts `scratch:` means the verb refused before compose ran; exit 2 from a message that starts
   `p0 probe refused:` means the probe's isolation check refused.
6. At teardown run `sh deploy/scratch/scratch.sh down nf`, remove the probe image (see "The probe image" below), then delete both temp dirs. The six-file dir holds the
   password-bearing `nats-auth.conf` and `nats-body.txt`; delete it even when the probe failed. `down` never removes it.

What the probe prints. The header comment of `golem/src/p0/probe.ts` is the reference for these lines; re-check it
against the file before a run. As of this section:

- stdout, in order:
  - `p0 join ok name=ag_nfprobe_01 uuid=<uuid>` once the Body has joined. Match the username and UUID in the logs below;
  - `p0 goto <state> status=<n> latency_ms=<n>`, then `p0 mine <state> status=<n> latency_ms=<n>`, each with
    ` reason=<text>` when the action gave one. The run passes only when both states are `completed`;
  - `p0 interrupted by SIGINT` or `p0 interrupted by SIGTERM`, if a signal arrived;
  - `p0 cleanup registry=<removed|failed> whitelist=<removed|failed>`. It is printed on every run that reaches the cleanup,
    and it is the second-to-last stdout line. It is the cleanup's receipt for the registry and whitelist entries;
  - `p0 verify registry=<absent|present|unknown>`. It is the last stdout line, printed on every run that reaches the
    cleanup. It reads the probe's registry key back after the cleanup, with the probe's own credentials, and does not
    trust the delete call. `absent` means the key is gone (no entry, or a delete marker); `present` means the key still
    holds an entry; `unknown` means the read failed or did not answer within 10 s. It never prints a value.
- stderr (capture it too):
  - `p0 disconnect failed: <reason>`, `p0 registry delete failed: <reason>` or `p0 whitelist remove failed: <reason>`,
    one per failed cleanup step, printed before the cleanup line;
  - `p0 failed: <reason>` for the first failed step (admission, registry put, join, goto, mine, or a signal), printed
    after the cleanup line and before the verify line;
  - `p0 verify failed: <reason>` only when the verify is `unknown`, printed before the verify line;
  - `p0 heartbeat failed for <username>: <reason>` when a registry heartbeat fails during the run;
  - `p0 probe refused: <rule>` for an isolation refusal. Nothing else is printed, and nothing is opened.
- Exit codes: 0 only when join, goto and mine completed, both cleanup entries were removed, the disconnect was ok and
  the verify is `absent`; 1 for any other run that started (a failed step, a signal, a failed cleanup step, a verify
  that is `present` or `unknown`); 2 for the isolation refusal. There is no separate exit-reason line: the reason for a
  non-zero exit is the `p0 failed:` or `p0 verify failed:` line on stderr, a `failed` cleanup line, or a `present` or
  `unknown` verify line.
- Operator expectation: a passing run ends with `p0 verify registry=absent` and exit 0. A `present` verify means the
  delete did not take effect: record the run and check the bucket by hand before calling the probe clean. An `unknown`
  verify means nothing was learned about the key, so it is not a pass. The key also expires on its own about a minute
  after its last put, so a later look at an absent key does not prove this run's delete; the verify line is the proof.
- Observed: `p0 verify registry=absent` as the last stdout line, with exit 0, in run 8b (one run, 2026-11-17).
  UNVERIFIED: an `absent` read of a key that expired on its own (run 8b read a deleted key); a second probe run; the
  `present` and `unknown` outcomes.

Comparing the username and UUID with the server logs (the grep forms are unverified on the 26.1 server logs; record the
raw output with the run, not a summary):

    docker logs scratch-nf-paper-1 2>&1 | grep -i '<username>'
    docker logs scratch-nf-paper-1 2>&1 | grep -i '<uuid>'
    docker logs scratch-nf-velocity-1 2>&1 | grep -i '<username>'

The username should appear in the Velocity log at the join and in the Paper log at the login, with the same UUID. A
mismatch in either is a failure to report, even if the probe exited 0. The container names are the compose names for
the `scratch-nf` project; confirm them with `docker ps` first (unverified until a node run).

Cleanup expectations: the probe removes its registry entry and its whitelist entry on every exit, including failure
and a signal. Confirm both after the run, with the stack still up:

    docker exec scratch-nf-paper-1 rcon-cli whitelist list

The probe's username must not be in that list. On the NeoForge platform the whitelist is off, so the probe's `whitelist add` and `whitelist remove` are harmless: the server accepts both, and a remove of a name not on the list replies `Player is not whitelisted`, which the probe accepts. For the registry, the probe's cleanup line (`p0 cleanup registry=...`) is the
record, and its verify line (`p0 verify registry=...`) is the read-back; no operator-side read of the key is verified yet. If the whitelist still lists the probe's username, or the
cleanup line says `failed`, record it as a finding and keep the stack up for inspection before `down`.

The probe image. `probe` builds `geldar-body:<project>` (for example `geldar-body:scratch-nf`). That is a custom tag, so
`down --rmi local` does not remove it, and the probe overlay is not in the `down` file set. `down` therefore leaves the
image behind, one per suffix. After `down` has finished (this prints nothing: `docker ps -a --filter label=com.docker.compose.project=scratch-nf`),
ops removes it by hand:

    docker images geldar-body
    docker rmi geldar-body:scratch-nf
    docker images geldar-body

The second `docker images` must not list the `scratch-nf` tag. `docker rmi` deletes the image only when no other tag
refers to it. This cleanup is not verified on a node run.

The probe never touches colo. Its overlay is added only by the `probe` verb, and only to a `scratch-<suffix>` project.
Its password files are scratch-only and come from the clean export. Nothing it prints is a secret: no password, token or
RCON value appears in its output, and none may be pasted into a report.

## Follow-ups for the owner

- Velocity runs as root on live and on scratch. The `itzg/mc-proxy` image drops privilege only when `$UID` is 0, and then to
  a hardcoded `bungeecord` user (uid 1000), so our `UID=1001` leaves it root (see the process-uid check above). Live colo sets
  the same UID and GID (`compose/colo.yml`, per ops lines 170-172). The comment there, and the velocity block in
  `compose/opt-in/scratch.yml`, say the itzg image "starts as root and drops to this uid". That is true for the Paper image and
  not for mc-proxy. A compose change on live is a deploy change and the owner's call; this PR does not edit the compose files.
- The Proxy Compatible Forge config owner: run 4 saw uid 1000 on a mode 600 file against the Paper JVM's 1001. The mode is the
  requirement and the owner is recorded. Cause unverified (the itzg/minecraft-server remap). The owner decides whether it must match.
- Our own mod loaded on a dedicated server once (run 7; see Mounting the mod jar). It does nothing yet and adds no payloads.
  Not yet exercised: a second start with the jar mounted, many Bodies, a human client.
- The runbook has no step for a second probe on one stack or for a Paper restart. None was run. Write and review such a
  step before any run does either.

## Building the mod jar

Build the jar on the desktop when `neoforge/` changes and a scratch NeoForge run needs it. To put the jar into the server, see
"Mounting the mod jar"; this section only produces the jar, its sha256 and a build-info file. Build from a clean export of `main`,
never from the live checkout, as the nats-auth section does.

1. Export `main` into an empty directory (absolute path). Take the commit first, so the build records the commit that was
   exported. Keep `COMMIT` set in the shell for step 2:

   ```
   git fetch origin
   COMMIT=$(git rev-parse origin/main)
   git archive --format=tar --prefix=geldar/ -o <absolute-file>.tar "$COMMIT"
   tar -tf <absolute-file>.tar        # stop if any entry is absolute or contains ..
   tar -xf <absolute-file>.tar -C <empty-dir>
   ```

2. Build. The output dir is absolute and absent or empty. Pass the commit from step 1 as `GELDAR_MOD_BUILD_COMMIT` (exactly
   40 lowercase hex):

   ```
   GELDAR_MOD_BUILD_COMMIT=$COMMIT GELDAR_MOD_BUILD_FROM_EXPORT=1 sh <empty-dir>/geldar/deploy/scratch/build-neoforge-mod.sh <absolute-output-dir>
   ```

   The script runs the pinned Gradle wrapper with the single task `build`, and dependency verification stays on. It needs Java 25
   and network for the first build. It prints the jar's sha256 and size. In a git checkout (a `.git` in the tree) the script
   refuses unless `neoforge/` has no changes and no untracked files, so the export mode is only for a tree without `.git`.
   Export mode also refuses unless `GELDAR_MOD_BUILD_COMMIT` is exactly 40 lowercase hex; build-info then records
   `commit=<sha> (export)`. The script clears `GRADLE_OPTS`, `JAVA_TOOL_OPTIONS`, `JDK_JAVA_OPTIONS`, `_JAVA_OPTIONS` and
   `GRADLE_USER_HOME_OPTS` before it runs. A `~/.gradle/gradle.properties` that switches verification off is not cleared, so
   build on a desktop without one.

3. Compare the sha256 by a second channel. Read it from the desktop output or from `geldar-neoforge.jar.sha256`, send it to the
   node by a route other than the copy, and run `sha256sum geldar-neoforge.jar` there. The two must match, as for the bundle.

4. Copy only the jar and its `.sha256` to the node (scp or similar): `geldar-neoforge.jar` and `geldar-neoforge.jar.sha256`.
   Never copy the build dir (`neoforge/build/` or the export tree).

The output holds `geldar-neoforge.jar`, `geldar-neoforge.jar.sha256` (the sha256 in `sha256sum` format) and
`geldar-neoforge.build-info`: the commit (for an export, `<sha> (export)` with the sha from step 1), the UTC build time, the Gradle wrapper version, the first line of
`java -version`, and the jar's sha256 and size. Each build records its sha256 in those two files. The hash is not pinned in the
repo: a pin would go stale on every change to `neoforge/`, so the run's brief states the hash it used.

The script refuses, and writes no jar: a relative or non-empty output dir; a dirty tree or an untracked file under `neoforge/`; an export without a valid
`GELDAR_MOD_BUILD_COMMIT`; a build that leaves no jar or more than one (the one that is not `-sources` or `-javadoc`); a jar
without `META-INF/neoforge.mods.toml`, or one that packs in `.java` sources. A failed build writes nothing, and a failure after
the jar is copied removes the files it wrote.

Run 7 (2026-11-17) loaded the mounted jar on a dedicated server, once. If the server fails to load the
mod, record that as a finding in the run's report. It is not a fault in `build-neoforge-mod.sh`.

## Extra mods (BlueMap, Chunky) on scratch

`sh deploy/scratch/scratch.sh` mounts the two optional jars on the NeoForge project when `SCRATCH_EXTRA_MODS=1`. The hook is
`deploy/scratch/scratch-extra-mods.sh`; the overlay is `compose/opt-in/scratch-neoforge-extra-mods.yml`. With the variable unset,
nothing changes. The overlay is added only for `SCRATCH_PLATFORM=neoforge`, to every verb of that project (up, status, down,
probe). Paper projects never get it.

Commands (replace the placeholders; the NeoForge variables of the section above apply as well):

```sh
export SCRATCH_PLATFORM=neoforge
export SCRATCH_EXTRA_MODS=1
export SCRATCH_EXTRA_CHUNKY_JAR_HOST=<absolute path of the Chunky jar on this node>
export SCRATCH_EXTRA_BLUEMAP_JAR_HOST=<absolute path of the BlueMap jar on this node>
export SCRATCH_NATS_AUTH_DIR=<absolute path of the NATS auth directory>
sh deploy/scratch/scratch.sh up <suffix>
sh deploy/scratch/scratch.sh down <suffix>
```

Both host variables are required, and each must name an absolute path (forward slashes; no quotes, backslashes or dollar
signs), a readable, non-empty regular file (not a symlink) whose sha256 equals its pin in `compose/neoforge/extra-mods.pins`.
`up` checks all of this on the host and refuses with exit 2 before any docker call. `SCRATCH_EXTRA_MODS` must be `1` or unset,
and `SCRATCH_PLATFORM` must be `neoforge`. `down` and `status` never refuse on these variables.

Privacy rule: never run BlueMap on scratch without its config seeding. `up` refuses with `SCRATCH_EXTRA_MODS=1` when
`compose/neoforge/extra-mods-bluemap-config.sh` is absent from the tree you run it from. Run the scratch stack from a tree that
contains the config seeding change (`git show origin/main:compose/neoforge/extra-mods-bluemap-config.sh` must succeed). On
origin/main before that change is merged, `up` refuses by design.

Not automated here: the scratch web overlay for the player-privacy 404 check. That belongs to the BlueMap team and
`docs/runbooks/map-neoforge.md` (section 2.0). The open items there are OI-2 (a clean export, the built jars, the NATS auth
directory, the secrets and the images) and OI-3 (the render syntax). This section adds no `--no-start` or create-only mode:
`scratch.sh` still starts the project when `up` passes its checks.

## Mind test on the scratch stack

This section runs one Claude Mind against one test player on a scratch stack (`compose/opt-in/scratch-mind.yml`, option A' in `docs/analysis/neoforge/mind-scratch-design.md`). Nothing here is a default: a plain `up` never starts a mind service. Every step that touches the Colo node needs the owner's direct approval first. The Mind host is reached only through the owner's ssh forward (step 6), never by any other route.

Placeholders: `<suffix>` is the scratch suffix, `<auth dir>` the NATS auth dir, `<local port>` the desktop port, `<mcp port>` the loopback MCP port on the node (the `SCRATCH_MCP_PORT` in `deploy/scratch/<suffix>.env`, default 18788), `<node-ssh-host>` the node's ssh name, `<secrets dir>` the scratch secrets dir (`$STATE_ROOT/geldar-scratch/scratch-<suffix>`). Never paste a real token, address or account name into chat or into the repo.

1. Make the NATS auth dir in a clean export, not in `compose/secrets/` (scratch must not write there). It needs the five `up` files plus `nats-mcp.txt` and `nats-body.txt`, non-empty, from `./geldar.ps1 shard nats-auth phase0` (UNVERIFIED that phase0 emits the two mind files; if it does not, stop). Set `SCRATCH_PLATFORM=neoforge` and `SCRATCH_NATS_AUTH_DIR=<auth dir>`, and `SCRATCH_MCP_PORT=<mcp port>` in `deploy/scratch/<suffix>.env`.
2. `sh deploy/scratch/scratch.sh up <suffix>`. Wait until postgres, nats, velocity and paper are healthy.
3. `sh deploy/scratch/scratch.sh mind-up <suffix>`. It writes `postgres-mcp.txt` and `mcp-token-pepper.txt` (random, 0600, never printed), sets the `geldar_mcp` login password through `admin.sh migrate --set-role-password` (UNVERIFIED that the superuser login in the admin image connects as this compose project), then starts `geldar-mcp` and `players-host` for the test player `ag-test-01`. The images `geldar-mcp:c1`, `geldar-body:c1` and `geldar-admin:c1` are built by the overlay's `build:` entries (UNVERIFIED that this works on the node without a prior build).
4. Whitelist the test player on Paper over RCON, read-only except this one line: `docker exec scratch-<suffix>-paper-1 rcon-cli whitelist add ag-test-01`. Check it with `docker exec scratch-<suffix>-paper-1 rcon-cli whitelist list`. On the NeoForge platform (`SCRATCH_PLATFORM=neoforge`) the server whitelist is OFF (owner decision 2026-11-17, decision 0387, set in `compose/opt-in/scratch-neoforge.yml`), so this add is harmless and the join does not need it; the list then shows the entry without enforcing it. On Paper the whitelist stays on. The Minecraft name the Body joins as is UNVERIFIED (the roster gives the id `ag-test-01`); if `players-host` logs a refused join before this step, the join is UNVERIFIED to retry, so restart `players-host` after the whitelist.
5. `sh deploy/scratch/scratch.sh mind-token <suffix> ag-test-01`. It prints one line, `minted token <token id> for ag-test-01 to <secrets dir>/mind-token.txt`. The token itself is never printed, read or logged by the script. A second run refuses while the file exists.
6. The owner, not the agent, starts the forward on the owner's desktop and copies the token to the Mind host: `ssh -N -L <local port>:127.0.0.1:<mcp port> <node-ssh-host>`, and for the token `ssh <node-ssh-host> 'cat <secrets dir>/mind-token.txt' > <local mode 600 file>` (UNVERIFIED transfer method; the file must be mode 600 on the owner's side and must not be printed). The Mind's session gets the dev seam URL (`GELDAR_DEV_MCP_URL=http://127.0.0.1:<local port>`) and the token from that file.
7. Checks, in order, from `docs/analysis/neoforge/mind-route.md` section 6. Keep a run record for each: stack health (every service healthy, the only published port is the loopback MCP port, no 25565 or 25566); no token gives 401 and the token of another player gives 403, both through the forward; the MCP tool list; one look; one goto (check the position with read-only RCON `data get` or `execute if` only); a grep of the transcript and every tool result for telemetry field names and observer wording; the abort paths (expired or wrong token 401 with no action, goto to an unreachable block gives an error text, Mind stops mid-call and the Body stops moving (UNVERIFIED)). Start each live case with an empty journal and a set-up world.
8. Revoke the test token on the owner's side when the test ends (UNVERIFIED that the mint tool's revoke verb covers the scratch database), then `sh deploy/scratch/scratch.sh down <suffix>`.

`down` runs `compose down -v --rmi local --remove-orphans` (the mind services are removed with the stack because `--remove-orphans` drops containers the compose file no longer defines; UNVERIFIED on a live node), then removes the scratch secrets dir, and with it `postgres-mcp.txt`, `mcp-token-pepper.txt` and `mind-token.txt`. It exits 1 if any volume is left. The NATS auth dir is the operator's and is not removed. Mind services declare no named volume, and the `geldar-*:c1` images are shared tags that `--rmi local` does not remove.

Not in this section: the human client route (option B), the desktop variant (A), and any change to the live Colo mind (`shards/colo-mind.yaml`).
## Human listener on the scratch stack

When to use it: when a human player (a real Microsoft account, the vanilla client) must join the NeoForge scratch shard to check the online-mode path. It is opt-in and off by default.

Start it with the NeoForge platform, the NATS auth dir and the lane variable:
`SCRATCH_PLATFORM=neoforge SCRATCH_NATS_AUTH_DIR=<dir> SCRATCH_HUMAN_LANE=1 sh deploy/scratch/scratch.sh up nf`. The script refuses with exit 2, and starts nothing, for SCRATCH_PLATFORM=paper, a missing NATS auth dir, or any value of SCRATCH_HUMAN_LANE other than 1. `status` and `down` work with or without the variable.

What starts: the service `velocity-human` (compose/opt-in/scratch-human.yml, config compose/velocity/velocity-human.toml). It is a second Velocity with online-mode = true, so Mojang authentication decides the account and its UUID. It is its own container with its own data volume. It uses the existing scratch secrets only: the forwarding secret and the velocity NATS user (the registry read that refuses agent names). It adds no NATS role and no secret. Its identity plugin runs with GELDAR_IDENTITY_LANE=human. The bot ingress (`velocity`) is unchanged and stays offline-mode.

Ports: loopback only, 127.0.0.1:${SCRATCH_HUMAN_PORT}. The default is 35566; deploy/scratch/nf.env sets 55566 for the nf project. Caps: 0.5 CPU, 768m memory with no swap, 256 pids, restart no, label geldar.scratch=true. Nothing is published on a public address.

Connecting: the owner opens an SSH tunnel from the owner's machine to the loopback port on the host (`ssh -L <local-port>:127.0.0.1:<human-port> <host>`), then the vanilla client connects to localhost on the local port. A vanilla client with a real Microsoft account should see the normal Mojang sign-in, then the shard.

Checks (UNVERIFIED until run on a host; record each result):
1. Join with an ordinary account name: the join succeeds and the player shows in the Paper player list.
2. Join with an agent-shaped name (a name the identity plugin's human lane refuses, see plugin/velocity-identity): the join is refused by the identity plugin.
3. The UUID the server logs for the join is the online UUID (Mojang's), NOT the offline-mode UUID derived from the name. Record both lines: the velocity-human join line and the Paper join line, each with its UUID, and the offline UUID for comparison.

What to capture: the velocity-human and Paper log lines for checks 1 to 3 and the health of the velocity-human container. Redact account names, IP addresses and any token before the lines leave the host. Never capture secret files.

Node steps need the owner's approval: any run on a node, a tunnel to a node, and any change to the public port or the SRV record. Nothing here is public: the port is loopback only, and the public game port by SRV record is a separate owner decision that is not made.

### Ledger jar and OTel agent on the scratch NeoForge stack

Opt-in, NeoForge only (`SCRATCH_PLATFORM=neoforge`). The overlay is `compose/opt-in/scratch-neoforge-ledger.yml`, added by `deploy/scratch/scratch-ledger.sh` only when one of these variables is set. Unset, the default render is unchanged.

| Variable | Meaning |
|---|---|
| `SCRATCH_NEOFORGE_LEDGER_JAR` | Absolute path to the ledger jar, built from `neoforge-ledger/`. Both this and the hash, or neither. |
| `SCRATCH_NEOFORGE_LEDGER_SHA256` | The ledger jar's sha256, 64 lowercase hex digits. |
| `SCRATCH_LEDGER_PROPS` | Absolute path to the ledger config file. The entrypoint copies it into the container's `config/ledger.properties` at every start. |
| `SCRATCH_NEOFORGE_OTEL_AGENT_JAR` | Absolute path to the OpenTelemetry Java agent jar. Not `SCRATCH_OTEL_AGENT_JAR`, which is the Paper telemetry variable (`docs/runbooks/scratch-telemetry.md`). |
| `SCRATCH_NEOFORGE_OTEL_AGENT_PROPS` | Absolute path to the agent properties file. |
| `SCRATCH_NEOFORGE_TELEMETRY` | `off` alone is the soft kill (see below). Otherwise the five variables above are all set, or none is. All five set `GELDAR_NF_TELEMETRY=on` in the container. |

The agent's sha256 has no host variable: its pin is the repo constant `GELDAR_NF_OTEL_AGENT_SHA256` in `compose/opt-in/scratch-neoforge-ledger.yml`.

What `up` checks, before any docker call, and exits 2 with nothing started: the platform is neoforge; each path is absolute, has no newline, quotes, backslashes or dollar signs, and is a readable regular file (not a symlink); each hash is 64 lowercase hex digits; an agent path contains no whitespace (the entrypoint splits `JVM_OPTS` on it); the host sha256 of the ledger jar equals `SCRATCH_NEOFORGE_LEDGER_SHA256`, and the host sha256 of the agent jar equals the repo constant `GELDAR_NF_OTEL_AGENT_SHA256`. `down` and `status` never refuse on these variables. The container checks the same pins again (`compose/neoforge/neoforge-entrypoint.sh`) and refuses to start on a mismatch.

Staging. The ledger jar comes from `neoforge-ledger/` through `deploy/build-neoforge-ledger.sh`, which writes `neoforge-ledger-0.1.0.jar`. The host path to that jar is what `SCRATCH_NEOFORGE_LEDGER_JAR` takes; the overlay mounts it as `/geldar/mods/geldar-neoforge-ledger.jar`. The agent jar comes from the agent's release, downloaded by the owner; its pin is the repo constant `GELDAR_NF_OTEL_AGENT_SHA256`, and nothing in this repo fetches the jar. The agent is mounted under `/geldar/telemetry/`. The properties files (`SCRATCH_LEDGER_PROPS` and `SCRATCH_NEOFORGE_OTEL_AGENT_PROPS`) are written on the host. They are neither pinned nor checked by any script: they control the export endpoint, so their content is the operator's to get right.

The OTLP endpoint is whatever the agent properties file says. Nothing here sets an endpoint. Nothing is public: the overlay declares no network and no published port, and the scratch stack stays on its own project network.

Soft kill. `SCRATCH_NEOFORGE_TELEMETRY=off` alone is the soft kill, and it works in scratch. It renders `compose/opt-in/scratch-neoforge-ledger-off.yml`: one environment key on `paper` (`GELDAR_NF_TELEMETRY=off`), with no mount and no network. The entrypoint's `off` branch removes only the container's own earlier copy of the ledger jar (a regular file or a symlink, unlinked without following it) and starts without the ledger, so a stale copy left in the data volume no longer stops the start. A directory at that path is refused with exit 1 and nothing inside it is removed. Off adds no agent flag, sets `OTEL_SDK_DISABLED=true` and unsets `JAVA_AGENTS` and `OTEL_JAVAAGENT_CONFIGURATION_FILE` in the start environment. `SCRATCH_NEOFORGE_TELEMETRY=off` together with any of the five variables exits 2 before any docker call (contradictory). `down` and `status` never refuse on it (see `docs/analysis/neoforge/ledger-extras-entrypoint.md`).

JVM_OPTS, not JAVA_AGENTS. The agent is added to `JVM_OPTS`. On the pinned image, `start-finalExec` (lines 634-635 of its start script) writes `JVM_OPTS` into `user_jvm_args.txt` on every start for NeoForge. `JAVA_AGENTS` is not used: it goes through `addAgents` and `mc-image-helper mcopy`, which is a download list. UNVERIFIED: that the agent attaches (the scratch run shows it in `ps` and the logs), and that NeoForge's `run.sh` reads `user_jvm_args.txt` (`start-deployNeoForge` is not confirmed). The properties files are neither pinned nor checked. They control the export endpoint.

Rename table. Names from the first draft are gone from the code, the overlays and this runbook:

| Old | New |
|---|---|
| `SCRATCH_OTEL_AGENT_JAR`, `SCRATCH_OTEL_AGENT_PROPS` (first draft) | `SCRATCH_NEOFORGE_OTEL_AGENT_JAR`, `SCRATCH_NEOFORGE_OTEL_AGENT_PROPS` |
| `SCRATCH_OTEL_AGENT_SHA256` | removed: the pin is the repo constant `GELDAR_NF_OTEL_AGENT_SHA256` |
| `GELDAR_NF_OTEL_AGENT=0\|1` | `GELDAR_NF_TELEMETRY=on\|off` |
| literal `GELDAR_NF_LEDGER_SHA256=off` (soft kill) | `GELDAR_NF_TELEMETRY=off` in the container; host `SCRATCH_NEOFORGE_TELEMETRY=off` |
| `/opt/otel/*` | `/geldar/telemetry/*` |
| nested bind of the ledger config at `/data/config` | mount at `/geldar/telemetry/ledger.properties`, copied to `/data/config/ledger.properties` at every start |
| `geldar-ledger.jar` | `geldar-neoforge-ledger.jar` |

The design notes are in `docs/analysis/neoforge/ledger-extras-entrypoint.md`.

### Telemetry sink on the scratch NeoForge stack

The agent above exports to `http://geldar-gateway:4318` (`compose/neoforge/otel-agent.properties`); the scratch stack has nothing of that name unless you ask for it. `SCRATCH_NEOFORGE_TELEMETRY_SINK=1` (NeoForge only) adds `compose/opt-in/scratch-neoforge-telemetry.yml`, layered after the ledger and mod overlays: a throwaway OTLP/HTTP receiver, service `otel-sink`, that answers as `geldar-gateway` on the scratch project network only, so the properties file works unchanged. It is a copy of the Paper scratch sink (`compose/opt-in/scratch-telemetry.yml`: same pinned image digest, same config, 512m and 0.5 CPU, runs as `SCRATCH_RUN_UID:SCRATCH_RUN_GID`). It publishes no port and declares no network. The NeoForge service (named `paper` in these overlays) starts after it. Unset (the default), no render changes.

`up` needs `SCRATCH_TELEMETRY_OUT`: an absolute path with no newline, quotes, backslashes or dollar signs, naming an existing writable directory that is not a symlink. Any other value of the sink variable than `1`, a non-neoforge platform, or a bad directory exits 2 before any docker call. `down` and `status` never refuse on these variables; they pass the overlay when the values are well formed, so export the same variables for them. The sink writes `otlp.jsonl` in that directory, which is what `deploy/scratch/telemetry-verify.sh` reads (no change needed there).

Start sequence for a NeoForge telemetry run (from the repository root, in a clean export as for any scratch run):

```
export SCRATCH_PLATFORM=neoforge
export SCRATCH_NATS_AUTH_DIR=<absolute node dir with the five NATS auth files>
export SCRATCH_NEOFORGE_MOD_JAR=<abs path of the mod jar>  SCRATCH_NEOFORGE_MOD_SHA256=<64 hex>
export SCRATCH_NEOFORGE_LEDGER_JAR=<abs path of the ledger jar>  SCRATCH_NEOFORGE_LEDGER_SHA256=<64 hex>
export SCRATCH_LEDGER_PROPS=<abs path of the ledger config>
export SCRATCH_NEOFORGE_OTEL_AGENT_JAR=<abs path of the agent jar>  SCRATCH_NEOFORGE_OTEL_AGENT_PROPS=<abs path of compose/neoforge/otel-agent.properties or a copy>
# all five or none; there is no agent hash variable (the pin is a repo constant)
export SCRATCH_TELEMETRY_OUT="$HOME/.local/state/geldar/scratch-nf-telemetry-out"   # absolute, outside the repo
mkdir -p "$SCRATCH_TELEMETRY_OUT"
export SCRATCH_NEOFORGE_TELEMETRY_SINK=1
sh deploy/scratch/scratch.sh up nf          # hashes are checked on the host first; any refusal exits 2 and starts nothing
sh deploy/scratch/scratch.sh status nf
# wait at least two export intervals (15 s each), then:
sh deploy/scratch/telemetry-verify.sh event <name>      # or metric / max / histcount / absent, as in scratch-telemetry.md "Verify"
sh deploy/scratch/scratch.sh down nf        # same exports; removes containers, volumes and the project's secrets
```

Teardown leaves `"$SCRATCH_TELEMETRY_OUT"` in place on the host (it is yours); remove its `otlp.jsonl` before the next run so the verify counts start from zero, or use `SCRATCH_TELEMETRY_SINCE_LINE`. `down` removes the `otel-sink` container with the rest of the project. The sink variable does not turn the agent on: the five variables above do, and with the agent off the sink stays empty. The sink is compatible with the soft kill: `SCRATCH_NEOFORGE_TELEMETRY=off` refuses only together with the five ledger and agent variables, not with `SCRATCH_NEOFORGE_TELEMETRY_SINK=1`, so `off` plus the sink gives a run in which the receiver is up and the verify script can show that nothing was exported (`absent`).
