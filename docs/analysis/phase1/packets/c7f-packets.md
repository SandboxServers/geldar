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
3. **The roster name is validated by the helper, never trusted from the caller.** The helper reads the name's roster row from the database through `supervisor_player_display_name` (0033) and `mcp_roster`. It also checks the name against the regex `^[A-Za-z0-9_]{3,16}$` itself, so a valid name is required whether or not the supervisor checked it first. A name not on the roster is refused for `start`. `stop`, `status` and `logtail` need no roster row: they act on the container of that name that carries the caller's `geldar.owner` label (decision 0108), so a Body whose name left the roster stays stoppable by its owner.
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

11. **Global cap on running Bodies (GLOBAL-CAP, decision 0261).** The helper reads the cap from one config place only: one env name (`GELDAR_GLOBAL_BODY_CAP`) or one shard-file key, named at dispatch, default 40. Before any `start`, the helper counts the running Body containers and the sovereign host containers on the node (the 15 sovereign hosts count). It refuses a start when the count is at or above the cap, with the error `global body cap reached` and audit outcome `capacity`. At 30 running it writes one alert line when the count first reaches 30. It never raises the cap, and a caller cannot pass a cap.

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
- Global cap (GLOBAL-CAP): the 40th running container is the last allowed start; the 41st start is refused with `global body cap reached` and creates no container. Revert: remove the count check; the test fails.
- Global cap counts sovereign hosts: a fixture of 39 running containers, of which 15 are sovereign hosts, allows one start and refuses the next. Revert: count only Body containers; the test fails.
- Global cap default and bad values: no config gives 40; `0`, a negative number or text refuses every start with a config error. Revert: the default; the test fails.
- Alert at 30: one alert line when the count first reaches 30, none on the next starts. Revert: remove the alert; the test fails.
- Abort and error path: a Docker error after the count check releases nothing and writes one audit line, and the count is unchanged. Revert: count before the check and keep a reserved slot on error; the test fails.

### Must not

- Mount or read the Docker socket from any container. The socket is used only by the helper process on the host.
- Accept an image, mount, env value, flag or command from the caller.
- Read secrets from the environment or print them.
- Edit `compose/colo.yml`, `nats-auth.conf` or `docs/spec.md`.
- Run `docker compose`, or create or remove a network.

## C7-03c2: helper install script and runbook

- **id / wave / lane.** C7-03c2, wave 5, Supervisor lane. **depends-on.** C7-03c1. **branch.** `phase1/c7-03c2-helper-install`. **migration.** no (the role migration is C7-03c1). **size.** M.
- **Status.** Built; node steps by geldar-93; open: how the helper build reaches the node.

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

## C7-03c5: helper bundle artifact with pinned Node and sha256

- **id / wave / lane.** C7-03c5, wave 5, Supervisor lane. **depends-on.** C7-03c1, C7-03c2. **branch.** `phase1/c7-03c5-helper-bundle`. **migration.** no. **size.** M.
- **Decision.** 0260. node5 (geldar-worldops) has no Node. The helper ships as a CI artifact, not a registry pull.
- **Status.** Built by the cont1 pass; node steps by geldar-93 (runbook Step 0a).

### Goal

1. **Bundle artifact.** `body-helper/scripts/bundle.mjs` bundles `body-helper/src/main.ts` with esbuild 0.28.2 (exact pin) into `dist/main.js` and writes `dist/main.js.sha256` beside it (sha256sum format).
2. **Node pin.** `deploy/body-helper-node.env` pins Node 22.23.4 (version, tarball name `node-v22.23.4-linux-x64.tar.xz`, its sha256 from the official SHASUMS256.txt). No install happens in the repo.
3. **Build-only CI.** `.github/workflows/body-helper-bundle.yml` (workflow change; actions pinned by commit SHA) checks the pinned tarball against its sha256, builds the bundle, self-checks the digest, and uploads the artifact `body-helper-bundle`. No deploy, no node access, no secret reads.
4. **Install script.** `deploy/install-body-helper.sh` verifies `main.js` against `main.js.sha256` and the staged tarball against the pin before any write, and extracts the pinned Node under `/opt/geldar/node`. The unit's `ExecStart` and the migrate call use `/opt/geldar/node/bin/node`. A mismatch blocks `--apply` with nothing changed.
5. **Runbook.** `docs/runbooks/body-helper-node-steps.md` Step 0a: how to get the artifact from a CI run, check it, and stage it and the tarball on the node.

### Files

`body-helper/scripts/bundle.mjs`, `body-helper/package.json` (esbuild exact), `pnpm-lock.yaml`, `body-helper/src/bundle.test.ts`, `deploy/body-helper-node.env`, `deploy/install-body-helper.sh`, `deploy/test/install-body-helper.test.ts`, `deploy/test/body-helper-artifacts.test.ts`, `.github/workflows/body-helper-bundle.yml`, `docs/runbooks/body-helper-node-steps.md`.

### Tests (each fails on revert)

- `body-helper/src/bundle.test.ts`: the bundle builds, and its sha256 sidecar matches `main.js`. Revert: drop the sidecar write in `bundle.mjs`; the test fails.
- `deploy/test/body-helper-artifacts.test.ts` (dry run): a bundle whose sha256 does not match `main.js.sha256` blocks `--apply` before any write, and the unit is not written. Revert: make the bundle sha256 mismatch not block in `install-body-helper.sh`; the dry-run test fails.
- `deploy/test/body-helper-artifacts.test.ts`: the pin file has the Node version and the tarball sha256; the workflow pins every action by a 40-hex SHA and runs no deploy step. Revert: change a pin to a tag; the test fails.
- Not yet tested (finding): a Node tarball sha256 mismatch blocks `--apply` before extraction. The script checks it (`node_tarball_ok`), but no test covers it.

### Must not

- Install Node or esbuild on the node, or run a docker build.
- Change `docs/spec.md`, or add a card that is not in this file.

## C7-03c3: supervisor uses the helper

- **id / wave / lane.** C7-03c3, wave 5, Supervisor lane. **depends-on.** C7-03c1 (the verbs and subjects). **branch.** `phase1/c7-03c3` (built; review pending; worknote `docs/analysis/phase1/worknotes/C7-03c3.md`). **migration.** no. **size.** M.

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
- Review note (C7-03c3 review, fix 9): the real `HelperRequest` must call `nc.request(subject, payload, { timeout })` (the library closes the inbox on timeout) and take the shard from config, so the subject is `geldar.<shard>.helper.body.<verb>`. C7-03c3 ships no request adapter; the body helper's own run deadline is 120 s and the client bound is 20 s.


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

## Owner-ruling cards (decision 0261, 2026-11-14)

Decision: [0261](../../../decisions/0261-open-signup-player-host-bodies-and-auto-roster.md). All cards below are wave 5. Each card uses the common tail of the packet conventions: branch `phase1/<card-id-lowercase>-<slug>`, worknote `docs/analysis/phase1/worknotes/<ID>.md`, must not edit `docs/spec.md`. Lanes are named in words. Register-package cards (LEGAL-SERVE, ROSTER-AUTO) run serially with the other register-package cards (wave plan constraints). Sizes: S, M or L as stated.

| Card | Wave | Lane | Depends on | Size | Pure code or node steps |
|---|---|---|---|---|---|
| LEGAL-SERVE | 5 | Register | C7-05, C7-06 (merged) | S to M | Pure code |
| SIGNUP-RUNBOOK | 5 | Docs | none | S | Docs only (node steps are geldar-93's) |
| REG-NATS-COMPOSE | 5 | Compose (folded into C7-03b2) | C7-04c2 (merged), C7-03b2 | S | Compose edit, node steps by geldar-93 |
| ROSTER-AUTO | 5 | SQL and Register | C3-04s, C7-03b3, C7-04b | M to L | Pure code plus one additive migration |
| BODY-HOST | 5 | Golem, admin and helper | C7-03c1, C7-03c3, C7-03b5, C7-03b4 (built), ROSTER-AUTO for the auto case | L | Pure code; live check orchestrator-run |
| GLOBAL-CAP | 5 | Supervisor (helper) | C7-03c1 | folded into C7-03c1 | No separate card; text added to C7-03c1 above |

### LEGAL-SERVE: serve the approved legal texts at sign-up

- **id / wave / lane.** LEGAL-SERVE, wave 5, Register lane. **branch.** `phase1/legal-serve-texts`. **migration.** none. **size.** S to M (S if the texts are embedded as static strings).

#### Goal

1. Serve the approved texts `docs/legal/terms.md`, `docs/legal/privacy.md` and `docs/legal/acceptable-use.md` (Version 1, effective 2026-11-11, approved by the owner, 0155) at `/register/terms`, `/register/privacy` and `/register/acceptable-use`.
2. Link all three from the sign-up page next to the consent box (0153 item 1: "shown at sign-up").
3. Embed the texts at build time: a generator script reads the three files and writes one generated TypeScript module. The module is produced by the script, never edited by hand. The running service reads no file at run time.
4. Keep the version stamp `TERMS_VERSION = 'v1'` (`threshold/register`, `account.ts:35`). A change of text, version or re-consent is not part of this card.

#### Tests (each fails on revert)

- Served text equals the file: a GET of each route returns the rendered text of the file, and the embedded source hash equals the SHA-256 of the file. Revert: serve a stub string; the test fails.
- Build fails on a missing file: the generator exits non-zero, so no empty page is served. Revert: write an empty module on a missing file; the test fails.
- Sign-up page links all three routes. Revert: drop the privacy link; the test fails.
- Version stamp: the page shows `v1`, which equals `TERMS_VERSION`. Revert: bump the stamp; the test fails.
- Generated module is current: a repo check regenerates it and compares. Revert: edit the module by hand; the test fails.

#### Must not

- Change the wording or the bytes of any legal file.
- Change `TERMS_VERSION` or the consent record.
- Read the legal files at run time.
- Edit `docs/spec.md`.

### SIGNUP-RUNBOOK: one runbook for opening sign-up

- **id / wave / lane.** SIGNUP-RUNBOOK, wave 5, Docs lane. **branch.** `phase1/signup-runbook`. **migration.** none. **size.** S.

#### Goal

1. One runbook, `docs/runbooks/open-signup.md`, for geldar-93. No values in it, only names.
2. Entra app steps by portal name: App registrations, New registration, Supported account types (personal Microsoft accounts), Redirect URI platform Web with `https://glass.<domain>/register/callback`, Certificates and secrets (a new client secret; its expiry noted), Overview (the Application (client) ID).
3. Environment names: `REGISTER_MS_CLIENT_ID`, `REGISTER_PUBLIC_URL`, `REGISTER_MCP_PUBLIC_URL`, `REGISTER_NATS_URL`, `REGISTER_NATS_USER`, `REGISTER_NATS_PASSWORD_FILE`, `REGISTER_KILL_SWITCH`, `REGISTER_TRUSTED_PEERS`, and `GELDAR_REGISTER_UPSTREAM` for Glass.
4. Secret files by name only: `register-ms-secret.txt`, `register-pepper`, `register-session-key`, `mcp-token-pepper.txt`, `postgres-register.txt`, `nats-register.txt`.
5. The order: secret files; env; start the `register` profile; migrations check; `GELDAR_REGISTER_UPSTREAM`; `colo-public.sh install glass`; one `board-proxy` restart; kill switch on (signed-in check, 503 on `/register/`); then the open step (kill switch false, 0261).
6. Verify steps and rollback (kill switch true and recreate the register service; the other steps are not undone).
7. Fix the stale sentence in `deploy/README.md` (around line 411, "Keep it off until C2-08d and the C2 gates") so it points to the runbook.

#### Tests (each fails on revert)

- Repo check: every `REGISTER_*` name set in `compose/colo.yml` appears in the runbook. Revert: remove one name from the runbook; the test fails.
- Repo check: the runbook contains no value (no UUID, no token-like string). Revert: paste a sample UUID; the test fails.
- Repo check: `deploy/README.md` no longer contains "Keep it off until C2-08d". Revert: restore the sentence; the test fails.

#### Must not

- Write any value, client id, secret or tenant id into the runbook.
- Edit `compose/colo.yml` (REG-NATS-COMPOSE owns it) or `docs/spec.md`.
- Run any node command.

### REG-NATS-COMPOSE: register NATS env in compose (folded into C7-03b2)

- **id / wave / lane.** REG-NATS-COMPOSE, wave 5, Compose lane. It is folded into C7-03b2 and is the only compose edit for the register service. **branch.** the C7-03b2 branch. **migration.** none. **size.** S.

#### Goal

1. On the `register` service in `compose/colo.yml`, set `REGISTER_NATS_URL`, `REGISTER_NATS_USER` (`register`) and `REGISTER_NATS_PASSWORD_FILE`, and mount the `nats-register` secret file read-only. Set all three together, as `config.ts` (NATS off unless all three are set) requires.
2. Add the `nats-register` secret to the compose secrets list and to `deploy/compose.secrets.yml`. The file is created on the node by geldar-93 (`gen-secrets.sh` does not create NATS files).
3. No other service gets a `REGISTER_NATS_*` variable.

#### Tests (each fails on revert)

- Repo check: the register service sets all three variables and mounts the secret. Revert: remove `REGISTER_NATS_USER`; the test fails.
- Repo check: no other service has a `REGISTER_NATS_*` variable. Revert: add one to glass; the test fails.
- Config test: with all three set NATS is on; with one missing it is off (existing behaviour kept). Revert the all-three rule; the test fails.

#### Must not

- Edit any other compose service, the budget, or `nats-auth.conf`.
- Put a password in the compose file or print one.
- Create `nats-register.txt` in the repo.

### ROSTER-AUTO: auto-roster on registration (includes DISPLAYNAME-SHAPE)

- **id / wave / lane.** ROSTER-AUTO, wave 5, SQL and Register lanes. **branch.** `phase1/roster-auto`. **migration.** yes, additive. The number is assigned at dispatch by checking `sql/` on `origin/main`; the next free number is recorded in the report (the wave plan notes 0037 as taken at writing). **size.** M to L.

#### Goal

1. On a successful agent create, the register calls one SECURITY DEFINER function that writes the `mcp_roster` row: owner id, lower-case roster key, exact-case display name. The register code never writes `mcp_roster` directly.
2. **DISPLAYNAME-SHAPE.** A display name that is not a valid Minecraft login (`^[A-Za-z0-9_]{3,16}$`) is refused at the registration form (`account.ts:37` narrows from `^[A-Za-z0-9][A-Za-z0-9 _-]{0,31}$` for new names) and again in SQL. Existing agents with other names keep working and are not given a Body or a roster row.
3. **Per-owner cap.** Default 3 agents per owner, the same number as `mcp_owners.player_cap`, which is the per-owner setting. A create beyond the cap is refused with a clear error, in the form and in SQL.
4. **Idempotent.** The same owner and the same name writes one row and no error. The same name for a different owner is refused; the existing row is not changed.
5. **Audit.** One `register_audit` row per create, with names and ids only.
6. **Database.** `search_path` pinned; `REVOKE ALL ... FROM PUBLIC`; `GRANT EXECUTE` to `geldar_register` only. The supervisor and the helper keep their own roster-owner check (0152, `service.ts:198-199`).
7. **Additive.** The migration adds the function and its grants only. It drops or changes no column (decision 0261; "additive first, destructive later"). Style and registration follow `c2-register-packets.md` step 1 (read `sql/0002_sovereign_mcp.sql`, `sql/0006_owner_cap_trigger.sql` and `sql/0007_journals_append_only.sql`): it inserts its own `schema_migrations` row, as `sql/0006_owner_cap_trigger.sql` does, and uses the gate literal of the latest migration on `origin/main`.

#### Tests (each fails on revert)

- A valid name writes one roster row; the key is lower case and the display name keeps its case. Revert: store the lower-case name; the test fails.
- Names refused in SQL and at the form: 2 characters, 17 characters, a space, a hyphen, a non-ASCII letter, and the empty string. Revert the SQL regex; each case fails.
- Boundaries: 3 and 16 accepted, 2 and 17 refused. Revert the upper bound to 17; the test fails.
- Per-owner cap: the third agent is accepted (last allowed), the fourth is refused with the cap error. Revert the cap check; the test fails.
- Idempotent: the same owner and name twice gives one row; a different owner gives a refusal and leaves the row as it was. Revert the conflict rule so the second owner overwrites; the test fails.
- Abort and error path: a failure after the roster insert rolls back the agent create (no roster row without the agent); the register gets a refusal. Revert the transaction; the test fails.
- Audit: one `register_audit` row per create, with no token or secret in it. Revert the audit insert; the test fails.
- Privileges: `geldar_register` can execute; `PUBLIC` and `geldar_mcp` cannot. Revert the `REVOKE`; the test fails.
- Existing agent with a space in its name: its row is unchanged and no roster row is created. Revert the backfill; the test fails.

#### Must not

- Write `mcp_roster` from register code, or give any role a new table privilege.
- Change or delete existing rows.
- Use the operator `roster-add` path as a shortcut.

### BODY-HOST: managed Body for a sign-up agent through the player-host path

- **id / wave / lane.** BODY-HOST, wave 5, Golem, admin and helper lanes. **branch.** `phase1/body-host`. **migration.** none expected (if one is needed, the number is assigned at dispatch). **size.** L.

#### Goal

1. The managed Body for a sign-up agent runs `golem/src/players/main.ts` with `player-config.ts`, not `golem/src/adam/main.ts` (0261 item 2). `supervisor/src/docker.ts` (moved to the helper by C7-03c1) names the entry point; the helper's template changes to the player-host entry for these Bodies.
2. Config comes from the database and env, not the shard YAML. `player-config.ts` gains a database source for one agent; the shard-YAML source stays for sovereign players.
3. The Body consumes the login name (the roster display name) and the life id (`ag-...`), so Paper, the life registry and the NATS subjects agree (readiness audit G2 name mismatch).
4. The helper admits the Body: it adds the login to Paper's whitelist and writes the Velocity life-registry key (decision 0040), through verbs the helper owns. The Body gets no RCON and no command socket (`golem/src/whitelist-house-body.ts`, threat rule 9).
5. This card supersedes the open part of C7-03b4 (its live check's name and admission). The C7-03b4 Body container spec otherwise stands.
6. **Open sub-questions for geldar-93, answered before dispatch:** the RCON whitelist verb (which command the helper runs, and how it is limited to the helper's own user list); the life-registry key (path and format under 0040); whether the Body image is the golem-body image with a different entry point, or a new image.

#### Tests (each fails on revert)

- A Body started for a database-only agent (no shard YAML line) joins as that name: the player-host entry reads the database row, and the whitelist call uses that name (fake RCON in the test). Revert: read the shard YAML; the test fails with "not in sovereign.players". This is the named test.
- The Body gets no RCON: its container env and binds have no RCON secret and no RCON host. Revert: mount the RCON secret; the test fails.
- The helper refuses to admit a name that is not on the roster. Revert: skip the roster check; the test fails.
- Admission is idempotent: a second start adds no second whitelist entry. Revert: add on every start; the test fails.
- Abort and error path: a failed whitelist call means the Body does not join; the container is stopped and one audit line is written. Revert: join anyway; the test fails.
- The name Paper sees equals the roster display name exactly, and the registry key is the life id. Revert the mismatch; the test fails.
- Regression: a sovereign player still uses the shard path. Revert the shard path; the test fails.

#### Must not

- Give the Body RCON or a command socket.
- Use the house Adam entry point for a sign-up agent.
- Read the shard YAML for a database-only agent.
- Start a live Body; the live check is the orchestrator's (C7-03b4-live).
- Edit `docs/spec.md`.
