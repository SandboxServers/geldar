---
title: Secrets by role
type: reference
audience: operators
status: draft
last_verified: 2026-11-16 against 03c1f5de
companions: [README.md, authn-authz-map.md, ../runbooks/rotate-secrets-by-role.md, ../runbooks/incident-response.md, ../runbooks/nats-auth-inplace.md, ../runbooks/mcp-tokens.md, ../runbooks/body-helper-node-steps.md, ../reference/compose-stacks.md, ../reference/environment-variables.md, ../reference/deploy-scripts.md, ../reference/admin-service.md, ../reference/register-service.md, ../threat-model.md]
sources: [deploy/gen-secrets.sh, deploy/compose.secrets.yml, deploy/install-body-helper.sh, deploy/colo-up.sh, deploy/colo-notice.sh, compose/colo.yml, compose/phase0.yml, compose/mcp.yml, compose/nats-auth.yml, compose/colo-kino.yml, compose/colo-kino-session.yml, compose/colo-notice.yml, compose/velocity/velocity.toml, geldar.ps1, eventsink/src/config.ts, animus/src/config.ts, animus/src/thinker/hub.ts, tools/migrate/src/migrate.ts, tools/mcp-tokens/src/cli.ts, tools/mcp-tokens/src/tokens.ts, tools/players-cli/src/leak-scan.ts, tools/adam-report/src/db.ts, threshold/register/src/identity.ts, threshold/register/src/providers.ts, threshold/register/src/tokens-policy.ts, threshold/register/src/owner-keys-policy.ts, threshold/register/src/production-api.ts, threshold/mcp/src/http/auth.ts, threshold/mcp/src/http/instinct-key.ts, supervisor/src/config.ts, body-helper/src/helperConfig.ts, golem/src/admit-life.ts, sql/0063_body_host_roles.sql, .github/workflows/colo-images.yml, .github/workflows/colo-deploy.yml, .github/workflows/mcp-mock-image.yml, .github/workflows/ci.yml, .github/workflows/plugin-jars.yml, .github/workflows/body-helper-bundle.yml, threshold/register/src/db-url.ts, deploy/colo-admin.sh, threshold/mcp/test/live/revoke-kill-hibernate.live.test.ts, tools/repo-checks/src/token-lifetime.test.ts, docs/spec.md, docs/threat-model.md, ../decisions/0053-public-mcp-through-an-outbound-tunnel-deferred.md, ../decisions/0054-static-hashed-per-player-bearer-tokens.md, ../decisions/0084-colo-deploy-by-pull-with-a-project-scoped-script.md, ../decisions/0133-colo-admin-by-one-shot-container.md, ../decisions/0152-programmatic-body-management-for-owners.md, ../decisions/0170-owner-management-values-and-admin-flag.md, ../decisions/0172-human-skin-upload-held-for-approval.md, ../decisions/0173-owner-keys-by-session-and-bearer-scope.md, ../decisions/0188-genesis-environment-stamp.md]
---

# Secrets by role

Every secret Geldar uses, named by its role: who consumes it, who creates it, who may rotate it and by which route, and what a leak would expose. This page never gives a value, a path on a host or in a container, or a file name. Where a reader needs the place, it names the environment variable that points at the file, or the line in `compose/colo.yml` that declares the compose secret.

For the steps to change a secret, use the [rotate secrets by role](../runbooks/rotate-secrets-by-role.md) runbook. For what each credential is allowed to do once presented, read the [authn and authz map](authn-authz-map.md). For a leak, start the [incident response](../runbooks/incident-response.md) runbook.

All facts were read from the repo at `03c1f5de` on 2026-11-16. Nothing on the node, the VM or a database was read (plan decision D8), so whether a secret exists on the node, and with which mode and owner, is unverified.

## Terms

| Term | Meaning on this page |
|---|---|
| Project owner | The person who owns Geldar and rules on its decisions. Holds the third-party accounts. |
| Operator | The role that runs the Colo node and the local stack. Changes a node secret only with the project owner's go ([runbook rule 3](../runbooks/rotate-secrets-by-role.md#rules-for-every-step)). |
| Account owner | A person who signed up through the register service and owns sovereign players. The code calls this an "owner" (`mcp_owners`). |
| Secret file | Every service secret is a file read at start, never an environment value (threat model rule 10, [`docs/threat-model.md`](../threat-model.md) section 4). A `*_FILE` variable names the file. |
| Generated | Made by a repo tool with random bytes, create-if-missing, never overwritten. |
| Rotation route | A repo tool or page that replaces the secret. "No repo route" means no repo tool does it; see [Rotation in one line](#rotation-in-one-line). |

## Rotation in one line

No repo generator overwrites a secret: `deploy/gen-secrets.sh` writes with `set -C` (lines 32 to 46), `Initialize-ShardSecrets` and `Initialize-NatsAuth` in `geldar.ps1` write only missing files, and `deploy/install-body-helper.sh` step 3 never overwrites. Decision [0188](../decisions/0188-genesis-environment-stamp.md) item 4 (Proposed) makes "never rotated silently" the rule. Only the credentials in the [per-person table](#per-person-credentials), the Postgres service-role passwords and, locally only, the MCP token pepper have a repo route. The [runbook](../runbooks/rotate-secrets-by-role.md#the-short-answer) holds the steps.

## Generated on the Colo node

`deploy/gen-secrets.sh` creates exactly ten roles (`GENERATED`, line 13), each as 32 random bytes in hex, and, when run as root, gives them to the service uid (lines 47 to 53). The compose ids are declared in `compose/colo.yml` lines 706 to 738; `deploy/compose.secrets.yml` repoints them at secret files on the node, named by `GELDAR_SECRETS_DIR` (decision [0084](../decisions/0084-colo-deploy-by-pull-with-a-project-scoped-script.md)).

| Secret role | Consumed by (Colo) | Rotated by, route | Blast radius if leaked | Evidence |
|---|---|---|---|---|
| Postgres superuser password | The Postgres image at first init; `eventsink` and `animus`, which both connect as the superuser role; the `admin` one-shot | Operator. No repo route: a Postgres volume keeps the password it was initialised with | The whole database as superuser: every table, every role, every grant. Within reach of anyone on the compose network who holds it; Postgres publishes no port on Colo | `POSTGRES_USER` defaults to `geldar` (`eventsink/src/config.ts` line 61, `animus/src/config.ts` line 197); `compose/colo.yml` `secrets:` lines 224 and 312, "No ports"; decision [0133](../decisions/0133-colo-admin-by-one-shot-container.md); [runbook](../runbooks/rotate-secrets-by-role.md#local-phase-0-stack) |
| Paper RCON password | `paper`; `players-host`; `admin` (`whitelist-house-body`); the body helper's admit one-shot | Operator. No repo route | The Paper console: op, give, stop. The console is a path by which a person could act in the world, so a leak is also a Principle 1 matter. RCON is not published on Colo | `golem/src/admit-life.ts` header; threat model section 3 (RCON row) and section 4 (rule 9) |
| Velocity forwarding secret | `paper` (its entrypoint writes it into Paper's config) and `velocity` | Operator. No repo route; both sides must change in one window (inferred) | With network reach to Paper's game port, logins Paper accepts without the Velocity gate. Paper's game port is on the compose network only | `compose/velocity/velocity.toml` line 13; `compose/colo.yml`, "Velocity is the only game listener"; [runbook](../runbooks/rotate-secrets-by-role.md#local-phase-0-stack) |
| Body NATS password (`body` user) | `golem-body`, `players-host`, `admin` (`ensure-skins-bucket`), and managed Bodies the body helper starts | Operator. No repo route | What the `body` user may publish: most of its shard's subjects and the life registry bucket | `GELDAR_BODY_NATS_SECRET_HOST_PATH`; [authn and authz map](authn-authz-map.md#nats-users); [NATS user passwords](../runbooks/rotate-secrets-by-role.md#nats-user-passwords) |
| `geldar_mcp` role password | `geldar-mcp`; `admin` sets it | Operator. `migrate --set-role-password`, which `deploy/colo-up.sh` runs on every deploy. A new value is made outside the repo | The `geldar_mcp` grants: owner, player and token rows (token rows hold HMACs only), budgets, the MCP journal | `GELDAR_MCP_DB_PASSWORD_FILE`; `deploy/colo-up.sh` lines 56 to 58; [authz map](authn-authz-map.md#postgres-roles) |
| `geldar_glass` role password | `glass`; `admin` sets it; `tools/adam-report` and `adam-run` use the same role | Operator. As above | A read-only role over the published record | `GELDAR_REPORT_DB_USER` default, `tools/adam-report/src/db.ts` line 171; public `README.md`: "Reads Postgres with a read-only role" |
| `geldar_register` role password | `register`; `admin` sets it | Operator. As above | The register's definer functions and its three direct table grants | [register service](../reference/register-service.md#database-interface) |
| Register identity pepper | `register`; `tools/mcp-tokens` identity commands | Nobody. No repo route, and do not change it: every identity hash is `HMAC-SHA256(pepper, "microsoft:" + sub)`, so a new value matches no stored identity (inferred) | A holder can compute the identity hash of a known Microsoft subject and so link it to an owner row, given database read access (inferred from the HMAC construction) | `REGISTER_PEPPER_FILE`; `tools/mcp-tokens/src/cli.ts` line 185; `threshold/register/src/identity.ts`; [runbook](../runbooks/rotate-secrets-by-role.md#colo-node) |
| MCP token pepper | `geldar-mcp`, `register`, `admin` (`token-mint`) | Operator, locally only: `mcp-tokens init --force --i-understand`. No repo route on the node | Every player token and every owner API key is stored as an HMAC under it, so changing it ends all of them. The pepper alone reveals no token (inferred: HMAC is one-way) | `GELDAR_MCP_PEPPER_FILE`, `REGISTER_TOKEN_PEPPER_FILE`; `threshold/mcp/src/http/auth.ts` `tokenDigest`; `threshold/register/src/production-api.ts` line 56 |
| Register session key | `register`, and `glass` when the Kino session overlay is merged | Operator. No repo route | It derives the register's CSRF values and is shared with Glass when the Kino session overlay is merged; the Glass side is withheld under decision 0361. It does not sign the register's own session cookie, which is a random id checked against the database | `REGISTER_SESSION_KEY_FILE`; `compose/colo-kino-session.yml`; [register service](../reference/register-service.md#sessions-and-cookies) |

`deploy/gen-secrets.sh` never creates the NATS server config, any NATS password other than the Body's, or the Microsoft client secret (header, lines 6 to 12).

## NATS

`./geldar.ps1 shard nats-auth <shard>` writes one password per user and the server config on a trusted machine, only when missing (`Initialize-NatsAuth`, `geldar.ps1`). The files are copied to the node by hand (`deploy/README.md`, "Not covered yet"). Never run that command on the node ([nats-auth-inplace](../runbooks/nats-auth-inplace.md#notes)).

| Secret role | Consumed by | Rotated by, route | Blast radius if leaked |
|---|---|---|---|
| NATS server config | `nats` (`compose/nats-auth.yml`) | Operator, permissions only, in place ([nats-auth-inplace](../runbooks/nats-auth-inplace.md)); passwords: no repo route | Holds every user's password, so it is the union of every row below |
| One password per NATS user: `mind`, `mcp`, `eventsink`, `paper`, `velocity`, `kino`, `deploy`, `supervisor`, `register`, `helper` (and `body`, above) | The service that connects as that user ([authz map, NATS users](authn-authz-map.md#nats-users)) | Operator. No repo route | Exactly that user's publish and subscribe lists. Among the narrowest are `deploy` (one subject), `velocity` (read-only KV watch) and `helper` (four subjects) |

How the passwords reach each service: `compose/colo.yml` wires `body`, `mind` and `mcp`; `compose/nats-auth.yml` wires `paper`, `velocity` and `eventsink`; the Kino overlay wires `kino` (observation control; [Glass and Kino](../reference/glass-and-kino.md), `agents-never`); `compose/colo-notice.yml` wires `deploy`; the `supervisor`, `register` and `helper` passwords have no compose wiring in this repo ([nats topology](../architecture/nats-topology.md#where-the-users-run)).

## Host services outside compose

| Secret role | Consumed by | Created by | Rotated by, route | Blast radius if leaked |
|---|---|---|---|---|
| `geldar_helper` role password | The body helper (root systemd unit) | `deploy/install-body-helper.sh --apply` step 3 | Operator. Step 4 sets the role from the file only when a login with it fails ([body-helper node steps](../runbooks/body-helper-node-steps.md)) | Two definer functions that answer one player's name or life id (`sql/0038_body_helper_role.sql`, `sql/0063_body_host_roles.sql`); no table privilege |
| Body helper NATS password (`helper` user) | The body helper | `deploy/install-body-helper.sh --apply` step 3 | Operator. No repo route | Hearing the four body helper verbs; the helper then acts on the Docker socket, so a forged request is checked only by the helper's own rules ([supervisor and body helper](../reference/supervisor-and-body-helper.md)) |
| `geldar_supervisor` role password | The supervisor (`SUPERVISOR_DB_PASSWORD_FILE`, `supervisor/src/config.ts`) | Not traced: no deploy script names it ([runbook](../runbooks/rotate-secrets-by-role.md#colo-node)) | Operator. `migrate --set-role-password` accepts the role (`tools/migrate/src/migrate.ts` lines 137 to 143) | Roster read, quota counters, audit append |
| Supervisor NATS password | The supervisor | By hand on the node ([nats-auth-inplace](../runbooks/nats-auth-inplace.md#procedure), step 0) | Operator. No repo route | Answering body control requests and asking the helper |
| Managed Body database secret (`GELDAR_MANAGED_DB_SECRET_HOST_PATH`) | Managed Body containers, when `GELDAR_MANAGED_BODIES` is on (off by default, `body-helper/src/helperConfig.ts` lines 102 to 111) | Not traced. The role these Bodies call, `geldar_body_host`, is created `NOLOGIN` (`sql/0063_body_host_roles.sql`), and `migrate --set-role-password` does not accept it (`PASSWORD_ROLES`) | Not traced | One definer function that answers four fields of one life's host config (`player_host_config`) |

## Other secret inputs in code

Secret inputs the code accepts that the tables above do not cover. Each is named by the variable that points at it.

| Secret role | Consumed by | Created by | Blast radius if leaked | Evidence |
|---|---|---|---|---|
| Register database URL (`REGISTER_DB_URL_FILE`) | `register`, in place of the role password file; it wins when set | Not traced; `compose/colo.yml` mounts the password file only | It embeds the `geldar_register` password, so the same as that row | `threshold/register/src/db-url.ts` lines 4 to 13 |
| Minted player tokens (`GELDAR_TOKENS_DIR`) | The operator, who hands each token to its harness | `admin` `token-mint` writes each new token as a file in the host directory this names, outside the repo; the script prints only the path and byte length | Each file is a live player token (see [per-person credentials](#per-person-credentials)) | `deploy/colo-admin.sh` lines 4 to 6 and 68 |
| Live-test player tokens (`GELDAR_LIVE_RANGER_TOKEN_FILE`, `GELDAR_LIVE_REVOKE_TOKEN_FILE`) | The MCP live case `revoke-kill-hibernate`, local only | `mcp-tokens` | That player's agency until revoked | `threshold/mcp/test/live/revoke-kill-hibernate.live.test.ts` lines 7 and 53 |
| Outbound tunnel credential | Nothing: the tunnel service is commented out in `compose/mcp.yml` | The operator, outside the repo, if decision 0053 is taken up | Not in use | `compose/mcp.yml` lines 44 to 54; decision [0053](../decisions/0053-public-mcp-through-an-outbound-tunnel-deferred.md) (deferred) |

## Local Phase 0 stack

The developer's own machine keeps its secrets as git-ignored secret files; `compose/phase0.yml` and `compose/mcp.yml` declare them. The roles are the same as on Colo, with these differences ([runbook](../runbooks/rotate-secrets-by-role.md#local-phase-0-stack)):

| Secret role | Created by | Note |
|---|---|---|
| Postgres superuser, RCON, Velocity forwarding | `./geldar.ps1 shard secrets phase0` or `shard up` | RCON is reachable from host tools only with `compose/rcon-host.yml` |
| MCP token pepper, `geldar_mcp` role password | `./geldar.ps1 mcp-tokens init` (also run by `mcp up`) | `init --force --i-understand` re-creates both; every token dies |
| NATS server config and per-user passwords; Thinker hub token | `./geldar.ps1 shard nats-auth <shard>` | NATS is open on Phase 0 unless the auth overlay is merged ([nats topology](../architecture/nats-topology.md#the-server)) |
| Thinker hub token (`GELDAR_THINKER_TOKEN_FILE`) | As above | Optional; unset leaves the Mind's loopback Thinker socket open (`animus/src/thinker/hub.ts` line 30). Not wired in `compose/colo.yml` (`git grep THINKER_TOKEN -- compose deploy`, no hits, 2026-11-16). Leak: answer Thinker jobs on that socket, limited by job ownership (threat model section 4, rule 2) |
| A test player's MCP token (`GELDAR_MCP_TEST_TOKEN_FILE`) | `mcp-tokens` | Read by the MCP live cases only |

## Per-person credentials

Short or fixed lifetimes, stored only as hashes. The holder, not the operator, keeps the value.

| Credential | Held by | Lifetime | Rotated by, route | Blast radius if leaked |
|---|---|---|---|---|
| Player MCP bearer token (`gmcp-` plus 64 hex) | The harness that plays the player | 90 days, renewal flag from 14 days before; a rotated-out token works 10 more minutes (`threshold/register/src/tokens-policy.ts` lines 5 and 11; decision [0170](../decisions/0170-owner-management-values-and-admin-flag.md) point 1) | The account owner on the account page or the owner API; the operator with `mcp-tokens token rotate` locally, or `token-mint` then `token-revoke` on the node ([runbook](../runbooks/rotate-secrets-by-role.md#rotate-a-players-mcp-token)) | That one player's agency until revoked (threat model section 3, bearer tokens row). A token in a transcript or shared log is live |
| Owner API key (`gowner-` plus 64 hex) | An account owner's scripts | 90 days (`OWNER_KEY_LIFETIME_MS`, `threshold/register/src/owner-keys-policy.ts` line 4; decision 0170 point 2) | The account owner only, from a cookie session (decision [0173](../decisions/0173-owner-keys-by-session-and-bearer-scope.md)) | The key's scopes over that owner's own agents; never the MCP endpoint (decision 0170 point 2) |
| Register session cookie | An account owner's browser | 30 minutes sliding, at most 12 hours | Ends at logout, expiry or account deletion | That owner's account page and owner API until it expires ([register service](../reference/register-service.md#sessions-and-cookies)) |

## Held by the project owner

| Secret role | Consumed by | Rotated by, route | Blast radius if leaked |
|---|---|---|---|
| Microsoft (Entra) client secret | `register` (`REGISTER_MS_CLIENT_SECRET_FILE`); never generated (`deploy/gen-secrets.sh` header) | Project owner, in the Entra app; then the operator replaces the file and restarts `register` (inferred). No repo route | Authenticates Geldar's app to Microsoft's token endpoint (inferred from the code exchange in `threshold/register/src/providers.ts`); it holds no Geldar data itself |
| MineSkin API key | `tools/players-cli` skin upload, operator side only; the register service never holds it (decision [0172](../decisions/0172-human-skin-upload-held-for-approval.md); [register service](../reference/register-service.md#skins)) | Project owner, with MineSkin. No repo route | Use of the project owner's MineSkin account (inferred). `tools/players-cli/src/leak-scan.ts` flags the key's shape in tracked files |
| Cloud model API keys | None in code: no package reads a hosted-model key (`git grep -i -E "anthropic\|openai" -- '*.ts'`, no hits outside tests, 2026-11-16) | Not applicable today | Spec 8.1 lists them as asset 3; they enter only when a cloud Thinker exists |
| Self-hosted deploy runner and the node's deploy entrypoint | `.github/workflows/colo-deploy.yml` reaches a root-owned entrypoint (workflow header) | Outside the repo; unverified | Deploys a commit on `main` only, per the workflow header. The entrypoint is not in the repo |

## CI tokens

CI uses no stored repository secret. Every workflow uses the per-run GitHub token (`git grep 'secrets\.' -- .github/workflows`, 2026-11-16: only `secrets.GITHUB_TOKEN`). All six workflows, read on 2026-11-16:

| Workflow | Token scope | Used for |
|---|---|---|
| `colo-images.yml` | `contents: read` at the top; `packages: write` on the image jobs (line 50 onward) | Push the Colo images to the GitHub container registry |
| `mcp-mock-image.yml` | `contents: read` at the top (line 32); the push job adds `packages: write` (lines 82 to 84) | Log in with the per-run token (line 115) and push the MCP mock image |
| `colo-deploy.yml` | `permissions: {}` at the top (line 26); the job has `contents`, `actions` and `checks` read (lines 44 to 47) and names the `colo` environment (line 40) | Read the release manifest artifact and the run status. Whether the `colo` environment holds secrets or approval rules is set in the repository settings and is unverified |
| `ci.yml` | `contents: read` (lines 17 to 18) | Checks; its image builds do not push |
| `plugin-jars.yml` | `contents: read` (lines 16 to 17, 29 to 30) | Build the plugin jars |
| `body-helper-bundle.yml` | `contents: read` (lines 20 to 21, 33 to 34) | Build the body helper bundle |

## Conflicts recorded

Recorded, not resolved (persona rule 8).

1. **Secret store.** Spec 6.7 puts Colo secrets in a secret store (Azure Key Vault or Vault/OpenBao) injected at deploy time. Decision [0084](../decisions/0084-colo-deploy-by-pull-with-a-project-scoped-script.md) item 6 and `deploy/gen-secrets.sh`: secret files on the node. Decision 0188 item 4 (Proposed): host secrets stay on the host; only the Entra client secret and the backup key also go to a vault. No vault is wired.
2. **Least privilege per service.** Spec 8.6: "No shared credentials between hosts. Each service has its own Postgres role ... with least privilege." `compose/colo.yml` gives the Postgres superuser password to `eventsink`, `animus` and `admin`. Decision 0133 records the admin case as deferred ("Least-privilege admin roles are C2"); no record covers `eventsink` or `animus`.
3. **Stale register secret names.** `deploy/compose.secrets.yml` repoints GitHub and Discord client secrets that `compose/colo.yml` no longer declares ([deploy scripts](../reference/deploy-scripts.md#conflicts-recorded), item 4). Whether the deploy's secret check then demands them is unverified.
4. **A plain password variable.** `tools/adam-report/src/db.ts` lines 154 to 166 accept the report database password as a plain environment value as well as a file, against threat model rule 10 ([environment variables](../reference/environment-variables.md#conflicts-recorded), item 1).
5. **Threat model pointer.** `docs/threat-model.md` section 6 sends "secret rotation" to spec 8.6, which has no rotation item ([runbook](../runbooks/rotate-secrets-by-role.md#conflicts-and-gaps), item 2).
6. **Token lifetime.** Three accounts. Spec 5.15.3 (line 874) and 8.4b (line 1286): OAuth, access tokens 15 minutes, refresh tokens rotate and expire after 30 days of non-use; the spec text has no literal "30-day default expiry", which decision 0054 attributes to 5.15.3. Decision [0054](../decisions/0054-static-hashed-per-player-bearer-tokens.md) item 3: static tokens, 30 days. Decision 0170 point 1 and the code: 90 days (`tools/mcp-tokens/src/tokens.ts` line 16, `threshold/register/src/tokens-policy.ts` line 5; `tools/repo-checks/src/token-lifetime.test.ts` keeps the two equal). The later decision and the code agree. Also recorded in [authn and authz map](authn-authz-map.md#conflicts-recorded), item 4.
7. **Unnamed MCP key.** `GELDAR_MCP_INSTINCT_KEY_FILE` names a key that turns on a second MCP connection class (`threshold/mcp/src/http/instinct-key.ts`; a usable key is at least 32 printable characters). No decision or spec section names it ([MCP tools](../reference/mcp-tools.md#conflicts-recorded), item 12), it is not wired in any compose file or deploy script (`git grep INSTINCT -- compose deploy`, no hits, 2026-11-16), and its creator is not traced.

## Unverified

- Which of these secrets exist on the node, their modes and owners, and which overlays the node merges (D8).
- How the supervisor runs on the node and where its secrets come from ([supervisor and body helper](../reference/supervisor-and-body-helper.md), conflict 1).
- The deploy runner's and the entrypoint's own credentials (outside the repo).
