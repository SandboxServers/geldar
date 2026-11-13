# Wave C7 packets, part 3: the C7-03b split (supervisor wiring in three cards)

C7-03b is replaced by three cards. It was one L card with a node change, a NATS binding and a Docker adapter, and no single session could land it safely. The split keeps the node-facing work (b2) behind the NATS user names (b1) and the adapter (b3), and keeps every live step with ops. Plan and waves: [c7-wave-plan.md](c7-wave-plan.md). Ledger: [ledger.md](../ledger.md), rows C7-03b1, C7-03b2, C7-03b3.

Shared facts for all three cards:

- **Subjects.** `geldar.<shard>.ctl.body.<op>` with `<op>` one of `start`, `stop`, `restart`, `status`, `logtail` (the `OPS` list in `supervisor/src/ports.ts`). Five tokens, so outside the sink's `geldar.*.*` filter, like the Body subjects. The owner ruling is decision [0152](../../../../decisions/0152-programmatic-body-management-for-owners.md) item 3.
- **Keys.** Bodies are keyed on the lower-cased roster name (decision [0108](../../../../decisions/0108-mcp-roster-source-of-truth.md)). Roster owner checks come from `mcp_roster`, admin checks from `supervisor_is_admin` (migration 0027). Quotas and limits: decision [0170](../../../../decisions/0170-owner-management-values-and-admin-flag.md) and [0082](../../../../decisions/0082-colo-compose-network-and-limits.md).
- **Failure rule.** Every failure path fails closed: a missing owner, an error or an unknown name gives a refusal, never a started body (worknote [C7-03a](../worknotes/C7-03a.md), fixes D and E).
- **Live.** Nothing in this file starts a body on the node. The live start of a body is the orchestrator's (`live: pending`).
- **Size.** Each card is one session (about 40k working tokens or less). A card that grows past that is split again by the orchestrator, not by the coder.
- **Pins.** Use only the versions named here; where none is named, reuse the version the repo already pins for the same library (check `package.json` in the package you touch). A new dependency is pinned exactly (`pnpm add -E`) and reported with its release date.

---

## C7-03b1: NATS contract, user binding and the request/reply transport

- **id / wave / lane.** C7-03b1, wave 2. Non-register lane for the contract, `geldar.ps1` and the supervisor; the register client is the only register-package edit (see the lane note below).
- **depends-on.** C7-03a (merged). **branch.** `phase1/c7-03b1-nats-binding`. **migration.** none. **size.** M (one session).
- **Lane note (conflict to resolve).** The wave plan allows one register-package packet at a time (C7-02b is the wave 2 one). The register client in this card adds two new files only (`threshold/register/src/nats-ctl.ts` and its test) and touches no shared file. The orchestrator serializes it with C7-02b or accepts the disjoint pair in writing. The coder does not edit `server.ts`, `account*.ts` or any route.

### Goal

1. **Contract.** `contract/src/subjects.ts` gains `ctlBodySubject(shard, op)` (throws on a shard the contract rejects, and on an `op` outside `OPS`) and `ctlBodyWildcard(shard)` (`geldar.<shard>.ctl.body.>`). The builders follow the style of `snapshotSubject` and `kinoFeedSubject` in the same file. Contract output is regenerated with the contract's own generator and committed. Nothing is hand-edited under generated paths.
2. **NATS users.** `Get-NatsUsers` in `geldar.ps1` (about lines 370 to 400):
   - `supervisor`: `Sub = @("geldar.$s.ctl.body.>")`, `Pub = @('_INBOX.>')` (a responder publishes replies to inboxes and subscribes only to the control subjects). No JetStream, no `geldar.$s.>`.
   - `register`: `Pub = @("geldar.$s.ctl.body.>")`, `Sub = @('_INBOX.>')` (a requester needs its inbox). Nothing else.
   - `body` and `paper` already have a broad allow (`geldar.$s.>`). Each gets an explicit `PubDeny` of `geldar.$s.ctl.body.>`, because NATS deny wins over the wider allow. Without it the body or the plugin could publish a control request. `kino` and `eventsink` are denied by their existing narrow allows; the test proves it.
   - No other user changes.
3. **Transport, supervisor side.** `supervisor/src/nats.ts`: subscribes to `ctlBodyWildcard`, decodes the request, calls the existing handler in `service.ts` (no logic change there), replies to `msg.reply`. A reply failure is caught and counted, never thrown into the process.
4. **Transport, register side (request only).** `threshold/register/src/nats-ctl.ts`: `requestBodyOp(op, shard, body, { timeoutMs })` sends one request and returns the parsed reply. On timeout, on no responders, or on a disconnect during the request it throws `BodyUnavailable`. C7-04 maps `BodyUnavailable` to HTTP 503 with the body `{"error":"body_unavailable"}`. This card ships the mapping function and its test, not the route.

### Files

- may-edit: `contract/src/subjects.ts` and its test, the generated contract output that the generator writes, `geldar.ps1` (`Get-NatsUsers` only), `tools/repo-checks/src/nats-auth.test.ts`, `supervisor/src/nats.ts` and test, `threshold/register/src/nats-ctl.ts` and test, `docs/analysis/phase1/worknotes/C7-03b1.md`.
- must-not-edit: `threshold/register/src/server.ts`, `threshold/register/src/account*.ts`, `service.ts` logic, `deploy/`, `compose/`, `docs/spec.md`.
- **Do not run `./geldar.ps1 shard nats-auth colo` or any node step.** The node's `nats-auth.conf` is live, and its passwords exist only on the node. The generator run is a desktop test against a temporary copy only, as the existing test does.

### Tests (each fails on revert)

- `contract`: `ctlBodySubject('phase0', 'status')` is `geldar.phase0.ctl.body.status`. A shard with a dot or a wildcard throws. An op of `ctl` or `>` throws. Revert: remove the op check; the test fails.
- `nats-auth.test.ts`: `ROLES` and the expected table gain `supervisor` and `register`. `supervisor` may subscribe to `ctl.body.>` and may publish only `_INBOX.>`. `register` may publish only `ctl.body.>`. For `body`, `paper`, `kino` and `eventsink` (and `mcp`), a publish to `geldar.<s>.ctl.body.start` is denied. Revert: delete the body `PubDeny` line; the body-deny test fails.
- `nats-auth.test.ts`: `supervisor` may not publish to `geldar.<s>.ctl.body.start` and `register` may not subscribe to `ctl.body.>`. Revert: widen `register` to `geldar.$s.>`; the deny test fails.
- `supervisor/src/nats.test.ts` (fake connection): a request is decoded, the existing handler is called once, the reply goes to `msg.reply`. A request with no reply inbox is dropped without a handler call. A reply that throws (the connection closed) is counted and does not reject the loop.
- `supervisor/src/nats.test.ts`, disconnect mid-request: the handler's runtime timer is cleared (fake timers, no pending timer after the disconnect). A retried request with the same body gets the handler's existing `noop`/`started` reply and counts nothing twice (fix E). Revert: remove the reply-failure catch; the disconnect test fails.
- `threshold/register/src/nats-ctl.test.ts`: a reply within the timeout is returned. A timeout throws `BodyUnavailable` and clears the timer (fake timers). A disconnect mid-request rejects with `BodyUnavailable`, leaves no pending timer, and a second call after reconnect works (idempotent). A no-responders reply throws `BodyUnavailable`. A malformed reply throws a distinct error, not `BodyUnavailable`. Revert: map a timeout to a generic error; the 503 mapping test fails.
- Revert check (the recipe): commit the fix, copy `geldar.ps1` to the scratchpad, delete the body `PubDeny` line, run `nats-auth.test.ts` (it must fail for the body-deny reason), restore from the backup, `git diff --stat` empty.

### Checks

`./geldar.ps1 pnpm --filter @geldar/contract test`, `./geldar.ps1 pnpm --filter @geldar/supervisor test`, `./geldar.ps1 pnpm --filter @geldar/register test` (or the package name in its `package.json`), `pwsh -NoProfile -File ./geldar.ps1 check`. The NATS live test in `threshold/mcp/test/nats-auth.it.test.ts` needs a running server and is not run here. Its `roleAllows` gains the same two roles, with `live: pending`.

---

## C7-03b2: compose service, deploy script, budget and runbook

- **id / wave / lane.** C7-03b2, wave 3 (moved from wave 2: it needs the NATS user names from b1 and the image from b3's Dockerfile, and no live use may happen before it). **depends-on.** C7-03b1 (user names and subject builders), C7-03a. **branch.** `phase1/c7-03b2-compose-deploy`. **migration.** none. **size.** M (one session; the runbook is the largest part).

### Goal

1. **Compose service.** `compose/colo.yml` gains a `supervisor` service, modelled on `register`:
   - `profiles: [supervisor]`, so it is off by default. `networks: [colo]`, no default network, no published port, no Caddy site.
   - `read_only: true`, `user` set to a non-root numeric uid through `GELDAR_SUPERVISOR_UID` (default is a deploy value, never `0`), `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, no `privileged`, no `network_mode: host`, no extra caps.
   - `deploy.resources.limits`: `cpus: "${GELDAR_COLO_SUPERVISOR_CPUS:-0.25}"`, `memory: "${GELDAR_COLO_SUPERVISOR_MEM:-128m}"`. The variable names match the `_CPUS` and `_MEM` pattern that `geldar.ps1` reads for the budget.
   - **Hard memory limit with no swap (owner check, host swap is nearly full).** `memswap_limit` equals the memory limit (both `${GELDAR_COLO_SUPERVISOR_MEM:-128m}`), which is `--memory-swap` equal to `--memory`. A CPU limit is set (`cpus`), in both the compose definition and `deploy/colo-supervisor.sh` (`--cpus 0.25`). The script passes `--memory 128m --memory-swap 128m --cpus 0.25`, the same values as compose.
   - Headroom at 0.25 CPU and 128m is confirmed PASS by the coordinator. The budget stays at the `shards/colo.yaml` arithmetic (10.85 CPUs, 20096m). Do not try to reconcile it with the per-player host containers started outside compose; that is out of scope for this card.
   - Docker socket: `/var/run/docker.sock:/var/run/docker.sock`, mounted on this service only. **Read-only is not a real limit.** A `:ro` bind on a Unix socket does not stop Docker API writes. The socket is root-equivalent on the host, so the only controls are the uid and the `docker` group GID (`group_add` from a deploy value). The card records this. A docker-socket proxy with an endpoint allow list would be stronger, but it is a new pinned image and an owner decision, so it is not in this card.
   - Secrets: `supervisor-postgres` and `supervisor-nats` in the base `secrets:` section (files under `compose/secrets/`, as the register secrets are). Never env vars.
2. **Secrets.** `deploy/compose.secrets.yml` maps both names to `${GELDAR_SECRETS_DIR}/postgres-supervisor.txt` and `${GELDAR_SECRETS_DIR}/nats-supervisor.txt`. `deploy/gen-secrets.sh` creates `postgres-supervisor.txt` (random, the same pattern as the other postgres files). It does **not** create `nats-supervisor.txt`: the script's own header says the NATS files come from the trusted machine, and the NATS password is set in the node's `nats-auth.conf` by the runbook.
3. **Budget.** `shards/colo.yaml`: `cpu_limit: 10.85` and `memory_limit: 20096m` (10.6 + 0.25 and 19968m + 128m). The comment gains the line "C7-03b2 adds supervisor (0.25 CPU, 128m, profile supervisor, off by default): 10.75 CPUs and 20032m", and the margin (0.1 CPU, 64m) is stated, as the old comment does. **Known drift:** the comment chain ends at 10.5 CPUs and 19904m, but the values were 10.6 and 19968m. The new line states the sum, and the card does not pick a new margin. The coder reports the drift.
4. **Deploy script.** `deploy/colo-supervisor.sh`: an idempotent script that creates the `geldar-colo-supervisor` container with `docker create` and `docker start`, not `docker compose up`. On the node, any compose `up` fails with "network geldar-colo has active endpoints" because the network's recorded config has drifted (geldar-93, Plan A). The flags, labels, limits, the read-only root, the secret bind mounts and the uid match the compose service exactly. The script:
   - refuses if the `geldar-colo` network is missing (it never creates or removes a network; that is a separate owner chore);
   - does nothing if a container with that name already runs the expected image;
   - replaces nothing and removes nothing: a stopped container with the name stops the script with a message for the operator;
   - never calls `docker compose`, `docker network create`, `docker network rm`, `down`, `--force-recreate` or `rm`.
   The image is read from `GELDAR_SUPERVISOR_IMAGE` (a digest, from the release env file, as the other services).
5. **Runbook.** `docs/runbooks/supervisor-node-steps.md` (new). The node-only operator steps, to be run by ops, only with the owner's go-ahead, and only after geldar-93 has received the plan (see the coordination rule below). Steps:
   1. Create the two password files 0600 in the node secrets dir (`GELDAR_SECRETS_DIR`).
   2. `deploy/colo-admin.sh migrate --set-role-password geldar_supervisor --password-file <path>`. The CD does not run this.
   3. Add the `supervisor` NATS user and the `register` publish permission to the LIVE `nats-auth.conf` by a node-local edit of exactly the permission lines: a masked diff first; `nats-server -t` validation on the edited copy; an in-place write (the file is a single-file bind mount, so `mv` does not reach the container); a SIGHUP reload; never a restart. Rollback: restore the previous file contents from the masked diff's backup and SIGHUP again.
   4. Run `deploy/colo-supervisor.sh`.
   5. Verify: `docker ps` shows the container, a `ctl.body.status` request from the register user is answered, and an unknown name returns a refusal. No body is started in this step.
   Say explicitly: **never run `./geldar.ps1 shard nats-auth colo` on the desktop.** It writes the node's auth file from desktop-side secrets, which is the drift this runbook avoids. Also state the rollback for the compose service (remove the container with `docker rm` after `docker stop`, never a network remove).
   The runbook also states the rollback lines the repo check requires.

### Coordination with geldar-93 (required)

- **MERGE/DONE protocol.** geldar-93 receives the plan before any node step: the exact diff, the commands, the time window and the rollback. The runbook is the plan. geldar-93 answers with DONE per step. The orchestrator holds the step until DONE.
- **Before dispatch and before the node change**, contact geldar-93 again with the diff (the original C7-03b rule, kept).
- **Batching.** Every image-changing merge refreshes all six ranger hosts. This card changes the image set (the supervisor image), so it is batched with the other C7 merges that change images. Do not merge it alone.
- **No network recreate.** Nothing in this card depends on recreating `geldar-colo`.

### Files

- may-edit: `compose/colo.yml`, `deploy/compose.secrets.yml`, `deploy/gen-secrets.sh`, `deploy/colo-supervisor.sh` and its test under `deploy/test/`, `shards/colo.yaml`, `supervisor/Dockerfile` (new; non-root, read-only-friendly), `docs/runbooks/supervisor-node-steps.md` (new), `tools/repo-checks/src/` (the new compose test), `docs/analysis/phase1/worknotes/C7-03b2.md`.
- must-not-edit: `threshold/register/`, `deploy/colo-up.sh` (the overlay is not used; the base file carries the service), other services' definitions, `docs/spec.md`, `compose/nats-auth.yml`.

### Tests (each fails on revert)

- `tools/repo-checks`: parse `compose/colo.yml` with the existing `yaml` package (no Docker needed). Only the `supervisor` service mounts `docker.sock`. Revert: add the socket mount to `register`; the test fails.
- `tools/repo-checks`: the supervisor has `read_only`, `cap_drop: [ALL]`, `no-new-privileges`, a non-root user, limits `0.25` and `128m`, no `privileged`, no `network_mode: host`, no published `ports`. Revert: drop `cap_drop`; the test fails.
- `tools/repo-checks`: the supervisor's `memswap_limit` equals its memory limit (no swap) and its CPU limit is set. The same holds for the `--memory-swap`, `--memory` and `--cpus` values in `deploy/colo-supervisor.sh`. Revert: set `memswap_limit` to `256m` (or drop the CPU limit); the test fails.
- `tools/repo-checks`: the budget arithmetic holds: the sum of the `GELDAR_COLO_*_CPUS` and `_MEM` defaults is at most `cpu_limit` and `memory_limit` in `shards/colo.yaml`. Revert: set `cpu_limit` back to 10.6; the test fails.
- `tools/repo-checks`: the supervisor secrets are referenced as files, never in `environment:`. Revert: move one to `environment`; the test fails.
- `deploy/test/colo-supervisor.test.sh` (a fake `docker` on PATH that records calls): a first run creates; a second run is a no-op; the run refuses when the network is missing; no recorded call matches `compose`, `network create`, `network rm`, `down`, `rm`, `--force-recreate`. Revert: change `docker create` to `docker compose up -d`; the test fails.
- The runbook carries the rollback lines and the phrase "never run `./geldar.ps1 shard nats-auth colo` on the desktop" (repo check).

### Checks

`./geldar.ps1 pnpm --filter @geldar/repo-checks test` (or the package name in `tools/repo-checks/package.json`), the compose check that `geldar.ps1` runs, `pwsh -NoProfile -File ./geldar.ps1 check`, `pnpm check:repo`. Live: `live: pending`, and nothing runs on the node in this card.

---

## C7-03b3: Postgres adapter and Docker client

- **id / wave / lane.** C7-03b3, wave 2. Non-register lane (`supervisor/` only). **depends-on.** C7-03a, C3-04s, C7-12 (all merged). **branch.** `phase1/c7-03b3-adapters`. **migration.** none (the grants are in 0024, 0025 and 0027; if a grant is missing, stop: the spare migration 0033 is the orchestrator's to assign). **size.** L (the largest; it may be split by the orchestrator into an adapter card and a Docker card, but not by the coder).

### Goal

The real adapters behind the existing ports in `supervisor/src/ports.ts`:

1. **Postgres.** `supervisor/src/pg-*.ts`, connecting as `geldar_supervisor` (the password comes from a Docker secret file, read at start, never logged):
   - `RosterPort`: reads `mcp_roster` and `mcp_owners` for the caller's owner and the name's record. Keys are lower-cased. Fails closed on any error.
   - `AdminFlagPort`: calls `supervisor_is_admin(owner)`. It does not read a column. A missing owner or an error is `false`.
   - `StartCountsPort` and `StartRow`: one row per start attempt in `body_ops`, keyed on the lower-cased name. The insert is the only write (0027 grants SELECT and INSERT only).
   - `AuditPort`: INSERT into `register_audit` (0025 grants INSERT and SELECT to the supervisor role). No UPDATE or DELETE.
   - `LogPort.recent`: bounded to the current roster record (its creation time or its owner). A new roster owner sees none of the previous owner's events.
   - Driver: the `pg` version the repo already pins (check `threshold/register/package.json` or `tools/migrate/package.json`). Reuse, do not add.
2. **Docker client.** `supervisor/src/docker.ts`: the Docker Engine HTTP API over the unix socket, with `node:http` and `socketPath` (no new dependency). It implements the `BodyRuntimePort` calls (create, start, stop, remove by id, inspect, logs). Every call honours the `AbortSignal` from the runtime timeout.
3. **Carry-forward (C7-03a review 5, all required in this card).**
   - Honour the abort signal. On abort or error, remove the container the aborted call created, by the id the Docker call returned, never by name (the name is shared with a newer attempt).
   - Replace a stopped container left by the previous roster owner, so the new owner can start the name (fix E, finding 2).
   - Log in with the exact `mcp_players.display_name` (case kept). Roster keys stay lower-cased; golem's id derivation and the offline-mode UUID depend on the exact case (decision 0108).
   - Call `supervisor_is_admin` for the admin check (ruling b).
   - Key containers by the lower-cased name, so one name is one body in Docker.
   - Pass `onAuditLost` in the composition root. It is optional today, and a lost audit row after an `ok` reply is otherwise silent (fix E).
   - 0082 CPU and memory limits in the generated container config (`HostConfig.NanoCpus` and `Memory`, or the names the Engine API uses). Tested at config level, on each axis.
   - Compensation by name: pass an attempt id or owner id on the runtime stop if the Docker client can support it. If it cannot, keep the known gap (fix G, finding 1) and say so in the worknote; do not claim it closed.
   - The read-only socket: the Docker client opens the socket read-write (it must create containers). The `:ro` note on the socket in C7-03b2 is not a control; the uid and the group are (see C7-03b2).

### Tests (each fails on revert)

- Abort: an aborted create removes the container by the returned id (fake Docker records the id; the test asserts the remove used the id, not the name). Revert: remove by name; the test fails.
- Abort and error paths on start, stop and logtail: each returns a refusal, never `ok`. A stopped container of a previous owner is replaced (revert: refuse on any existing container; the test fails).
- Logs: a fixture with events before and after the record's creation time; `recent` returns only the later events. Revert: drop the bound; the test fails.
- Exact name: the login env carries the display name's case (`Steve`, not `steve`), and the container name is lower-cased. Revert: use the key for login; the test fails.
- Admin: `supervisor_is_admin` is called with the owner id; an error or a missing owner gives `false`. Revert: read a column; the test fails (the SQL-text test asserts the function call).
- `onAuditLost`: the composition root's deps object has it set. Revert: remove it; the test fails.
- Limits: the generated config has `NanoCpus` and `Memory` equal to the `limits.ts` values, on each axis (CPU and memory are separate tests). Revert: remove the CPU limit; the CPU test fails.
- SQL text: every query names only the allowed tables and functions (`mcp_roster`, `mcp_owners`, `body_ops`, `register_audit`, `supervisor_is_admin`). No UPDATE or DELETE. Revert: add an UPDATE; the test fails.
- Integration against a real Postgres is behind `GELDAR_IT=1` and is not run here.

### Checks

`./geldar.ps1 pnpm --filter @geldar/supervisor test`, `./geldar.ps1 check`, `pnpm check:repo`. Live: a start and a stop of a DB-listed test player on the node is the orchestrator's `live: pending` step, after geldar-93 has the plan and b2 is merged. Nothing in this card starts a body.

---

## Order and dependencies

- b1 and b3 run in parallel: disjoint files (contract, `geldar.ps1`, the NATS files and the register client against the supervisor adapters).
- b2 runs after b1 (it needs the user names and subject builders) and after b3's image exists, and it lands in wave 3.
- b3 lands before any live start. No live start of a body happens before b2 is merged, the runbook is agreed with geldar-93, and the orchestrator runs it.
