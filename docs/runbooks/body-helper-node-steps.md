---
title: "Body helper: node steps"
type: how-to
audience: operators
status: draft
last_verified: 2026-11-16 against 03c1f5de
companions: [README.md, nats-auth-inplace.md, open-signup.md]
sources: [../decisions/0260-body-container-control-by-host-helper.md, deploy/install-body-helper.sh, deploy/body-helper-node.env, body-helper/src/helperConfig.ts, deploy/README.md]
---

# Body helper: node steps

Packet C7-03c2 (review fix B). Decision 0260: the body helper is a root-owned systemd unit on the Colo node. It
starts and stops Body containers for the supervisor. It is not in a container and not in any compose
file. This runbook is the plan for the node operator. It names env vars and files by name only. No value,
address, user password or token appears here, and none may be pasted into a chat or a commit.

## Rules for every step

- Run one step, check it, then the next. Each step has its own rollback. A step is DONE only when
  its verify line is true.
- Dry run first. `deploy/install-body-helper.sh` with no flag is a dry run. Only `--apply` changes
  anything, and it is run after the dry run has been read.
- The NATS server is never restarted. The conf change is an in-place edit followed by SIGHUP, and it
  follows `docs/runbooks/nats-auth-inplace.md` step by step.
- Never run `./geldar.ps1 shard nats-auth colo` on the node. It writes the node's auth file from
  desktop-side secrets, which is the drift this runbook avoids. Nothing in this runbook runs any `shard nats-auth` command.
- Never remove a network, never `docker compose` the helper, never start a Body by hand.
- Do not echo a secret file or turn on shell tracing (`set -x`) while a step reads one.
- Read-only verbs only while probing: `systemctl is-active`, `systemctl is-enabled`, `docker ps`,
  `journalctl` (names only in what you paste into the report).

## Order of the steps

The install script runs FIRST. It creates the helper's NATS password file, and the NATS conf entry for
`helper` takes its value from that file. So the order is: dry run (step 1), the install script (step 2),
the NATS conf in place (step 3), verify (step 4). Do not change the NATS conf before step 2 is DONE.

## Open questions for the node operator (block step 2)

1. How the built helper reaches the node is decided by C7-03c5 (decision 0260): a CI artifact, not a registry.
   The CI job `body-helper-bundle` (`.github/workflows/body-helper-bundle.yml`) builds one bundle, `main.js`, and
   `main.js.sha256` beside it, and keeps them as the GitHub Actions artifact `body-helper-bundle` for 30 days.
   The node operator downloads that artifact from a green run (see "Step 0a" below), checks it, and copies the two files to
   `/opt/geldar/body-helper/dist/`. The install script does not fetch code. It verifies `main.js` against
   `main.js.sha256` before it writes anything, and blocks if either file is missing or does not match.
2. The PG* variables for the password step (step 2) are NOT set by this runbook. `sudo` drops them
   (env_reset), and `sudo -E` is refused by this runbook. The node operator decides how root's run gets them,
   and writes that decision into the change log. They must name the admin role (PGUSER), the host
   (PGHOST), the port (PGPORT) and the database (PGDATABASE).
3. The tool that sends the step 4 `status` request as the `supervisor` user is not named here. Use a
   NATS client that reads the `supervisor` password file; do not put the password on a command line.

## Step 0a: the helper bundle and the pinned Node (C7-03c5)

Run by the node operator before step 2. Nothing here runs on the node except the copies and the checks named.

1. Get the bundle from a green run of the `body-helper-bundle` workflow (build only; it touches no node). Pick the
   run on `main` that built the commit being installed, then download its artifact on a machine with the GitHub
   CLI, not on the node:
   `gh run download <run-id> -n body-helper-bundle -D <empty-dir>`. The artifact holds `main.js` and `main.js.sha256`.
2. Check the bundle where you downloaded it: `cd <empty-dir> && sha256sum --check main.js.sha256` must say `OK`.
   On the node, first run `install -d -m 0755 -o root -g root /opt/geldar/body-helper/dist`. Then copy both files
   to that directory with `scp`.
3. Put both files in `/opt/geldar/body-helper/dist/` as root: `install -m 0644 -o root -g root main.js main.js.sha256 /opt/geldar/body-helper/dist/`.
   The install script checks `main.js` against `main.js.sha256` on every `--apply` and blocks on a mismatch.
4. Node: on the node run `install -d -m 0755 -o root -g root /opt/geldar/node` first. Download
   `node-v22.23.4-linux-x64.tar.xz` from the official release (`https://nodejs.org/dist/v22.23.4/`) on the machine you
   download to, then run `sha256sum node-v22.23.4-linux-x64.tar.xz` there. Its sum must equal the value of
   `BODY_HELPER_NODE_SHA256_LINUX_X64` in `deploy/body-helper-node.env` (the public digest is kept in that file only,
   so the two cannot drift). Do not copy a tarball whose sum differs. Copy the checked tarball to
   `/opt/geldar/node/`. The install script's `--apply` checks its sha256 again, then extracts it so that
   `/opt/geldar/node/bin/node` exists, and writes `/opt/geldar/node/.pinned-sha256` as the stamp that marks the node
   as the pin. A bad sha256 stops the apply before any write; a bad tarball is never extracted.
   Prerequisite: `--apply` needs `xz` on the node's PATH to unpack the tarball. If `command -v xz` finds nothing, install
   the OS package `xz-utils` first (this is the only package install in this step; Node itself is never installed by a package manager).
5. Never install Node from a package manager on the node. The pin in `deploy/body-helper-node.env` is the only Node.

## Step 0: inputs by name

The helper reads these env vars from `/etc/geldar/body-helper.env`, a root-owned file that the node
operator writes from the release env. Names, as read by `body-helper/src/helperConfig.ts`:

`GELDAR_SHARD`, `GELDAR_SERVICE_UID`, `GELDAR_NATS_URL`, `GELDAR_NATS_USER`,
`GELDAR_NATS_PASSWORD_FILE`, `GELDAR_PG_HOST`, `GELDAR_PG_PORT`, `GELDAR_PG_DATABASE`,
`GELDAR_PG_USER`, `GELDAR_PG_PASSWORD_FILE`, `GELDAR_DOCKER_SOCKET`, `GELDAR_BODY_IMAGE`,
`GELDAR_MC_HOST`, `GELDAR_MC_PORT`, `GELDAR_BODY_NATS_SECRET_HOST_PATH`,
`GELDAR_BODY_SHARD_HOST_PATH`, `GELDAR_BODY_NANO_CPUS`, `GELDAR_BODY_MEMORY_BYTES`,
`GELDAR_BODY_PIDS_LIMIT`, `GELDAR_SWEEP_MINUTES`, `GELDAR_BODY_HELPER_DEADLINE_MS`,
`GELDAR_GLOBAL_BODY_CAP` (default 50; the owner sets it, the helper never raises it).

Managed Body inputs (BH-3), all optional and off by default. Names only; the values go in the root-only config, never here:
`GELDAR_MANAGED_BODIES` (default off; the managed flag, which stays off until the node operator flips it after the live check),
`GELDAR_RCON_SECRET_HOST_PATH` (the root-only RCON password file, bound only into the admit one-shot),
`GELDAR_MANAGED_PG_HOST` and `GELDAR_MANAGED_PG_ROLE` (the managed Body's database wiring, the narrow role and never the
helper's own role), `GELDAR_MANAGED_DB_SECRET_HOST_PATH` (the root-only file that holds the managed Body's database
password), and `GELDAR_MANAGED_PG_PORT` (optional, default 5432). With the flag on, the helper refuses to load if the RCON
path or the host, role or secret path is missing, and the error names only that variable. A managed start is refused
until the flag is on and the config is complete.
The RCON and database secret files must be readable by the container user (owner `GELDAR_SERVICE_UID`, mode 0600 or
0400): use the same owner and mode as the NATS secret for Bodies (`GELDAR_BODY_NATS_SECRET_HOST_PATH`). The rule for
the NATS files, owner `GELDAR_SERVICE_UID` and mode `0600`, is in `deploy/README.md`, section "(c) Secrets".

If an admit one-shot is left behind (a helper killed between create and start, or a create the client timed out on),
the next start for that life is refused with `life admission failed`. Find it by label, then remove it by its exact
name only: `docker ps -a --filter label=geldar.admit --format '{{.Names}}'`, then `docker rm -f geldar-admit-<life id>` for that one name. Never a wildcard or a `docker rm` with a pattern, and never touch any `geldar-player-ag-*` container.

The admit one-shot has two fixed modes (BH-5a): `GELDAR_ADMIT_MODE=add` (start, container `geldar-admit-<life id>`) and `remove` (stop, container `geldar-unadmit-<life id>`). Both carry the `geldar.admit` label, whose value names the mode, so the label filter above lists both. A left-behind `geldar-unadmit-<life id>` is removed the same way, by its exact name only: `docker rm -f geldar-unadmit-<life id>`. Never a pattern.

The BH-6 sweep (with managed Bodies on) removes a managed Body whose roster row is gone and whose container exited 78, only after two consecutive passes: its whitelist entry first (the remove one-shot), then the container. A failed remove keeps the container and retries on the next pass; the sweep audit lines are `orphan_removed` and `orphan_removal_failed`. A Body that exits 78 while its roster row still exists (for example a banned owner, whose row the roster read still returns) is not removed by the sweep; it stays until the operator acts.

`GELDAR_NETWORK` (default `geldar-colo`) and `GELDAR_STACK` (default `colo`) are optional; an unset or empty
value takes the default. `GELDAR_NETWORK` is a Docker network name of at most 63 characters, and the
helper refuses `host`, `bridge` and `none` (also `default` and `container:<id>`, in any case). The helper
does not start with a refused value. `GELDAR_STACK` is at most 63 lower-case letters, digits or hyphens,
starting with a letter or digit.

Two password files are the single source for the helper's logins. The install script (step 2) creates
them if missing, mode 0600:

- `/etc/geldar/secrets/helper-postgres.txt`: the password of the Postgres role `geldar_helper`. The
  helper's `GELDAR_PG_PASSWORD_FILE` points here.
- `/etc/geldar/secrets/nats-helper.txt`: the password of the NATS user `helper`. The helper's
  `GELDAR_NATS_PASSWORD_FILE` points here, and the `helper` entry in the NATS conf (step 3) takes the
  same value. Nothing else holds a copy.

The NATS user `supervisor` has its own password file, `nats-supervisor.txt`, in the Colo secrets directory.
It is created by step 0 of `docs/runbooks/nats-auth-inplace.md`, not by this runbook.

## Step 1: dry run of the install script

On the node, from the repo checkout, with no flag:

    deploy/install-body-helper.sh

Expected: `mode: dry run`, a `would:` line for each change, and a summary with `dry run summary`.
Until the build is placed it also prints `blocked: helper build missing`. The plan lists the password
step for `geldar_helper` even on a fresh node. Nothing changes. Check that no file under
`/etc/systemd/system/` and no secret file was created.

Rollback: none needed; a dry run changes nothing.

## Step 2: the install script, with --apply

1. Set the PG* variables of the password step as open question 2 decides. Required: `PGHOST`,
   `PGPORT`, `PGUSER` (an admin role that may run `ALTER ROLE`), and `PGDATABASE`. `PGDATABASE` is
   required: the login probe reaches the database the migrate verb uses, and without it the probe would
   log in to a database named after the role, fail, and run `ALTER ROLE` on every run. Without a pg_hba entry the probe is refused (28000) and the script runs `ALTER ROLE` on every run; check
   the login by hand after step 2. The apply preflight refuses to start unless `PGHOST`, `PGUSER` and `PGDATABASE` are set.
2. As root, with no `-E`: `sudo deploy/install-body-helper.sh --apply`. It writes the unit file (`/opt/geldar` is
   created by card C7-03c5, not by the script; the bundle and the Node tarball are staged by Step 0a), creates the two secret files if missing (step 0), runs the
   password step, and enables the unit. A second `--apply` changes nothing. Only `--apply` changes
   anything; an unknown flag is refused.
3. Node runtime (decided by C7-03c5): the unit's `ExecStart` and the password step's migrate call use the
   pinned Node 22.23.4 at `/opt/geldar/node/bin/node`, never a PATH `node`. The node has no Node (recorded in
   the header comment of `deploy/body-helper-node.env`; not re-checked on the node for this runbook). The pin is `deploy/body-helper-node.env` (version, tarball name, sha256 of
   `node-v22.23.4-linux-x64.tar.xz`). Stage the official tarball in `/opt/geldar/node/`; the script checks its
   sha256 against the pin, then extracts it. If `/opt/geldar/node/bin/node` is absent and the tarball is not
   staged, `--apply` stops at its node preflight before it writes anything. Do not install Node from a package
   manager on the node to get past it.
4. Until step 3 is DONE the helper cannot log in to NATS. It may restart under systemd (`Restart=on-failure`,
   at most 5 starts in 300 s). That is expected. If the unit is `failed` after step 3, restart it once.

Rollback of step 2:

1. `systemctl disable --now geldar-body-helper.service`
2. `rm /etc/systemd/system/geldar-body-helper.service`, then `systemctl daemon-reload`.
3. The secret files are left in place. Removing a password file does not undo a database login.
4. The `geldar_helper` role stays a login role until a database admin runs
   `ALTER ROLE geldar_helper NOLOGIN` by hand. The migrate tool cannot undo a password. Do not
   change the role by any other route.

## Step 3: the NATS users and permissions, in place

Follow `docs/runbooks/nats-auth-inplace.md` (the procedure, steps 0 to 7): the owner go, the maintenance
notice, the staging directory `$HOME/nats-stage` (0700, `umask 077`), validation with the container's
`nats-server -t`, the sha256 of the backup against the live file, the `http:` line check, the
`Reloaded:` log lines, and the connection count. Do not run `nats-server` on the host. This runbook adds
only the helper's lines below. The PR that adds the helper to `geldar.ps1` (#415) is merged (merge commit
`4bab81b3`, 2026-11-15; `geldar.ps1` lines 411 to 413), so the node runs what the generator produces.

In `nats-auth-inplace.md` step 0 create ONLY `nats-supervisor.txt`. Do NOT create `nats-helper.txt` there: it
already exists at `/etc/geldar/secrets/nats-helper.txt` from step 2, and that file is the only source. Where that
procedure gives a wildcard subject for the body helper, it means the four exact subjects below.

The helper's lines, by user (`<shard>` is `GELDAR_SHARD`):

- **`helper`** (new user; if it is absent, add it. Its own owner go):
  - Sub: exactly four subjects, no wildcard: `geldar.<shard>.helper.body.start`,
    `geldar.<shard>.helper.body.stop`, `geldar.<shard>.helper.body.status`,
    `geldar.<shard>.helper.body.logtail`.
  - Pub: `_INBOX.>` only.
  - Password: the value of `/etc/geldar/secrets/nats-helper.txt` (step 0, created by step 2). Copy it into
    the staged conf with a script that reads the file. Never echo it, never type it.
- **`supervisor`**:
  - If the user is present, edit its entry. If it is missing, add it as a new user (its own owner go, and
    `nats-supervisor.txt` mode 0600 from `nats-auth-inplace.md` step 0).
  - Pub: `_INBOX.>` and the four helper subjects `geldar.<shard>.helper.body.start`,
    `geldar.<shard>.helper.body.stop`, `geldar.<shard>.helper.body.status`,
    `geldar.<shard>.helper.body.logtail`. The `_INBOX.>` stays because the supervisor replies to
    `ctl.body` requests on inboxes.
  - Sub: `geldar.<shard>.ctl.body.>` and `_INBOX.>`.
- **`register`**: UNCHANGED. Pub `geldar.<shard>.ctl.body.>`, Sub `_INBOX.>`. It has no helper subject, by design.
- **`body`** and **`paper`**: add PubDeny `geldar.<shard>.helper.body.>` to each. It is in the generator
  (`geldar.ps1`, the `body` and `paper` lines) and absent from the live conf. It is a widened
  permission on live lines, so it has its own owner go. Nothing else on those two lines changes.

The diff of step 3 of the procedure must show these lines and no other line, including the `register`
entry. A wildcard on any helper subject in the staged conf stops the change.

Rollback: the procedure's step 7 (the backup, its sha256 check, `Reloaded` lines, and the connection
count). The two new password files stay after a rollback; remove them only with the owner.

## Step 4: verify

1. `systemctl is-active geldar-body-helper.service` prints `active`.
2. No Body is started. `docker ps` lists the same Body containers as before step 2.
3. Using each role's own client (never the admin account), check the helper's permissions:
   - `supervisor` publishes a `geldar.<shard>.helper.body.status` request and is not refused;
   - `body` publishing `geldar.<shard>.helper.body.status` is refused (a `Permissions Violation` line in the NATS log);
   - a Paper-side publish to `geldar.<shard>.helper.body.status` is refused (Permissions Violation in the NATS log);
   - `helper` subscribing to `geldar.<shard>.helper.body.>` is refused, and subscribing to `geldar.<shard>.helper.body.status` is allowed.
4. A `status` request on subject `geldar.<shard>.helper.body.status` for an UNKNOWN roster name
   (use a name that is not on the roster, such as `zz-unknown-probe`) is answered with a refusal.
   Send it with the `supervisor` NATS user, which is the only user with publish on the `status`
   subject (step 3). The register user has no permission on it, by design. Send no `start`.
5. `journalctl -u geldar-body-helper.service` shows one audit line per request, with names only.

Rollback: `systemctl disable --now geldar-body-helper.service`, then the rollback of step 2 (unit file
removed, `daemon-reload`). A refusal that is not what step 4.4 expects is a stop: disable the unit,
then check the conf by the step 3 diff. Never a restart of NATS, never a network remove.

## Before anything else is enabled

- The supervisor container (C7-03b2) is NOT enabled until this runbook's steps 1 to 4 are DONE and
  the C7-03c3 supervisor change is merged.
- The live Body check (C7-03b4-live) is run by the orchestrator, after C7-03b2 is deployed. It starts
  one test body for a test player that is set up first. Do not start a Body for it by hand.
- The owner sets `GELDAR_GLOBAL_BODY_CAP` (default 50) in `/etc/geldar/body-helper.env`. The helper
  refuses starts at the cap. The cap is not raised by any caller.
- Keep the decision record and the worknote C7-03c2 in step with what was done on the node.
