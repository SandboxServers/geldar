# The live NeoForge shard: compose project geldar-nf

Status: the compose file and its repo test exist (compose/nf-live.yml, tools/repo-checks/src/nf-live-compose.test.ts).
The geldar-nf project is deployed on the node. The human lane's first `up` was attempted on 2026-11-18: it failed at the
volume ownership step (section 10.7, step (c1)) and was stopped. After the owner-approved one-time ownership fix, the human lane
came up the same day and is OPEN: `velocity-human` publishes `<bind-ip>:<port>` on the owner's gateway, and players reach it through
the SRV name (section 10.8, "Node result"). The agent lane is still loopback only (`127.0.0.1:46565`). Caddy and the owner's gateway
are outside this repo (owner decisions for the final-instance step).

**THE NEOFORGE SHARD MUST NOT BE MADE PUBLIC BEFORE THE CONCURRENT-HUMAN CAP IS LIVE ON THE HUMAN PROXY.** The slot cap
merged as #726 is enforced in the identity plugin's human lane, but only on a human proxy that runs a jar built from main
containing #726 and #732 (section 3b). The cap of 5 from 0137 is dropped by owner decision (0388, ACCEPTED 2026-11-18,
"Amends 0137 for the NeoForge shard"): humans and agents share MAX_PLAYERS = 100. That shared limit of 100 is on main
(#732: `SHARD_MAX_PLAYERS = 100` in HumanSlots.java; `MAX_PLAYERS: "100"` in compose/nf-live.yml). The running geldar-nf
enforced MAX_PLAYERS 10 until the owner-approved node step that recreates neoforge at 100. Ops ran that step on 2026-11-18 (observed by ops; section 10.8);
until a jar with #726 and #732 runs on the human proxy and S1 (section 10.8)
passes, a public listener has no proven human bound: its only bound is MAX_PLAYERS, which counts bodies too.

The per-shard storage design is in docs/analysis/neoforge/per-shard-storage-design.md (one NATS, one Postgres database,
one sink per shard; see also docs/decisions/0026-one-database-per-shard.md). Read that first for why the shard is separate.

## 1. What the project is

- Project name `geldar-nf` (top-level `name:` in compose/nf-live.yml, so a plain `-f` call also lands here).
- Shard token `nf`. Its own NATS (JetStream), its own Postgres database `geldar_nf`, its own sink, its own network
  (`geldar-nf_nf`) and its own named volumes (`geldar-nf_*`). None is external. The file is not an overlay and names no
  other compose file.
- Services: `nats`, `postgres`, `eventsink`, `identity-seed` (one-shot), `velocity`, `neoforge` (the NeoForge 26.1.2 server
  with Proxy Compatible Forge for forwarding, bundle install, pinned mod jar). The `probe` one-shot (section 4c) is opt-in;
  `up` never starts it.
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
| 46575     | neoforge | 25575          | no | reserved: RCON is not published; inside Docker it is reachable from nf (and geldar-telemetry with telemetry), section 4c; the host port is unused |

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

## 3b. Player limits (pinned in compose/nf-live.yml; the running shard reaches these values at the node step)

The neoforge service pins three itzg variables in compose/nf-live.yml. The scratch overlay
(compose/opt-in/scratch-neoforge.yml, the paper service) pins MAX_PLAYERS 10 and is SCRATCH-ONLY: it does not follow the
live value. Names are the itzg image's, as the colo Paper uses them (compose/colo.yml and compose/phase0.yml).

| Variable | compose/nf-live.yml on main now | Live NeoForge after the owner-approved node step (ops ran it on 2026-11-18) | Autonomous Paper (compose/phase0.yml, unchanged) |
|----------|-------------------------------------|---------------------------------------------------------------------------|---------------------------------------------------|
| MAX_PLAYERS | 100 | 100 (humans and agents share it) | 400 |
| VIEW_DISTANCE | 8 | 8 (unchanged; NOT sized for 100 players) | 6 |
| SIMULATION_DISTANCE | 6 | 6 (unchanged; NOT sized for 100 players) | 5 |

The shared limit (#732) is on main. The running shard enforced MAX_PLAYERS 10 until the node step; ops observed 100 on 2026-11-18 (section 10.8).
The shard has NOT been sized for 100 players: the figures for 100 are unmeasured.

Reasoning. The vanilla world tick runs on one server thread (general Minecraft server behaviour, not measured here), so
3 CPUs do not raise the tick rate; the load is the loaded chunks and the ticked entities. Vanilla keeps about (2V+1)^2
chunks loaded per player at view distance V, and ticks entities in about (2S+1)^2 chunks per player at simulation
distance S. At the lead's example (20 players, view 10) that is about 441 chunks per player, up to about 8,800 in all
before overlap, which is too high for 3 CPUs on a shard whose first players are few. At 10 players, view 8, it is about
289 chunks per player, up to about 2,900; simulation 6 ticks 169 chunks per player against 289 at simulation 8. The 9G
heap and 12 GiB cap are unchanged (the colo Paper ratio). The memory figure for about 2,900 chunks is an estimate, not a
measurement: UNVERIFIED. Re-measure at the first start with `tick query` and the heap before raising any value. The owner
set MAX_PLAYERS to 100 by owner decision (0388). That figure is not measured here; a higher view or simulation distance needs the same re-measure first.

The image writes server.properties from these variables on each start (section 6, the bundle notes). That the NeoForge
server honours them is UNVERIFIED until a live start reads them back from its log or server.properties. The one exception is MAX_PLAYERS: ops observed `max-players=100` in /data/server.properties on 2026-11-18 (section 10.8).

Three things these values do not do, stated plainly:

- **The concurrent-human cap is the slot code merged as #726, and its capacity is now the shared limit of 100 (#732).**
  The cap of 5 from spec section 8.4 and decision 0137 item 1 is dropped for the NeoForge shard by 0388 (ACCEPTED). On
  main, `HumanSlots.SHARD_MAX_PLAYERS` is 100 (`plugin/velocity-identity/src/main/java/dev/geldar/identity/HumanSlots.java:24`).
  A human reserves one slot at the login decision. The slot belongs to the connection object, and the human gives it back
  on its own disconnect or on a refused login after the reservation. At 100 held slots the next human gets the generic
  denial; until the node step, the running shard's MAX_PLAYERS 10 is the lower bound. A UUID that already holds a slot is
  refused, and a refused duplicate frees nothing. On main today agents never take a slot. MAX_PLAYERS is a different
  number: it is 100 in the repo (`compose/nf-live.yml:280`) and bounds ALL players, bots included; the running shard
  enforced 10 until the node step, and 100 after it (observed by ops; section 10.8).
- **The cap binds only on a human proxy that runs that plugin build.** The node must run a jar built from main containing
  #726 and #732 before the lane is public (section 10, gate item 1). Until the human proxy runs it, no code enforces the cap.
- **Not built, and not part of #726:** per-IP limits, login rate limiting beyond Velocity's default, and an idle kick
  (held packet H1b, dropped by the owner on 2026-11-18; not built). An idle account can hold its slot, so idle accounts can
  fill the shared limit of 100 and block humans and agents joining. With no whitelist and a limit only at 100, a per-IP
  limit matters more, not less.
- **Slot release is OBSERVED for one join and leave (2026-11-18, section 10.8).** The count went 1/100 -> 0/100 on a
  disconnect, with no "release found no slot" warning. That shows the release path works for one sequential human. It does
  NOT show concurrency, the cap at 100, or that `DisconnectEvent` fires for every connection that ends after a login
  (0388 residual risk 4).
- **The NeoForge shard must not be made public before the cap is live on the human proxy** (the bold note at the top of
  this runbook).
- **The show-max-players values are display only, and they now agree at 100.** compose/velocity/velocity-nf.toml shows
  100 (line 9) and compose/velocity/velocity-nf-human.toml shows 100 (line 12). Neither file is edited by this runbook. Whether Velocity refuses a login over its own count is UNVERIFIED (not checked in this packet). The real server
  cap is MAX_PLAYERS: 10 on the running shard until the node step, 100 after it.

## 4. Secrets

Per-project directory `compose/secrets-nf/` (gitignored; the repo ignore line is added). The file reads `${NF_SECRETS_DIR:-./secrets-nf}`.
Names, one file each, mode 0600, owned by the ops account (uid `NF_SERVICE_UID`, 1001 on this node; section 5):

The directory holds TEN files: the list is `SECRET_FILES` in `deploy/nf-deploy.sh`, and the generator writes exactly these ten.

- `nats-auth.conf` (the per-shard NATS server config; the server side of the six NATS users);
- six NATS password files, one per user: `nats-neoforge.txt`, `nats-sink.txt`, `nats-deploy.txt`, `nats-velocity.txt`, `nats-seed.txt`
  and `nats-body.txt` (the users neoforge, sink, deploy, velocity, seed and body; body is the probe's, section 4c);
- `postgres.txt` (the Postgres password), `velocity-forwarding.txt` (the Velocity forwarding secret, shared with the NeoForge side),
  `rcon.txt` (the RCON password, section 4c).

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
5. Check the set: `compose/secrets-nf/` holds `nats-auth.conf`, the six NATS password files (`nats-neoforge.txt`, `nats-sink.txt`,
   `nats-velocity.txt`, `nats-deploy.txt`, `nats-seed.txt`, `nats-body.txt`), `postgres.txt`, `velocity-forwarding.txt` and `rcon.txt`, with no other file
   (ten names, the generator's full output).

**Copy to the node (the SAFE-EXPORT ends here on the desktop).**

6. Copy only the directory: `scp -r "$EXP/compose/secrets-nf" <ops account>@<node>:<node export>/compose/`. Use the ops account
   so the files arrive owned by its uid (1001, section 5). Do not copy the rest of the export.
7. On the node, as the ops account, set the modes explicitly (scp does not keep them): `chmod 700 <dir>` and
   `chmod 600 <dir>/*`. Then check `stat -c '%a %u %n' <dir> <dir>/*`: the directory must show `700 1001`, every file `600 1001`,
   and the file list must be the ten names of step 5. A wrong owner or mode stops the run here (the script refuses it too).
8. On the desktop, delete the copies: `rm -rf "$EXP" "$ARCH" "$LIST"` (the export holds the generated secrets). Keep no other copy.

The generator's output is owned by the desktop account, and its modes are set on the desktop only; the node copy is set by
step 7. The copy is the only one; do not paste the passwords into a ticket or a chat.

Command: `./geldar.ps1 shard nats-auth nf --live`. Without `--live` it refuses and writes nothing. An unknown flag is refused.

Files, in `compose/secrets-nf/` (git-ignored; `NF_SECRETS_DIR` points nf-live.yml at it): `nats-auth.conf` (the server
config), then one password file per user: `nats-neoforge.txt`, `nats-sink.txt`, `nats-velocity.txt`, `nats-deploy.txt`,
`nats-seed.txt`. Existing files are reused and never overwritten. If `nats-auth.conf` exists and a password file is missing,
the run fails and writes nothing. Restore the missing file, or delete the directory and generate again before any start.

**Upgrade: a node that already holds the older set.** A directory generated before the probe packet has eight files (no
`rcon.txt`, no `nats-body.txt`), and the generator refuses to run on it. Do not regenerate it in place, and do not delete it
when the node is running (postgres.txt and velocity-forwarding.txt must stay). The steps, in order:
1. Keep the node's `postgres.txt` and `velocity-forwarding.txt`. The Postgres password applies only at the first initialisation
   of the volume, and the forwarding secret must match the running velocity.
2. On the trusted machine, in a clean export, run `./geldar.ps1 shard nats-auth nf --live` once. Copy to the node, from that one
   run, `rcon.txt`, `nats-body.txt`, the new `nats-auth.conf` and all six `nats-*.txt` password files, and replace the node's
   copies together: the conf and the password files must come from the same run.
3. Install the new files with `mv` (see the install method below), in one window, then run the one command
   `sh deploy/nf-deploy.sh refresh-secrets` (below). It force-recreates nats first, waits until nats is healthy, then recreates
   velocity, eventsink, identity-seed (a one-shot: it must exit 0) and neoforge. Do not use `up` for this step: `up` leaves a
   service whose compose config did not change running, and that is every service here (the files keep their paths).
   postgres is not recreated: its password file is kept and its password applies only at the first start of the volume.
   Check `nf-deploy.sh status` after the command.
The generator has no append mode, so this procedure is the only upgrade path. UNVERIFIED on a node until ops's run on 2026-11-18 (section 10.8).

**Why a refresh is needed, and the install method.** Docker bind-mounts a single file by its inode. `mv` gives the name a new
inode, and a running container keeps the old inode, so it keeps serving the old bytes. Compose compares a service's config
(paths, image, environment), not the content of a mounted file, so `up` sees no change and does not recreate nats. Two install
methods exist. In-place `cat new > existing` keeps the inode, so the container sees the new bytes, but the write is not atomic (a
half-written conf can be read) and NATS reads its config only at start or reload. `mv` is atomic: the container keeps the old
file until it is recreated. **Use `mv`**: write the new file, set mode 0600 on it before the move, `mv` it over the node's file,
then run `refresh-secrets`. Never rely on an in-place edit. A hand recreate is never needed: `refresh-secrets` is the one path.

**`refresh-secrets`: run it after ANY change to a secret file's content** (an upgrade, a rotated password, a new `rcon.txt`).
Command: `sh deploy/nf-deploy.sh refresh-secrets` (no service name). It runs the same gates as `up` (the operator account,
not root; the secret files present, mode 0600 or 0400 and owned by NF_SERVICE_UID; the mod jar; the port; no colo labels;
the RAM and disk floors; NF_TELEMETRY on, off or unset, as `up` reads it; the compose config). It refuses unless the project is
up (nats, postgres, velocity, eventsink and neoforge running): then there is nothing to refresh, and you run `up`. Then, in order:
1. `up -d --force-recreate --no-deps nats`, then it polls until nats is running and healthy (one check per second, at most
   NF_REFRESH_HEALTH_TRIES checks, default 120).
2. `up -d --wait --force-recreate --no-deps velocity eventsink`.
3. `up --force-recreate --no-deps --exit-code-from identity-seed identity-seed`: the seed re-runs with the new `seed` password.
4. `up -d --wait --force-recreate --no-deps neoforge`.
Each step prints its name. Every compose call goes through the script's own wrapper: the project `geldar-nf`, the base file
compose/nf-live.yml, and the telemetry overlay only as NF_TELEMETRY sets it. `DEPLOY_DRY_RUN=1` prints the steps without running
them (the nats wait is skipped in a dry run).
It never recreates postgres, never removes a volume or the network, never touches the colo stack, and never names
golem-body or players-host.
Failure modes, all leave the project as it was for the step that failed, and a rerun is safe (each step is a recreate):
- A gate refuses (a missing or mis-moded secret, a non-numeric NF_REFRESH_HEALTH_TRIES, the project not up): nothing is
  recreated. Fix the input and run it again.
- nats is not healthy after the checks: the verb stops. velocity, eventsink, identity-seed and neoforge are NOT recreated, so
  they still hold the old passwords. Read `sh deploy/nf-deploy.sh logs nats`, fix it, and run the verb again.
- velocity or eventsink does not recreate or become healthy: the verb stops before identity-seed and neoforge.
- identity-seed exits non-zero (the verb names it; an `Authorization Violation` for user `seed` in the nats log means nats
  still runs the old conf): the verb stops before neoforge. Fix nats first, then run the verb again.
- neoforge does not become healthy: the verb stops; it is the last step, so nothing after it is left to refresh.
The files are mode 0600 and the directory 0700 on POSIX (checked by the test there); owner-only (ACL) on Windows. Each file is
created empty, restricted, then written, so the secret is never in a file with a looser mode. On Windows the script sets no ACL on
the directory: it inherits its parent's. A re-run restricts an existing file again; an existing empty secret file is refused by name.
An empty password file, or one with a double quote or a line break, is refused by name and nothing is written.

Mapping to nf-live.yml: `nats-auth.conf` is the nats service's config; `nats-sink.txt` the eventsink; `nats-neoforge.txt`
the neoforge service; `nats-velocity.txt` velocity; `nats-seed.txt` identity-seed (user `seed`). `nats-deploy.txt` is
declared but no compose service mounts it: the maintenance notice is published by the operator's deploy as that user, on
the node, outside the stack. `rcon.txt` is the neoforge service's `RCON_PASSWORD_FILE` (section 4c). `nats-body.txt` is read
only by the probe overlay (section 4c).

Generated: the ten files of section 4b (`nats-auth.conf`, the six NATS password files, `postgres.txt`,
`velocity-forwarding.txt` and `rcon.txt`). Not generated: no Thinker token (this shard has no Thinker hub).

Users and allow lists (every subject is `geldar.nf.*`, a JetStream API subject for the two streams below or the two identity
buckets, the life registry bucket (body only), or the inbox; no user has `>` or `geldar.*`):

| User | May publish | May subscribe |
|------|-------------|---------------|
| neoforge | `geldar.nf.*` except `geldar.nf.maintenance` and `geldar.nf.dlq`; JetStream STREAM.INFO and STREAM.CREATE for the two streams; `_INBOX.>` | `geldar.nf.maintenance`; `_INBOX.>` |
| sink | `geldar.nf.dlq`, `geldar.nf.state.>`, `$JS.API.INFO`; the durable consumer `eventsink` on the two streams (CONSUMER.CREATE with its filter, `.eventsink.>`; INFO; MSG.NEXT; ACK); STREAM.INFO and CREATE; `_INBOX.>` | `geldar.nf.state.*.proficiency`; `_INBOX.>` |
| deploy | `geldar.nf.maintenance` | `_INBOX.>` |
| velocity | watch and get on the two identity buckets (read only) | `_INBOX.>` |
| seed | `$JS.API.INFO`; create, inspect and update of the two identity buckets | `_INBOX.>` |
| body | `$KV.geldar-life-registry.ag_nfprobe_01` (the probe's one key); `$JS.API.INFO`; stream info and message get of `KV_geldar-life-registry` (the registry only) | `_INBOX.>` |

The two stream names are `GELDAR_EVENTS` (the name the plugin and the sink use today) and `GELDAR_EVENTS_NF` (decision
0380). The `GELDAR_EVENTS` allow is a default: remove it when the sink's per-shard config lands.

The password is plaintext inside `nats-auth.conf`, as the colo shard's config is. Treat the directory as a secret: do not
copy it into a checkout, a ticket or a log.

UNVERIFIED: the JetStream API subjects above come from the code and the @nats-io/jetstream 3.4.0 client; the test computes the
sink's subjects from that client. The sink and seed permissions remain UNVERIFIED against a live server until the node run;
nats-server 2.15 acceptance of this config is checked only there. The mod's export type list is not defined yet, so its publish is `geldar.nf.*` and narrows later.

## 4c. RCON, the body user and the probe verb

**RCON is enabled, on `neoforge` only.** The service sets `ENABLE_RCON: "TRUE"` and `RCON_PASSWORD_FILE: /run/secrets/rcon`
(compose/nf-live.yml). Port 25575 is not published: no `ports:` entry names it, so it is not reachable from the host or the node. Inside the
Docker networks, RCON listens on all interfaces of neoforge. Without telemetry, neoforge is on the nf network only, so any
container on nf (velocity, nats, postgres, eventsink, identity-seed) can open a connection to 25575; only the RCON password
guards it. With `NF_TELEMETRY=on`, neoforge is also on geldar-telemetry, so every container on that network can open it too.
This is accepted (the password is the only guard); the render test in nf-live-telemetry.test.ts pins the two network lists. The host port 46575 of section 2 stays reserved and unused. The
password is `rcon.txt` (section 4), read only by the neoforge service and the probe.

**The body user.** `nats-body.txt` is the password of the NATS user `body`, the probe's own user (its allow list is in section 4b).
It is mounted only by the probe overlay, compose/nf-live-probe.yml, and no base service reads it.

**The probe verb.** `deploy/nf-deploy.sh probe` first runs `compose build probe` on every run, so a stale tag cannot keep an old
isolation guard. The first build needs network access (the golem image runs `pnpm install`) and takes a few minutes. Ctrl-C or
TERM during the run removes the leftover probe with its 60 s stop grace period and exits 130 or 143. The probe service runs
read-only, with no capabilities and no-new-privileges (UNVERIFIED on a node; compose/opt-in/scratch-probe.yml sets none of
these). It then runs one golem Body probe, `ag_nfprobe_01`, over the project network, with the
`body` NATS user and RCON. The overlay compose/nf-live-probe.yml (profile `probe`, image `geldar-body:geldar-nf`, built from
golem/Dockerfile) runs as `run --rm --no-deps probe` on the project `geldar-nf`. It is a one-shot: it joins through Velocity,
whitelists the name over RCON, registers it in the life registry, and cleans up.

Preconditions, all checked by the script before the run (a failed check starts nothing):
- The project is up: `nats`, `postgres`, `eventsink`, `velocity` and `neoforge` are running, and `identity-seed` has exited 0.
  Run `nf-deploy.sh up` first.
- `nats-body.txt` and `rcon.txt` are in the secrets directory and pass the secret check.
- The isolation guard of the golem probe (golem/src/p0/isolation.ts) admits this project only once the golem + sink window lands:
  the held probe-isolation packet (branch `phase1/nf-probe-isolation`, golem/**) accepts project `geldar-nf` with the hosts
  velocity, neoforge and nats. Until it lands, the probe exits 2 with an isolation refusal and nothing else runs. Do not run
  `probe` before that window.

Cleanup: the probe process removes its own registry entry and its RCON whitelist entry (golem/src/p0/probe-cleanup.ts), on every
exit including a signal, then reads the registry key back. The script's part is the container: `run --rm` removes it, and the
script then runs `rm -f probe`, which removes one a crash left behind. The script does not touch the registry or the whitelist.

Exit code: the probe's own. 0 means the join, the registration and the cleanup all succeeded and the read found the key absent
(golem/src/p0/probe.ts header). 1 means any other failure, an interruption, a failed cleanup step, or a present or unknown read.
2 means an isolation refusal. The script returns that code unchanged.

`up` never starts the probe: the service is in profile `probe`, which `up` does not activate. `probe` runs with `--no-deps`, so
compose starts and restarts nothing else.

**Manual check before a second run: the bot must not be left over.** This repo ships no NATS CLI
wrapper, so the check below uses no `nats kv get` command. The check is the wait below, for two reasons, both read from the code:
- The probe's registration is an unconditional put: golem/src/p0/probe.ts:165 calls `registry.register`, which puts the key
  (golem/src/registry.ts:165, `kv.put`). An existing `ag_nfprobe_01` key is overwritten, not refused, so a second run never fails
  on a leftover entry.
- A key that a killed or crashed run did not delete expires with the registry TTL: `REGISTRY_TTL_MS = 60_000`
  (golem/src/registry.ts:15), and the bucket is created with that TTL (golem/src/registry.ts:80). After a failed or killed probe,
  wait at least 60 s before `probe` runs again.

**UNVERIFIED (probe and RCON):**
- The `body` user's permissions. They derive from docs/security/authn-authz-map.md and the registry-KV use (section 4b), not from
  a scratch auth run.
- The probe's NATS and RCON behaviour on geldar-nf: nothing has run against this project.
- The itzg `RCON_PASSWORD_FILE` handling on the pinned image: that the image reads the file and enables RCON with it.
- The real `probe` run: the join, the whitelist, the registration and the cleanup on the node.
- `rcon-cli` in the itzg image (section 8, item 7).

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
  `geldar-nf` at the prompt), `logs <service>`, `probe` (a one-shot, section 4c; `up` never starts it).
- The project name (`geldar-nf`) and the file (`compose/nf-live.yml`) are constants. The script refuses to run when
  `GELDAR_PROJECT` or `GELDAR_COLO_COMPOSE` is set, and it does not source `deploy/common.sh`.
- `up` runs in this order: `up -d --wait nats postgres`, the `identity-seed` one-shot, `up -d --wait eventsink neoforge`, then
  `up -d --wait velocity` (the only published port, `127.0.0.1:46565`). It never starts golem-body or players-host.
- Inputs, all from the environment: `NF_MOD_JAR_HOST` and `NF_MOD_SHA256` (the pinned mod jar and its sha256);
  `NF_BUNDLE_TARBALL` and `NF_BUNDLE_TARBALL_SHA256` (the offline bundle tarball from `deploy/scratch/build-neoforge-bundle.sh`
  and its sha256; `seed-bundle` reads them, plan and up take no bundle input, see "What is staged on the node"); `NF_SECRETS_DIR`
  (default `compose/secrets-nf/`, which must hold the ten files the script lists, owner `NF_SERVICE_UID` (1001 on this node; the
  script's default is 1000, so export it, section 5), mode 0600 or 0400). The list is ten names (`SECRET_FILES`): `rcon.txt`, `nats-auth.conf`, the six NATS files of section 4b, and
  `postgres.txt` and `velocity-forwarding.txt`. The generator writes all ten (section 4b), so the
  files it wrote satisfy the list.
  `plan` and `up` read the secrets (through the gates); `seed-bundle`, `status`, `down` and `logs` do not.
- Refusals, before any state changes: a colo variable set; a checkout; a missing or badly owned secret file; a mod jar or
  bundle tarball whose sha256 differs (seed-bundle only); free RAM below the 16640 MiB of caps plus an 8192 MiB margin; free disk below 50 GiB;
  a listener on 46565 other than the project's own velocity; a `geldar-nf` container with a geldar-colo label.
- Port 46565: `plan` and `up` accept the project's own running velocity on it. That is a container with the exact
  project label `geldar-nf` and service label `velocity`, with exactly one published mapping, `127.0.0.1:46565->25565/tcp`,
  and every listener socket on `127.0.0.1:46565`. The Ports text of `docker ps` may also list an unpublished exposed port
  (for example `25577/tcp`, from the image's EXPOSE) before or after that mapping, as in `25577/tcp, 127.0.0.1:46565->25565/tcp`;
  an entry without `->` is ignored. So a re-`up` on a running project passes this gate. They still refuse any other
  listener: another project (colo or scratch), another service, a second published mapping, a binding on `0.0.0.0` or `[::]`,
  a host process with no container, or a `docker ps` failure or unreadable output. A refusal prints the failed check
  (`own velocity check failed: <reason>`).
- `DEPLOY_DRY_RUN=1` prints the steps of `up` and `down` without running them. The gates still run.
- No CI workflow runs this script. It is operator-run. A continuous deploy for geldar-nf would be a separate change that the
  owner must approve.
- `up` checks that `geldar-nf_neoforge-data` is seeded: the volume exists and its `.geldar-bundle.sha256` marker verifies
  (`sha256sum -c --strict` in a throwaway container). If not, `up` refuses and names `seed-bundle`. `plan` does not check it.
- UNVERIFIED on a real node: `seed-bundle`. The `up` check ran only against stubs before the node; `up` was run on the node on 2026-11-18 (section 10.8).

### What is staged on the node

- The mod jar and its sha256 file (the 64-hex value is passed as `NF_MOD_SHA256`).
- The bundle tarball and its sha256 file (passed as `NF_BUNDLE_TARBALL` and `NF_BUNDLE_TARBALL_SHA256`).
- Nothing else. `NF_BUNDLE_DIR` is gone: plan and up do not read a bundle directory.
- The seed ownership: `seed-bundle` extracts the tarball, then runs `chown -R NF_SERVICE_UID:NF_SERVICE_GID /data` and
  `chmod -R u+rwX /data` in the same throwaway container. The marker check runs as that same uid:gid
  (`NF_SERVICE_GID` defaults to `NF_SERVICE_UID`). Whether itzg re-owns `/data` when the uid is 1001 is UNVERIFIED on a node.
- The NATS and secret generator (`./geldar.ps1 shard nats-auth nf --live`) runs on the trusted machine in a clean export, and
  its result is copied to the node. It writes ten files: `nats-auth.conf`, six NATS password files (`nats-neoforge.txt`,
  `nats-sink.txt`, `nats-deploy.txt`, `nats-velocity.txt`, `nats-seed.txt`, `nats-body.txt`), `postgres.txt`, `velocity-forwarding.txt`
  and `rcon.txt`.
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
   `velocity-forwarding.txt` exist, so the ten secret files of section 4b must all be present (section 6).
6. **Up (node):** `nf-deploy.sh up`. It starts the services in its own order (section 6): `nats` and `postgres`, then
   `identity-seed`, then `eventsink` and `neoforge`, then `velocity` (the only published port, loopback). Probes after it are
   read-only (`nf-deploy.sh status`, `logs`, and `tick query`, `list`, `version` in the game).

### Checklist

1. The NATS auth set is generated on the trusted machine and copied to the node (order steps 1 and 2). `postgres.txt` and
   `velocity-forwarding.txt` and `rcon.txt` are generated with the other seven (section 4b, ten files in all); the secret files must be 0600 (or 0400) and owned by the ops account.
2. The neoforge bundle seeded (order step 4; item 7.1 is done in the repo); compose/velocity/velocity-nf.toml is in place (bot
   ingress, backend neoforge:25565).
3. `docker compose -p geldar-nf -f compose/nf-live.yml config --quiet` with the real environment, including `NF_SERVICE_UID=1001`.
4. Re-measure the node's memory and cores; confirm the caps in section 3 still fit beside the autonomous shard.
5. Start with `up` (order step 6), not by hand. The old by-hand order (`nats`, `postgres`, `eventsink`, `identity-seed`,
   `neoforge`, `velocity`) differed from `up`'s order, so it is no longer the procedure.
6. **Tick and TPS check, without RCON** (added with the telemetry overlay; used from the probe packet; outside this packet's scope).
   RCON is enabled on the project network (section 4c), but this check does not use it, so this
   check reads the database. After about 30 s of neoforge uptime, run these read-only through the project's postgres service
   (database `geldar_nf`, user `geldar`, from compose/nf-live.yml):
   `docker compose -p geldar-nf -f compose/nf-live.yml exec -T postgres psql -U geldar -d geldar_nf -tAc "SELECT count(*) FROM events WHERE type = 'server_tps'"`
   The count must be greater than 0. Then `SELECT payload->>'tps' FROM events WHERE type = 'server_tps' ORDER BY at DESC LIMIT 1`
   must be near 20. A count above 0 proves the NATS and sink path. The `events` columns `type` and `payload` are from
   sql/0001_init.sql. The event name `server_tps` is UNVERIFIED in this repo until the first node run.
7. **Tick and TPS over RCON, after item 6 passes (section 4c).** Run
   `docker compose -p geldar-nf -f compose/nf-live.yml exec -T neoforge rcon-cli tick query` (the tick rate and the average time per
   tick) and `... exec -T neoforge rcon-cli neoforge tps`. The repo calls `rcon-cli` through `docker exec` (docs/runbooks/scratch-stack.md,
   deploy/scratch/telemetry-rows.sh), but `rcon-cli` in the itzg image and the reply format are UNVERIFIED on this image: record
   each reply, or the unknown-command reply. Item 6 remains the primary proof of the NATS and sink path.

## 9. Telemetry (optional)

Off is the default. With `NF_TELEMETRY` unset, `nf-deploy.sh` renders and starts exactly the base file, `compose/nf-live.yml`
alone, and makes no network call. The base file is not changed, and a render test asserts that the base render carries no telemetry.

**`NF_TELEMETRY=on` has no effect on the JVM until the entrypoint of PR #701 (packet B) is merged. Do not set it before.**
Until then the script refuses `on`, because the entrypoint in the tree has no `GELDAR_NF_TELEMETRY`.

**Rollback (explicit off).** To clear a stale ledger jar copy from the mods folder, run `NF_TELEMETRY=off sh deploy/nf-deploy.sh up`
(or `plan` first). That adds `compose/nf-live-telemetry-off.yml`, which sets `GELDAR_NF_TELEMETRY=off` on `neoforge` only. The
entrypoint then removes our own stale ledger jar copy and starts no agent. Unset is NOT the same: with NF_TELEMETRY unset the
script adds no overlay, so a stale jar left in place makes the start refuse, BY DESIGN. The start refuses rather than run a jar
it did not install. Use `NF_TELEMETRY=off` for the rollback, then unset it for the normal start.

**Forwarding config (`proxy-compatible-forge.toml`).** The entrypoint rewrites only the `[forwarding]` table, from the secret
file. Backups: `.bak` is the FIRST original file, written once and kept; `.bak.prev` is the previous start's file (rolling, one
start back). A toml in an unusual form is refused with exit 1 before any write: a quoted header (`["forwarding"]` or
`['forwarding']`), a dotted key (`forwarding.secret = ...`), or an inline table (`forwarding = { ... }`). A UTF-8 BOM before the
first header is stripped from the rewritten copy. A symlink or a directory at the config, `.bak`, `.bak.prev` or `.part` path is
refused, and nothing is followed or written through it. The symlink and directory refusal tests skip on Windows.

**Root cause of the original rejection: NOT established.** The masked node shape would have passed the old exact-line guard,
so the cause is not known from the repo. The rewrite makes the exact shape irrelevant (any form the rewrite accepts ends with one
`[forwarding]` table), but it does not explain why the node rejected the earlier file. Confirm on the node before you rely on it.

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
- RCON is enabled on the project network for the probe (section 4c). The tick and TPS checks (checklist items 6 and 7) are outside the telemetry overlay.
- The mechanism by which `JVM_OPTS` reaches `user_jvm_args.txt` on every start of the pinned itzg image is verified by the lead,
  not by this checkout. The attach is not.

## 10. Public human lane (accepted; decision 0388, ACCEPTED 2026-11-18; opened by the node steps in 10.7)

Status: ACCEPTED (0388, 2026-11-18). The lane was opened by the node steps listed in 10.7, each one approved by the owner, and it is OPEN as of 2026-11-18 (10.8). The gateway already forwards the public port to the node, so from the moment `velocity-human` bound it, the lane was reachable from the internet. No step below has been run on the node by an agent. Placeholders only: `<hostname>` (the public name), `<port>` (the human port), `<bind-ip>` (the address the human port binds on the node). The real values are the owner's and are not written in the repo.

**The go-public gate (0388 status line). The lane must NOT go public until (1) the plugin jar built from merged main (it contains #726, the slots and the fail-closed registry gate; #731, the inbox prefix; #732, the shared limit of 100) is DEPLOYED on the human proxy and on the node, (2) the node's `nats-auth.conf` is regenerated so the `human` user holds `_INBOX.human.>` only (the NF_HUMAN gate refuses a conf that still grants `_INBOX.>`, see 10.6), (3) neoforge enforces MAX_PLAYERS 100 (a node step), and (4) the owner has approved each node step.** S1 (10.8) is NOT a gate: the owner skipped it on 2026-11-18, and its checks are first-join observations. The repo does not record the state of items (2) and (3) at the bind on 2026-11-18; that is the owner's record, and this section does not claim them.

### 10.1 Architecture

- **Agent lane:** `velocity`, loopback `127.0.0.1:46565` (section 2). Unchanged.
- **Human lane:** `velocity-human` (compose/nf-live-human.yml), the only port that overlay publishes: `<bind-ip>:<port>` to container port 25565. Set at bring-up only, through node env: `NF_HUMAN=on`, `NF_HUMAN_BIND=<bind-ip>`, `NF_HUMAN_PORT=<port>`. Unset, the repo default renders as `127.0.0.1:46566`, which is loopback and not public.
- `velocity-human` is on network `nf-human` only. `nats` and `neoforge` join `nf-human` as well. Nothing else does.
- `velocity-human` reads NATS as user `human` (`nats-human.txt`), read-only on the two identity buckets.
- `velocity-human` has its own NATS inbox prefix, `_INBOX.human.` (`GELDAR_NATS_INBOX_PREFIX`, set on `velocity-human` only, `compose/nf-live-human.yml:54`). The user `human` is limited to `_INBOX.human.>`. This is account-level isolation only: the human user shares the one NATS account with the others. A separate NATS account is NOT built and NOT in scope. Not yet verified on a live NATS (10.10). The generator on main (since #731) gives `human` `_INBOX.human.>` only; a deployed conf that still grants `_INBOX.>` keeps the H5 grant until it is regenerated (10.6). On the first join (2026-11-18) the watches ran under this prefix with no violation logged (10.8); the rest is UNVERIFIED (10.10).
- `velocity-human` has no RCON and no postgres access (10.5).

### 10.2 Choosing the port

- Before choosing `<port>`, run a read-only `ss -ltn` on the node. `<port>` must not be listening, and must not collide with any node port in section 2 or with another shard.
- `<port>` is never 25565 or 25566. The deploy gate refuses them, and refuses anything below 1024, the live velocity port, and any value above 65535.
- On the node, 25565 is already held by another service, so `<port>` cannot be 25565 there. Do not look for another value by trial: take it from the `ss -ltn` check above.
- `<bind-ip>` is one IPv4 address. A wildcard (all interfaces), an IPv6 value, brackets, a hostname or a blank are refused by the gate.
- Neither value is committed to the repo or to a shared file. Set them in the shell that runs `nf-deploy.sh`.

### 10.3 The public name

- Players type only `<hostname>`, with no port.
- The public name is an SRV owner name: the record is `_minecraft._tcp.<hostname>`, its port field is `<port>`, and its target is a name that resolves to the gateway's public address.
- Caddy is NOT involved. The game port is TCP, and Caddy serves HTTP and HTTPS only.
- The SRV record (and the CNAME for its target name) is an owner-owned DNS change. Add it last (10.7, step (f)).

### 10.4 The gateway rule (owner-owned)

- The owner's gateway already forwards TCP `<port>` on its public address to `<bind-ip>:<port>`. The repo sets none of it. From the moment `velocity-human` binds, the lane is reachable from the internet.
- The owner removes the rule to roll back (10.9).

### 10.5 RCON

- The RCON password file is never mounted into `velocity-human`. Its secrets are `velocity-forwarding` and `nats-human.txt` only.
- `neoforge` is on `nf-human`, so RCON is reachable by name from there. Whether RCON binds only to loopback inside the NeoForge container is UNVERIFIED.

### 10.6 NATS generator upgrade (a node with the ten-file set)

An older node holds `nats-auth.conf` and nine password files, and no `nats-human.txt`. The generator (`deploy/nats-auth-nf.ps1`, run as `./geldar.ps1 shard nats-auth nf --live`) refuses a re-run there: "compose/secrets-nf/nats-auth.conf exists but nats-human.txt is missing ... Nothing was written." It reuses the existing password files and creates only the missing one. Its test is `tools/repo-checks/src/nats-auth-nf-upgrade.test.ts`. The H5 report has the same procedure.

Procedure (the owner runs it; the password values are never printed):

1. On the trusted machine, in a clean export made with `git archive` (no `.git`), put the node's nine existing password files into `compose/secrets-nf/`, unchanged. Do NOT put the node's `nats-auth.conf` there.
2. In that export, run `./geldar.ps1 shard nats-auth nf --live`. It creates `nats-human.txt` and a new `nats-auth.conf` with seven users (the six old ones and `human`), using the nine existing passwords.
3. Copy back to the node ONLY `nats-human.txt` and the new `nats-auth.conf`, replacing the node's old config. Keep the node's nine password files as they are.
4. Run `nf-deploy.sh refresh-secrets` (owner-OK, 10.7). It force-recreates `nats` first, then the services that mount the secrets (not postgres).
- Whether a NATS config reload is enough instead of recreation is UNVERIFIED. This procedure uses recreation.
- **The deployed `nats-auth.conf` is never overwritten by the generator** (`deploy/nats-auth-nf.ps1`: "kept ... never overwritten" when the file exists). So a conf from H5 still names `human` with the broad grant `_INBOX.>`, and a re-run does not fix it. Such a conf is regenerated by the SAME procedure, with two differences: run it in a clean export made from merged main (after #731, the generator writes `_INBOX.human.>` for `human`), and leave the node's `nats-auth.conf` OUT of `compose/secrets-nf/`. Put the node's existing password files there unchanged (`nats-human.txt` included), run the generator, and copy back to the node ONLY the new `nats-auth.conf`, replacing the old one. The UNVERIFIED point: that the generator, given all password files and no conf, writes a conf that reuses them (not run on a node).
- `NF_HUMAN=on` refuses a conf that still grants `human` `_INBOX.>` (`deploy/nf-human-lib.sh`, the `nats-auth.conf` check; in code on main since #731). The refusal is the gate's; the regeneration is the owner's step (b) in 10.7.
- Note on size: `geldar.ps1` is 695 lines by `wc -l` on main (one line modified and one added by #728). It is over the 500-line soft cap, and it is not split here.

### 10.7 Bring-up order (every step is a stop point)

Each step is run by the owner. Steps marked OWNER-OK-REQUIRED are not run by an agent.

Ordering note (PR numbers are references only). Merged to main: #726 (the human slots and the fail-closed registry gate), #727 (chat guard), #728 (overlay), #729 (NATS user and network), #731 (the inbox prefix and the NF_HUMAN conf check) and #732 (the shared limit of 100). #733 and #734 are docs, and #735 is this docs packet (queued). #736 (H1c2, an explicit `ag-` and `ag_` prefix rule in HumanRules, defence in depth) is merged to main (`AGENT_PREFIXES` in HumanRules) and is not a go-public condition: an `ag-` name is already refused by username validity, because Minecraft usernames cannot contain `-` (`LifeRegistry.java:42`, `LoginGate.isValidUsername`). The steps below are the node work, in order. Each one is approved by the owner before it runs, and none is run by an agent.

- **(a) OWNER-OK-REQUIRED: the jar.** Sync the node tree to merged main. Build the plugin jar on the trusted machine from `plugin/velocity-identity` (merged main, with #726, #731 and #732). Stage it with its sha256 and place it at `plugin/velocity-identity/build/libs/geldar-velocity-identity.jar` relative to the node tree, before any recreate. The overlay mounts it read-only with `create_host_path: false`. A missing or empty jar makes the start refuse (`deploy/nf-human-lib.sh`).
- **(b) OWNER-OK-REQUIRED: node step A (the conf and the secrets).** Generate `nats-human.txt` and the new `nats-auth.conf` by the 10.6 procedure. The conf must grant `human` `_INBOX.human.>` only. Copy both to the node, then run `nf-deploy.sh refresh-secrets`. It force-recreates `nats` first, then the services that mount the secrets. The gate refuses `on` while the deployed conf still grants `_INBOX.>`.
- **(c) OWNER-OK-REQUIRED: the neoforge recreate with MAX_PLAYERS 100.** The first `NF_HUMAN=on` `up` also recreates `neoforge`, because its network set changes. Do (c) and (d) together, in one owner-approved recreate, so that neoforge comes up with MAX_PLAYERS 100. The live shard enforced 10 until then. Ops ran the 10 to 100 recreate on 2026-11-18 (observed; section 10.8).
- **(c1) OWNER-OK (approved 2026-11-18; a one-time step, run by ops): volume ownership, BEFORE the first `up`.** A fresh named volume is root-owned and empty. The proxy runs as the service uid (`user: uid:gid`) with a read-only root, `cap_drop: ALL` and `no-new-privileges`, so it cannot write into `/server`. The first `up` failed there: install-paper got AccessDeniedException writing its jar download into `/server`. The agent `velocity` avoids this by starting as root; `velocity-human` does not. Before the first `up`, the root of the volume `geldar-nf_velocity-human-data` must be owned by `NF_SERVICE_UID:NF_SERVICE_GID`. Use one route: (i) the one-shot `velocity-human-init` service, which chowns the volume root. It is NOT in `compose/nf-live-human.yml` on origin/main as of 2026-11-18, so use it only after `git show origin/main:compose/nf-live-human.yml | grep -n velocity-human-init` shows it; or (ii) the one-time ops chown of the empty volume root to the service uid and gid, run in a throwaway container that mounts only that volume. The exact command is ops's and is UNVERIFIED here. Not needed again unless the volume is recreated. On 2026-11-18 route (ii) was used: the owner-approved one-time chown of the empty `velocity-human-data` volume root to the service uid (ops ran it; the command is not recorded here). The second `up` then succeeded. Route (i) makes the fix reproducible once the volume-init change (PR #740, branch `phase1/nf-human-volume-init`) is merged; `git show origin/main:compose/nf-live-human.yml` had no `velocity-human-init` on 2026-11-18, so it was not on main then. The netty tcnative warning about noexec at start is expected and harmless: the tmpfs is noexec, and `/tmp` is intentionally left noexec.
- **(d) OWNER-OK-REQUIRED: plan, then up.** Run `nf-deploy.sh plan` with `NF_HUMAN=on`, `NF_HUMAN_BIND=<bind-ip>`, `NF_HUMAN_PORT=<port>` and `NF_SERVICE_UID` exported, plus the telemetry env the live shard already runs with: `NF_TELEMETRY=on`, its ledger and agent pins (`NF_LEDGER_JAR_HOST`, `NF_LEDGER_SHA256`, `NF_OTEL_AGENT_HOST`, `NF_MOD_JAR_HOST`, `NF_MOD_SHA256`). `plan` is read only. Then run `nf-deploy.sh up` with the same environment. An `up` without the telemetry env hits the by-design stale-jar guard and refuses. The plan lists `up -d --wait velocity-human` as its last step. If the proxy does not become healthy, `up` stops and stops only `velocity-human`. The healthcheck waits for the identity plugin's ready marker (`/tmp/geldar-identity.ready`) with a 35 s window (20 s start period, 3 retries at 5 s), so a missing or invalid plugin fails in 35 s. `restart` is `"no"` in the repo file, so nothing restarts the proxy by itself. The live `velocity-human` container was changed to `unless-stopped` with `docker update` on 2026-11-18 (open item, 10.8).
   Orphan guard: while `velocity-human` exists, `plan`, `up`, `refresh-secrets` and `probe` refuse with `NF_HUMAN` unset or `off`, and name `human-down` and `NF_HUMAN=on`. `status`, `logs`, `down` and `human-down` stay allowed.
- **(e) Verify from OUTSIDE the node (read only, no join).** A TCP connect to `<bind-ip>:<port>` answers. The same address on 46565 and on 25565 does not answer. Then `nf-deploy.sh logs velocity-human` and `status` (read only). A TCP answer proves the port is open, not that the login works.
- **(f) DNS, last (owner-owned).** The SRV record and the CNAME for its target (10.3). Caddy is not involved.
- **(g) Rollback:** 10.9.

The first real join is the first test of the lane. Its observations are listed in 10.8 and in the 0388 status line; they are not a precondition of any step above.

### 10.8 S1 checks: SKIPPED by the owner on 2026-11-18; the same checks are done as first-join observations

S1 was the LAN-only check. The owner skipped it on 2026-11-18. The checks below are RECOMMENDED first-join observations, run on the first real join (the owner or a tester on a real account). They are not a precondition of the lane (0388 status line). Record what each one shows; do not claim a check that was not run.

1. A plain Prism NeoForge 26.1.2 client with NO geldar mod connects to `<bind-ip>:<port>` and completes Microsoft login. Then a vanilla client does the same.
2. An `ag_` name (any case) is refused by the prefix rule. An `ag-` name (any case) is refused by username validity, because a name with `-` is not a valid Minecraft username; S1 expects that refusal. The H1c2 PR (#736, merged) adds an explicit `ag-` rule as defence in depth; it is not a go-public condition, and an `ag-` name is refused by validity with or without it. An offline-mode name (an offline launcher account) is refused.
3. The 101st player is refused by MAX_PLAYERS (100 once the node step has changed the live shard; 10 before it). This is not testable with real humans: state that in the S1 report and do not claim it passed. Requires #726 deployed on the human proxy.
4. A slot is released after a disconnect: a human who was refused because the limit was full joins once a slot is freed. The limit is the shared 100 (#732) once the node step has run (section 3b); before it, the live shard enforces 10. A full-limit test with real humans is not testable, state that. (The release half was seen for one join and leave on 2026-11-18; the refusal half is not tested.)
5. In the `velocity-human` logs, confirm that the same `Player` object appears in `LoginEvent` and in `DisconnectEvent` (residual risk 4). Seen as an effect on 2026-11-18: the count was reserved at login and released on disconnect (see the observations below).
6. The registry gate: with the registry unsynced (owner test only), every login is denied.

### Node result and first-join observations (2026-11-18)

Times are UTC, from the ops logs of 2026-11-18. These are OBSERVATIONS, not passed checks. Placeholders only, as above.

Node result:

- The first `up` failed at the volume ownership step (10.7 (c1)). After the owner-approved one-time chown, the second `up` ran 16:00:34 to 16:01:01Z. `velocity-human` became healthy.
- It published exactly `<bind-ip>:<port>` to 25565/tcp: the node's LAN address, not a wildcard. The agent `velocity` still listens only on `127.0.0.1:46565`.
- No NATS `Permissions` or `Authorization Violation` for any user in the logs. The identity plugin loaded in the human lane, the skin bucket synced, and the registry watches ran (under `_INBOX.human.`).
- `docker diff` on `velocity-human` showed no writes outside `/server` and `/tmp`: `read_only` holds with those two paths writable.
- The second `up` did not recreate `nats`, `eventsink` or `neoforge`.
- From the owner's desktop on the LAN, a TCP connect to `<bind-ip>:<port>` succeeded and a connect to port 46565 was refused.
- The identity plugin jar's sha256 on the node equals the desktop build of main 3a706c41.
- The jansi and netty native libraries warn that `/tmp` is noexec. The warning is non-fatal; `/tmp` stays noexec.
- Gate facts observed by ops (ops record, UTC 2026-11-18; the repo cannot show them): (1) NATS: node step A ran 15:44:50-15:46Z on a clean export of main 3a706c41; the auth generator created `nats-human.txt` and a new `nats-auth.conf` with seven users; ops checked that the `human` line holds `_INBOX.human.>` and no bare `_INBOX.>`; the nine existing password files were unchanged by sha256; `refresh-secrets` exited 0; the gate-checked `plan` (15:47:54Z) and `up` (16:00:34-16:01:01Z) with `NF_HUMAN=on` passed ("all gates passed"), so the gate's conf check held; no Permissions or Authorization Violation in nats since. (2) neoforge: `MAX_PLAYERS=100` in the container env and `max-players=100` in /data/server.properties, observed 15:39-15:40Z after the first recreate, 15:45Z after refresh-secrets, and 16:01Z after the human `up` (this answers the earlier UNVERIFIED on the itzg write). (3) Jar: the velocity-identity jar installed on the node has sha256 beginning 3ac5005d (6490207 bytes), equal to the desktop build of main 3a706c41 (it contains HumanSlots and HumanRules), built 15:43Z and installed before refresh-secrets; the agent `velocity` runs the same jar after its recreate.

First-join observations:

- 16:05:18Z: the owner's desktop joined on the LAN with a plain NeoForge client (no geldar mod, Microsoft login). Admitted (`[geldar-identity]: Admitted <name>`); skin lookup skipped (not a sovereign life); forwarding to neoforge accepted (no secret mismatch); in the world about 2 m 06 s; clean disconnect on both proxy and server. No NATS violation and no exception in any log.
- 16:12:13Z: a join through the public `<hostname>` over the physical (non-VPN) route, with the SRV record supplying `<port>` and no port typed: worked.
- At the two joins above, HumanSlots logged NOTHING on reserve or release, so slot release was not shown then.
- Later on 2026-11-18, the velocity-identity jar from main 591f3e7f (sha256 prefix f2031976) was installed on the node and went live in `velocity` and `velocity-human` from 16:58Z. That replaced the jar in the Node result above. The human port was down about 15 s during the swap. `velocity-human`'s restart policy was set to `unless-stopped` live with `docker update` (open item below).
- Slot-logging PR #741 is merged (merge commit a583114b), and its logs exist. One join and leave on the live human proxy, through the public name, reserved and released a slot (counts only):
  - 17:01:13Z: join through the public name.
  - 17:01:27Z: `human slot reserved: 1/100` in `velocity-human`, then `Admitted`, then forwarding to neoforge connected.
  - 17:01:28Z: neoforge logged `logged in`.
  - 17:03:21Z: disconnect. `velocity-human` logged `human slot released: 0/100`, and neoforge logged `left the game`.
  - No `human slot release found no slot` warning was logged.
  - No NATS `Permissions` or `Authorization Violation` has been logged since 16:58Z.
- Slot release on disconnect is therefore OBSERVED for one join and leave. It shows that the same `Player` object reaches `LoginEvent` and `DisconnectEvent` for that one sequential human. It does NOT show concurrency, the cap at 100, or that `DisconnectEvent` fires for every connection that ends after a login.
- neoforge logs `SERVER IS RUNNING IN OFFLINE/INSECURE MODE`. That is expected behind the proxy: online-mode is the proxy's.
- OPEN ITEM (2026-11-18): `velocity-human` runs with restart `unless-stopped` LIVE, set with `docker update`. The repo file `compose/nf-live-human.yml:108` still says `"no"`. A later `up` would recreate the container with the repo's policy, so the reboot-policy PR must flip the file before the next `up`. Until then, the live policy and the repo disagree.

What the S1 list above shows, as observations:

- Seen: forwarding works; admission works; a plain NeoForge client without the geldar mod joins (this answers the open question about the client mod for a plain NeoForge client; a vanilla client was not tried); the Microsoft login works through the node's network (item 1); slot release on disconnect, for one join and leave (items 4 and 5, 2026-11-18).
- The H6 inbox prefix: the watches ran under `_INBOX.human.` with no violation logged. Server enforcement of the narrowed grant is only seen as "no violation"; no violation was attempted.
- NOT observed: the `ag_` refusal and the `ag-` refusal (item 2); the offline-name refusal (item 2); the 101st-player refusal and the cap at 100 (item 3); the refusal of a human when the limit is full (item 4, the refusal half); the registry-unsynced denial (item 6); a second human, and so concurrent slots.

### 10.9 Rollback (in this order)

1. The owner removes the gateway rule (public traffic stops).
2. The owner deletes the SRV record.
3. `nf-deploy.sh human-down`. It runs `docker compose rm -sf velocity-human` and touches no other service. Plain `nf-deploy.sh down` stops the whole project, including the agent lane; do not use it for this.
4. Unset `NF_HUMAN`, `NF_HUMAN_BIND` and `NF_HUMAN_PORT` for later runs.

`human-down` is the rollback that the orphan guard names: after it, `plan`, `up` and `refresh-secrets` run again with `NF_HUMAN` unset.

What is left behind: `human-down` removes the container only, so the `nf-human` network stays. `down` runs `docker compose down`, which should also remove the project's networks, including `nf-human`; that is UNVERIFIED on the node.

### 10.10 UNVERIFIED (do not treat any of these as checked)

- `create_host_path: false` with a MISSING jar (the start refusal). With the jar present it worked on the node (10.8).
- The refusals on a live server: `ag_`, `ag-`, the offline-mode name, and the registry-unsynced denial. None was tested with a real attempt (10.8).
- The 101st-player refusal and the shared cap of 100 (section 3b, item 3 of the gate).
- Slot release under concurrency, and whether `DisconnectEvent` fires for every connection that ends after a login (0388 residual risk 4). One sequential join and leave was observed on 2026-11-18 (10.8); that is all.
- The `$JS.FC` flow-control subject form beyond "no violation" (10.8), and KV ACL enforcement against an attempted violation (none was attempted).
- Whether Proxy Compatible Forge accepts a second forwarding secret (0388 residual risk 1).
- RCON binding inside the NeoForge container.
- Whether a NATS config reload is enough (10.6).
- Whether the `nf-human` network is removed by `down` (10.9).
- The H6 inbox prefix beyond "no violation" (10.8): the exact permission set a push watch needs, whether the server enforces `_INBOX.human.>` against an attempted violation, and whether the client ever publishes to an inbox (0388 residual risk 9).
- Whether the ready marker is written only while the registry is synced (`docs/reference/velocity-identity-plugin.md:98`). The healthcheck proves plugin load and an open port; registry sync is proven only once #726 is deployed on the human proxy.

### 10.11 Not built

- Per-IP limits, login rate limiting beyond Velocity's default, and the idle kick (held packet H1b). DROPPED by the owner on 2026-11-18 ("rate limits: leave alone"). ACCEPTED RISK (0388 residual risks 3 and 5): no per-IP limit, no login rate limiting beyond Velocity's default, no idle kick.
- A human registry and a revocation path (0387 item 5(d)). DROPPED by the owner on 2026-11-18 (online identity is enough: the Microsoft login is the identity). ACCEPTED RISK (0388 residual risk 7).
- Chat export and the name mask: off. Per 0375, `collector.chat.enabled=false` keeps the ledger's NameMask off.
