---
title: "Update NATS authorization in place (Colo node)"
type: how-to
audience: operators
status: draft
last_verified: 2026-11-16 against 03c1f5de
companions: [README.md, body-helper-node-steps.md, open-signup.md, node-only-config.md, kino.md, skins.md]
sources: [../decisions/0080-nats-auth-cutover.md, ../decisions/0087-nats-overlay-live-test-and-scoped-subjects.md, ../decisions/0199-muffled-hearing.md, ../decisions/0280-proficiency-contract-and-state-subjects.md, geldar.ps1, deploy/install-body-helper.sh, deploy/README.md, compose/nats-auth.yml]
---

# Runbook: update NATS authorization in place (Colo node)

Owner: the node operator, the role that holds the Colo node. Approval: an owner go for the change, recorded before step 0.

This runbook changes the NATS users and permissions on the live Colo node without restarting the NATS container. It is the in-place path that genesis packet G2-02 asks for (`docs/analysis/genesis/packets.md`). The alternative, regenerate on the trusted machine, copy, and `docker compose up -d nats`, is in `deploy/README.md` (lines 309 to 318), and decision 0199 ("Deploy", line 80) names that same restart path for the hearing denies. It drops every NATS client, so use it only when in-place is impossible, and publish a notice first. No decision record states which path is the general rule; see the [runbooks index, open conflict 1](README.md#open-conflicts-recorded-in-runbook-text-not-resolved).

Related: [0080 NATS auth cutover](../decisions/0080-nats-auth-cutover.md), [0087 NATS overlay, live test and scoped subjects](../decisions/0087-nats-overlay-live-test-and-scoped-subjects.md), [0199 muffled hearing](../decisions/0199-muffled-hearing.md) (the hearing subject deny), [0280 proficiency contract and state subjects](../decisions/0280-proficiency-contract-and-state-subjects.md) (the sheet state gap).

## Facts the procedure depends on

- Live file: `$GELDAR_SECRETS_DIR/nats-auth.conf`, mode `0600`. `GELDAR_SECRETS_DIR` is the node's secrets directory (`deploy/README.md`, "Prerequisites"); set it in the shell before you run the commands below. The node's actual path is not written in this public file.
- It is a single-file read-only bind mount to `/etc/nats/nats-auth.conf` in container `geldar-colo-nats-1`. Image: `nats:2.15.1-alpine@sha256:7ae34c25dfd6fe2e01c6483eabef20d796690fdcac6c4d94ca780a6cf9877fde` (`compose/colo.yml`, `compose/nats-auth.yml`).
- Command (`compose/nats-auth.yml`): `-js -sd /data -c /etc/nats/nats-auth.conf`.
- **Never `mv` a new file over the live file.** A single-file bind mount follows the inode, so the container keeps the old file. Write in place with `cat new > live` or `cp new live`. Both keep the inode and the mode.
- The monitor line `http: "127.0.0.1:8222"` must be identical in the old and new file. A changed `http:` host cannot be reloaded (seen 2026-11-12). Check it in step 2.
- Passwords live in the conf and in `secrets/nats-<user>.txt`. The generator creates missing password files, and writes the conf only when it is missing (`Initialize-NatsAuth` and `Get-NatsUsers` in `geldar.ps1`, about lines 319 and 370). So a repo change never reaches the node by itself.
- `deploy/colo-cd.sh` does not touch the conf. `deploy/colo-cd-plan.sh` lists NATS as a `needs manual` item (`deploy/README.md`, the plan script row).
- The monitor listens on `127.0.0.1:8222` inside the container. Do not probe it from outside, and do not publish it.

## Drift to resolve first

The live file and the generator on `main` differ (by user and permission line only; no secret values are recorded here). The "Live node" column is the state recorded on 2026-11-14; it was not re-checked on the node for this runbook. The generator column is `Get-NatsUsers` in `geldar.ps1` (lines 370 to 415) at commit `03c1f5de`, read on 2026-11-16. PR #415, which added the `helper` user and the helper subjects, is merged (merge commit `4bab81b3`, 2026-11-15).

| Entry | Live node (recorded 2026-11-14) | Generator on `main` (03c1f5de) | Batch on the node |
|---|---|---|---|
| user `helper` | absent | Sub the four helper subjects, Pub `_INBOX.>` | add |
| user `supervisor` | absent | Pub `_INBOX.>` and the four helper subjects, Sub `geldar.<s>.ctl.body.>` and `_INBOX.>` | add |
| user `register` | absent | Pub `geldar.<s>.ctl.body.>`, Sub `_INBOX.>` | not in this batch |
| `body` PubDeny | `geldar.<s>.kino.>`, `geldar.<s>.blockowner.changed` | the same two, plus `geldar.<s>.ctl.body.>`, `geldar.<s>.helper.body.>`, `geldar.<s>.state.*.level` and `geldar.<s>.body.*.hearing` | add `geldar.<s>.helper.body.>` only |
| `paper` PubDeny | `geldar.<s>.kino.control`, `geldar.<s>.blockowner.query` | the same two, plus `geldar.<s>.ctl.body.>`, `geldar.<s>.helper.body.>` and `geldar.<s>.state.*.level` | add `geldar.<s>.helper.body.>` only |
| `mind` and `mcp` PubDeny | none recorded | `geldar.<s>.body.*.hearing` (added 2026-11-15, commit `3f6c1071`) | not in this batch |
| `body` Sub, `eventsink` Pub and Sub | not recorded | body Sub adds `geldar.<s>.state.*.level`; eventsink Pub `geldar.<s>.dlq` and `geldar.<s>.state.>`, Sub `geldar.<s>.state.*.proficiency` (added 2026-11-15, commit `d2843e94`) | not in this batch (see "AN-12b" below) |

On 2026-11-14 the other users matched the generator of that day. The hearing denies (`3f6c1071`), the `body` Sub on `state.*.level` and the eventsink lines (`d2843e94`) entered the generator on 2026-11-15, after that record. The `body` and `paper` PubDeny on `state.*.level` entered on 2026-11-14 (`a2d2a4e1`, `git log -S'state.*.level' -- geldar.ps1`) and was already drift in that record. Treat every user as drifted until the node file is diffed again (procedure step 3). Live had 8 users (body, mind, eventsink, mcp, velocity, paper, kino, deploy); after this batch it has 10. The node had no `nats-supervisor.txt`, `nats-helper.txt` or `nats-register.txt`, and no compose mapping for them. The live `body` and `paper` denies for `ctl.body.>` and `state.*.level` stay drift until their own change; this batch does not add them.

Pending additions. Each needs its own decision-owner go:

- Sheet state subjects (decision 0280 known gap): the `state.*.level` deny for body and paper is in the generator but not in the live file. Not in the generator: eventsink publish `geldar.<s>.life.*.sheet`, and body and paper PubDeny `geldar.<s>.life.>`.
- Hearing subject (decision 0199 option A): body, mind and mcp PubDeny `geldar.<s>.body.*.hearing`. In the generator since commit `3f6c1071`; not in the live file as recorded.
- Provenance (AN-28c): body PubDeny and Sub on `geldar.<s>.provenance.>`. In the generator since AN-28c; not in the live file as recorded.
- Body control on the live node: `body` and `paper` PubDeny `geldar.<s>.ctl.body.>` (the generator on `main` has it, the live file does not), and the `register` user. The `register` user and its `REGISTER_NATS_*` env are the REG-NATS-COMPOSE row in `docs/analysis/phase1/ledger.md`, folded into C7-03b2.
- The batch below (`helper` and `supervisor` users, `helper.body.>` denies) waits for its own owner go. Its generator change (PR #415) is merged.

**Rule:** a change to the live file must land in `geldar.ps1` (the user list and the permission lines) in the same change, or the repo and the node drift again. Do not apply a live change that the generator does not produce. The change in the repo is reviewed like the live change.

## Batch: body helper users and subjects

This batch is the body helper's NATS wiring from the C7 registration session. The subjects and permissions are in `docs/analysis/phase1/packets/c7f-packets.md` (item 7) and `docs/analysis/phase1/packets/c7c-packets.md` (`supervisor` and `register`). `<s>` is the shard name, `colo` on the node. The generator lines came in PR #415, merged as `4bab81b3` on 2026-11-15 (`Get-NatsUsers` in `geldar.ps1`, lines 411 to 413, pinned by `tools/repo-checks/src/nats-auth.test.ts`), so the node can run what the generator produces. `/opt/geldar` is not created by the install script. The node operator creates its directories by hand in [body-helper-node-steps.md](body-helper-node-steps.md) Step 0a (card C7-03c5) and stages the bundled `dist/main.js` and the pinned Node tarball there; `deploy/install-body-helper.sh --apply` then checks both hashes and extracts the pinned Node, because the node has no Node runtime on PATH for any user.

Names and subjects only:

- **NEW user `helper`**
  - Sub: exactly four subjects, no wildcard: `geldar.<s>.helper.body.start`, `geldar.<s>.helper.body.stop`, `geldar.<s>.helper.body.status`, `geldar.<s>.helper.body.logtail`.
  - Pub: `_INBOX.>` only.
  - Password file: `secrets/nats-helper.txt` (root-only). The helper install script creates it before this change; this runbook only reads it.
- **NEW user `supervisor`** (absent on the live file today)
  - Pub: the same four exact subjects (`geldar.<s>.helper.body.start`, `.stop`, `.status`, `.logtail`), plus `_INBOX.>`. The `_INBOX.>` stays because the supervisor answers `ctl.body.*` requests on inboxes (c7c); without it the replies to register fail.
  - Sub: `geldar.<s>.ctl.body.>` and `_INBOX.>`.
  - Password file: `secrets/nats-supervisor.txt`.
- **`register`**: unchanged by this batch (Pub `geldar.<s>.ctl.body.>`, Sub `_INBOX.>`). The live file has no `register` user. Adding it is the REG-NATS-COMPOSE step (`docs/analysis/phase1/ledger.md`), not this batch.
- **`body` and `paper`**: add PubDeny `geldar.<s>.helper.body.>`. Nothing else changes in their lines.

The password files must exist before step 2: `nats-supervisor.txt` is created by step 0, and `nats-helper.txt` by the helper install script. The new users go into the conf only after both files exist. A batch change that adds only these lines is the one the diff in step 3 must show.

## Batch: building KV buckets (`geldar-plans`, `geldar-seen`)

Owner step, done by hand on the node. This campaign does not make it. The building buckets are `geldar-plans` (plan chunks) and `geldar-seen` (the seen-block map), named in `golem/src/building/names.ts`. The `body` role creates both at its start through `openRestartKv` (`golem/src/body/restart.ts`, lines 152 and 153), and only when `body_actions.building` is on. The `body` role in `geldar.ps1` grants `$KV.` publish only for the life registry, checkpoints, body generation and skins; it does not grant `geldar-plans` or `geldar-seen`. So the live conf needs both before the flag-on restart: add `$KV.geldar-plans.>` and `$KV.geldar-seen.>` to the `body` Pub list, check the file, then reload NATS. Without them a Body with the flag on fails in `openRestartKv` and does not start. The generator line is not changed by this runbook, so a regenerate drops the in-place edit until the repo change lands. There is no seed step for these buckets: `golem/src/seed-buckets.ts` is a scratch-only one-shot that creates the two identity buckets with the `seed` user, and that user cannot create the building streams.

## Procedure

Run on the Colo node, as the account that owns the secrets directory. Never print the contents of `secrets/` or any password file. Use `sed` to redact before any diff.

**0. Preconditions**

- Set `GELDAR_SECRETS_DIR` in this shell to the node's secrets directory, then check it. If the check prints `stop`, do not go on: with the variable empty, the commands below would write to `/nats-auth.conf`.
  ```sh
  export GELDAR_SECRETS_DIR=<the node's secrets directory>
  test -n "$GELDAR_SECRETS_DIR" && test -d "$GELDAR_SECRETS_DIR" && test -f "$GELDAR_SECRETS_DIR/nats-auth.conf" && echo ok || echo stop
  ```
  Whether the node's login shell already exports the variable is unverified (it is set in the node's deploy environment, which is not in the repo).
- The owner go is recorded, and the window is agreed.
- For the batch, the node's checkout includes PR #415 (merged to `main` as `4bab81b3`).
- The helper install script has run on the node, so `secrets/nats-helper.txt` exists and is non-empty. This runbook never creates, chowns or overwrites that file:
  ```sh
  test -s "$GELDAR_SECRETS_DIR/nats-helper.txt" && echo "nats-helper.txt present"
  ```
  If the line prints nothing, stop: the install script has not run, and the NATS edit waits for it.
- Create ONLY `nats-supervisor.txt`. Do it in a shell with `umask 077` and `set -C`, so an existing file is never overwritten. Never print the value, and never paste it into a log or chat:
  ```sh
  umask 077
  set -C
  openssl rand -hex 32 > "$GELDAR_SECRETS_DIR/nats-supervisor.txt"
  set +C
  stat -c '%U:%G %a %n' "$GELDAR_SECRETS_DIR/nats-supervisor.txt"
  ```
  The `stat` output must show mode `600`. If `set -C` refuses the file, it exists: stop and check it with the owner, do not overwrite it.
- If clients may drop (any role that loses or gains permissions, or a restart), publish a maintenance notice first: `deploy/colo-notice.sh pause bodies <seconds>` (or `world`), and `back` after the change. The notice needs `nats-deploy.txt`; it warns and publishes nothing if the file is missing.
- Record the container count and the connection count:
  ```sh
  docker ps | wc -l
  docker exec geldar-colo-nats-1 wget -qO- http://127.0.0.1:8222/varz | grep -o '"connections": *[0-9]*'
  ```
  The connection count was 54 on 2026-11-14. Write both numbers in the change log.

**1. Backup**

```sh
umask 077
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
cp "$GELDAR_SECRETS_DIR/nats-auth.conf" "$GELDAR_SECRETS_DIR/nats-auth.conf.bak-$STAMP"
chmod 0600 "$GELDAR_SECRETS_DIR/nats-auth.conf.bak-$STAMP"
sha256sum "$GELDAR_SECRETS_DIR/nats-auth.conf" "$GELDAR_SECRETS_DIR/nats-auth.conf.bak-$STAMP"
```

Record the two sha256 values. They must match.

**2. Stage the new conf**

- Make a private staging directory outside `secrets/`: `install -d -m 0700 "$HOME/nats-stage"`. Do not use `secrets/nats-auth.conf.new`: it is a stale, unvalidated leftover. Do not use it, and do not delete it without the owner.
- Write the new conf to `$HOME/nats-stage/nats-auth.conf` with `umask 077`, so it is `0600`.
- Passwords come from the existing `secrets/nats-<user>.txt` files, one per user that already exists. This runbook creates no new password for an existing user. The helper's password is READ from `secrets/nats-helper.txt`, the file the helper install script already created; the helper's environment points at the same file, so both sides use one value. Never create or overwrite that file here. The supervisor's password is read from `nats-supervisor.txt` (step 0). Copy each value into the staged conf with a script that reads the file. Never echo it, and never type it by hand.
- For the batch, add to the staged copy only the lines in the batch section: the `helper` and `supervisor` users, and one `geldar.<s>.helper.body.>` PubDeny each on `body` and `paper`.
- Check the monitor line is unchanged:
  ```sh
  grep -n 'http:' "$GELDAR_SECRETS_DIR/nats-auth.conf" "$HOME/nats-stage/nats-auth.conf"
  ```
  Both must print `http: "127.0.0.1:8222"`.

**3. Validate without touching the live server**

```sh
docker run --rm --entrypoint nats-server \
  -v "$HOME/nats-stage/nats-auth.conf:/check/nats-auth.conf:ro" \
  nats:2.15.1-alpine@sha256:7ae34c25dfd6fe2e01c6483eabef20d796690fdcac6c4d94ca780a6cf9877fde \
  -t -c /check/nats-auth.conf
```

Expect `is valid`. Anything else stops the change.

Diff by user and permission lines, passwords redacted:

```sh
sed -E 's/password[^,}]*/password=REDACTED/g' "$GELDAR_SECRETS_DIR/nats-auth.conf" > "$HOME/nats-stage/old.redacted"
sed -E 's/password[^,}]*/password=REDACTED/g' "$HOME/nats-stage/nats-auth.conf" > "$HOME/nats-stage/new.redacted"
diff "$HOME/nats-stage/old.redacted" "$HOME/nats-stage/new.redacted"
```

Read the diff against the pending list and the decision. Only the expected users and subjects may change. Delete the two `.redacted` files afterwards.

For the batch, the diff must show exactly: two added user blocks (`helper`, `supervisor`) with the subjects of the batch section, and one added `helper.body.>` PubDeny line each on `body` and `paper`. Any other line, including a `register` user, stops the change.

**4. Apply in place**

```sh
cat "$HOME/nats-stage/nats-auth.conf" > "$GELDAR_SECRETS_DIR/nats-auth.conf"
stat -c '%a %i' "$GELDAR_SECRETS_DIR/nats-auth.conf"
```

The mode must still be `600`. Run `sha256sum` on the live file and compare it with the staged file. Do not run `mv`.

**5. Reload (SIGHUP, not a restart)**

```sh
docker kill -s HUP geldar-colo-nats-1
docker logs --since 2m geldar-colo-nats-1
```

The log must show, in this order or close to it:

- `Reloaded: authorization users`
- `Reloaded: accounts`
- `Reloaded server configuration`

Then check the connection count:

```sh
docker exec geldar-colo-nats-1 wget -qO- http://127.0.0.1:8222/varz | grep -o '"connections": *[0-9]*'
```

It should return to the pre-change number, 54 on 2026-11-14, within a minute or two as clients reconnect. If a `Reloaded` line is missing, stop and go to step 7.

**6. Verify each changed role**

- For each role whose permissions changed, check one denied publish is refused and one allowed publish still works. A refused publish is logged as a `Permissions Violation` line (`docker logs --since 5m geldar-colo-nats-1 | grep -i 'permissions violation'`). Do the allowed check with the role's own client, not the admin account.
- For the batch, with each role's own client and never the admin account: `supervisor` publishes a `geldar.<s>.helper.body.status` request and is not refused; `body` publishing `geldar.<s>.helper.body.status` is refused (`Permissions Violation`); `helper` subscribing to `geldar.<s>.helper.body.>` is refused, and subscribing to `geldar.<s>.helper.body.status` is allowed. A request with no responder is still an allowed publish; the helper may not be running yet.
- Check that `body`, `mcp` and `eventsink` are connected (the connection count, and their names in `GET /connz`, read through `docker exec ... wget`).
- Check for dead letters: no new dead-letter messages in the logs of Body, MCP and eventsink since the change.
- Body hosts and MCP reconnect on their own. Confirm it in their logs. Do not restart them by hand unless they stay disconnected for more than five minutes.

**7. Rollback**

Use this if a `Reloaded` line is missing, a required role is refused, or a dead letter appears that the change caused.

```sh
cat "$GELDAR_SECRETS_DIR/nats-auth.conf.bak-<UTC stamp>" > "$GELDAR_SECRETS_DIR/nats-auth.conf"
sha256sum "$GELDAR_SECRETS_DIR/nats-auth.conf"
docker kill -s HUP geldar-colo-nats-1
docker logs --since 2m geldar-colo-nats-1
```

The `sha256sum` must equal the backup's value from step 1. Then repeat the `Reloaded` check and the connection count from step 5. Keep the backup until the change is confirmed for a day. The two new password files stay after a rollback; remove them only with the owner.

## Client impact

**Not verified:** whether a reload closes live sessions of changed or removed users on nats-server 2.15.1. Earlier reloads logged the three `Reloaded` lines (2026-11-12 16:08:53Z and 2026-11-13 16:29:14Z), but nothing shows what happened to the sessions. The repo test `threshold/mcp/test/nats-auth.it.test.ts` only asserts that a revoked user is refused on its next connection.

What to expect until this is tested:

- Users whose entries did not change should stay connected.
- A client that loses permissions may be closed, or may get `Permissions Violation` errors on the next publish or subscribe.
- Body hosts and MCP should reconnect on their own. Verify it in the logs.

Test it once on a throwaway container before the live change:

1. Start `nats:2.15.1-alpine` (digest above) with a two-user conf, on a loopback port, with its own monitor port. Use a separate test container name. Never use the live name.
2. Connect one client as each user. Subscribe as one user to a subject it may read.
3. Remove one permission from the second user in a copy of the conf. Replace the conf in place (`cat`, not `mv`).
4. Send `docker kill -s HUP` to the test container.
5. Observe: is the first client still connected, is the second client closed, and what does its next publish get. Record the answer in this section.
6. Remove the test container and its temporary files.

Until the test records a result, plan the live change as if changed users are closed.

## Notes

- A change in the repo lands first. The generator (`geldar.ps1`) must produce the same conf the node runs. Check that with the golden test before the node change.
- Do not run `./geldar.ps1 shard nats-auth colo` on the node. It is a trusted-machine command. It writes into the checkout's dev secrets folder, not the live file: new password files and a Thinker token for any that are missing, and a conf only when none is there (`geldar.ps1` lines 326 to 344). Run on the node, it would leave unreviewed secret files in the node's checkout and would not change the live file in `GELDAR_SECRETS_DIR`.
- Do not edit `docs/spec.md` to match a live change.

## Open questions

- JetStream republish caveat (decision 0199, known limit, not verified live): the body, mind and mcp roles also hold $JS.API.>. A JetStream stream republish may emit to a subject without a publish-ACL check on that subject. If so, the PubDeny guards against mistakes and ordinary bugs, not against a hostile or compromised role. The existing Kino and state.*.level denies share this property. Applies to every PubDeny in the generated config; on the owner's list of open decisions, raised by the node operator.

## AN-12b: state subscriptions (AN-12b fix pass)

- body: Sub gains `geldar.<s>.state.*.level` (one life's level push). Not `state.>`.
- eventsink: Sub gains `geldar.<s>.state.*.proficiency` (one life's request). Not `state.>`.
- Add these two lines to the live file with this runbook's procedure (steps 0 to 7) before setting GELDAR_SHEET_SHARD, or the state service is refused. They are in the generator (`geldar.ps1` lines 386 and 393). Do not run `./geldar.ps1 shard nats-auth` on the node for this (see Notes): `Initialize-NatsAuth` writes only into the repo's git-ignored dev secrets folder: it creates any missing `nats-<user>.txt` password file and the Thinker token there (`geldar.ps1` lines 326 to 342), and writes the conf only when that conf is missing (line 344). It never writes the live file on the node. An earlier version of this line said to run it on the live node; that contradicted the Notes rule and the generator's behaviour, and was corrected on 2026-11-16.
- Sink opt-in override: `compose/opt-in/sheet-sink.yml` (not in the default set). Use it as `docker compose -f compose/colo.yml -f compose/opt-in/sheet-sink.yml up -d eventsink`. It is outside `compose/*.yml` so the compose lane does not validate it standalone.