# Runbook: update NATS authorization in place (Colo node)

Owner: the operator who holds the Colo node (geldar-93 in the Phase 1 notes). Approval: an owner go for the change, recorded before step 0.

This runbook changes the NATS users and permissions on the live Colo node without restarting the NATS container. It is the in-place path that genesis packet G2-02 asks for (`docs/analysis/genesis/packets.md`). The alternative, a full `docker compose up -d nats`, is in `deploy/README.md` (about lines 309-317). It drops every NATS client, so use it only when in-place is impossible, and publish a notice first.

Related: [0080 NATS auth cutover](../decisions/0080-nats-auth-cutover.md), [0087 NATS overlay, live test and scoped subjects](../decisions/0087-nats-overlay-live-test-and-scoped-subjects.md), [0199 muffled hearing](../decisions/0199-muffled-hearing.md) (the hearing subject deny), [0280 proficiency contract and state subjects](../decisions/0280-proficiency-contract-and-state-subjects.md) (the sheet state gap).

## Facts the procedure depends on

- Live file: `/mnt/nvme/geldar-colo/secrets/nats-auth.conf`, mode `0600`.
- It is a single-file read-only bind mount to `/etc/nats/nats-auth.conf` in container `geldar-colo-nats-1`. Image: `nats:2.15.1-alpine@sha256:7ae34c25dfd6fe2e01c6483eabef20d796690fdcac6c4d94ca780a6cf9877fde` (`compose/colo.yml`, `compose/nats-auth.yml`).
- Command (`compose/nats-auth.yml`): `-js -sd /data -c /etc/nats/nats-auth.conf`.
- **Never `mv` a new file over the live file.** A single-file bind mount follows the inode, so the container keeps the old file. Write in place with `cat new > live` or `cp new live`. Both keep the inode and the mode.
- The monitor line `http: "127.0.0.1:8222"` must be identical in the old and new file. A changed `http:` host cannot be reloaded (seen 2026-11-12). Check it in step 2.
- Passwords live in the conf and in `secrets/nats-<user>.txt`. The generator writes the conf only when it is missing (`Initialize-NatsAuth` and `Get-NatsUsers` in `geldar.ps1`, about lines 319 and 370). So a repo change never reaches the node by itself.
- `deploy/colo-cd.sh` does not touch the conf. `deploy/colo-cd-plan.sh` lists NATS as a `needs manual` item (`deploy/README.md`, the plan script row).
- The monitor listens on `127.0.0.1:8222` inside the container. Do not probe it from outside, and do not publish it.

## Drift to resolve first

As of 2026-11-14 the live file and the generator on `main` differ (by user and permission line only; no secret values are recorded here). The helper column is the generator after PR #415, which is not merged yet (`git grep helper -- geldar.ps1` on `main` finds nothing).

| Entry | Live node | Generator on `main` | Generator after #415 | Batch on the node |
|---|---|---|---|---|
| user `helper` | absent | absent | Sub the four helper subjects, Pub `_INBOX.>` | add |
| user `supervisor` | absent | Pub `_INBOX.>`, Sub `geldar.<s>.ctl.body.>` | adds the four helper subjects to Pub, and `_INBOX.>` to Sub | add |
| user `register` | absent | Pub `geldar.<s>.ctl.body.>`, Sub `_INBOX.>` | unchanged | not in this batch |
| `body` PubDeny | `geldar.<s>.kino.>`, `geldar.<s>.blockowner.changed` | the same two, plus `geldar.<s>.ctl.body.>` and `geldar.<s>.state.*.level` | adds `geldar.<s>.helper.body.>` | add `geldar.<s>.helper.body.>` only |
| `paper` PubDeny | `geldar.<s>.kino.control`, `geldar.<s>.blockowner.query` | the same two, plus `geldar.<s>.ctl.body.>` and `geldar.<s>.state.*.level` | adds `geldar.<s>.helper.body.>` | add `geldar.<s>.helper.body.>` only |

Other users match. Live has 8 users (body, mind, eventsink, mcp, velocity, paper, kino, deploy); after this batch it has 10. The node has no `nats-supervisor.txt`, `nats-helper.txt` or `nats-register.txt`, and no compose mapping for them. The live `body` and `paper` denies for `ctl.body.>` and `state.*.level` stay drift until their own change; this batch does not add them.

Pending additions, none in the generator or the live file. Each needs its own decision-owner go:

- Sheet state subjects (decision 0280 known gap): deny publish `geldar.<s>.state.*.level` for body and paper; eventsink publish `geldar.<s>.life.*.sheet`; body and paper PubDeny `geldar.<s>.life.>`.
- Hearing subject (decision 0199 option A): body PubDeny `geldar.<s>.body.*.hearing`.
- Provenance (`docs/analysis/harness/work-packets-geldar-b.md`, about line 34): body PubDeny and Sub on `provenance.>`.
- Body control on the live node: `body` and `paper` PubDeny `geldar.<s>.ctl.body.>` (the generator on `main` has it, the live file does not), and the `register` user. The `register` user and its `REGISTER_NATS_*` env are the REG-NATS-COMPOSE row in `docs/analysis/phase1/ledger.md`, folded into C7-03b2.
- The batch below (`helper` and `supervisor` users, `helper.body.>` denies) is pending the PR #415 merge and its own owner go.

**Rule:** a change to the live file must land in `geldar.ps1` (the user list and the permission lines) in the same change, or the repo and the node drift again. Do not apply a live change that the generator does not produce. The change in the repo is reviewed like the live change.

## Batch: body helper users and subjects

This batch is the body helper's NATS wiring from the C7 registration session. The subjects and permissions are in `docs/analysis/phase1/packets/c7f-packets.md` (item 7) and `docs/analysis/phase1/packets/c7c-packets.md` (`supervisor` and `register`). `<s>` is the shard name, `colo` on the node. The generator lines are in PR #415 (`Get-NatsUsers` in `geldar.ps1`, pinned by `tools/repo-checks/src/nats-auth.test.ts`). Apply the batch only after #415 is merged, so that the node runs what the generator produces. `/opt/geldar` does not exist on the node yet; the install script (card C7-03c5) creates it (root, mode 0755) together with the pinned node binary and the bundled `dist/main.js`, both hash-checked, because the node has no Node runtime on PATH for any user.

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

## Procedure

Run on the Colo node, as the account that owns the secrets directory. Never print the contents of `secrets/` or any password file. Use `sed` to redact before any diff.

**0. Preconditions**

- The owner go is recorded, and the window is agreed.
- For the batch, PR #415 is merged to `main` and the node has the merged `geldar.ps1`.
- The helper install script has run on the node, so `secrets/nats-helper.txt` exists and is non-empty. This runbook never creates, chowns or overwrites that file:
  ```sh
  test -s /mnt/nvme/geldar-colo/secrets/nats-helper.txt && echo "nats-helper.txt present"
  ```
  If the line prints nothing, stop: the install script has not run, and the NATS edit waits for it.
- Create ONLY `nats-supervisor.txt`. Do it in a shell with `umask 077` and `set -C`, so an existing file is never overwritten. Never print the value, and never paste it into a log or chat:
  ```sh
  umask 077
  set -C
  openssl rand -hex 32 > /mnt/nvme/geldar-colo/secrets/nats-supervisor.txt
  set +C
  stat -c '%U:%G %a %n' /mnt/nvme/geldar-colo/secrets/nats-supervisor.txt
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
cp /mnt/nvme/geldar-colo/secrets/nats-auth.conf /mnt/nvme/geldar-colo/secrets/nats-auth.conf.bak-$STAMP
chmod 0600 /mnt/nvme/geldar-colo/secrets/nats-auth.conf.bak-$STAMP
sha256sum /mnt/nvme/geldar-colo/secrets/nats-auth.conf /mnt/nvme/geldar-colo/secrets/nats-auth.conf.bak-$STAMP
```

Record the two sha256 values. They must match.

**2. Stage the new conf**

- Make a private staging directory outside `secrets/`: `install -d -m 0700 "$HOME/nats-stage"`. Do not use `secrets/nats-auth.conf.new`: it is a stale, unvalidated leftover. Do not use it, and do not delete it without the owner.
- Write the new conf to `$HOME/nats-stage/nats-auth.conf` with `umask 077`, so it is `0600`.
- Passwords come from the existing `secrets/nats-<user>.txt` files, one per user that already exists. This runbook creates no new password for an existing user. The helper's password is READ from `secrets/nats-helper.txt`, the file the helper install script already created; the helper's environment points at the same file, so both sides use one value. Never create or overwrite that file here. The supervisor's password is read from `nats-supervisor.txt` (step 0). Copy each value into the staged conf with a script that reads the file. Never echo it, and never type it by hand.
- For the batch, add to the staged copy only the lines in the batch section: the `helper` and `supervisor` users, and one `geldar.<s>.helper.body.>` PubDeny each on `body` and `paper`.
- Check the monitor line is unchanged:
  ```sh
  grep -n 'http:' /mnt/nvme/geldar-colo/secrets/nats-auth.conf "$HOME/nats-stage/nats-auth.conf"
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
sed -E 's/password[^,}]*/password=REDACTED/g' /mnt/nvme/geldar-colo/secrets/nats-auth.conf > "$HOME/nats-stage/old.redacted"
sed -E 's/password[^,}]*/password=REDACTED/g' "$HOME/nats-stage/nats-auth.conf" > "$HOME/nats-stage/new.redacted"
diff "$HOME/nats-stage/old.redacted" "$HOME/nats-stage/new.redacted"
```

Read the diff against the pending list and the decision. Only the expected users and subjects may change. Delete the two `.redacted` files afterwards.

For the batch, the diff must show exactly: two added user blocks (`helper`, `supervisor`) with the subjects of the batch section, and one added `helper.body.>` PubDeny line each on `body` and `paper`. Any other line, including a `register` user, stops the change.

**4. Apply in place**

```sh
cat "$HOME/nats-stage/nats-auth.conf" > /mnt/nvme/geldar-colo/secrets/nats-auth.conf
stat -c '%a %i' /mnt/nvme/geldar-colo/secrets/nats-auth.conf
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
cat /mnt/nvme/geldar-colo/secrets/nats-auth.conf.bak-<UTC stamp> > /mnt/nvme/geldar-colo/secrets/nats-auth.conf
sha256sum /mnt/nvme/geldar-colo/secrets/nats-auth.conf
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
- Do not run `./geldar.ps1 shard nats-auth colo` on the node. It is a trusted-machine command; on the node it would write a conf the node did not review.
- Do not edit `docs/spec.md` to match a live change.
