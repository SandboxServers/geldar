# Supervisor container: node steps (geldar-93)

Status: operator runbook for C7-03b2 (decision 0260). It is the plan for geldar-93. Nothing here runs from the desktop or from CI.

Scope: the `supervisor` service in `compose/colo.yml` (profile `supervisor`, off by default), its two secret files, the NATS user it connects as, and the container that `deploy/colo-supervisor.sh` creates. The NATS users and the password steps for the body helper are in `docs/runbooks/body-helper-node-steps.md` (C7-03c2). Follow that runbook's steps 1 to 4 first. The supervisor container is not enabled until they are DONE.

## Gates (all must hold before any step runs)

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

1. **Password files.** Create the two files, mode 0600, in the node secrets directory (`GELDAR_SECRETS_DIR`):
   - `postgres-supervisor.txt`: written by `deploy/gen-secrets.sh` (random; the same pattern as the other Postgres files).
   - `nats-supervisor.txt`: written by geldar-93 from the trusted machine. The script never creates it, and no value goes on a command line or into the repo.
   Check the modes and owner with `stat` only. Do not print the contents.

2. **Postgres role password.** Run the migrate verb with the password file, not a value:
   `deploy/colo-admin.sh migrate --set-role-password geldar_supervisor --password-file <path to postgres-supervisor.txt>`
   The verb logs in with the file's password first and changes nothing when that login works, so a second run is a no-op. The operator routes use the superuser `geldar` (`postgres.txt`), not this role.

3. **NATS user.** Apply the `supervisor` NATS user and the `register` publish permission to the live `nats-auth.conf`, as set out in `docs/runbooks/body-helper-node-steps.md`. A masked diff comes first, then `nats-server -t` on the edited copy, an in-place write (the file is a single-file bind mount, so `mv` does not reach the container), and a SIGHUP reload. Never a restart.

4. **Start the container.** With the image digest from the release env file (`GELDAR_SUPERVISOR_IMAGE`; the digest, not a tag) and the secrets directory set:
   `deploy/colo-supervisor.sh`
   The script runs `docker create` and then `docker start` with the same flags, limits, read-only root, secret mounts and uid as the compose service (0.25 CPU, 128m memory with no swap, 64 pids, uid `GELDAR_SUPERVISOR_UID`, default 1000). It refuses, and changes nothing, when the `geldar-colo` network is missing, when a secret file is missing, or when a container with the name already exists. It never calls compose and never creates or removes a network.
   The container has no healthcheck: it has no HTTP port. It exits with status 1 if its control subscription ends, and the restart policy `unless-stopped` starts it again.

5. **Verify.** No body is started in this step.
   - `docker ps` shows `geldar-colo-supervisor` running and healthy in the sense of not restarting.
   - A `ctl.body.status` request from the `register` NATS user is answered.
   - A request for an unknown name returns a refusal.
   Record the results in the geldar-93 DONE message. Do not paste the reply bodies if they contain a player name.

## Rollback

- The supervisor container only: `docker stop geldar-colo-supervisor`, then `docker rm geldar-colo-supervisor`. Nothing else is removed.
- Never a network remove, never `compose down`, never a volume removal.
- NATS: restore the previous `nats-auth.conf` contents from the masked diff's backup, run `nats-server -t`, and SIGHUP again. Never a restart.
- Passwords: leave the files in place; they are inert without the container. Remove them only on the owner's instruction.
- After a rollback, the supervisor profile stays off. Nothing starts it by default: `colo-up.sh` and `colo-cd.sh` do not name the profile.

## After the steps

- geldar-93 records DONE for steps 1 to 5 (or the reason for a stop).
- The orchestrator runs the C7-03b4 live check (C7-03b4-live) on this container.
