# Wave C7 packets, part 6: the body helper (decision 0260)

Decision: [0260](../../../decisions/0260-body-container-control-by-host-helper.md). The supervisor never holds the Docker socket. A root-owned host helper with four fixed verbs controls Body containers. Cards C7-03c1 to C7-03c3 and C7-03b5 build it. C7-03b2 (the compose service and deploy script) is adjusted to wait for them. Wave 5 is the wave for these cards.

## Order, sizes and node steps

| Card | Wave | Lane | Depends on | Size | Pure code or node steps |
|---|---|---|---|---|---|
| C7-03c1 body helper | 5 | Supervisor | C7-03a, C7-03b1 (subject names), C7-03b3 (display-name function, migration 0033) | M | Pure code, plus one additive migration (geldar_helper role) |
| C7-03c3 supervisor uses the helper | 5 | Supervisor | C7-03c1 | M | Pure code |
| C7-03b5 supervisor process entry and image | 5 | Supervisor | C7-03a, C7-03b3 | M | Pure code (CI build job only) |
| C7-03c2 helper install script and runbook | 5 | Supervisor | C7-03c1 | M | Needs geldar-93 node steps (install and nats-auth.conf) |
| C7-03b2 compose service, deploy script, runbook (adjusted) | 5 | Supervisor | C7-03c1, C7-03c2, C7-03c3, C7-03b5 | M | Needs geldar-93 node steps (compose service, supervisor container) |
| C7-03b4-live live check (C7-03b4) | 5 | Supervisor (live) | C7-03b2 merged and deployed, C7-03c3 | S | Needs geldar-93 (runs on the node, orchestrator-run) |

Pure code (no node step): C7-03c1, C7-03c3, C7-03b5. Node steps (geldar-93 DONE per step): C7-03c2 (install and the NATS user edit), C7-03b2 (compose service), the live check.

Batching: C7-03c2 and C7-03b2 change the image set, so they merge in one window with the other C7 image merges (wave plan rule). Nothing here recreates the `geldar-colo` network.

## C7-03c1: body helper

- **id / wave / lane.** C7-03c1, wave 5, Supervisor lane. **depends-on.** C7-03a (package), C7-03b1 (subject builders), C7-03b3 (`supervisor_player_display_name`, 0033). **branch.** `phase1/c7-03c1-body-helper`. **migration.** yes: one additive migration creating role `geldar_helper`. Number assigned at dispatch by checking `sql/` on `origin/main`; at the time of writing `sql/` ends at 0037 (0037 is GX-01a), so the coder takes the next free number and records it. **size.** M.

### Goal

1. **New workspace package `body-helper/`.** A small root-owned Node service on the Colo node, run as a systemd unit. It is NOT in a container and not in any compose file. It is built and installed by C7-03c2.
2. **Four fixed verbs:** `start`, `stop`, `status`, `logtail`. Any other verb is refused and logged.
3. **The roster name is validated by the helper, never trusted from the caller.** The helper reads the name's roster row from the database through `supervisor_player_display_name` (0033) and `mcp_roster`. It also checks the name against the regex `^[A-Za-z0-9_]{3,16}$` itself, so a valid name is required whether or not the supervisor checked it first. A name not on the roster is refused.
4. **The Body container is built from a FIXED TEMPLATE inside the helper.** The logic of `supervisor/src/docker.ts` moves here: hardening, capabilities dropped, no-new-privileges, read-only root, tmpfs, memory and CPU limits, binds (the secret files and the shard file only), restart policy, labels, log config, and network `geldar-colo`. The template is the C7-03b4 spec.
5. **The caller supplies only the verb and the roster name.** The helper refuses any other field: no image, mounts, env, flags or command. The image comes from the helper's own config file, read from a root-only path.
6. **One body per name.** A `start` for a name that already has a container returns "already running" and starts nothing new. A `stop` for a name with no container returns "not running".
7. **Transport: NATS request/reply on its own subject set** `geldar.<shard>.helper.body.<verb>`, with a dedicated NATS user `helper`:
   - user `helper`: Sub on `geldar.<shard>.helper.body.*`, Pub on `_INBOX.>`.
   - user `supervisor`: Pub on `geldar.<shard>.helper.body.start`, `...stop`, `...status`, `...logtail` only; Sub on `_INBOX.>`.
   - the register user gets no new permission.
8. **Postgres: a new narrow role `geldar_helper`.** Created `NOLOGIN` by the migration. It has `EXECUTE` on `supervisor_player_display_name` only, and no table grants. It gets a password in C7-03c2 (the password step), and only then can log in.
9. **Secrets.** The helper reads its database password and its NATS password from root-only files (mode 0600, owner root). It never reads them from the environment and never logs them.
10. **Audit.** Every verb attempt is logged once: verb, roster name, result (accepted, refused and why, or the Docker result). Names only, no secrets, no template contents.

### Why this transport (recorded for review)

- **Chosen: NATS request/reply on a dedicated subject set.** Least new surface: it uses the existing NATS transport and auth (0067, 0080), so no new listener, no new port and no host socket is mounted into any container.
- **Rejected: a Unix socket for the helper.** It would need a host-path bind of the socket into the supervisor container, which breaks the "no host mounts except secrets" rule. It also needs `SO_PEERCRED` to check the caller's uid, and Node cannot read that without a native addon. The uid check would be weaker than the NATS user check.
- **Open point for geldar-93:** confirm that the helper on the host can reach NATS through the published loopback port. If it cannot, fall back to the Unix socket with a bind into the supervisor container, and record the exception in a new decision before the change.

### Tests (each fails on revert)

- Verb allow list: `start`, `stop`, `status`, `logtail` are accepted; `exec`, `rm`, `create`, empty and unknown verbs are refused. Revert: accept any verb; the refusal test fails.
- Name check at the helper: a name not matching the regex is refused before any database call; a name absent from the roster is refused. Revert: skip the roster read; the not-on-roster test fails.
- Caller cannot set the container: a request with an extra `image`, `mounts`, `env` or `flags` field is refused and the container config is unchanged. Revert: pass caller fields into the template; the test fails.
- Template hardening: one test per flag (cap drop, no-new-privileges, read-only root, memory and swap, CPU, network, restart policy, labels) asserts the flag on the created container config. Revert each flag; each test fails.
- One body per name: a second `start` for the same name starts nothing. Revert: remove the existing-container check; the test fails.
- Abort and error path: a Docker error on create returns an error reply, leaves no half-made container, and logs one audit line. Revert: swallow the error; the test fails.
- Last allowed retry: none (the helper does not retry; a failed verb is a failed reply).
- Audit: each attempt, accepted or refused, writes one line with names only; a test asserts the line has no password and no template body. Revert: log the request body; the test fails.
- Migration: `geldar_helper` exists as `NOLOGIN`, has `EXECUTE` on `supervisor_player_display_name`, and has no table privileges. Revert: add `SELECT` on `mcp_roster`; the test fails.
- NATS permission table: the `helper` and `supervisor` users have exactly the permissions above (a test on the generated config). Revert: add a `supervisor` Pub on `_INBOX.>`; the test fails.

### Must not

- Mount or read the Docker socket from any container. The socket is used only by the helper process on the host.
- Accept an image, mount, env value, flag or command from the caller.
- Read secrets from the environment or print them.
- Edit `compose/colo.yml`, `nats-auth.conf` or `docs/spec.md`.
- Run `docker compose`, or create or remove a network.

## C7-03c2: helper install script and runbook

- **id / wave / lane.** C7-03c2, wave 5, Supervisor lane. **depends-on.** C7-03c1. **branch.** `phase1/c7-03c2-helper-install`. **migration.** no (the role migration is C7-03c1). **size.** M.

### Goal

1. **`deploy/install-body-helper.sh`.** Dry-run is the default. `--apply` is required to change anything. Idempotent: a second `--apply` changes nothing.
   - installs the helper build to a root-owned path;
   - writes the systemd unit (root-owned file). Hardening: `NoNewPrivileges=yes` where compatible, `ProtectSystem=strict`, and access limited to the Docker socket and its two secret files (`ReadWritePaths` and `ReadOnlyPaths` list only those);
   - creates the root-only secret files (database password, NATS password) if missing, mode 0600. It never overwrites an existing file and never prints a value;
   - runs the `geldar_helper` password step through the existing migrate verb (below);
   - reports names only, never values.
   - never touches `nats-auth.conf` itself.
2. **Migrate verb.** Add `geldar_helper` and `geldar_supervisor` to `PASSWORD_ROLES` in `tools/migrate/src/migrate.ts`. Make `--set-role-password` idempotent: first try a login with the file's password; run `ALTER ROLE ... PASSWORD` only when that login fails. A second run then changes no `pg_authid` row. This moves the `PASSWORD_ROLES` item from C7-03b2 here.
3. **Runbook `docs/runbooks/body-helper-node-steps.md`** for geldar-93. It is the plan, and it is written so geldar-genesis can reproduce it from the script and its dry-run, not from manual notes:
   - the masked diff of the LIVE `nats-auth.conf`: add users `helper` and `supervisor`, and the `register` publish permission for the `ctl.body.*` subjects, as in-place edits of those permission lines only;
   - a backup of the previous file, `nats-server -t` on the edited copy, an in-place write (the file is a single-file bind mount, so `mv` does not reach the container), then SIGHUP. Never a restart;
   - install by the script, `--dry-run` first, then `--apply`;
   - the password step;
   - verify: the unit is active, a `status` request from the register user is answered, and an unknown name is refused. No body is started;
   - rollback: restore the backup and SIGHUP; `systemctl disable --now`; remove the unit file. Never a network remove.
   - the runbook states: **never run `./geldar.ps1 shard nats-auth colo` on the desktop.** It writes the node's auth file from desktop-side secrets, which is the drift this runbook avoids.

### Tests (each fails on revert)

- Repo check: the script refuses to run without `--apply` (exit non-zero, nothing changed, the dry-run message says so). Revert: make the apply path the default; the test fails.
- Repo check: the script prints no secret. A fake secret value written to a test file under a temp root never appears in the output. Revert: echo the file contents; the test fails.
- Repo check: the unit file has `ProtectSystem=strict` and `NoNewPrivileges=yes`, and its only socket path is the Docker socket. Revert: drop `ProtectSystem`; the test fails.
- Script test with a fake `systemctl` and a temp root: a first `--apply` creates the files; a second is a no-op; an existing secret file is never overwritten. Revert: overwrite secrets; the test fails.
- Migrate test: `--set-role-password geldar_helper` is accepted; a role outside `PASSWORD_ROLES` is still refused; a second run with the same password file changes no `pg_authid` row. Revert the allow list; the accepted case fails. Remove the login probe; the second-run case fails.
- Repo check: the runbook contains the rollback lines and the phrase "never run `./geldar.ps1 shard nats-auth colo` on the desktop".

### Must not

- Write `nats-auth.conf` or any node file other than the helper's own files and the secret files it creates.
- Print or copy secret values, or touch `skins/`.
- Run on the node. Node steps run only after geldar-93 DONE per step.

## C7-03c3: supervisor uses the helper

- **id / wave / lane.** C7-03c3, wave 5, Supervisor lane. **depends-on.** C7-03c1 (the verbs and subjects). **branch.** `phase1/c7-03c3-supervisor-helper`. **migration.** no. **size.** M.

### Goal

1. **Replace the Docker adapter port.** `supervisor/src/docker.ts` becomes a NATS client for the helper verbs (`start`, `stop`, `status`, `logtail`). It sends the verb and the roster name only.
2. **The supervisor keeps** the roster ownership check, the quota, one request in flight per owner, the audit and the `ctl.body.*` binding (C7-03b1).
3. **Supervisor image and compose service have no Docker socket and no host mounts except secrets.** The supervisor's secrets are `supervisor-postgres` and `supervisor-nats` as files.
4. **Docker-only code leaves the supervisor.** `supervisor/src/docker.ts` keeps no Docker client. The container-config test moves to `body-helper/`.

### Tests (each fails on revert)

- Repo check: no service in `compose/colo.yml` mounts `docker.sock`, and the supervisor has no bind other than its secret files. Revert: add a socket bind to the supervisor; the test fails.
- Supervisor unit test: a `start` request calls the helper subject with the verb and the name only; no image or flag is sent. Revert: send a container config; the test fails.
- Supervisor unit test: a request for a name not owned by the caller is refused before the helper is called. Revert: skip the ownership check; the test fails.
- Abort and error path: a helper timeout or an error reply returns a failure to the caller, releases the one-in-flight slot, and writes an audit line. Revert: keep the slot held on error; the test fails.
- Quota: the quota check still runs before the helper call. Revert the order; the test fails.

### Must not

- Import a Docker client or open a Docker socket anywhere in `supervisor/`.
- Change the `ctl.body.*` subjects.
- Edit `compose/colo.yml` (C7-03b2 owns it).

## C7-03b5: supervisor process entry and image

- **id / wave / lane.** C7-03b5, wave 5, Supervisor lane. **depends-on.** C7-03a, C7-03b3. **branch.** `phase1/c7-03b5-supervisor-entry`. **migration.** no. **size.** M.

### Goal

1. **`supervisor/src/main.ts`.** Reads its config from environment variables and secret files. It logs names only, never values.
2. **Supervisor Dockerfile** (`supervisor/Dockerfile`): non-root numeric user, read-only friendly, no Docker CLI installed, no socket path in the image.
3. **colo-images workflow build job.** Read `.github/workflows/colo-images.yml` and follow its pattern: digest-pinned base images, the same action pins as the other services, the same tag and push steps.

### Tests (each fails on revert)

- Repo check: the Dockerfile installs no `docker` CLI and mentions no `docker.sock` path. Revert: add `docker-cli` to the image; the test fails.
- Repo check: the Dockerfile base image is pinned by digest. Revert: use a tag; the test fails.
- Repo check: the workflow has a supervisor build job with the same pins as the other services. Revert: drop the job; the test fails.
- `main.ts` unit test: a missing secret file stops the process with a names-only error. Revert: start with an empty password; the test fails.

### Must not

- Add a Docker client, a Docker CLI or a socket path to the image.
- Print secret values.
- Edit `compose/colo.yml` (C7-03b2 owns it).

## C7-03b2 (adjusted): compose service, deploy script, budget and runbook

The card in [c7c-packets.md](c7c-packets.md) is changed as follows. Its goal and tests otherwise stand.

- **Depends on.** C7-03c1, C7-03c2, C7-03c3, C7-03b5. It is no longer shelved behind C7-03b1 and C7-03b3 alone.
- **No Docker socket.** The `/var/run/docker.sock` mount, the `group_add` from a deploy value, and the text about the socket and its root equivalence are removed. The supervisor service has no socket mount and no `group_add`.
- **Profile.** The compose service stays `profiles: [supervisor]`, off by default.
- **Script.** `deploy/colo-supervisor.sh` creates the supervisor container only (`docker create` and `docker start`, as in the card). It grants no Docker access. The Docker access belongs to the helper (C7-03c1).
- **Runbook.** `docs/runbooks/supervisor-node-steps.md` references `docs/runbooks/body-helper-node-steps.md` (C7-03c2) for the NATS users and the password steps. It keeps the step order: the helper first, then the supervisor container.
- **PASSWORD_ROLES.** The `PASSWORD_ROLES` change moves to C7-03c2 (it covers both `geldar_helper` and `geldar_supervisor`).
- **Gate.** "Must not be enabled before the C7-03b4 live check" stays.
- **Test changes.** The socket-mount test in the card now asserts that no service mounts `docker.sock`.

## C7-03b3 and C7-03b4: notes

- **C7-03b3** (Postgres adapter and Docker client): the Docker client is now in the helper (C7-03c1). The supervisor keeps only the Postgres adapter after C7-03c3. Merged code is not reverted; C7-03c3 removes the Docker call sites.
- **C7-03b4** (Body container spec): the spec is built by the helper. The tests move with the template to `body-helper/`.
- **C7-03b4 live check** (`C7-03b4-live`, S, geldar-93): runs against the helper, not the supervisor's Docker adapter. The orchestrator runs it after C7-03b2 is deployed. It starts one test body from a DB-listed test player and stops it. Deterministic: the test player is set up before the verb runs, and the journal is clean for the test. `live: pending` in the card's own report.
