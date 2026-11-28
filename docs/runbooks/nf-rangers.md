---
title: The Turbo rangers lane on geldar-nf
type: how-to
audience: operators
status: draft
last_verified: 2026-11-28 against the phase1/nf-rangers branch (before merge)
companions: [README.md, nf-live-project.md, nats-auth-inplace.md, skins.md, retire-an-agent.md]
sources: [compose/nf-live.yml, compose/nf-live-rangers.yml, deploy/nf-deploy.sh, deploy/nf-rangers-lib.sh, deploy/nats-auth-nf.ps1, shards/nf-mind.yaml, docs/analysis/neoforge/turbo-rangers-packets.md, docs/runbooks/nats-auth-inplace.md, docs/runbooks/skins.md, tools/players-cli/src/cli.ts]
---

# The Turbo rangers lane on geldar-nf

This runbook brings the five Turbo rangers (ranger-yellow, ranger-green, ranger-blue, ranger-red, ranger-pink) and their door,
geldar-mcp, onto the NeoForge shard project geldar-nf on the node. It is the node half of packets P2 to P5 in
`docs/analysis/neoforge/turbo-rangers-packets.md`. Read [nf-live-project.md](nf-live-project.md) first for the project itself.

**Run one step at a time, through the coordinator geldar-69.** Each step below needs an owner "go" recorded by geldar-69
before you start it. Stop at the first step that does not produce its expected output, do its rollback if it says one, and tell
geldar-69. Never run two steps at once, and never skip ahead.

## Rules for every step

- The ops account is uid 1001. Export `NF_SERVICE_UID=1001` and `NF_SECRETS_DIR=<node secrets-nf directory>` in the shell first.
  Run commands from the node checkout (`<node checkout>`).
- Use `DEPLOY_DRY_RUN=1` first wherever the script supports it.
- Never print the contents of a secret file. Use `test -s`, `stat -c '%a %U'`, or `sha256sum` to check a file.
- Never run `docker compose down`, anything with `--volumes`, or any recreate that names `neoforge`, `postgres` or `nats`.
  Never use a pattern kill (`pkill`, `killall`).
- A repo change does not reach the node by itself. `compose/**`, `deploy/**` and `shards/**` arrive only by a manual checkout
  update in N3.
- Use `<nf nats container>`, `<nf velocity container>`, `<nf postgres container>` and `<ranger container>` for the container
  names; read the real names with `docker ps` in N0.

## N0. Preflight (read only)

```sh
docker ps --filter label=com.docker.compose.project=geldar-nf --format '{{.Names}} {{.Status}}'
free -m
ss -ltn | grep 46788
```

Expected: the six base services (nats, postgres, eventsink, neoforge, velocity, velocity-human) show `Up ... (healthy)`.
`free -m` shows `available` above 30000 MiB. `ss` prints nothing.

Rollback: none (read only). If a base service is not healthy, stop and tell geldar-69.

## N1. NATS users, in place (no restart)

N1 changes one file, the live `nats-auth.conf`, and sends it a SIGHUP. It is the in-place reload only, the same way the colo
NATS conf is applied ([nats-auth-inplace.md](nats-auth-inplace.md), step 5). It is **not** `refresh-secrets`: that verb recreates
neoforge too, which restarts the world, and it needs geldar-69's say first. Do not use it for N1.

**Re-measure the node right before N1.** The numbers are from this moment, not from the plan.

```sh
docker stats --no-stream
free -m
```

Expected: `free -m` `available` above 30000 MiB, with the project's six services at their normal CPU. Record both outputs in the
step log. If available memory is below 30000 MiB, stop and tell geldar-69: the rangers add five Bodies and one door on this node.
The CPU floor is owner-set and not in this runbook; geldar-69 gives it with the go.

1. Backup the live conf (the rollback needs it):
   ```sh
   cp "$NF_SECRETS_DIR/nats-auth.conf" "$NF_SECRETS_DIR/nats-auth.conf.bak-$(date -u +%Y%m%dT%H%M%SZ)"
   sha256sum "$NF_SECRETS_DIR/nats-auth.conf"
   ```
2. Copy the four new password files and the new conf from the trusted machine into `$NF_SECRETS_DIR` as
   `nats-ranger.txt`, `nats-mcp.txt`, `postgres-mcp.txt`, `mcp-token-pepper.txt` (mode 0600), and the new `nats-auth.conf` to a
   staging path such as `$HOME/nats-stage/nats-auth.conf`. Check modes with `stat -c '%a %U' <file>`. Expected: `600 <ops user>`
   for each new file. The new conf is produced by `./geldar.ps1 shard nats-auth nf --live` on a clean export of the merged commit
   (the generator never rewrites an existing conf, so delete only `nats-auth.conf` in that export first).
3. Check the `http:` line is identical, old to new (a changed `http:` host cannot be reloaded):
   ```sh
   grep '^ *http:' "$NF_SECRETS_DIR/nats-auth.conf"
   grep '^ *http:' "$HOME/nats-stage/nats-auth.conf"
   ```
   Expected: the two lines are equal. If not, stop.
4. Write the conf in place. Never `mv` it: a single-file mount follows the inode.
   ```sh
   cat "$HOME/nats-stage/nats-auth.conf" > "$NF_SECRETS_DIR/nats-auth.conf"
   sha256sum "$NF_SECRETS_DIR/nats-auth.conf" "$HOME/nats-stage/nats-auth.conf"
   ```
   Expected: the two hashes are equal.
5. Reload (SIGHUP, not a restart):
   ```sh
   docker kill -s HUP <nf nats container>
   docker logs --since 2m <nf nats container> 2>&1 | tail -n 20
   docker ps --filter name=<nf nats container> --format '{{.Names}} {{.Status}}'
   ```
   Expected: a config reload line with no error; nats still `(healthy)`. Then
   `docker ps --filter label=com.docker.compose.project=geldar-nf --format '{{.Names}} {{.Status}}'` shows velocity, neoforge and
   eventsink with their original uptime (no restart).

**Rollback.** Put the saved conf back in place and reload:
```sh
cat "$NF_SECRETS_DIR/nats-auth.conf.bak-<UTC stamp>" > "$NF_SECRETS_DIR/nats-auth.conf"
docker kill -s HUP <nf nats container>
```
The extra users are harmless unused, so the four new password files may stay. If the reload fails and the conf will not load,
roll back and tell geldar-69; the fallback is a restart path that recreates neoforge and needs a notice and an owner go.

## N2. Database (additive)

Needs N3's admin image, so run N3 first if it is not built. Take a `pg_dump` of `geldar_nf` through an owner-approved path first:
that dump is the real rollback.

```sh
docker compose -p geldar-nf -f compose/nf-live.yml -f compose/nf-live-rangers.yml --profile admin run --rm --no-deps rangers-admin migrate --dry-run
```

Expected: exactly `0067` and `0068` pending. Then apply without `--dry-run`:

```sh
docker compose -p geldar-nf -f compose/nf-live.yml -f compose/nf-live-rangers.yml --profile admin run --rm --no-deps rangers-admin migrate
docker compose -p geldar-nf -f compose/nf-live.yml -f compose/nf-live-rangers.yml --profile admin run --rm --no-deps rangers-admin migrate --set-role-password geldar_mcp --password-file /run/secrets/postgres-mcp.txt
```

Expected: a one-line OK for the second command, and no password printed. Verify read only:

```sh
docker exec <nf postgres container> psql -U geldar -d geldar_nf -Atc "select max(version) from schema_migrations; select rolcanlogin from pg_roles where rolname='geldar_mcp'"
```

Expected: `0068` and `t`.

**Rollback.** Migrations are forward only. `ALTER ROLE geldar_mcp NOLOGIN` restores the role state. The real rollback is the
`pg_dump` taken first, restored by the owner.

## N3. Build and render

```sh
git -C <node checkout> fetch
git -C <node checkout> merge --ff-only <merged commit>
docker compose -p geldar-nf -f compose/nf-live.yml -f compose/nf-live-rangers.yml config --quiet
docker compose -p geldar-nf -f compose/nf-live.yml -f compose/nf-live-rangers.yml build geldar-mcp ranger-yellow rangers-admin
docker images | grep -E 'geldar-(mcp|body|admin):nf-live'
```

Expected: `config --quiet` prints nothing. `build` finishes for three images: `geldar-mcp:nf-live`, `geldar-body:nf-live` and
`geldar-admin:nf-live`. The other four ranger services share the body image. `docker images` lists the three tags.

**Rollback.** `docker rmi` the three new tags only. Do not remove any other image.

## N4. Bring the rangers up

```sh
NF_RANGERS=on DEPLOY_DRY_RUN=1 deploy/nf-deploy.sh plan
```

Expected: the plan lists the rangers step and no recreate of nats, neoforge, velocity, eventsink or postgres.

```sh
NF_RANGERS=on deploy/nf-deploy.sh up
```

Expected: `geldar-mcp` healthy, `127.0.0.1:46788` listening (`ss -ltn | grep 46788`), and the five ranger containers `Up`.
`docker logs <ranger container>` shows one JSON line per event with a `life_id`. The six base services keep their original uptime.

**Join check on NeoForge 26.1.2 (sovereign Body).** Run it before any Mind starts. It is the check that a sovereign Body joins the
NeoForge 26.1.2 shard; the P0 probe is the evidence for it (`docs/analysis/neoforge/p0-findings.md`).

1. With `presence.start: always` each Body joins through velocity at start. Run:
   ```sh
   docker logs <nf velocity container> 2>&1 | grep 'Admitted'
   ```
   Expected: five agent names listed, one per ranger.
2. Check each ranger's own log for a join error:
   ```sh
   docker logs <ranger container> 2>&1 | grep -i -E 'error|exception|join' | tail -n 20
   ```
   Expected: no error lines. Repeat for the five rangers, one command each.
3. Check that `sovereign_call` reaches players-host. Run it from a ranger container (read only):
   ```sh
   docker logs <ranger container> 2>&1 | grep 'sovereign_call' | tail -n 5
   ```
   Expected: `sovereign_call` lines with no `unreachable` or `refused`. The exact log text is UNVERIFIED on nf: if the grep finds
   nothing, do not guess; report what you see.

**If any join check fails, tell geldar-69 before anything else, and do not start a Mind.**

**Rollback.** `NF_RANGERS=on deploy/nf-deploy.sh rangers-down` stops and removes the six rangers-lane containers only. The base
services are not touched.

## N5. Registration (through rangers-admin)

Run each command as a one-shot:

```sh
docker compose -p geldar-nf -f compose/nf-live.yml -f compose/nf-live-rangers.yml --profile admin run --rm --no-deps rangers-admin owner-add <owner id> --cap 5
docker compose -p geldar-nf -f compose/nf-live.yml -f compose/nf-live-rangers.yml --profile admin run --rm --no-deps rangers-admin roster add <name> --owner <owner id>
docker compose -p geldar-nf -f compose/nf-live.yml -f compose/nf-live-rangers.yml --profile admin run --rm --no-deps rangers-admin player-add <player-id> --owner <owner id> --life <life id> --name <Name> --harness <harness>
docker compose -p geldar-nf -f compose/nf-live.yml -f compose/nf-live-rangers.yml --profile admin run --rm --no-deps rangers-admin players-status
```

Repeat `roster add` and `player-add` for each of the five rangers. `<owner id>` and `<harness>` are owner inputs; the harness
value is UNVERIFIED. Expected: `players-status` lists five players and prints no token value.

**Rollback.** `token-revoke` for each player, then retire per [retire-an-agent.md](retire-an-agent.md). No world effect.

## N6. Skins

Run the "Skins step" below. N6 needs the owner's go recorded for the five MineSkin uploads (gate G1, met by the owner on 2026-11-28),
and gate G3 (classic or slim for each skin).

## N7. Show them

Reconnect each Body, one at a time, so the checkpoint is kept (main handles SIGTERM):

```sh
docker restart <ranger container>
docker logs <nf velocity container> 2>&1 | grep 'skin:'
```

Expected from the grep, after all five restarts: `skin: applied for <life id> (variant classic|slim)` five times and
`skin: bucket geldar-skins synced, 5 keys cached, 0 rejected`. A `skin: lookup skipped` line means the name is not in the registry;
report it. Then the owner joins with the human client and looks.

**Rollback.** A restart reverts to the default look. Skin records can be removed by the same NATS user (`nats kv del`).

## N8. Whole-lane rollback

```sh
NF_RANGERS=on deploy/nf-deploy.sh rangers-down
```

Then remove `NF_RANGERS` from the environment. The four new secret files and the two conf users may stay. What stays behind:
Postgres rows (owners, players, roster), the skins bucket keys, the registry keys (they expire by TTL), and the images.

## Skins step (desktop, with a tunnel)

Rules from the code: `skin set <player id> <png>` takes the **player id** (for example `ag-turbogreen-01`), looks it up in the shard file
`sovereign.players` (`tools/players-cli/src/cli.ts`), and writes the key `life_id` into `geldar-skins`. The PNG must be 8-bit RGB or
RGBA, 64x64 or 64x32, with only IHDR, IDAT and IEND chunks, at most 24 KiB ([skins.md](skins.md)). A PNG with extra chunks is refused,
so run `--check-only` first. Visibility stays `unlisted` (decision 0250): do not pass `--visibility`.

1. Approval. The owner approved the five MineSkin uploads on 2026-11-28 (unlisted, vault key). Decision 0140 covered six only.
   Gate G3 (classic or slim per skin) is the owner's; default classic.
2. The key, straight from the vault into the git-ignored file, with no echo and no variable:
   ```powershell
   az keyvault secret show --vault-name <key vault> --name <mineskin secret name> --query value -o tsv > compose/secrets/mineskin.txt
   ```
   Restrict the file to your own user. Check it is non-empty with `(Get-Item compose/secrets/mineskin.txt).Length -gt 0`.
3. Point the CLI at the shard file: `$env:GELDAR_SHARD_FILE = '<checkout>/shards/nf-mind.yaml'` (needs P3 merged).
4. Check only, one per life. Expected: `ok: 64x64 skin for <player id> (life <life id>); not uploaded`.
   ```powershell
   ./geldar.ps1 pnpm --filter @geldar/players-cli exec node src/cli.ts skin set ag-turbogreen-01 <Downloads>/<png file> --check-only
   ```
   The five files are `2013_11_21_skin_<id>.png` in the Downloads folder: green `ag-turbogreen-01`, yellow `ag-turboyelo-01`
   (life `ag_turboyelo_01`, 15 characters), blue, red and pink. Use the player id listed in the shard file for each.
5. Tunnel. Read the NATS container's bridge address (read only, on the node):
   ```sh
   docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' <nf nats container>
   ```
   Then, in a second terminal, `ssh -N -L 14222:<nats container address>:4222 <node user>@<node host>`. The port 46222 is not
   published, so the tunnel goes to the container address. In the first terminal set `GELDAR_NATS_URL=nats://127.0.0.1:14222`,
   `GELDAR_NATS_USER=ranger` and the password-file variable the CLI reads (its name is UNVERIFIED here: read `connectNats` in
   `contract/` before this step). The file holds the `ranger` password with `$KV.geldar-skins.>` publish (N1). Never put the password on
   a command line.
6. Upload, one at a time, classic unless G3 says slim:
   ```powershell
   ./geldar.ps1 pnpm --filter @geldar/players-cli exec node src/cli.ts skin set ag-turbogreen-01 <Downloads>/<png file> --model classic
   ```
   Expected: `stored the classic skin for ag-turbogreen-01 (life ag_turbogreen_01) in geldar-skins`. MineSkin rate limits apply
   ([skins.md](skins.md)): wait between uploads if refused. All five are 64x64.
7. Verify: `skin show <player id>` prints the variant, the texture host `textures.minecraft.net` and a signature length. Close the
   tunnel. Delete `compose/secrets/mineskin.txt` with `Remove-Item`, clear the `GELDAR_*` variables, and check `git status` is clean.
8. Reconnect and look: N7.

**Fallback without a tunnel** ([skins.md](skins.md), "Sign a skin"): `skin set ... --no-store --export-json <path outside the repo>`,
copy the JSON to the node, and import it in the node's admin container with `skin-import`. That needs the overlay's admin service to
mount a 0700 directory read-only at `/run/skins`.

## Held: packet 4 (hand ids and tokens to scriptorium)

**HELD. Do not run.** Packet 4 gives the five life ids and player ids, the MCP URL, and five bearer tokens to scriptorium. It waits on
two things: kit 0.3.0, and the Mind-host CPU measurement. The MCP URL is loopback (`127.0.0.1:46788`, path `/p/<player id>`); the
public route and the Host allow-list for nf are not set up. Tokens are minted by `token-mint` into a 0700 directory and delivered
through the owner's channel only, never into the repo or a log. Before that hand-off, geldar-69 flips `presence.start` to `on_demand`
if the owner chose `always`.

Nothing in this runbook starts a Mind. Stop before packet 4 and tell geldar-69.
