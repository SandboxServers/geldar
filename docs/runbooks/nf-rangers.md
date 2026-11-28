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
- Every `plan`, `up`, `rangers-admin` and `probe` command carries the same `NF_HUMAN`, `NF_TELEMETRY` and `NF_EXTRA_MODS` as the
  live run. Take the values from the live run (`NF_TELEMETRY` and `NF_EXTRA_MODS` from the ops env file, `NF_HUMAN` from the shell;
  never print the file). The `<same as the live run>` placeholders are not shell syntax: replace each with the live value. Omitting
  one changes the render: compose recreates `neoforge`, and `check_human_orphan` refuses while a human container exists.
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

### N0 (continued). Where the shell values come from (read only)

`NF_HUMAN`, `NF_HUMAN_BIND`, `NF_HUMAN_PORT`, `NF_TELEMETRY` and `NF_EXTRA_MODS` are shell exports at bring-up. They are not
committed ([nf-live-project.md](nf-live-project.md) section 10.2). The source of truth for the running project is the containers.
The two commands below print only whether the human binding is loopback, its port, and overlay file names. No address goes into
the repo or the step log.

```sh
docker inspect -f '{{range $p, $b := .NetworkSettings.Ports}}{{range $b}}{{.HostIp}} {{.HostPort}}{{"\n"}}{{end}}{{end}}' <nf velocity-human container> | awk 'NF==2 { print (($1=="127.0.0.1") ? "loopback" : "NOT loopback"), "port", $2 }'
docker inspect -f '{{index .Config.Labels "com.docker.compose.project.config_files"}}' <nf neoforge container> | tr ',' '\n' | xargs -n1 basename
```

Expected: one `loopback` or `NOT loopback` line with a port, and the overlay names the live project was brought up with (for
example `nf-live.yml`, `nf-live-rangers.yml`). Map them to the shell values:

- `nf-live-human.yml` listed: `NF_HUMAN=on`. Set `NF_HUMAN_BIND` and `NF_HUMAN_PORT` from the first command (the address stays in
  the shell). No such line: `NF_HUMAN` is unset or `off`.
- `nf-live-telemetry.yml` listed: `NF_TELEMETRY=on`.
- `nf-live-mod-<name>.yml` listed: `NF_EXTRA_MODS` names that mod overlay. The exact value form is UNVERIFIED: read how
  `deploy/nf-deploy.sh` parses `NF_EXTRA_MODS` before you set it.

If a listed overlay and the shell value disagree, stop and tell geldar-69. `<nf neoforge container>` and `<nf velocity-human container>`
are the names from `docker ps` in N0.

## N1. NATS users, in place (no restart)

N1 adds two users, `ranger` and `mcp`, to the live `nats-auth.conf` and sends it a SIGHUP. It does not regenerate anything. The
new conf is the node's live file plus only those two user lines and their permission lines. Every existing user line and every
existing password stays byte-identical. The reload is the in-place path the Colo NATS conf uses ([nats-auth-inplace.md](nats-auth-inplace.md),
the in-place section). It is **not** `refresh-secrets`: that verb recreates neoforge too, which restarts the world, and it needs
geldar-69's say first. Do not use it for N1.

The two user lines are the generator's output for `ranger` and `mcp` in `deploy/nats-auth-nf.ps1` on main (`Get-NfNatsUsers`,
the `$broadDeny` list, and the `mcp` and `ranger` entries, with `$s` = `nf`). They are copied from it, not retyped. If the
generator changes, re-copy them. The password field is the placeholder `@PASSWORD@`, filled from the password file at write
time; no password is printed.

**Re-measure the node right before N1.** The numbers are from this moment, not from the plan.

```sh
docker stats --no-stream
free -m
```

Expected: `free -m` `available` above 30000 MiB, with the project's six services at their normal CPU. Record both outputs in the
step log. If available memory is below 30000 MiB, stop and tell geldar-69: the rangers add five Bodies and one door on this node.
The CPU floor is owner-set and not in this runbook; geldar-69 gives it with the go.

**Variables and the secrets directory (read only).** The ops account is uid 1001 (see "Rules for every step"), and the compose
services run as `NF_SERVICE_UID` (`compose/nf-live-rangers.yml`), so the secret files must be owned by that uid.

```sh
export NF_SECRETS_DIR=<node secrets-nf directory>
export NF_SERVICE_UID=1001
export STAGE="$HOME/nats-stage-rangers"
umask 077
mkdir -p "$STAGE"
stat -c '%a %u:%g %U %n' "$NF_SECRETS_DIR" "$NF_SECRETS_DIR/nats-auth.conf" "$NF_SECRETS_DIR/nats-neoforge.txt"
```

Expected: the directory is `700` and the live conf `600`, both owned by the ops account. The sibling `nats-neoforge.txt` is
`600 1001:1001` (UNVERIFIED on the node: this is the check). The new password files must match the sibling's owner and mode. If the
sibling is owned by another uid, stop and tell geldar-69 before you create anything.

1. Create the four new password files on the node, only if missing. The value is never printed. The ops account is uid 1001, so
   the files are created with the service owner; the `stat` in step 2 is the check.
   ```sh
   umask 077
   for f in nats-ranger.txt nats-mcp.txt postgres-mcp.txt mcp-token-pepper.txt; do
     if test -s "$NF_SECRETS_DIR/$f"; then echo "kept $f"; else
       printf '%s' "$(openssl rand -hex 32)" > "$NF_SECRETS_DIR/$f" && echo "created $f"
     fi
   done
   stat -c '%a %u:%g %n' "$NF_SECRETS_DIR"/nats-ranger.txt "$NF_SECRETS_DIR"/nats-mcp.txt "$NF_SECRETS_DIR"/postgres-mcp.txt "$NF_SECRETS_DIR"/mcp-token-pepper.txt
   ```
   Expected: one `created <name>` or `kept <name>` per file, and `600 1001:1001` for each `stat` line (a `test -s` failure on an
   empty file recreates it, as the generator does). If a `stat` line shows another owner, stop; the owner is fixed by the account
   that owns the directory, not in this runbook.

   Rollback: `rm` only the files this step printed as `created`. Do it before N2 starts.

2. Stage a copy of the live conf outside the live path (the live file is not touched):
   ```sh
   cp -p "$NF_SECRETS_DIR/nats-auth.conf" "$STAGE/nats-auth.live.conf"
   sha256sum "$NF_SECRETS_DIR/nats-auth.conf" "$STAGE/nats-auth.live.conf"
   ```
   Expected: the two hashes are equal.

3. Write the two user-line templates. The heredocs are quoted, so `$` is not expanded:
   ```sh
   cat > "$STAGE/ranger.tpl" <<'EOF'
         { user: "ranger", password: "@PASSWORD@", permissions: { publish: { allow: ["geldar.nf.>", "$JS.API.>", "$JS.ACK.>", "_INBOX.>", "$KV.geldar-life-registry.>", "$KV.geldar-checkpoints.>", "$KV.geldar-body-generation.>", "$KV.geldar-skins.>", "$KV.geldar-plans.>", "$KV.geldar-seen.>"], deny: ["geldar.nf.kino.>", "geldar.nf.blockowner.changed", "geldar.nf.ctl.body.>", "geldar.nf.helper.body.>", "geldar.nf.state.*.level", "geldar.nf.body.*.hearing", "geldar.nf.provenance.>", "geldar.nf.life.>", "geldar.nf.maintenance", "geldar.nf.dlq", "$JS.API.STREAM.DELETE.>", "$JS.API.STREAM.PURGE.>", "$JS.API.CONSUMER.DELETE.>"] }, subscribe: { allow: ["geldar.nf.body.>", "geldar.nf.blockowner.changed", "geldar.nf.state.*.level", "geldar.nf.provenance.>", "_INBOX.>"], deny: ["_INBOX.human.>"] }, allow_responses: true } }
   EOF
   cat > "$STAGE/mcp.tpl" <<'EOF'
         { user: "mcp", password: "@PASSWORD@", permissions: { publish: { allow: ["geldar.nf.sovereign_call", "geldar.nf.body.>", "$KV.geldar-presence.>", "$JS.API.>", "$JS.ACK.>", "_INBOX.>"], deny: ["geldar.nf.body.*.hearing", "geldar.nf.maintenance", "geldar.nf.dlq", "$JS.API.STREAM.DELETE.>", "$JS.API.STREAM.PURGE.>", "$JS.API.CONSUMER.DELETE.>"] }, subscribe: { allow: ["_INBOX.>"], deny: ["_INBOX.human.>"] }, allow_responses: true } }
   EOF
   ```
   Expected: no output. The deny lists are the `$broadDeny` list (generator line 44) plus the mcp and ranger PubDeny and SubDeny
   entries (lines 75 and 79-80). The indent is six spaces, as in the live file.

4. Fill each password from its file. `awk` reads the file, so the value never reaches a command line or the terminal:
   ```sh
   awk -v pf="$NF_SECRETS_DIR/nats-ranger.txt" 'BEGIN { if ((getline p < pf) <= 0 || p == "") exit 1; close(pf) } { gsub(/@PASSWORD@/, p); print }' "$STAGE/ranger.tpl" > "$STAGE/ranger.line"
   awk -v pf="$NF_SECRETS_DIR/nats-mcp.txt" 'BEGIN { if ((getline p < pf) <= 0 || p == "") exit 1; close(pf) } { gsub(/@PASSWORD@/, p); print }' "$STAGE/mcp.tpl" > "$STAGE/mcp.line"
   grep -c '@PASSWORD@' "$STAGE/ranger.line" "$STAGE/mcp.line"
   ```
   Expected: `0` for each file. A non-zero exit from either awk, or a placeholder left behind, means STOP: the password file is
   empty or unreadable.

5. Build the new conf. The anchor is the users list: the one line `    ]` that closes it, and the user line directly above it
   (the last user). `awk` counts the anchor, so a missing or doubled anchor stops the step. The last user line gains a comma, which
   the array needs, and the two new lines follow it; nothing else changes:
   ```sh
   grep -c -E '\{ user: "(ranger|mcp)"' "$STAGE/nats-auth.live.conf"
   awk -v R="$STAGE/ranger.line" -v M="$STAGE/mcp.line" '
   { l[NR] = $0 }
   END {
     c = 0; n = 0
     for (i = 1; i <= NR; i++) if (l[i] == "    ]") { n++; c = i }
     if (n != 1 || c < 2) { print "STOP: users close line missing or ambiguous" > "/dev/stderr"; exit 1 }
     if (l[c-1] !~ /allow_responses: true } }$/) { print "STOP: the line above ] is not a user line" > "/dev/stderr"; exit 1 }
     for (i = 1; i < c - 1; i++) print l[i]
     print l[c-1] ","
     while ((getline x < R) > 0) print x ","
     close(R)
     while ((getline x < M) > 0) print x
     close(M)
     for (i = c; i <= NR; i++) print l[i]
   }' "$STAGE/nats-auth.live.conf" > "$STAGE/nats-auth.new.conf" || { echo "STOP: anchor check failed"; false; }
   ```
   Expected: the first `grep -c` prints `0` (neither user exists yet; a non-zero count means STOP, the users are already in the
   conf). The awk prints nothing and writes `nats-auth.new.conf`.

6. Validate the new conf with the project's pinned NATS image, read only, no network, the conf mounted read only. The live
   container is not used:
   ```sh
   docker run --rm --pull never --network none --read-only --entrypoint nats-server -v "$STAGE/nats-auth.new.conf:/etc/nats/nats-auth.conf:ro" nats:2.15.1-alpine@sha256:7ae34c25dfd6fe2e01c6483eabef20d796690fdcac6c4d94ca780a6cf9877fde -t -c /etc/nats/nats-auth.conf
   ```
   Expected: exit 0 and a line saying the configuration is valid (the wording is UNVERIFIED). Any error: STOP.

7. Redacted diff. Passwords are masked, and the diff must show only the expected change, or STOP:
   ```sh
   diff <(sed -E 's/password: "[^"]*"/password: "<redacted>"/' "$STAGE/nats-auth.live.conf") <(sed -E 's/password: "[^"]*"/password: "<redacted>"/' "$STAGE/nats-auth.new.conf")
   grep '^ *http:' "$NF_SECRETS_DIR/nats-auth.conf" "$STAGE/nats-auth.new.conf"
   ```
   Expected: the diff has one `<` line (the old last user line) and three `>` lines: that same line with a trailing comma, then the
   `ranger` line, then the `mcp` line. Nothing else, no other hunk. The two `http:` lines are equal. Any other difference: STOP.
   (The comma on the old last line is the one change to an existing line. The array needs it; the brief's "only the two added
   lines" cannot hold for an appended array entry. Whether NATS accepts the comma is UNVERIFIED until step 6 passes.)

8. Backup the live conf with a timestamp (the rollback uses it). Record its inode before the write in step 9:
   ```sh
   BAK="$NF_SECRETS_DIR/nats-auth.conf.bak-$(date -u +%Y%m%dT%H%M%SZ)"
   cp -p "$NF_SECRETS_DIR/nats-auth.conf" "$BAK" && cmp "$NF_SECRETS_DIR/nats-auth.conf" "$BAK" && stat -c '%a %i %n' "$BAK" "$NF_SECRETS_DIR/nats-auth.conf"
   ```
   Expected: `cmp` is silent; the backup is `600`; the live conf's inode number is the one you record.

9. Write the new conf in place. The container bind-mounts this one file, so the write must keep its inode:
   ```sh
   cat "$STAGE/nats-auth.new.conf" > "$NF_SECRETS_DIR/nats-auth.conf"
   sha256sum "$NF_SECRETS_DIR/nats-auth.conf" "$STAGE/nats-auth.new.conf"
   stat -c '%a %u %i %n' "$NF_SECRETS_DIR/nats-auth.conf"
   ```
   Expected: the two hashes are equal, mode `600`, and the inode is the one recorded in step 8. `mv` would put a new inode on the
   path, and the container would keep reading the old file. `cp` only keeps the inode while the destination exists and is not
   replaced; `cat >` is the form that writes the same inode and leaves mode and owner alone.

10. Reload with SIGHUP (not a restart). Read the NATS and service state before and after (step 11).
   ```sh
   docker kill --signal=HUP <nf nats container>
   docker logs --since 2m <nf nats container> 2>&1 | tail -n 20
   ```
   Expected (the log wording is UNVERIFIED on nf): a line with `Reloaded server configuration` and a line with
   `Reloaded: authorization users`, and no `[ERR]` line.

11. Connection counts and uptime, before step 9 and after step 10. The count must be unchanged; a service restart is a STOP.
   ```sh
   docker exec <nf nats container> wget -qO- http://127.0.0.1:8222/connz | grep -o '"num_connections": *[0-9]*'
   docker ps --filter label=com.docker.compose.project=geldar-nf --format '{{.Names}} {{.Status}}'
   ```
   Expected: the same `num_connections` before and after (UNVERIFIED: the image has `wget`; the repo has no other read-only
   `/connz` check). `velocity`, `neoforge` and `eventsink` keep their uptime. A count that moves by one or two as clients
   reconnect is not a STOP on its own; say so in the log.

12. Per-role allow and deny checks. The repo has no verified check command for these, so this step is UNVERIFIED on the node. Use
   the nats CLI or the node's admin helper from a one-shot client on the nf network with the password file mounted read only.
   Never put a password on a command line. If neither tool can read a password file, STOP and report.
   - `ranger` connects, publishes `geldar.nf.body.ag_turboyelo_01.snapshot` (allowed), and is refused `geldar.nf.maintenance` (denied).
   - `mcp` connects, publishes `geldar.nf.sovereign_call` (allowed), and is refused `geldar.nf.body.ag_turboyelo_01.hearing` and
     `geldar.nf.maintenance` (denied), and is refused a subscribe to `_INBOX.human.x`.
   - Expected for a refusal: a permissions violation reported by the client (the wording is UNVERIFIED). The denied subject must
     not be delivered to any other client.

**Rollback.** Put the backup back in place, the same way, and reload. Then run the step 11 and step 12 checks again; the `ranger` and
`mcp` users are then expected to be refused, and the existing users must still connect:
```sh
cat "$BAK" > "$NF_SECRETS_DIR/nats-auth.conf"
sha256sum "$NF_SECRETS_DIR/nats-auth.conf" "$BAK"
docker kill --signal=HUP <nf nats container>
```
The four new password files may stay; the extra users are harmless unused. If the reload fails and the conf will not load,
roll back and tell geldar-69; the fallback is a restart path that recreates neoforge and needs a notice and an owner go.

## N1a. Tokens directory (before N2)

The `rangers-admin` one-shot mounts a host directory for token files (`compose/nf-live-rangers.yml`, `create_host_path: false`).
Compose never creates it, so the run fails until it exists. Create it outside the checkout, mode 0700, owned by the service uid,
the same way as the skins directory in [skins.md](skins.md) (`sudo` is needed because `/etc/geldar` is root-owned):

```sh
sudo install -d -m 0700 -o "$NF_SERVICE_UID" -g "$NF_SERVICE_UID" /etc/geldar/tokens-nf
export NF_TOKENS_DIR=/etc/geldar/tokens-nf
stat -c '%a %u %n' "$NF_TOKENS_DIR"
```

Expected: `700 1001 /etc/geldar/tokens-nf` (the uid is `NF_SERVICE_UID`). `N2` to `N5` pass `NF_TOKENS_DIR` to each `rangers-admin` run.

**Rollback.** `sudo rmdir /etc/geldar/tokens-nf` (it refuses while the directory holds files, which is correct), then `unset NF_TOKENS_DIR`.

## N2. Database (additive)

Needs N3's admin image, so run N3 first if it is not built. Take a `pg_dump` of `geldar_nf` through an owner-approved path first:
that dump is the real rollback.

```sh
NF_TOKENS_DIR=/etc/geldar/tokens-nf NF_HUMAN=<same as the live run> NF_TELEMETRY=<same as the live run> NF_EXTRA_MODS=<same as the live run> docker compose -p geldar-nf -f compose/nf-live.yml -f compose/nf-live-rangers.yml --profile admin run --rm --no-deps rangers-admin migrate --dry-run
```

Expected: exactly `0067` and `0068` pending. Then apply without `--dry-run`:

```sh
NF_TOKENS_DIR=/etc/geldar/tokens-nf NF_HUMAN=<same as the live run> NF_TELEMETRY=<same as the live run> NF_EXTRA_MODS=<same as the live run> docker compose -p geldar-nf -f compose/nf-live.yml -f compose/nf-live-rangers.yml --profile admin run --rm --no-deps rangers-admin migrate
NF_TOKENS_DIR=/etc/geldar/tokens-nf NF_HUMAN=<same as the live run> NF_TELEMETRY=<same as the live run> NF_EXTRA_MODS=<same as the live run> docker compose -p geldar-nf -f compose/nf-live.yml -f compose/nf-live-rangers.yml --profile admin run --rm --no-deps rangers-admin migrate --set-role-password geldar_mcp --password-file /run/secrets/postgres-mcp.txt
```

Expected: a one-line OK for the second command, and no password printed. Verify read only:

```sh
docker exec <nf postgres container> psql -U geldar -d geldar_nf -Atc "select max(version) from schema_migrations; select rolcanlogin from pg_roles where rolname='geldar_mcp'"
```

Expected: `0068` and `t`.

**Rollback.** Migrations are forward only. `ALTER ROLE geldar_mcp NOLOGIN` restores the role state. The real rollback is the
`pg_dump` taken first, restored by the owner.

## N3. Build and render

**Prerequisite P1 (hard gate).** Golem must accept `neoforge` as an RCON host. That change is on branch
`phase1/nf-rangers-golem-host` and is held until geldar-69 merges it together with the Body recreation. Do not start N3
or N4 before P1 is merged and the five ranger Bodies are recreated from it. Without P1 the Bodies crash-loop under
`restart: unless-stopped`, because they cannot reach RCON on `neoforge`.

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
NF_RANGERS=on NF_HUMAN=<same as the live run> NF_TELEMETRY=<same as the live run> NF_EXTRA_MODS=<same as the live run> DEPLOY_DRY_RUN=1 deploy/nf-deploy.sh plan
```

Expected: the plan lists the rangers step, which reads exactly:

```text
rangers (NF_RANGERS=on, after the steps above): up -d --wait --no-deps geldar-mcp and the five ranger Bodies (ranger-yellow ranger-green ranger-blue ranger-red ranger-pink); geldar-mcp publishes 127.0.0.1:46788, the Bodies publish nothing
```

and no recreate of nats, neoforge, velocity, eventsink or postgres. The `46788` is `RANGERS_PORT` in `deploy/nf-rangers-lib.sh`.

```sh
NF_RANGERS=on NF_HUMAN=<same as the live run> NF_TELEMETRY=<same as the live run> NF_EXTRA_MODS=<same as the live run> deploy/nf-deploy.sh up
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
NF_TOKENS_DIR=/etc/geldar/tokens-nf NF_HUMAN=<same as the live run> NF_TELEMETRY=<same as the live run> NF_EXTRA_MODS=<same as the live run> docker compose -p geldar-nf -f compose/nf-live.yml -f compose/nf-live-rangers.yml --profile admin run --rm --no-deps rangers-admin owner-add <owner id> --cap 5
NF_TOKENS_DIR=/etc/geldar/tokens-nf NF_HUMAN=<same as the live run> NF_TELEMETRY=<same as the live run> NF_EXTRA_MODS=<same as the live run> docker compose -p geldar-nf -f compose/nf-live.yml -f compose/nf-live-rangers.yml --profile admin run --rm --no-deps rangers-admin roster add <name> --owner <owner id>
NF_TOKENS_DIR=/etc/geldar/tokens-nf NF_HUMAN=<same as the live run> NF_TELEMETRY=<same as the live run> NF_EXTRA_MODS=<same as the live run> docker compose -p geldar-nf -f compose/nf-live.yml -f compose/nf-live-rangers.yml --profile admin run --rm --no-deps rangers-admin player-add <player-id> --owner <owner id> --life <life id> --name <Name> --harness <harness>
NF_TOKENS_DIR=/etc/geldar/tokens-nf NF_HUMAN=<same as the live run> NF_TELEMETRY=<same as the live run> NF_EXTRA_MODS=<same as the live run> docker compose -p geldar-nf -f compose/nf-live.yml -f compose/nf-live-rangers.yml --profile admin run --rm --no-deps rangers-admin players-status
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
