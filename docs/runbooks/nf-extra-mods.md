# Optional extra mods on the live NeoForge shard

This runbook covers the mechanism for optional mod jars on the live NeoForge project (compose/nf-live.yml): each mod is pinned by
sha256 in the repository, enabled per node by an environment variable, and copied into the server's mods/ folder by the
entrypoint only when its jar matches the pin. The first users are Chunky 1.5.66 (pregeneration) and BlueMap 5.29 (live map).
Neither is enabled by this change: the default render and the default `up` are unchanged.

Status: the mechanism is built and tested without a running server. Whether the NeoForge server loads a jar copied this way is
UNVERIFIED until a run proves it (see the last section).

## What is in the repository

- compose/neoforge/extra-mods.pins: the allowlist and the pins. One line per mod:
  `<name> <sha256-lowercase-hex> <jar-file-name> <version>`, fields separated by one space. Lines starting with `#` are comments.
  The names in this file are the whole allowlist. A mod that is not listed cannot be enabled.
- compose/nf-live-mod-chunky.yml and compose/nf-live-mod-bluemap.yml: one overlay per mod. Each adds to the neoforge service only
  the pin as an environment constant (GELDAR_NF_EXTRA_<NAME>_SHA256) and one read-only bind mount at
  /geldar/extra-mods/<name>.jar, with create_host_path false (a missing host file fails the start). They join no network and
  publish no port. A test asserts each constant equals the pins file.
- deploy/nf-extra-mods-lib.sh: the host-side checks, sourced by deploy/nf-deploy.sh.
- compose/neoforge/neoforge-entrypoint.sh: the copy into mods/ (see "The entrypoint" below).

## Enabling a mod on a node

Set these in the node's environment (never in the repository):

- `NF_EXTRA_MODS`: the names to enable, separated by commas or spaces, for example `chunky` or `chunky,bluemap`. Unset or empty
  enables nothing, and every compose call is then the same as before.
- `NF_EXTRA_<NAME>_JAR_HOST` for each enabled name: the absolute host path of the jar. For example
  `NF_EXTRA_CHUNKY_JAR_HOST=/srv/geldar/mods/Chunky-NeoForge-1.5.66.jar` (the path is an example, not a real one).

`deploy/nf-deploy.sh` refuses before any docker call when: a name is not in the allowlist; a name is given twice; an entry is
empty (a leading, trailing or doubled comma); a character other than letters, digits, underscore, comma and space appears; the
host path is unset, relative, not a regular file, a symlink, or under a symlinked directory; or the file's sha256 is not the
pin. Only the file names and the fixed messages are printed, never the jar's bytes.

`plan` prints one line per enabled mod with its version and the first 12 digits of its pin, and `up` adds the overlay
`compose/nf-live-mod-<name>.yml` after the others.

## Adding a mod (the checklist)

1. The release is at least 14 days old when it is pinned.
2. Download the jar once, outside the repository, and take its sha256 (`sha256sum` on Linux, `Get-FileHash -Algorithm SHA256`
   on Windows). Compare it with the publisher's published hash where there is one.
3. Read the mod's `mods.toml` (or `neoforge.mods.toml`) and confirm the modId, the loader (neoforge) and the Minecraft version
   range match the shard (NeoForge 26.1.2, Minecraft 26.1).
4. Record the license and confirm it allows running it on a private server.
5. Add a line to compose/neoforge/extra-mods.pins, and a matching overlay compose/nf-live-mod-<name>.yml (copy an existing one:
   the image line, the constant and the mount path all change). The entrypoint's `extra_prep` and `extra_copy` calls must name
   the mod too; a test fails until they do.
6. Run `./geldar.ps1 check` (the mod's overlay must render alone, with no environment).

## The entrypoint

On every start, for each allowlisted mod:

- Before the bundle check, a stale copy at /data/mods/<name>.jar is removed. A symlink or a directory there stops the start,
  and nothing is removed.
- After the bundle check, when the overlay is in place, the mounted jar is hashed against its pin, copied to a .part file, mode
  644, owned like the other data files, hashed again and renamed. A mismatch leaves no .part and no final file, and stops the start.
- A mounted jar with no pin, or a pin with no mounted jar, stops the start.
- When the mod is not enabled, nothing is copied. With the feature off, only a copy at mods/<name>.jar that is equal to the pin is
  removed on the next start. A different file at mods/<name>.jar makes the start refuse, and nothing is deleted. Files the mod wrote
  in the world or config folders are not removed.
- An offline bundle list that names chunky.jar or bluemap.jar is refused by the entrypoint's mods/ check, after the stale removal.

## Rollback and disabling

To disable a mod, remove its name from `NF_EXTRA_MODS` (or unset the variable) and run `up`. The overlay is no longer added, so
the mount and the environment constant go, and the entrypoint removes /data/mods/<name>.jar when that file is a copy equal to the
pin (a different file there makes the start refuse). The mod's world and config data stay.

Important: enabling or disabling a mod CHANGES the neoforge service's mount and environment set, so `up` RECREATES the neoforge
container. That is a restart of the game server, with the players disconnected. Plan it like any other restart. The same
applies to the first enable.

## Keep NF_EXTRA_MODS in the ops env file

There is no wrapper script and no shell profile. Ops keeps a plain shell env file in the ops user's home on the node: one per
bring-up, timestamped, in private mode. Ops sources that file by name before every run of the deploy script. The file holds
NF_TELEMETRY and its pins, NF_MOD_JAR_HOST, NF_MOD_SHA256 and similar. NF_SERVICE_UID, NF_HUMAN, NF_HUMAN_BIND and NF_HUMAN_PORT are
set in the shell for each run, not in the file.

To enable a mod, ops adds NF_EXTRA_MODS and NF_EXTRA_<NAME>_JAR_HOST to a NEW revision of that file, and sources it on every
plan, up, refresh-secrets and probe. The file is never committed, and no value from it goes in the repository. The first enable
or disable recreates neoforge (see above).

To remove the mods on purpose, type `NF_EXTRA_MODS=none` in the shell for that run. Without it, when the running neoforge container
still has extra mods mounted and NF_EXTRA_MODS is unset, plan, up, refresh-secrets and probe refuse, and the refusal names the mods.
status, logs and down are not checked.

## Staging a jar on the node

1. Create a directory readable only by the service owner (mode 700) outside the repository, for example
   `/srv/geldar/extra-mods`. Do not put it under a symlinked path.
2. Copy the jar in as a regular file. Do not create a symlink to it: the deploy refuses a symlink.
3. Run `sha256sum /srv/geldar/extra-mods/<file>.jar` and compare it with the pin in compose/neoforge/extra-mods.pins by eye and
   with `grep`. A mismatch means the wrong file: replace it, do not change the pin.
4. Set `NF_EXTRA_<NAME>_JAR_HOST` to the path, then run `plan` and read its extra-mod lines.

## Scratch stack

The scratch stack (docs/runbooks/scratch-stack.md) uses the same entrypoint, and deploy/scratch/scratch.sh does not add the extra
mods. The scratch overlay is compose/opt-in/scratch-neoforge-extra-mods.yml: it changes only the scratch service (paper, which runs
NeoForge in scratch), adds the two read-only mounts and both pin constants, and renders only merged with the scratch stack (the header of compose/opt-in/scratch-neoforge-extra-mods.yml lists the files; alone, it does not render). Both jars are
mounted, so both host variables must name real files for a start. The manual route, with the scratch variables set by hand:

    SCRATCH_EXTRA_CHUNKY_JAR_HOST=/srv/geldar/mods/Chunky-NeoForge-1.5.66.jar \
    SCRATCH_EXTRA_BLUEMAP_JAR_HOST=/srv/geldar/mods/bluemap-5.29-neoforge.jar \
    docker compose -p scratch-<suffix> -f compose/phase0.yml -f compose/opt-in/scratch.yml \
      -f compose/opt-in/scratch-neoforge.yml -f compose/opt-in/scratch-neoforge-extra-mods.yml ...

The deploy helper's sha256 check does not run on this route: check the two jars by hand (the checklist above) before `up`.

## Why a pin with no mounted jar refuses

A pin in the environment with no jar mounted is a mismatch between the overlay and the environment: either the overlay was left
out (the mod would silently not load) or the jar path is wrong. The start stops with one line, so the operator sees it. Refusing
also matches the ledger jar rule. The same stop applies to a mounted jar with no pin.

## UNVERIFIED

- Whether the NeoForge server loads Chunky 1.5.66 and BlueMap 5.29 when the jar is copied this way: only a run proves it.
- Whether each mod's own config or first-run behaviour needs anything beyond the jar: not checked.
- The sha256 of the Chunky jar was computed from the downloaded file; the BlueMap sha256 was supplied by its owner and has not
  been re-computed on the node.
- The scratch overlay is rendered only by the parse test (tools/repo-checks/src/scratch-neoforge-extra-mods.test.ts); no
  scratch stack was started with it.
