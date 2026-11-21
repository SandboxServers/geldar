---
title: "Open sign-up (ordered runbook for the node operator)"
type: how-to
audience: operators
status: draft
last_verified: 2026-11-21 against a5adb9e9 (repo facts only; node status not checked by this edit)
companions: [README.md, body-helper-node-steps.md, nats-auth-inplace.md, account-deletion.md, mcp-tokens.md]
sources: [deploy/gen-secrets.sh, deploy/colo-admin.sh, deploy/colo-up.sh, deploy/colo-public.sh, compose/colo.yml, ../decisions]
---

# Open sign-up (ordered runbook for the node operator)

Audience: the node operator. Scope: the steps that take the Colo node from "sign-up closed" to "sign-up open" with managed Bodies. This runbook names files, variables and portal screens only. It contains no values. Never paste a secret, token, client id, tenant id, IP address or account name into a chat, a commit or this file.

Status on the node: UNKNOWN for every step, except the sign-up flip and re-flip in Section 4, which the node owner reports (not verified in this repo). No runbook or ledger records a node step as done. Check the change log before you start, and skip nothing that is not recorded as done.

## Owner gate

- Sign-up opens LAST, and only after C7-09 (account deletion and export), C7-11 (the sign-up gate: terms version approved by the owner in a committed file), C7-13a (skin uploads added to `register_account_delete`, see [account-deletion.md](account-deletion.md)) and BH-5 (unwhitelist on retire and delete) are all built, deployed and live-checked. BH-5 must be deployed before sign-up opens. BH-6 (managed host exit 78 sweep) is built and merged (#575). The BH-6 sweep covers only an exit 78 orphan; a lost (absent) container is cleaned by hand (Section 4 item 4), which the owner accepted for now, so neither it nor row 25a holds step 27.
- Until the owner says yes in writing, `REGISTER_KILL_SWITCH` stays `true`. Decision 0153 item 3 says the kill switch "stays off". Read that as "sign-up stays closed": the env value stays `true`. Rows 20 to 23 never set it to `false`.
- Decision 0261 does not say whether M1 waits for C7-09 and C7-11 (0153 says it does). That question is open for the owner. The owner gate above is the answer used here. Row 21 is not blocked on that question; row 27 is.
- The final step needs an explicit owner yes in the same message thread as the go. A standing "later" is not a yes.

## Global rules (every step)

1. One step, verify it, then the next. Dry run first where the step offers one.
2. Never print or paste a secret value. No `set -x` near secret files.
3. Never `docker compose down -v`. Never touch `geldar-player-ag-*` containers. Never remove or recreate the `geldar-colo` network.
4. Never run `shard nats-auth colo` or any `shard nats-auth` command. Never restart NATS.
5. Tell the node operator and get the owner's agreed window before any compose recreate of Paper, and before any whole-stack `up`.
6. No Docker socket in any container (decision 0260).
7. Merge image-changing cards in one deploy window.
8. Caps from 0261: 40 running Bodies in total, and the 15 sovereign hosts count toward it (alert and review at 30); per-owner agent cap 3.
9. Write a change-log line for every step: date, step number, result, who ran it. No values in the log.
10. `deploy/colo-up.sh` is a Paper recreate and a whole-stack `up`. Never run it for a single step of this runbook.

## Shared resources and their rules

| Resource | Rule |
|---|---|
| NATS live config | Owner approval before any NATS change. Edit in place only: write the new file with `cat new > live`, never `mv`. Then reload with SIGHUP to the NATS container. Keep a backup and its sha. Follow [nats-auth-inplace.md](nats-auth-inplace.md). |
| Compose stack | Recreate named services only. Never `down -v`. Tell the node operator and get the owner's window before touching Paper. |
| Postgres | Schema changes only through the repo migrations (`deploy/colo-admin.sh migrate`). Use the role named in the step, never a shared admin password in a file. |
| Caddy (public) | Validate before reload. One `board-proxy` restart per window. Use `deploy/colo-public.sh` only. |
| Secret files | Owner-provided or generated on the node by `deploy/gen-secrets.sh`, mode 0600, owned by the service uid, never in git. |

## Ordered steps

Who runs each step: "Owner" means the owner of the Microsoft account and the repo. "Node" means the node operator on the Colo node. "Orchestrator" means the campaign runner for live checks. "Ops" means the operations engineer who runs the Azure CLI; rows 1 and 20 are run by Ops. "Blocked on" names the cards that must be done first; a step marked BLOCKED is not started.

| # | Step | Runs by | Owner provides | Blocked on | Rollback | Reference |
|---|---|---|---|---|---|---|
| 1 | Entra sign-in app: reuse the existing shared app (no new app for this cutover) | Ops | The existing app's client id (env) and client secret (file, never chat) | none | Remove the env value and the secret file; never delete the shared app | Section 1 |
| 2 | Stage the body-helper bundle | Node | Yes to install the helper | none | As the helper rollback | [body-helper-node-steps.md](body-helper-node-steps.md) Step 0a |
| 3 | Stage the pinned Node runtime | Node | Nothing | none | As the helper rollback | [body-helper-node-steps.md](body-helper-node-steps.md) Step 0a |
| 4 | Decide how the helper gets its Postgres admin variables | Node | Nothing | none | None (decision only) | [body-helper-node-steps.md](body-helper-node-steps.md) open question 2 |
| 5 | Write the helper env file | Node | The global Body cap (default 40) | Step 4 | Remove the env file | [body-helper-node-steps.md](body-helper-node-steps.md) Step 0 |
| 6 | Dry run the helper installer | Node | Nothing | Step 5 | None (dry run) | [body-helper-node-steps.md](body-helper-node-steps.md) Step 1 |
| 7 | Apply the helper installer | Node | Go for the install | Step 6 | As the helper rollback | [body-helper-node-steps.md](body-helper-node-steps.md) Step 2 |
| 8 | Maintenance notice for Body clients | Node | Agreed window | none | `back` ends the notice | [nats-auth-inplace.md](nats-auth-inplace.md) procedure 0: `deploy/colo-notice.sh pause bodies <seconds>`, then `back` |
| 9 | NATS auth batch for the helper and supervisor users | Node | Owner approval of the batch; a separate owner approval for the widened denies | PR #415 is merged to main (merge commit `4bab81b3`); BLOCKED on the node running its generator output | Restore the backup by `cat`, check the sha, SIGHUP | [nats-auth-inplace.md](nats-auth-inplace.md) and [body-helper-node-steps.md](body-helper-node-steps.md) Step 3 |
| 10 | Verify the helper | Node | Nothing | Steps 7 and 9 | None (read only) | [body-helper-node-steps.md](body-helper-node-steps.md) Step 4 |
| 11 | NATS user for the register service (its own batch) | Node | Owner approval of this NATS batch | BLOCKED on C7-03b2 (REG-NATS-COMPOSE) | Restore the backup by `cat`, check the sha, SIGHUP | Section 2 note; [nats-auth-inplace.md](nats-auth-inplace.md) |
| 12 | Deploy the supervisor service and the register NATS env | Node | Owner approval; go for the deploy window | BLOCKED on C7-03b2, C7-03c3 and C7-03b5; steps 7, 9, 10 and 11 | Recreate the previous service; no network recreate | Card C7-03b2 |
| 13 | BODY-HOST: apply the BH-1 SQL migration 0063 | Node | Go | BLOCKED on BH-1 | Restore from a pre-step `pg dump` only with the owner's go | Card BH-1; through `deploy/colo-admin.sh migrate` |
| 14 | BODY-HOST: set the `geldar_body_host` role password and write the two root-only secret files | Node | Nothing | BLOCKED on BH-1 to BH-4 | Remove the two files; set a new role password | Cards BH-1 to BH-4 (names come from BH-4; no values) |
| 15 | BODY-HOST: RCON secret path and the managed flag (default off) in the helper root config. The RCON path is read by the admit one-shot only, never by the helper process | Node | Nothing; the flag stays off until row 19a | BLOCKED on BH-1 to BH-4 and step 14 | Set the managed flag off; remove the path | Cards BH-1 to BH-4 |
| 16 | BODY-HOST: pull the golem image | Node | Nothing | BLOCKED on BH-1 to BH-4 | Remove the pulled image tag | Cards BH-1 to BH-4 |
| 17 | BODY-HOST: restart the helper | Node | Go for the restart window | BLOCKED on BH-1 to BH-4 and steps 14 to 16 | Stop the helper unit; the managed flag off | Cards BH-1 to BH-4 |
| 18 | BODY-HOST: confirm the live `body` NATS user holds the `$KV.geldar-life-registry.>` publish | Node | Nothing | BLOCKED on BH-1 to BH-4 and step 17 | None (read only); if the publish is missing, change it only in a NATS batch under step 9's rules | [nats-auth-inplace.md](nats-auth-inplace.md) |
| 19 | Live Body check, one run with an owner-owned test agent. Check that the started Body's container environment and binds hold no RCON secret | Orchestrator, on the node by the node operator | Owner-owned test agent, made by the operator roster path (`deploy/colo-admin.sh roster-add <name> --owner <owner>`, then player-add; see [mcp-tokens.md](mcp-tokens.md)). No sign-in is needed, so steps 20 and 21 are not needed | BLOCKED on steps 13 to 18, step 12, card C7-03b4-live and ROSTER-AUTO | Stop the test Body cleanly; managed flag off | Card C7-03b4-live; [body-helper-node-steps.md](body-helper-node-steps.md) |
| 19a | Managed flag on for the agents the owner names | Node | Owner's written choice of timing; the default is after step 19 passed and the Body stopped cleanly, and before step 26 | Step 19 passed and stopped cleanly | Managed flag off | Step 15 (the flag) |
| 20 | Register secret files and env | Ops | Client id and secret from step 1 | Step 1 | Remove the env values; the kill switch stays `true` | Section 2 |
| 21 | Start the register profile with the kill switch `true` | Node | Nothing | Step 20; ROSTER-AUTO migration; C7-09 route; steps 11 and 12 are not needed while register runs with NATS off (pending C7-03b2) | Recreate the register service only, with the kill switch `true` | Section 2 |
| 22 | Public routes for Glass (`GELDAR_PUBLIC_APPLY=restart`: one `board-proxy` restart, Caddy admin API off) | Node | Nothing | Step 21; LEGAL-SERVE | Re-run the install with the upstream unset (503 block), then one `board-proxy` restart | Section 3 |
| 23 | Roster seed (optional operator data; not on the minimum path) | Node | Go for the roster seed, only if the owner wants existing agents rostered | none; ROSTER-AUTO covers new sign-ups | Seeded rows are removed only with the owner's go | Section 6; [mcp-tokens.md](mcp-tokens.md) |
| 24 | Deletion follow-ups | Node | Decisions on kept agent rows and the kino audit | Card C7-09c | As [account-deletion.md](account-deletion.md) | [account-deletion.md](account-deletion.md) |
| 25 | BH-5: unwhitelist on retire and delete, built and deployed | Node | Go for the deploy window | BLOCKED on BH-5 and steps 13 to 18 | Recreate the previous build; no network recreate | Card BH-5 |
| 25a | BH-6: the sweep removes a managed Body whose roster row is gone after exit 78 on two consecutive passes, and its whitelist entry | Node | Go for the deploy window | None. The owner accepted manual cleanup of lost-container life ids for now (Section 4 item 4), so this row does not block the cutover | None; the managed flag stays off | Card BH-6 |
| 26 | Gate check: C7-09, C7-11, C7-13a and BH-5 done; BH-6 built; lost-container cleanup is manual, not a gate | Owner | Answer to the 0261 question; approval of terms v1 (listed in `APPROVED_TERMS_VERSIONS` in `signup-gate.ts` in the register service source); the drift and batch C answers in Section 4 | Steps 24 and 25; row 26a; cards C7-09, C7-11, C7-13a; the drift in the Section 2 note closed or accepted | None | Section 4 |
| 26a | NATS batch C: narrow `$JS.API.>` for the body, mind and mcp roles (deny STREAM.CREATE/UPDATE and KV creation), after a read-only startup check of which of them create streams or KV, with a throwaway-server test first. Reason: the PubDenys (hearing, state level, kino, ctl.body) can be bypassed by a deliberate JetStream republish stream; batch C stops bugs, not a forger | Node | The owner's approval of batch C (owner: the world-operations coordinator), or an accepted risk in writing | Step 9 done; the throwaway-server test passed; the read-only startup check recorded | Restore the backup by `cat`, check the sha, SIGHUP | [nats-auth-inplace.md](nats-auth-inplace.md) Open questions (the JetStream republish caveat); [0199 muffled hearing](../decisions/0199-muffled-hearing.md), Decision item 9 (the hearing channel) |
| 27 | Open sign-up (kill switch `false`) | Node | Explicit yes, after step 26 | Step 26 | Kill switch `true`; recreate the register service only | Section 4 |
| 28 | First admin, after the first owner sign-in | Node | The owner's sign-in | Step 27 (a first admin cannot sign in before sign-up opens) | Remove the admin role by hand only with the owner's go | [mcp-tokens.md](mcp-tokens.md) |

Steps 1 to 12 are the helper and NATS work; steps 13 to 19 are BODY-HOST and the live Body check. Together they are prerequisites for live Bodies, not for the sign-in page. Steps 20 to 22 bring up the sign-in service with sign-up closed. Step 27 is the only step that opens sign-up. Step 28 happens after it.

## Section 1: Entra app (shared app, reused)

No new Entra app is created for this cutover. The existing shared app is reused (decision 0135, R40 and R42). Tenant ids, the app id, account names and the secret never go into chat or this file.

1. Check, do not create: the app's sign-in audience must be personal Microsoft accounts, and its redirect URI must be the Glass origin followed by `/register/callback`.
2. The client secret's end date is 2027-11-11. Record that date (the date only) in the change log.
3. The client id goes to the node env as `REGISTER_MS_CLIENT_ID`. The secret stays in the file `register-ms-secret.txt`. Never send either in chat.

Rollback: remove the env value and the secret file. Never delete the shared app.

## Section 2: Secret files, env and the register profile (node)

Renders of the compose config (`config` output) are produced on the operator's machine. They are never written on the node. Rows 20 to 23 keep `REGISTER_KILL_SWITCH` at `true`. Node status of every row is UNKNOWN. The repo facts in this section were read from origin/main at a62ceb44 on 2026-11-20 (unchanged; not re-read in the 2026-11-21 edit). The node itself was not checked.

Secret files, by name only. Never print a value.

- `register-ms-secret.txt`: owner-provided (step 1). Placed by hand, mode 0600, owned by the service uid. `gen-secrets.sh` never generates it.
- `register-pepper.txt`: generated. At least 32 characters after trim.
- `register-session-key.txt`: generated. At least 32 characters. Shared with Glass by the Kino session overlay.
- `mcp-token-pepper.txt`: generated only when it is missing. At least 32 bytes, no byte-order mark, at most one trailing LF or CRLF. The register service reads it strictly, and the MCP reads the same file. Never regenerate it and never delete it: a new value breaks the existing tokens.
- `postgres-register.txt`: generated (the `geldar_register` login password).
- `nats-register.txt`: created in step 11, by the same method as `nats-supervisor.txt` in [nats-auth-inplace.md](nats-auth-inplace.md) (umask 077 and `set -C`, so an existing file is never overwritten).

Generated files come from `deploy/gen-secrets.sh`, run as root on the node. Pass the service uid on its command line: `sudo env GELDAR_SERVICE_UID=1001 sh deploy/gen-secrets.sh` (add `GELDAR_SECRETS_DIR=<secrets dir>` after `env` only if the secrets dir is not the `common.sh` default). `sudo` strips the caller's environment, so a bare `GELDAR_SERVICE_UID=1001 sudo ...` does not pass the value. The script creates only the missing files, prints file names only, and writes mode 0600 in a 0700 directory owned by the service uid. It also re-owns existing files to that uid, so a wrong value changes ownership of live secrets. Do not create a generated file by hand.

Deploy values the operator sets in the node env. Compose reads them; their compose defaults are shown so you know which ones must be set:

- `REGISTER_MS_CLIENT_ID`: owner value from step 1. Default empty.
- `REGISTER_PUBLIC_URL`: the Glass origin. Default is a placeholder, so it must be set.
- `REGISTER_MCP_PUBLIC_URL`: the MCP origin. Default empty; MCP links stay broken until it is set.
- `REGISTER_TRUSTED_PEERS`: the peer list from the release env. Default falls back to the MCP trusted proxies.
- `REGISTER_KILL_SWITCH`: must be `true` in this section. Default `true`; only the exact value `false` opens sign-up (step 27).
- `GELDAR_REGISTER_IMAGE`: the register image from the release manifest (`current.env`, written by `deploy/colo-cd.sh` and swapped by `colo-rollback.sh`; the order of the two `--env-file` arguments in item 4 is the owner's node rule, UNVERIFIED in the repo). It must be pinned by digest and present on the node before any `up`.
- `GELDAR_COLO_REGISTER_CPUS` and `GELDAR_COLO_REGISTER_MEM`: optional; compose defaults apply if unset.
- `REGISTER_NATS_URL`, `REGISTER_NATS_USER`, `REGISTER_NATS_PASSWORD_FILE`: added by card C7-03b2 (pending C7-03b2). Compose does not set them yet, so the register service runs with NATS off, and setting them on the node does nothing until C7-03b2 merges. Only the register service gets these.

Compose sets these names itself. Do not set them on the node: `REGISTER_HOST`, `REGISTER_PORT`, `REGISTER_SHARD`, `REGISTER_MS_CLIENT_SECRET_FILE`, `REGISTER_SESSION_KEY_FILE`, `REGISTER_PEPPER_FILE`, `REGISTER_TOKEN_PEPPER_FILE`, `REGISTER_DB_PASSWORD_FILE`.

`GELDAR_REGISTER_UPSTREAM` is not a compose name. It is a key in the root-only `GELDAR_PUBLIC_ENV` file, set in Section 3.

`GELDAR_SERVICE_UID=1001` is not read from the node env. `common.sh` defaults the uid to 1000, and compose uses `${GELDAR_SERVICE_UID:-1000}`. Put `GELDAR_SERVICE_UID=1001` on the command line of every compose, `colo-admin.sh` and `gen-secrets.sh` command in this runbook, as shown in items 1, 3 and 4. `colo-admin.sh` sources `common.sh` and checks the secret files against that uid, so a missing value makes it stop.

Render gate (read only; items 3 and 4 refer to it). Renders happen on the operator's machine, never on the node:

- (a) `config --quiet` passes with the same compose files and env names as the running project.
- (b) The register block of the rendered config is compared with `docker inspect` of the running register container: image reference, env names and non-secret values, mounts, limits, user, and ports. Secret values are never printed; compare names only. The only allowed difference is the intended env value (for example `REGISTER_KILL_SWITCH` when the step 27 flip is intended). Image-level ENV (such as `NODE_ENV`, `NODE_VERSION`, `PATH` and `YARN_VERSION`) comes from the image: it is expected in `docker inspect` and absent from the render, and that is not a mismatch.
- (c) The rendered `com.docker.compose.config-hash` label is compared with the running one for postgres, nats, paper, velocity, bluemap-alias and bluemap-web only. The bluemap-alias and bluemap-web blocks read only names that the compose files and the Section 2 command set (`GELDAR_STATE_DIR`, `GELDAR_SERVICE_UID`, the `GELDAR_COLO_*` limits and the bluemap ports) provide. For eventsink, glass, geldar-mcp and players-host the render is UNPROVEN: the node's deploy env file (sourced by `colo-cd.sh`) exports env, such as `GELDAR_TELEMETRY_URL` and `GELDAR_KINO_ENABLED`, that the compose env files do not hold, so their hash is not a gate. The register-only command does not touch them, so verify instead that their `StartedAt` times are unchanged before and after it (read only, `docker inspect`).

Container names: address every container in the render gate, and in every `docker inspect` (image, `StartedAt`, config-hash) comparison, by its exact compose name `geldar-colo-<service>-1`, for example `geldar-colo-register-1`. Never match by a name pattern such as `geldar-colo-*` or `*register*`: a pattern also matches the `geldar-nf-*` containers (the NeoForge lane), which must never be compared with or touched. The same applies to the `StartedAt` checks in item 4.

A mismatch in any part means stop and report.

Order:

1. Create the secret files above. Verify each exists with the right mode and owner, without printing contents: `stat` for mode and owner, `wc -c` for length. The token pepper must have no byte-order mark.
2. Set the deploy values above in the node env. Verify with the compose config check (`config --quiet`), without pasting its output.
3. Migrations and role password. Read-only check first: `GELDAR_SERVICE_UID=1001 deploy/colo-admin.sh migrate --dry-run` prints `nothing to apply` when the migrations are current, and takes the lock without creating anything. A `would apply` line means a migration is missing: stop and report. Caution: the admin wrapper runs its one-shot without `--no-deps`, and that container depends on postgres. Run the render gate (above) for postgres first; if it differs, stop. There is no read-only login check: `GELDAR_SERVICE_UID=1001 deploy/colo-admin.sh migrate --set-role-password geldar_register --password-file /run/secrets/postgres-register.txt --dry-run` connects to nothing and always prints `dry run: the password of geldar_register would be set; nothing was run`. The real run is login-first: if the file's password already logs in, it prints `password already set for role geldar_register: the file's password logs in; nothing changed` and changes nothing. Run migrate first (`GELDAR_SERVICE_UID=1001 deploy/colo-admin.sh migrate`), then the real set-role-password command (`GELDAR_SERVICE_UID=1001 deploy/colo-admin.sh migrate --set-role-password geldar_register --password-file /run/secrets/postgres-register.txt`); either line shows whether it was needed. The real set-role-password run needs the owner's go, and its output line is the record of the password state. These are the two commands `deploy/colo-up.sh` runs at its lines 55 and 58. Each one changes the database and needs the owner's go. Do not run `deploy/colo-up.sh` itself: it recreates Paper and runs a whole-stack `up`, which needs the owner's agreed window (global rule 5). Do not alter the migration table by hand.
4. Start the register service only, with the kill switch `true`. Pre-checks: the image is pinned by digest and present (`docker image inspect`), no `REGISTER_KILL_SWITCH=false` in either env file (check the name with `grep -c`, print no values; this applies only until the owner chooses to persist, see the decision note in Section 4), and the render gate passes. Then run the compose files of the running project, in the order and with the contents of its `com.docker.compose.project.config_files` label (copy the list from the label; do not rely on the list here). The repo minimum is `compose/colo.yml`, `compose/nats-auth.yml`, `deploy/compose.secrets.yml`, `compose/colo-kino.yml`; the node may merge more, such as `compose/colo-kino-session.yml` (UNVERIFIED for the node). Use both env files and both profiles:

```
GELDAR_STATE_DIR=<state dir> GELDAR_SECRETS_DIR=<secrets dir> GELDAR_SERVICE_UID=1001 \
GELDAR_KINO_PUBLIC_ORIGIN=<kino origin> \
docker compose -p geldar-colo <files from the label, each as -f> \
  --env-file <state dir>/node.env --env-file <state dir>/current.env \
  --profile register --profile sovereign up -d --no-deps register
```

The `--no-deps` flag is required: the register service depends on postgres, and without it compose would also reconcile postgres. `--profile sovereign` is required so the rendered model matches what is running. `GELDAR_KINO_PUBLIC_ORIGIN` is read from the running glass container and is needed, or `config` fails. The kill switch is `true`, so no sign-in is possible. Do not run `deploy/colo-up.sh` (item 3). To open sign-up (step 27), run the same command with `REGISTER_KILL_SWITCH=false` set on the command line as a shell variable, never in an env file; compose gives the command-line value precedence over the env files. Before and after the command, record the `StartedAt` of eventsink, glass, geldar-mcp and players-host (read only) and confirm they are unchanged.

Rollback: remove the env values and recreate the register service with the kill switch `true`. Other steps are not undone.

## Section 2 note: the register NATS batch (step 11)

Step 11 is its own batch, with its own backup and sha, a diff that shows only the `register` user, SIGHUP and its own owner go. See [nats-auth-inplace.md](nats-auth-inplace.md).

The live `body` and `paper` users lack the PubDeny for `geldar.<s>.ctl.body.>` and `geldar.<s>.state.*.level` (the drift recorded in nats-auth-inplace.md). Opening sign-up with a `register` user while that drift stands is a known gap. Closing it in its own batch, or an owner decision in writing to accept it, is a prerequisite of step 27.

## Section 3: Public routes (node)

1. Add `GELDAR_REGISTER_UPSTREAM` to the root-only `GELDAR_PUBLIC_ENV` file (`/etc/geldar-colo/public.env`, owner root, mode 600: the owner's path; `colo-public.sh` has no default for it, UNVERIFIED in the repo), before the install. Its value is the loopback address and port of the register service from compose (decision 0150): `127.0.0.1:<GELDAR_PORT_REGISTER>`, 18090 by default. `colo-public.sh` accepts only that form. The other keys (domain, glass and map upstreams) must already be in the file. No other address.
2. Dry run only: `DEPLOY_DRY_RUN=1 GELDAR_PUBLIC_APPLY=restart deploy/colo-public.sh install glass`. It prints every state change, changes nothing, and names no other site. The script validates before it applies.
3. Apply, one real run, one path only. The Colo node runs with the Caddy admin API off (ruling R39), so the default reload path (`GELDAR_PUBLIC_APPLY` unset or `reload`) must not be used there; do not run `install glass` without `GELDAR_PUBLIC_APPLY=restart`. Run `GELDAR_PUBLIC_APPLY=restart deploy/colo-public.sh install glass`; add `GELDAR_PUBLIC_RESTART_OK=1` only if the script is to restart `board-proxy` itself:
   - With `GELDAR_PUBLIC_RESTART_OK=1`, the script restarts `board-proxy` once and waits up to 30 s for a valid config.
   - Without it, the script prints `RESTART board-proxy once`, and the operator restarts the container by hand, once.
   Never do both. Record which path ran in the change log. A Caddy restart interrupts every site on the shared Caddy for a few seconds (unmeasured), including other tenants' sites. It needs the node owner's window, and it is one restart per window.
4. Verify with the kill switch still `true`. `/register/` must return the register service's own 503 (its kill switch). It needs row 21 healthy and the register upstream in the Glass render. The text "the register service is not deployed" means the upstream is unset, so it is a failure. Legal pages also return 503 until row 27, because the kill switch comes before every route. Check that Glass `/` still answers after the restart (GET only).
   Open item: the signed-in check is not defined yet. A signed-in session is impossible while the kill switch is `true`, so the check needs a request the owner and the node operator name in writing before step 27. Record the result in the change log.

Rollback, lighter first: re-run the install with `GELDAR_REGISTER_UPSTREAM` unset. The script writes the 503 block for `/register*` and `/roster*`, and the same one-restart rule of step 3 applies. Full rollback: `deploy/colo-public.sh off glass` takes the whole Glass site off (not only the register paths), so use it only for a Glass outage. See [maintenance-notice.md](maintenance-notice.md) if clients are affected.

## Section 4: Gate and open (owner, then node)

Run the Verify checklist below first; every line must pass.

Before this section, every step from 1 to 25, except the optional row 23 and row 25a (manual cleanup, not a gate), and row 19a, is recorded in the change log with its result. Step 26 is the owner's gate.

1. Owner confirms C7-09 (deletion and export) is deployed and live-checked.
2. Owner confirms C7-11 (sign-up gate) is deployed, and that terms version 1 is listed in `APPROVED_TERMS_VERSIONS` in `signup-gate.ts` in the register service source.
3. Owner confirms C7-13a is deployed: `register_account_delete` removes skin uploads.
4. Owner confirms BH-5 is deployed: retire and delete unwhitelist the Body. Known gap: a managed container lost while its life stays admitted is not removed by the stop, because the supervisor sends no stop for an absent container. Its life id is left admitted with no automatic cleanup built; the operator removes it with the exact-name remove one-shot per [body-helper-node-steps](body-helper-node-steps.md). With the managed flag off, a lost container likewise leaves its life admitted until that manual removal. The owner has accepted this manual cleanup for now (row 25a), so it does not block step 27.
5. Owner confirms the `body`/`paper` PubDeny drift (Section 2 note) is closed, or accepts it in writing.
6. Owner gives the word on NATS batch C (row 26a), or accepts the JetStream republish risk in writing.
7. Owner answers the open 0261 question in writing.
8. Owner gives an explicit yes for the open step.
9. Node opens sign-up: runs the Section 2 item 4 register-only command with `REGISTER_KILL_SWITCH=false` on the command line (the re-flip rule below applies), then verifies the register log line `register listening killSwitch=false`. The command has the Section 2 item 4 shape, with the flip as a shell variable on the first line (the files, env files and profiles are copied from the running project's label, as in item 4):

   ```
   REGISTER_KILL_SWITCH=false GELDAR_STATE_DIR=<state dir> GELDAR_SECRETS_DIR=<secrets dir> GELDAR_SERVICE_UID=1001 \
   GELDAR_KINO_PUBLIC_ORIGIN=<kino origin> \
   docker compose -p geldar-colo <files from the label, each as -f> \
     --env-file <state dir>/node.env --env-file <state dir>/current.env \
     --profile register --profile sovereign up -d --no-deps register
   ```
10. Verify: sign-in works; terms consent is recorded; agent registration creates the roster entry; a token can be issued. This step does not verify a Body start: the only Body starts are step 19 and row 19a.
11. Verify the sign-in redirect target (read only, no sign-in; run after item 9 and after every re-flip). With the kill switch `false`, `GET <Glass origin>/register/login?consent=yes` answers 302. Capture that response's redirect target into a shell variable without printing it, then request only the status of that target. Use exactly these two commands, with no `-i`, `-v` or `-L` (`-i` and `-v` print the `Location` header, which carries `state` and `code_challenge`; `-L` follows the chain):

   ```
   AUTH_URL=$(curl -s -o /dev/null -w '%{redirect_url}' '<Glass origin>/register/login?consent=yes')
   curl -s -o /dev/null -w '%{http_code}' "$AUTH_URL"
   ```

   Expect 302 or 200 from the Microsoft host, never 404. A 404 is a stop: close sign-up with the item 9 command and `REGISTER_KILL_SWITCH=true` (Rollback below), report it, and do not re-flip until the cause is fixed. Checking only that the redirect points at the Microsoft host is not enough: a wrong authorize path there still passes that check, and only the status shows it.

Rollback: run the item 9 register-only command with `REGISTER_KILL_SWITCH=true` on the command line, and recreate the register service only. Other steps are not undone. Users who signed in during the open window keep their accounts; the deletion path in [account-deletion.md](account-deletion.md) handles removal.

Re-flip rule (step 27). The flip is on the command line only, so any deploy that recreates the register service re-closes sign-up, because the compose default is `true`. That includes every register image change, even when the deploy window bundles other changes. Every `colo-images` deploy that rebuilds the images recreates every service, not only the ones whose code changed: each rebuild changes every image digest through the revision label. So register is recreated and sign-up re-closed by every such deploy, even one that does not touch register code. The node owner re-flips after the deploy finishes. Record the `StartedAt` of each service on the exact names just before the flip, then after it: only register's `StartedAt` may change (`docker inspect`, read only). A change to any other service's `StartedAt` across the flip is a finding to report.

After such a deploy, the node owner re-runs the item 9 register-only command with `REGISTER_KILL_SWITCH=false` and verifies the log line `register listening killSwitch=false`. It then runs item 11 with the same stop rule: a 404 closes sign-up again, as above. Log each re-flip in the change log.

A merge-queue run can be ejected on a transient Maven Central fetch failure in the plugin job. That is not a code problem: re-queue the run, and do not change the code or the runbook for it. Example, as reported by the node owner (not verified in this repo): the first flip was on 2026-11-21 at 02:19Z; a register recreate at 05:59Z the same day closed sign-up again; the re-flip was at 22:08Z.

Decision note (owner's call, held until the owner has signed in once). Persisting `REGISTER_KILL_SWITCH=false` in the node env file would remove the re-flip rule. Compose gives the command-line value precedence over the env files, so the emergency close stays one register-only command with `true`. Until the owner chooses to persist, the Section 2 item 4 pre-check ("no `REGISTER_KILL_SWITCH=false` in either env file") applies; if the owner persists it, that pre-check changes with the decision.

## Section 5: First admin (node, after step 27)

Once the first owner has signed in, the sign-in creates the account. Make it the first admin by the steps in [mcp-tokens.md](mcp-tokens.md). This cannot be done before the open step: a first admin exists only after a human's first Microsoft sign-in, and the kill switch blocks every sign-in until step 27.

## Section 6: Roster seed (row 23, optional)

Row 23 is not on the minimum path to sign-up. ROSTER-AUTO rosters new sign-up agents in code. A seed only adds names for agents that already exist. Whether the seed must happen before step 27 is the owner's call; decision 0261 does not settle it.

No node command runs `roster seed`. `deploy/colo-admin.sh` and `tools/admin/admin.sh` accept `roster-add` and `roster-list` only. [mcp-tokens.md](mcp-tokens.md) still describes `roster seed` as the operator step; that is stale on this point (ROSTER-AUTO and the wrapper), and this packet does not change it. The one wrapper path is one `roster-add` per name:

- Read the names from the shard file's sovereign player list on the node. Do not list names in chat or in the change log.
- Dry run: `DEPLOY_DRY_RUN=1 deploy/colo-admin.sh roster-add <name> --owner <owner>` prints the plan.
- Apply, with the owner's go: `deploy/colo-admin.sh roster-add <name> --owner <owner>`.
- Check before and after: `deploy/colo-admin.sh roster-list --owner <owner>`.

Name rule: 1 to 16 letters, digits or underscores. The owner id must exist first (`deploy/colo-admin.sh owner-add <id> [--cap N]`). The wrapper runs the admin one-shot without `--no-deps`, so the Section 2 item 3 caution applies.

Removal: the wrapper has no remove command. Removing a seeded row needs the owner's go and the direct CLI path. `register_audit` is append-only, so rows are not erased.

## Verify checklist (before the open step)

- Helper unit is active; no Body has started by hand.
- NATS users for helper, supervisor and register answer their own permission checks (read only).
- Migrations through the register migrations are applied (the Section 2 item 3 dry run prints `nothing to apply`), and the `geldar_register` password state is the output line of the set-role-password run in Section 2 item 3 (there is no separate read-only check).
- Register service is up with the kill switch `true`; `/register/` returns the register service's own 503 (Section 3 step 4).
- BODY-HOST steps 13 to 18 passed. BH-5 is deployed.
- The live Body check (step 19) passed, the Body was stopped cleanly, and its container environment and binds hold no RCON secret.
- The `body` and `paper` drift in Section 2 note is closed, or the owner has accepted it in writing.

## Rollback summary

| Scope | Action |
|---|---|
| Open sign-up | Kill switch `true`; recreate register service only |
| Public routes | Install with the upstream unset (503 block), then one `board-proxy` restart; `off glass` only for a Glass outage |
| Register env and secrets | Remove env; kill switch stays `true` |
| Helper | Follow [body-helper-node-steps.md](body-helper-node-steps.md) rollback |
| BODY-HOST | Managed flag off; stop the helper unit; the cards BH-1 to BH-5 give the rest |
| NATS | Restore the backup by `cat`, check the sha, SIGHUP, read the logs (see [nats-auth-inplace.md](nats-auth-inplace.md)) |
| Entra app | The shared app is reused: remove the env value and the secret file; never delete the shared app |

## Pending (as first written; the "Merged on `main`" bullet lists what has merged since)

- REG-NATS-COMPOSE (steps 11 and 12) is folded into card C7-03b2 (pending C7-03b2). The `REGISTER_NATS_*` names are not yet in `compose/colo.yml`. The register config already reads the NATS names; compose sets none of them, so the register service runs with NATS off. The card's status was not re-checked in this edit (UNVERIFIED).
- PR #415 (steps 9 and 10) is merged (merge commit `4bab81b3`, 2026-11-15). The NATS batch still waits for its own owner go and for the node to run the generator output.
- NATS batch C (row 26a) is not built and has no card number yet. The JetStream republish caveat is in [nats-auth-inplace.md](nats-auth-inplace.md) Open questions.
- Cards named in the table for steps 13 to 18 (BODY-HOST, cards BH-1 to BH-4), step 25 (BH-5) and step 19 (C7-03b4-live). BH-4 names the two root-only secret files that row 14 writes. Merge status is in the "Merged on `main`" bullet below.
- Cards named in the table for steps 19, 21 and 22: ROSTER-AUTO and LEGAL-SERVE. Merge status is in the "Merged on `main`" bullet below.
- Cards named in the table for step 26 (C7-13a) and step 24 (C7-09c). Merge status is in the "Merged on `main`" bullet below.
- Merged on `main` since this list was first written (`git log --grep`, 2026-11-16, at `03c1f5de`): BH-1 (PR #525, migration `sql/0063_body_host_roles.sql`), BH-2 (#527), BH-3 (#530), BH-5a (#537), ROSTER-AUTO (#515), LEGAL-SERVE (#404), C7-03c3 (#447), C7-03b5 (#503), BH-6 (#575). No commit names BH-4, C7-13a (other than a planning commit) or C7-09c. Whether each card is complete and deployed on the node is not checked here; the campaign ledger (`docs/analysis/phase1/ledger.md`) is the record. The BLOCKED markers in the table are unchanged until that check.
- The RCON whitelist verb and the Velocity life key for DB-only agents are open 0261 sub-questions.
- The signed-in check for Section 3 step 4 is not named yet.
- The tool for the supervisor-user status probe is not yet named.
