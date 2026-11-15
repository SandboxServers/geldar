# Supervisor container: node steps (geldar-93)

Status: operator runbook for C7-03b2 (decision 0260). It is the plan for geldar-93. Nothing here runs from the desktop or from CI.

Scope: the `supervisor` service in `compose/colo.yml` (profile `supervisor`, off by default), its secret files, the NATS users it needs, and the container that `deploy/colo-supervisor.sh` creates. The NATS batch for the body helper and the `supervisor` user is in `docs/runbooks/body-helper-node-steps.md` (C7-03c2). Follow that runbook's steps 1 to 4 first. The supervisor container is not enabled until they are DONE.

## Before merge (read first)

This branch must not reach the node's CD (`deploy/colo-up.sh`, `colo-cd.sh`, `colo-rollback.sh`) until these three files exist in `GELDAR_SECRETS_DIR`:

- `postgres-supervisor.txt`
- `nats-supervisor.txt`
- `nats-register.txt`

Each one: mode 0600, owned by `GELDAR_SERVICE_UID`, not empty. Compose declares all three as top-level secrets, and `check_secrets` in `deploy/common.sh` checks every top-level secret, including the ones behind a profile. Until the files exist, the deploy refuses to start with "secret file missing". `check_secrets` is not changed for this.

Merge is held until geldar-93 has created the three secret files; the owner's word is needed. Step 1 below creates them and checks them with `stat`.

## Gates (steps 2 to 5)

Gates 1 to 4 apply to steps 2 to 5. Step 1 (the three secret files) is done before the merge and needs only geldar-93's DONE and the owner's word; it does not wait for these gates.

1. The C7-03b4 live check has been run by the orchestrator, or the orchestrator has said the supervisor may start without it. The gate in the card is "must not be enabled before the C7-03b4 live check".
2. geldar-93 has received this plan: the exact diff, the commands, the time window and the rollback. geldar-93 answers DONE per step. The orchestrator holds each step until DONE.
3. The `PASSWORD_ROLES` change (C7-03c2, role `geldar_supervisor`) is merged and deployed before step 2 below.
4. The owner has given the go-ahead for the node window.

## Shared-resource rules (the Colo node is shared)

- No `docker compose up`, `down`, `stop`, `rm`, `restart` or `--force-recreate` for any project on the node. The network `geldar-colo` has drifted; a compose up on it fails with "network geldar-colo has active endpoints".
- Never create, remove or recreate the `geldar-colo` network. That is a separate owner chore.
- Only the `geldar-colo-supervisor` container is created here. No other container is touched.
- geldar-93-first: geldar-93 owns the node. Nothing in this runbook is run before geldar-93 has said DONE for that step.
- Never run `./geldar.ps1 shard nats-auth colo` on the desktop. It writes the node's auth file from desktop-side secrets, which is the drift this runbook avoids.

## Steps

1. **Secret files.** Owner uid first: `GELDAR_SERVICE_UID` is the node env value (default 1000, the uid every colo service runs as). Every secret file below must be owned by that uid, or the script and the deploy refuse it. Create the three files in `GELDAR_SECRETS_DIR`, mode 0600:
   - `postgres-supervisor.txt`: written by `deploy/gen-secrets.sh` (random; it creates only missing files).
   - `nats-supervisor.txt`: created on the node by the method in `docs/runbooks/nats-auth-inplace.md` step 0 (`umask 077`, `set -C`, random value), then `chown` to `GELDAR_SERVICE_UID` (the owner check refuses another owner). That is its only author. The script never creates it, and no value goes on a command line or into the repo. Creating it by that method first needs `nats-helper.txt` to exist: step 0 stops without it, and the helper install script (C7-03c5) creates that file. If the helper is not installed yet, geldar-93 creates the file with the same `umask 077` / `set -C` / `openssl rand` pattern without that stop line, noting it in the change log.
   - `nats-register.txt`: the same method (`umask 077`, `set -C`, so an existing file is never overwritten), then `chown` to `GELDAR_SERVICE_UID`. Its NATS user is added in step 3b.
   Check the modes, sizes and owners with `stat -c '%a %u %s %n'` only. Do not print the contents.

2. **Postgres role password.** Run the migrate verb with the password file, not a value:
   `deploy/colo-admin.sh migrate --set-role-password geldar_supervisor --password-file /run/secrets/postgres-supervisor.txt`
   The admin service mounts `postgres-supervisor.txt` at that path (compose `admin` secrets). The mount exists only once the merged compose is deployed, so this step waits for that deploy. The verb logs in with the file's password first and changes nothing when that login works, so a second run is a no-op. The operator routes use the superuser `geldar` (`postgres.txt`), not this role.

3. **NATS users.** Two separate batches, each with its own backup, masked diff, `nats-server -t`, in-place write (the file is a single-file bind mount, so `mv` does not reach the container), SIGHUP and owner go. Never a restart.
   - 3a. The `supervisor` user is not in this runbook. It is part of the body helper batch in `docs/runbooks/body-helper-node-steps.md` step 3 (C7-03c2).
   - 3a-prerequisite. The open drift must be closed first, or accepted by the owner in writing: the live `body` and `paper` users lack the PubDeny for `geldar.<s>.ctl.body.>` and `geldar.<s>.state.*.level` (see `docs/runbooks/nats-auth-inplace.md`). It is its own batch.
   - 3b. The `register` user, as in `docs/runbooks/open-signup.md` step 11: publish `geldar.<s>.ctl.body.>`, subscribe `_INBOX.>`, password from `nats-register.txt`. Its batch is separate from the helper batch. Never `./geldar.ps1 shard nats-auth colo` (see above). The diff must show only the `register` user.
   `body-helper-node-steps.md` states that the register user is unchanged by its batch, so 3b is not in that runbook.

4. **Start the container.** `GELDAR_SUPERVISOR_IMAGE` is the digest reference of the supervisor image (`ghcr.io/sandboxservers/geldar-supervisor@sha256:` and 64 hex characters). It is taken from the colo-images run log of the merge commit: the line `supervisor digest: <digest>` that the supervisor job's last step prints (C7-03b2 workflow change). It is not in `release.env` or the manifest summary yet, so do not look for it there. A tag is refused, and so is a value that starts with `-`.
   `GELDAR_SECRETS_DIR` must be an absolute path with no comma. `GELDAR_SERVICE_UID` must match the owner of the secret files.
   `GELDAR_SUPERVISOR_IMAGE=<digest> GELDAR_SECRETS_DIR=<absolute secrets dir> GELDAR_SERVICE_UID=<uid> deploy/colo-supervisor.sh`
   The script runs `docker create` and then `docker start` with the same flags, limits, labels, log options, read-only root, secret mounts and uid as the compose service (0.25 CPU, 128m memory with no swap, 64 pids). It refuses, and changes nothing, when the `geldar-colo` network is missing, when a secret file is missing or owned by another uid, when the image is not a digest, or when a container with the name already exists. It never calls compose and never creates or removes a network.
   The container has no healthcheck: it has no HTTP port. It exits with status 1 if its control subscription ends, and the restart policy `unless-stopped` starts it again.

5. **Verify.** No body is started in this step.
   - `docker ps` shows `geldar-colo-supervisor` running and healthy in the sense of not restarting.
   - A `ctl.body.status` request from the `register` NATS user is answered.
   - A request for an unknown name returns a refusal.
   Record the results in the geldar-93 DONE message. Do not paste the reply bodies if they contain a player name.

## Rollback

- The supervisor container only: `docker stop geldar-colo-supervisor`, then `docker rm geldar-colo-supervisor`. Nothing else is removed.
- Never a network remove, never `compose down`, never a volume removal.
- NATS: restore the previous `nats-auth.conf` contents from the masked diff's backup (`cat`, then check the sha), run `nats-server -t`, and SIGHUP again. Never a restart.
- Passwords: leave the files in place; they are inert without the container. Remove them only on the owner's instruction.
- After a rollback, the supervisor profile stays off. Nothing starts it by default: `colo-up.sh` and `colo-cd.sh` do not name the profile.

## After the steps

- geldar-93 records DONE for steps 1 to 5 (or the reason for a stop).
- The orchestrator runs the C7-03b4 live check (C7-03b4-live) on this container.
