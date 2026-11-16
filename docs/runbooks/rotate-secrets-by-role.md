---
title: Rotate secrets by role
type: how-to
audience: operators
status: draft
last_verified: 2026-11-16 against 03c1f5de
companions: [README.md, nats-auth-inplace.md, body-helper-node-steps.md, open-signup.md, mcp-tokens.md, kino.md, skins.md, bring-up-phase0-shard.md, backup-and-restore.md, ../reference/compose-stacks.md, ../reference/deploy-scripts.md, ../reference/environment-variables.md, ../reference/register-service.md, ../reference/admin-service.md]
sources: [geldar.ps1, deploy/gen-secrets.sh, deploy/compose.secrets.yml, deploy/colo-up.sh, deploy/colo-admin.sh, deploy/install-body-helper.sh, deploy/common.sh, tools/admin/admin.sh, tools/mcp-tokens/src/cli.ts, tools/mcp-tokens/src/tokens.ts, tools/mcp-tokens/src/secret-files.ts, tools/migrate/src/migrate.ts, tools/players-cli/src/cli.ts, tools/glass-ctl/src/glass-ctl.ts, threshold/register/src/config.ts, compose/phase0.yml, compose/colo.yml, compose/paper/paper-entrypoint.sh, compose/velocity/velocity.toml, deploy/scratch/scratch.sh, docs/spec.md, docs/threat-model.md, docs/runbooks/kino.md, docs/analysis/genesis/README.md, docs/analysis/genesis/plan.md, ../decisions/0054-static-hashed-per-player-bearer-tokens.md, ../decisions/0084-colo-deploy-by-pull-with-a-project-scoped-script.md, ../decisions/0152-programmatic-body-management-for-owners.md, ../decisions/0170-owner-management-values-and-admin-flag.md, ../decisions/0173-owner-keys-by-session-and-bearer-scope.md, ../decisions/0188-genesis-environment-stamp.md, supervisor/src/main.ts]
---

# Rotate secrets by role

Every secret Geldar uses, named by its role, with the tool that creates it and the route, if any, that changes it. Then the steps for the routes that exist.

This page never names a secret's value or where it sits on a host or in a container. Where a script reads secrets from a directory, the page names only the variable (`GELDAR_SECRETS_DIR`, `GELDAR_TOKENS_DIR`).

**Owner:** the node operator runs the Colo steps, each with the owner's go. Owner-held secrets (marked below) are the owner's alone.

**Tested?** No. Nothing here was run for this page (documentation freeze, plan decision D8). The commands and flags exist in the repo at `03c1f5de`; each one is cited.

## The short answer

Most secrets in this repo cannot be rotated by a repo tool. Every generator is create-if-missing and never overwrites a file: `Initialize-ShardSecrets` and `Initialize-NatsAuth` in `geldar.ps1` (lines 249 to 365), `deploy/gen-secrets.sh` (`set -C`, lines 32 to 46), and `deploy/install-body-helper.sh` step 3 (line 230). [Decision 0188](../decisions/0188-genesis-environment-stamp.md) item 4 (Proposed) makes "never rotated silently" the rule (also `docs/analysis/genesis/README.md` line 40, D-GN-04).

What can be rotated today:

| Route | Secret role | Section |
|---|---|---|
| `mcp-tokens token rotate`, `token mint` and `token revoke` | A sovereign player's MCP bearer token | [Rotate a player's MCP token](#rotate-a-players-mcp-token) |
| `migrate --set-role-password` | The password of a Postgres service role, from a file that already holds the new value | [Apply a changed service-role password](#apply-a-changed-service-role-password) |
| `mcp-tokens init --force --i-understand` | The MCP token pepper and the MCP role password, local stack only | [Re-create the MCP pepper locally](#re-create-the-mcp-pepper-locally) |
| The account page or the owner API | The owner's own player tokens and owner API keys | [Owner self-serve](#owner-self-serve) |

## Rules for every step

1. Never print, paste, log or commit a value. The tools print file names and ids only (`mcp-tokens` usage: "Output never contains a token", `tools/mcp-tokens/src/cli.ts` line 94; `deploy/gen-secrets.sh` header).
2. A token file is written outside the repo: `mcp-tokens` refuses an `--out` inside the checkout (`checkOutPath`, `tools/mcp-tokens/src/tokens.ts` lines 58 to 72).
3. On the Colo node, get the owner's go before any change, and say which role you change, never the value.
4. Change both sides of a shared secret in the same window. A value two services must agree on (a role password and its database role, a NATS password and `nats-auth.conf`, the session key and Glass) breaks the pair when only one side changes.

## Secret roles

### Local Phase 0 stack

Compose file secrets on the developer's machine, created by `geldar.ps1` and git-ignored; `compose/phase0.yml` declares them by name.

| Role | Created by | Read by | Repo route to change it | Effect of a new value |
|---|---|---|---|---|
| Postgres superuser password | `./geldar.ps1 shard secrets phase0` or `shard up` (`geldar.ps1` line 263) | Postgres at first init; `db migrate` and `mcp-tokens` through `Invoke-PgNode` (line 515) | None | A Postgres volume keeps the password it was initialised with; a new file gives a password failure on the old volume (the `run-shard` skill, "Secrets and volumes"). Only a fresh volume takes it, which loses the data |
| RCON password | Same | Paper at start (`RCON_PASSWORD_FILE`, `compose/phase0.yml` line 78); host tools through `GELDAR_RCON_PASSWORD_FILE` (`golem/src/config.ts`) | None | Inferred: Paper reads it at start, so a restart of `paper` picks up a new value. Untested |
| Velocity forwarding secret | Same | Paper's entrypoint writes it into `paper-global.yml` on every start (`compose/paper/paper-entrypoint.sh` lines 1 to 5); Velocity reads the file (`compose/velocity/velocity.toml` line 13) | None | Inferred: both `paper` and `velocity` must restart together, or the proxy and the server disagree. Untested |
| NATS per-role passwords and `nats-auth.conf` (opt-in locally) | `./geldar.ps1 shard nats-auth <shard>` (lines 319 to 365), one file per user in `Get-NatsUsers` (lines 370 to 415) | NATS and each client | None; see [NATS user passwords](#nats-user-passwords) | The conf holds every password; it is written only when missing (line 344) |
| Thinker hub token | `shard nats-auth` (lines 335 to 343) | The Thinker hub, when `GELDAR_THINKER_TOKEN_FILE` is set | None | Unset keeps the hub open (line 335) |
| MCP token pepper | `./geldar.ps1 mcp-tokens init`, also run by `./geldar.ps1 mcp up` (line 539) | The MCP and `mcp-tokens` (HMAC of every token) | `init --force --i-understand` | Invalidates every token (`tools/mcp-tokens/src/secret-files.ts`, `PEPPER_FILE` comment) |
| `geldar_mcp` role password | Same | The MCP | `init --force --i-understand`, then `db migrate --set-role-password` | The role keeps its old password until you set it (`PASSWORD_REWRITE_WARNING`, `tools/mcp-tokens/src/cli.ts` lines 147 to 151) |
| `geldar_glass` role password | Not traced for the local stack | Glass through `./geldar.ps1 glass` (`geldar.ps1` line 606; `tools/glass-ctl/src/glass-ctl.ts` line 32) | `db migrate --set-role-password geldar_glass` | Unverified |
| MineSkin API key (owner-held) | The owner | `tools/players-cli` skin upload, from a key file the owner holds | None in the repo; the owner rotates it with MineSkin | Only skin uploads use it |

### Colo node

Kept in the directory that `GELDAR_SECRETS_DIR` names on the node. `deploy/compose.secrets.yml` points each compose secret at that directory.

| Role | Created by | Read by | Repo route to change it | Effect of a new value |
|---|---|---|---|---|
| Postgres superuser, RCON, Velocity forwarding | `deploy/gen-secrets.sh` (`GENERATED`, line 13) | As on the local stack; the admin container reads the superuser password (`tools/admin/admin.sh` line 7) | None | As on the local stack |
| `geldar_mcp`, `geldar_glass`, `geldar_register` role passwords | `deploy/gen-secrets.sh` | The MCP, Glass, the register service | `deploy/colo-up.sh` sets all three from their files on every run (lines 56 to 58) | Applies a changed file; nothing in the repo writes the new value |
| `geldar_helper` role password, and the body helper's NATS password | `deploy/install-body-helper.sh` step 3 (never overwrites, line 230) | The body helper unit | Step 4 sets the role password from the file only when a login with the file fails (lines 272 to 278) | See [body-helper-node-steps](body-helper-node-steps.md) |
| `geldar_supervisor` role password | Not traced: no deploy script names the role (`git grep geldar_supervisor -- deploy`, 2026-11-16, no hits) | The supervisor (`supervisor/src/main.ts` line 22) | `migrate --set-role-password` accepts the role (`tools/migrate/src/migrate.ts` lines 138 to 142) | Unverified |
| Register identity pepper | `deploy/gen-secrets.sh` | The register service (`REGISTER_PEPPER`, at least 32 characters, `threshold/register/src/config.ts` lines 141 to 142) | None | Inferred: the identity hash is an HMAC under this pepper ([register service](../reference/register-service.md)), so a new value would match no stored identity: every owner would sign in as a stranger and bans would stop matching. Do not change it |
| MCP token pepper | `deploy/gen-secrets.sh` | The MCP and the register service (`REGISTER_TOKEN_PEPPER_FILE`, `config.ts` lines 60 to 74) | None on the node | Invalidates every player token and every owner API key, which are stored as HMACs under it ([register service](../reference/register-service.md)) |
| Register session key | `deploy/gen-secrets.sh` | The register service and, with the Kino session overlay, Glass ([kino](kino.md) step 1) | None | Inferred: ends every register and Glass session; both must read the same value |
| Microsoft (Entra) client secret (owner-provided) | The owner, in the Entra app; never generated (`deploy/gen-secrets.sh` lines 9 to 10) | The register service | None in the repo | Owner-held. The genesis plan proposes stamp-driven rotation; not built (`docs/analysis/genesis/plan.md` line 52) |
| NATS per-role passwords and `nats-auth.conf` | `shard nats-auth` on a trusted machine, copied to the node by hand (`deploy/README.md`, "Not covered yet"); `gen-secrets.sh` makes only the Body's NATS password | NATS and each client | None; see [NATS user passwords](#nats-user-passwords) | |
| Release manifest and deploy runner | Outside the repo (owner) | `deploy/colo-*.sh` | None | Owner-held. CI uses only the per-run `GITHUB_TOKEN` (`git grep 'secrets\.' -- .github/workflows`, 2026-11-16) |

The scratch stack generates its own secrets in a per-user directory and removes them on `down` (`deploy/scratch/scratch.sh` lines 73 to 78 and 261 to 267; [scratch-stack](scratch-stack.md)). Nothing there needs rotation.

### Per-player and per-owner credentials

| Role | Lifetime | Who rotates it |
|---|---|---|
| Player MCP bearer token (`gmcp-` plus 64 hex, stored as an HMAC) | 90 days ([decision 0170](../decisions/0170-owner-management-values-and-admin-flag.md) point 1; `tools/mcp-tokens/src/tokens.ts` line 15) | The operator with `mcp-tokens`; the owner on the account page or the API |
| Owner API key (`gowner-` plus 64 hex, stored as an HMAC) | 90 days from mint, fixed; the owner cannot choose it ([decision 0170](../decisions/0170-owner-management-values-and-admin-flag.md) point 2, answering question Q2 of [decision 0152](../decisions/0152-programmatic-body-management-for-owners.md) item 2; `interval '90 days'` in `sql/0026_owner_api_keys.sql` line 102 and `sql/0035_owner_keys_by_session.sql` line 41; `OWNER_KEY_LIFETIME_MS` in `threshold/register/src/owner-keys-policy.ts` line 4; read 2026-11-16) | The owner only, cookie session ([decision 0173](../decisions/0173-owner-keys-by-session-and-bearer-scope.md)) |

## Rotate a player's MCP token

A lost token cannot be shown again; rotate it ([decision 0054](../decisions/0054-static-hashed-per-player-bearer-tokens.md)).

### Local stack

1. Start the shard ([bring up the Phase 0 shard](bring-up-phase0-shard.md)).
2. List the player's tokens (ids only, never values or hashes):

   ```powershell
   ./geldar.ps1 mcp-tokens token list --player <player-id>
   ```

3. Rotate. The new token goes to a file outside the repo; the old ones expire after the grace window (default 10 minutes, `DEFAULT_GRACE_MINUTES`, `tools/mcp-tokens/src/tokens.ts` line 19; `--grace-minutes 0` revokes at once):

   ```powershell
   ./geldar.ps1 mcp-tokens token rotate <player-id> --out <file outside the repo> --grace-minutes 10
   ```

   It prints `rotated <player>: new <token id> written to <file>; old tokens expire within <N> min` (`tools/mcp-tokens/src/cli.ts` lines 462 to 473).

4. Hand the new file to whoever runs the player's client, within the grace window. Delivery is outside this repo.

**Verify:** `token list --player <player-id>` shows the new id active and the old ones expiring or revoked.

**Rollback:** none for the old token once revoked. If the new file is lost, rotate again.

### Colo node

`tools/admin/admin.sh` has no `token rotate` subcommand ([admin service](../reference/admin-service.md), line 128 of that page). Mint, then revoke:

1. List tokens (ids only): `deploy/colo-admin.sh players-status`.
2. Mint a new one. `GELDAR_TOKENS_DIR` must be a host directory outside the checkout, mode 0700 (`mount_checks`, `deploy/colo-admin.sh` lines 51 to 53); the admin container writes the new token file into that directory (`mint_args`, lines 32 to 49):

   ```sh
   deploy/colo-admin.sh token-mint <player-id>
   ```

3. Once the client runs on the new token, revoke the old one by its id:

   ```sh
   deploy/colo-admin.sh token-revoke <tk_id>
   ```

**Verify:** `players-status` again.

**Rollback:** a revoked token stays revoked; mint another.

### Owner self-serve

An owner rotates and revokes their own players' tokens, and mints and revokes owner API keys, on the account page or the owner API. In API v1 those routes are cookie-session only with CSRF; a Bearer owner key is refused on them ([decision 0173](../decisions/0173-owner-keys-by-session-and-bearer-scope.md) item 2). See the [register service](../reference/register-service.md) reference.

## Apply a changed service-role password

`migrate --set-role-password` sets a role's password from a file. It accepts `geldar_mcp`, `geldar_glass`, `geldar_register`, `geldar_helper` and `geldar_supervisor` (`tools/migrate/src/migrate.ts` lines 138 to 142). It does not create the new value: no repo tool overwrites an existing secret file. Producing the new file is outside the repo's tooling and needs the owner's go on the node. Without a new file, these steps change nothing.

1. Local stack:

   ```powershell
   ./geldar.ps1 db migrate --set-role-password geldar_mcp --password-file <the role's password file>
   ```

2. Colo node, the same call `deploy/colo-up.sh` makes (lines 56 to 58), for the one role:

   ```sh
   deploy/colo-admin.sh migrate --set-role-password geldar_mcp --password-file <the role's file, as deploy/colo-up.sh passes it>
   ```

   Copy the `--password-file` argument for the role from `deploy/colo-up.sh` lines 56 to 58; it is a path inside the admin container, not on the host.

3. Restart the service that reads the role's file so it logs in with the new value. That a restart is needed is inferred (the services read the file at start); untested.

**Verify:** the service's logs show no authentication failure after the restart, and its health check passes ([bring up the Phase 0 shard](bring-up-phase0-shard.md) locally; `deploy/colo-status.sh` on the node).

**Rollback:** put the previous file back and run step 1 or 2 again. That needs a copy of the previous value, which no tool keeps.

## Re-create the MCP pepper locally

Local stack only. This invalidates every MCP token and every owner API key, so every player must get a new token.

**Before you start:** the local shard's Postgres must be up (`./geldar.ps1 shard status phase0`), because step 3 runs `db migrate` against it. Only the MCP is stopped.

1. Stop the MCP: `./geldar.ps1 mcp down`.
2. Re-create the pepper and the `geldar_mcp` password file:

   ```powershell
   ./geldar.ps1 mcp-tokens init --force --i-understand
   ```

   Without `--i-understand` it refuses with `init --force re-creates the pepper and invalidates every token` (`tools/mcp-tokens/src/cli.ts` lines 130 to 137).

3. Set the role to the new password. The command prints a warning naming the exact call to run (`PASSWORD_REWRITE_WARNING`, `tools/mcp-tokens/src/cli.ts` lines 147 to 151). Run that call:

   ```powershell
   ./geldar.ps1 db migrate --set-role-password geldar_mcp --password-file <the path the warning prints>
   ```

4. Start the MCP: `./geldar.ps1 mcp up`, then `./geldar.ps1 mcp smoke`.
5. Mint a new token for each player ([Rotate a player's MCP token](#local-stack)).

**Verify:** `mcp smoke` passes, and `mcp-tokens token list` shows only new tokens active.

**Rollback:** none. The old pepper is gone, and every token hashed under it is dead.

## NATS user passwords

No repo procedure changes a NATS user's password. `shard nats-auth` writes a password file and the conf only when they are missing (`geldar.ps1` lines 326 to 344). [nats-auth-inplace](nats-auth-inplace.md) covers editing the live `nats-auth.conf` in place with a SIGHUP for users and permissions; it gives no password steps, and the client side (each service's password file) would also have to change. Treat a NATS password change as unplanned work: stop, write it down, and ask the owner.

The runbooks and `deploy/README.md` disagree on how the live NATS conf is changed on the node (in place with SIGHUP, or regenerate and restart); see the [runbooks index, open conflict 1](README.md#open-conflicts-recorded-in-runbook-text-not-resolved).

## Conflicts and gaps

1. **Spec versus the node.** Spec section 6.7 puts Colo secrets in a secret store (Azure Key Vault or Vault/OpenBao) injected at deploy time. The node keeps them as files that `deploy/gen-secrets.sh` creates ([decision 0084](../decisions/0084-colo-deploy-by-pull-with-a-project-scoped-script.md) item 6). Decision 0188 item 4 (Proposed) keeps host-generated secrets on the host and only the Entra client secret and the backup key in a vault. No vault is wired up.
2. **Threat model pointer.** `docs/threat-model.md` line 130 points "secret rotation" to spec section 8.6. Spec section 8.6 has no rotation item.
3. **Stale secret names.** `deploy/compose.secrets.yml` still names `register-github-secret` and `register-discord-secret`; `compose/colo.yml` declares neither ([deploy scripts](../reference/deploy-scripts.md), conflict 4). Whether the deploy's secret check then demands their files is unverified.
4. **Token lifetime.** Decision 0054 says 30 days; decision 0170 point 1 and `tools/mcp-tokens/src/tokens.ts` line 15 say 90. The later decision and the code agree.
5. **No rotation for the generated roles.** The superuser, RCON, Velocity forwarding, peppers and session key have no repo route. That is consistent with D-GN-04 ("never rotated silently") but leaves no tested path after a leak. A leak of any of them is an incident: see [incident response](incident-response.md) (W3, new in this wave).

## Related

- Secrets by role, as reference: [secrets by role](../security/secrets-by-role.md).
- Variable names: [environment variables](../reference/environment-variables.md). Compose secret names: [compose stacks](../reference/compose-stacks.md).
- Adding a player and minting the first token: [mcp-tokens](mcp-tokens.md). Retiring one: [retire an agent](retire-an-agent.md).
