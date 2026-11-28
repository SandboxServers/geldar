---
title: Environment variables
type: reference
audience: operators
status: draft
last_verified: 2026-11-16 against 1b114276
companions: [README.md, compose-stacks.md, shard-config.md, deploy-scripts.md, cli-tools.md, glass-and-kino.md, register-service.md, supervisor-and-body-helper.md, ../security/secrets-by-role.md, ../runbooks/open-signup.md, ../runbooks/scratch-stack.md]
sources: [.env.example, compose/.env.example, deploy/release.env.example, threshold/register/.env.example, deploy/body-helper-node.env, compose, deploy/common.sh, deploy/colo-admin.sh, deploy/colo-cd.sh, deploy/colo-notice.sh, deploy/colo-public.sh, deploy/install-body-helper.sh, deploy/scratch/scratch.sh, geldar.ps1, contract/src/nats-connect.ts, animus/src, golem/src, lantern-local/src, eventsink/src, glass/src, threshold/mcp/src, threshold/register/src, supervisor/src, body-helper/src, tools, plugin/core/src/main, plugin/core-common/src/main, plugin/velocity-identity/src/main, CLAUDE.md, bench/sheet/run.sh, deploy/compose.secrets.yml, plugins/bluemap/alias-proxy/alias-proxy.ts, shards/phase0.yaml]
---

# Environment variables

The environment variables Geldar code, compose files and deploy scripts read, as far as the searches [below](#how-the-list-was-derived) and a review pass found them: its name, what it means, and which service or tool reads it. Glass and Kino names are listed only as families here; their meanings are in [Glass and Kino](glass-and-kino.md). **Names and meanings only.** This page holds no value and no default that is an address, a path, a secret or a host name. A secret is named by its role; where its file lives is the operator's business (see the [secrets by role](../security/secrets-by-role.md)).

For the compose files that set these variables, see [compose stacks](compose-stacks.md). For the keys of the shard files (configuration that is not in the environment), see [shard config](shard-config.md).

All facts were read from the files at commit `1b114276` on 2026-11-16. Glass, Kino and telemetry variables appear here as names and one-line roles only; their behaviour belongs in the `agents-never` pages ([Glass and Kino](glass-and-kino.md)).

## How the list was derived

The names come from five places: the four `.env.example` files and `deploy/body-helper-node.env`; the `environment:` blocks and `${VAR}` interpolations of the compose files; `${VAR}` references in `deploy/*.sh`; `$env:` reads in `geldar.ps1`; and reads of `env.X`, `env['X']`, `required(env, 'X')`, `process.env.X` and `System.getenv("X")` in the TypeScript and Java sources (tests, fakes and fixtures excluded). A name built at run time (for example `GELDAR_COLO_<SERVICE>_CPUS`) is listed as a pattern. The patterns miss a name read through a constant (`GELDAR_GLOBAL_BODY_CAP`, `body-helper/src/config.ts` line 5) and code outside the listed `sources` (`plugins/bluemap/alias-proxy/alias-proxy.ts`); the review of 2026-11-16 found those and they are listed below. Another missed read is possible; re-run the commands when you change a service.

```powershell
# Names one TypeScript package reads (replace <package>, for example threshold/mcp)
git grep -hoE '(env\.|env\[.|\(env, .|Setting\(env, .)[A-Z][A-Z0-9_]{2,}' -- <package> ':!*.test.ts' ':!**/test/**' ':!*.fakes.ts' | ForEach-Object { $_ -replace '^.*[.\[(,''" ]', '' } | Sort-Object -Unique
# Names the deploy scripts interpolate
Select-String -Path deploy/*.sh, deploy/*/*.sh -Pattern '\$\{([A-Z][A-Z0-9_]+)' -AllMatches | ForEach-Object { $_.Matches.Groups[1].Value } | Sort-Object -Unique
# Names the compose files set or interpolate
Select-String -Path compose/*.yml, compose/opt-in/*.yml, deploy/compose.secrets.yml -Pattern '\b([A-Z][A-Z0-9_]{2,})\b' -AllMatches | ForEach-Object { $_.Matches.Value } | Sort-Object -Unique
```

Conventions used below:

- **Secret file**: the variable names a file that holds a secret. The value of the variable is a path; the file's content is the secret, held by the operator. No secret is ever passed as a plain variable, with the one exception recorded in [conflicts](#conflicts-recorded).
- **Loopback**: an address or URL that every reader refuses unless it is loopback, or a Colo service name with `GELDAR_IN_NETWORK_HOSTS=1` (decisions 0050, 0131).

## Shared by several services

| Name | Meaning | Read by | Evidence |
|---|---|---|---|
| `GELDAR_SHARD` | The shard name; selects `shards/<name>.yaml` and the NATS subject prefix. | Mind, Body, player host, MCP, Glass (Kino), body helper, Geldar-Core plugin, `adam-cli`, `players-cli`, `deploy/colo-notice.sh` | `animus/src/config.ts` line 272; `golem/src/adam/adam-config.ts` line 129; plugin `getenv` |
| `GELDAR_SHARD_FILE` | An explicit shard file path, used instead of `GELDAR_SHARD`. | MCP, `players-cli`, `golem/src/whitelist-house-body.ts`, the `admin` container | `threshold/mcp/src/cli.ts` line 73 |
| `GELDAR_NATS_URL` | The NATS server URL. Loopback on the PC; the in-network service name on Colo. | Mind, Body, eventsink, MCP, Glass (Kino), body helper, Paper and Velocity plugins, `players-cli`, live tests and the bench CLI | `.env.example`; compose files |
| `GELDAR_NATS_USER` | The NATS user this process connects as (decisions 0067, 0080). | Every NATS client through `contract/src/nats-connect.ts`; the Java plugins | `contract/src/nats-connect.ts` |
| `GELDAR_NATS_PASSWORD_FILE` | Secret file: the NATS password of that user. | As above | `contract/src/nats-connect.ts`; `compose/nats-auth.yml` |
| `GELDAR_IN_NETWORK_HOSTS` | Set to `1` to accept Colo service names as hosts, not only loopback (decision 0131). | Mind, Body, player host, Glass, `admin` | `animus/src/config.ts`; `compose/colo.yml` lines 257 to 258 |
| `GELDAR_TELEMETRY_URL` | Optional telemetry endpoint; unset means none. Passed through from the host. | Read by Body, eventsink, MCP. Compose also passes it to the Mind (`compose/colo.yml` lines 306 to 307), but no Mind code reads it (`git grep -n TELEMETRY -- animus lantern-local` finds nothing, 2026-11-16). | `golem/src/adam/main.ts`, `golem/src/metrics.ts`; `eventsink/src/main.ts`, `eventsink/src/metrics.ts`; `threshold/mcp/src/cli.ts`, `main.ts`, `metrics.ts`; `compose/colo.yml` lines 266 to 267 |
| `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER` | Postgres connection. | Mind, eventsink, MCP, register, supervisor; `adam-report` reads `POSTGRES_PORT` | `.env.example`; compose files |
| `POSTGRES_PASSWORD_FILE` | Secret file: the Postgres password for `POSTGRES_USER`. Also read by the Postgres image. | Mind, eventsink, `postgres` image | `compose/phase0.yml` lines 20, 147 |

## Host processes on the PC (`.env.example`)

`./geldar.ps1 adam up` reads `.env` (copied from `.env.example`; a variable in the real environment wins) and passes these to the Mind, `lantern-local` and Adam's Body. Every address must be loopback (`.env.example` lines 1 to 4).

| Name | Meaning | Read by |
|---|---|---|
| `GELDAR_SHARD` | As above. | All three |
| `GELDAR_NATS_URL` | As above. | Mind, Body |
| `GELDAR_MC_HOST`, `GELDAR_MC_PORT` | The Velocity bot ingress the Body connects to. | Body, player host, body helper |
| `OLLAMA_URL` | The Ollama endpoint. | Mind (embedder check), `lantern-local`, `adam-cli` |
| `GELDAR_MIND_WS_URL` | The Mind's Thinker socket for `lantern-local`; defaults to `mind.thinker` in the shard file. | `lantern-local` |
| `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_DB`, `POSTGRES_PASSWORD_FILE` | As above. | Mind |
| `GELDAR_MCP_URL` | The loopback MCP URL for `./geldar.ps1 mcp smoke` and the MCP live cases. | `geldar.ps1`, live tests |
| `GELDAR_MCP_TEST_TOKEN_FILE` | Secret file: a test player's MCP token, kept outside the repo. | MCP live cases |
| `REGISTER_MCP_PUBLIC_URL` | The MCP address shown on the register onboarding page. | register |

`compose/.env.example` holds one key, `PAPER_MEMORY` (Paper's heap in `compose/phase0.yml`); CI and `shard up` copy it to the gitignored `compose/.env`.

## Per service

### Mind (`animus`)

| Name | Meaning | Evidence |
|---|---|---|
| `GELDAR_THINKER_TOKEN_FILE` | Secret file: the shared Thinker token. When set, the Thinker hub requires it. | `animus/src/thinker/hub.ts`; `geldar.ps1` line 342 |
| `GELDAR_IT_ALLOW_SHARED_DB`, `GITHUB_ACTIONS` | Test switches: the throwaway database helper may share a database only when the first is `1` and the second is `true`. | `animus/src/memory/throwaway-db.ts` line 14 |

Plus the shared names above.

### Body (`golem`) and player host

| Name | Meaning | Evidence |
|---|---|---|
| `GELDAR_MC_HOST`, `GELDAR_MC_PORT` | The game ingress (Velocity). | `compose/colo.yml` lines 259 to 260 |
| `GELDAR_RCON_HOST`, `GELDAR_RCON_PORT` | Paper RCON, for the player host and the whitelist step. | `compose/colo.yml` lines 621 to 622 |
| `GELDAR_RCON_PASSWORD_FILE` | Secret file: the RCON password. | `compose/colo.yml` line 623 |
| `GELDAR_PLAYER_ID` | The sovereign player id the player host serves (compose interpolation into `--player`). | `compose/colo.yml` lines 593, 614 |
| `GELDAR_BODY_WATCHDOG_MS` | Body watchdog limit in milliseconds. | `golem/src/adam/main.ts` line 242; `golem/src/players/main.ts` line 150 |
| `GELDAR_LIFE_ID`, `GELDAR_LOGIN_NAME` | The life a managed Body host serves; the login name must equal it. | `golem/src/players/managed-main.ts` lines 193 to 194 |
| `GELDAR_ADMIT_MODE`, `GELDAR_ADMIT_LIFE_ID` | The admit one-shot the body helper runs: the action and the life id. | `body-helper/src/managed-template.ts` |
| `GELDAR_PG_HOST`, `GELDAR_PG_PORT`, `GELDAR_PG_DATABASE`, `GELDAR_PG_USER`, `GELDAR_PG_PASSWORD_FILE` | Postgres connection of a managed Body host (password as a secret file). | `golem/src/players/managed-main.ts`; `body-helper/src/managed-template.ts` |
| `GELDAR_NOTICE_SHARD` | The shard a maintenance notice is published to. | `golem/src/publish-maintenance-notice.ts` line 67 |
| `SHEET_NATS_URL`, `SHEET_PROJECT`, `SHEET_SHARD`, `SHEET_RESULT_TIMEOUT_MS` | The sheet campaign driver on a scratch stack. | `golem/src/bench/sheet/life-cli.ts`; `bench/sheet/run.sh` |

### `lantern-local`

`GELDAR_MIND_WS_URL` and `OLLAMA_URL` (above).

### Eventsink

| Name | Meaning | Evidence |
|---|---|---|
| `EVENTSINK_BATCH_SIZE`, `EVENTSINK_FETCH_WAIT_MS` | Consumer batch size and fetch wait. | `eventsink/src/config.ts` |
| `GELDAR_SHEET_SHARD` | The shard for the state service and outbox publisher; blank or unset is off. Not `GELDAR_SHARD`. | `compose/colo.yml` eventsink (node env file); `compose/opt-in/sheet-sink.yml` line 11 |
| `GELDAR_XP` | Set to `1` to turn on the XP ledger; blank or unset is off. | `compose/colo.yml` eventsink; `compose/opt-in/sheet-sink.yml` line 12 |
| `GELDAR_PROFICIENCY_THRESHOLDS` | Proficiency thresholds; needs `GELDAR_XP=1`. | as above; `compose/opt-in/sheet-sink.yml` line 13 |

Plus the shared NATS, Postgres and telemetry names.

### MCP (`threshold/mcp`)

| Name | Meaning | Evidence |
|---|---|---|
| `GELDAR_MCP_DB_PASSWORD_FILE` | Secret file: the `geldar_mcp` role password. | `compose/colo.yml` line 344 |
| `GELDAR_MCP_PEPPER_FILE` | Secret file: the pepper token hashes use. Required. | `threshold/mcp/src/config.ts` line 220 |
| `GELDAR_MCP_INSTINCT_KEY_FILE` | Secret file that turns on the MCP's second connection class ([mcp-tools, Identity and scopes](mcp-tools.md#identity-and-scopes); no decision names it, [mcp-tools conflict 12](mcp-tools.md#conflicts-recorded)). Unset leaves the class off; set but unusable refuses start-up. | `threshold/mcp/src/config.ts` line 106 |
| `GELDAR_MCP_IN_CONTAINER` | Set to `1` inside the container; only then may the server bind all interfaces. | `compose/mcp.yml` |
| `GELDAR_MCP_BIND` | The listen address. | `compose/mcp.yml` |
| `GELDAR_MCP_DEV_HOSTS` | Host header values accepted from local clients. | `threshold/mcp/src/config.ts` line 367 |
| `GELDAR_MCP_PUBLIC_HOST` | The public Host header value, when one exists (decision 0053 defers it). | `threshold/mcp/src/config.ts` line 366 |
| `GELDAR_MCP_TRUSTED_PROXIES` | Comma list of peers whose client-address header is trusted. When set, it replaces the effective list from the shard file (see [shard config `mcp` keys](shard-config.md#sovereign-block), the one statement of the fallback). Set in the node's deploy environment (decision 0132: no address in the repo). | `threshold/mcp/src/config.ts` lines 373 to 376; `compose/colo.yml` lines 353 to 355 |
| `GELDAR_MCP_CLIENT_IP_HEADER` | Replaces the header name that carries the client address (decision 0090). | `shards/phase0.yaml` line 116 |
| `GELDAR_WAIT_DELTA_LIVES` | Comma list of life ids, or `all`, whose `wait` returns unchanged lists in delta form (decision 0221). Empty is off. | `threshold/mcp/src/main.ts` |
| `GELDAR_ACT_BUDGET_ENFORCE` | Only `1` enforces the act budget; otherwise acts are metered only (decision 0149). | `threshold/mcp/src/budget/meter.ts` |
| `GELDAR_MCP_LIVE` | Live-test switch set by `geldar.ps1`. | `geldar.ps1` |

### Register service (`threshold/register`)

| Name | Meaning | Evidence |
|---|---|---|
| `REGISTER_KILL_SWITCH` | Sign-in is off unless this is exactly `false`. Read at start. | `compose/colo.yml` line 411 |
| `REGISTER_REQUIRE_MC_OWNERSHIP` | Off unless this is exactly `true`. When on, a NEW Microsoft sign-up must own Minecraft: Java Edition (the flow adds scope `XboxLive.signin`). Read at start. Forwarded by `compose/colo.yml` (empty by default, so off). | `threshold/register/src/config.ts` |
| `REGISTER_PUBLIC_URL` | The register's public URL; a deploy value. | `compose/colo.yml` line 413 |
| `REGISTER_MCP_PUBLIC_URL` | The MCP URL shown on the onboarding page. | `.env.example` lines 34 to 38 |
| `REGISTER_HOST`, `REGISTER_PORT` | Listen address and port. | `threshold/register/.env.example` |
| `REGISTER_MS_CLIENT_ID` | The Microsoft (Entra) app's client id; a deploy value. | `compose/colo.yml` line 419 |
| `REGISTER_MS_CLIENT_SECRET_FILE` | Secret file: the Entra client secret, owner-provided. | line 420 |
| `REGISTER_SESSION_KEY_FILE` | Secret file: the key that signs the session cookie; Glass reads the same key. | line 422 |
| `REGISTER_PEPPER_FILE` | Secret file: the register's own pepper. | line 423 |
| `REGISTER_TOKEN_PEPPER_FILE` | Secret file: the MCP's token pepper, so minted tokens verify. | line 425 |
| `REGISTER_SHARD` | The shard players are registered on. | line 426 |
| `REGISTER_DB_PASSWORD_FILE` | Secret file: the `geldar_register` role password. | line 430 |
| `REGISTER_DB_URL_FILE` | Secret file: a whole connection URL; wins over the parts. | `threshold/register/src/db-url.ts` line 4 |
| `REGISTER_TRUSTED_PEERS` | Peers whose client-address header is trusted. | line 432 |
| `REGISTER_HARNESSES` | Harness names offered at sign-up. | `threshold/register/src/config.ts` line 168 |
| `REGISTER_SIGNIN_PER_MINUTE`, `REGISTER_OWNER_PER_MINUTE`, `REGISTER_PER_MINUTE` | Rate limits. | `threshold/register/.env.example` |
| `REGISTER_NATS_URL`, `REGISTER_NATS_USER`, `REGISTER_NATS_PASSWORD_FILE`, `REGISTER_NATS_TIMEOUT_MS` | Optional NATS connection (password as a secret file). | `threshold/register/src/config.ts` lines 107 to 122 |

The variables the Colo compose file sets for this service are gated against the [open-signup runbook](../runbooks/open-signup.md) by `tools/repo-checks/src/open-signup-runbook.test.ts`.

### Glass and Kino

Glass reads `GELDAR_GLASS_*` variables (host, port, Postgres connection with a password secret file, trusted proxies, public host names, rate limits, stream limits, an on/off switch, the session key file) and Kino reads `GELDAR_KINO_*` variables (on/off, allowed origins, skins directory, metrics endpoint), plus `GELDAR_ALIASES_FILE`, `GELDAR_SHARD` and the shared NATS names. Glass is the read-only view for human viewers (decisions 0072, 0093, 0094); Kino is its live view (decision 0075). Their per-variable meanings are in the [Glass and Kino](glass-and-kino.md) reference (`agents-never`). List the names with:

```powershell
git grep -hoE "GELDAR_(GLASS|KINO)_[A-Z0-9_]+" -- glass/src compose | Sort-Object -Unique
```

### Supervisor

`SUPERVISOR_SHARD`, `SUPERVISOR_NATS_URL`, `SUPERVISOR_DB_PASSWORD_FILE` (secret file) and the shared Postgres connection names (`supervisor/src`). No compose file starts the supervisor at `1b114276`.

### Body helper (`body-helper`, a host service on the node)

| Name | Meaning |
|---|---|
| `GELDAR_SHARD`, `GELDAR_STACK`, `GELDAR_NETWORK` | Shard, compose stack label and Docker network of the Bodies it starts. |
| `GELDAR_DOCKER_SOCKET` | The Docker socket path. Required. |
| `GELDAR_BODY_IMAGE` | The Body image reference. |
| `GELDAR_BODY_MEMORY_BYTES`, `GELDAR_BODY_NANO_CPUS`, `GELDAR_BODY_PIDS_LIMIT` | Limits per Body container. |
| `GELDAR_BODY_NATS_SECRET_HOST_PATH`, `GELDAR_RCON_SECRET_HOST_PATH`, `GELDAR_MANAGED_DB_SECRET_HOST_PATH` | Host paths of secret files mounted into Bodies. |
| `GELDAR_BODY_SHARD_HOST_PATH` | Host path of the shard file mounted into Bodies. |
| `GELDAR_MANAGED_BODIES` | Unset, empty or `0` refuses every managed start. |
| `GELDAR_MANAGED_PG_HOST`, `GELDAR_MANAGED_PG_PORT`, `GELDAR_MANAGED_PG_ROLE` | Postgres for managed Body hosts. |
| `GELDAR_SWEEP_MINUTES` | Sweep interval. |
| `GELDAR_BODY_HELPER_DEADLINE_MS` | The most time one start or stop may hold the queue. |
| `GELDAR_SERVICE_UID` | The uid Bodies run as. |
| `GELDAR_GLOBAL_BODY_CAP` | The cap on running Bodies (decision 0261); unset gives the code default, and zero, negative or non-numeric values refuse start-up. Read through the constant `CAP_ENV`. (`body-helper/src/config.ts` lines 1 to 10) |
| `GELDAR_MC_HOST`, `GELDAR_MC_PORT`, `GELDAR_NATS_URL`, `GELDAR_NATS_USER`, `GELDAR_NATS_PASSWORD_FILE`, `GELDAR_PG_*` | As above. |

Evidence: `body-helper/src/helperConfig.ts`. `deploy/install-body-helper.sh` installs the service with an environment file on the node (line 194); the script names its own inputs, such as `BODY_HELPER_PREFIX` and `BODY_HELPER_REPO`, in its header (lines 16 to 19). The pinned Node runtime for the helper is named by `BODY_HELPER_NODE_VERSION`, `BODY_HELPER_NODE_TARBALL` and `BODY_HELPER_NODE_SHA256_LINUX_X64` in `deploy/body-helper-node.env`.

### Paper, Velocity and Postgres images

The itzg images read their own settings (`EULA`, `TYPE`, `VERSION`, `PAPER_BUILD`, `VELOCITY_VERSION`, `VELOCITY_BUILD_ID`, `MEMORY`, `SEED`, `ONLINE_MODE`, `ENABLE_WHITELIST`, `ENFORCE_WHITELIST`, `HARDCORE`, `DIFFICULTY`, `VIEW_DISTANCE`, `SIMULATION_DISTANCE`, `MAX_PLAYERS`, `SPAWN_PROTECTION`, `ALLOW_FLIGHT`, `MOTD`, `ENABLE_RCON`, `RCON_PASSWORD_FILE`, `RCON_CMDS_STARTUP`, `UID`, `GID`). The Geldar plugins inside read `GELDAR_NATS_URL`, `GELDAR_SHARD`, `GELDAR_NATS_USER`, `GELDAR_NATS_PASSWORD_FILE` and `GELDAR_AGENT_SKINS_DIR` (the agent skins folder for the map). The Postgres image reads `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD_FILE`. `bluemap-web` sets `XDG_CONFIG_HOME` and `XDG_DATA_HOME` for Caddy. The `bluemap-alias` proxy (`plugins/bluemap/alias-proxy/alias-proxy.ts` lines 132 to 135) reads `GELDAR_ALIAS_PROXY_PORT` (its listen port), `GELDAR_ALIAS_UPSTREAM_HOST` and `GELDAR_ALIAS_UPSTREAM_PORT` (the BlueMap live server inside Paper) and `GELDAR_ALIASES_FILE`; each has a code default. Evidence: `compose/phase0.yml`, `compose/colo.yml`; `git grep -hoE 'getenv\("[A-Z_0-9]+"' -- plugin`.

### Velocity identity plugin

| Name | Meaning | Evidence |
|---|---|---|
| `GELDAR_IDENTITY_LANE` | Selects the login lane of the identity gate. Unset (default) or `agent`: the agent lane, unchanged from before the lane existed. `human`: the human lane. Any other value, including an empty one, refuses the gate: every login is denied and the error is logged. Read once, when the plugin loads. Compose files must not set it blank, because an empty value refuses the gate. What each lane admits: [velocity-identity-plugin, Lanes](velocity-identity-plugin.md#lanes). | `plugin/README.md`, "Velocity identity: lanes"; `git grep -n GELDAR_IDENTITY_LANE -- plugin` |

## Compose interpolation (set by the operator or the deploy)

These are read by Docker Compose when it renders a file, not by a service.

| Name or pattern | Meaning | File |
|---|---|---|
| `GELDAR_PROJECT` | The Colo compose project name. | `compose/colo.yml` line 8; `deploy/common.sh` |
| `GELDAR_COLO_<SERVICE>_CPUS`, `GELDAR_COLO_<SERVICE>_MEM` | Per-service CPU and memory budget; the file holds the defaults. | `compose/colo.yml` |
| `GELDAR_SERVICE_UID` | The uid every Colo container runs as; must not be 0. | `compose/colo.yml`; `deploy/common.sh` |
| `GELDAR_<NAME>_IMAGE` (`BODY`, `MIND`, `EVENTSINK`, `MCP`, `ADMIN`, `GLASS`, `REGISTER`) | Image references; digest references on the node, from the release manifest. | `compose/colo.yml`; `deploy/release.env.example` |
| `GELDAR_PORT_<NAME>` (`BOT`, `MCP`, `REGISTER`, `GLASS`, `BLUEMAP`) | Host loopback ports; only these names are allowed. | `compose/colo.yml`; `tools/repo-checks/src/loopback-ports.ts` |
| `GELDAR_NETWORK`, `GELDAR_COLO_SUBNET` | The Colo network name and subnet; the node sets a private subnet. | `compose/colo.yml` lines 699 to 704 |
| `GELDAR_STATE_DIR` | The node state directory (third-party plugin jars, alias directory). | `compose/colo.yml`; `deploy/common.sh` |
| `GELDAR_SECRETS_DIR` | The node secrets directory. | `deploy/compose.secrets.yml`; `compose/colo.yml` lines 736 to 738 |
| `GELDAR_MC_BIND`, `GELDAR_MC_PORT` | The public Minecraft bind and port; set both or neither. | `compose/colo-public.yml`; `deploy/common.sh` lines 72 to 105 |
| `GELDAR_KINO_PUBLIC_ORIGIN`, `GELDAR_KINO_NATS_USER` | Inputs to the Kino overlay. | `compose/colo-kino.yml` |
| `GELDAR_WORLD_VOLUME` | The world volume name, for a fresh or throwaway world. | `compose/phase0.yml` line 170; `compose/signcheck.yml`; `compose/opt-in/scratch.yml` |
| `PAPER_MEMORY` | Paper heap on the Phase 0 and scratch stacks. | `compose/.env.example` |
| `GELDAR_RCON_FILE`, `GELDAR_CORE_JAR` | The signcheck RCON secret file and the Geldar-Core jar to mount. | `compose/signcheck.yml` |
| `SCRATCH_PG_PORT`, `SCRATCH_NATS_PORT`, `SCRATCH_NATS_MON_PORT`, `SCRATCH_MC_PORT`, `SCRATCH_SECRETS_DIR`, `SCRATCH_NATS_AUTH_DIR` | Scratch stack ports and secret directories, set by `deploy/scratch/scratch.sh`. | `compose/opt-in/scratch.yml` |

## Deploy scripts

`deploy/common.sh` reads `GELDAR_PROJECT`, `GELDAR_COLO_ROOT`, `GELDAR_COLO_COMPOSE`, `GELDAR_COLO_EXTRA_OVERLAY`, `GELDAR_SECRETS_DIR`, `GELDAR_RELEASE_FILE`, `GELDAR_STATE_DIR`, `GELDAR_MIN_FREE_KB`, `GELDAR_BLUEMAP_LOCK`, `GELDAR_CHUNKY_LOCK`, `GELDAR_COREPROTECT_LOCK`, `GELDAR_PLUGIN_DIR`, `GELDAR_SERVICE_UID`, `GELDAR_MC_BIND`, `GELDAR_MC_PORT`, `GELDAR_MCP_TRUSTED_PROXIES`, `GELDAR_GLASS_TRUSTED_PROXIES`, `GELDAR_COLO_SUBNET`, `GELDAR_DEPLOY_ALLOW_FILE_URL` and `DEPLOY_DRY_RUN` (`1` runs read-only steps only). The other scripts add their own: `GELDAR_COLO_SHARD`, `GELDAR_TOKENS_DIR`, `GELDAR_SKINS_DIR` (`colo-admin.sh`); `COLO_CD_*`, `GELDAR_RELEASE_MANIFEST`, `GELDAR_RELEASE_SHA` (`colo-cd.sh`); `GELDAR_PUBLIC_ENV`, `GELDAR_CADDY_FILE`, `GELDAR_PUBLIC_APPLY`, `GELDAR_PUBLIC_RESTART_OK`, `GELDAR_PUBLIC_SRC` (`colo-public.sh`); `COLO_NOTICE_STRICT` (`colo-notice.sh`); `BODY_HELPER_*` (`install-body-helper.sh`), including the test-only `BODY_HELPER_TEST` (line 65) and `BODY_HELPER_NODE_ENV` (line 78); `SCRATCH_NATS_OPEN` (`deploy/scratch/scratch.sh` line 138: `1` is refused, and `up` exits 2 with nothing started, because the identity seed needs `SCRATCH_NATS_AUTH_DIR`). Purposes and side effects are in the [deploy scripts](deploy-scripts.md) reference.

`deploy/colo-public.sh` also reads keys from its own env file, not from the environment: `GELDAR_DOMAIN` and `GELDAR_<NAME>_UPSTREAM` for `MAP`, `GLASS`, `REGISTER` and `MCP` (header lines 12 to 13; lines 49 to 60).

The release manifest (`deploy/release.env.example`) holds only `GELDAR_<NAME>_IMAGE` keys, each a digest reference; the `colo-images` workflow produces it.

## Tools and test switches

| Name | Meaning | Read by |
|---|---|---|
| `GELDAR_REPORT_DB_USER`, `GELDAR_REPORT_DB_PASSWORD_FILE`, `GELDAR_REPORT_DB_PASSWORD` | Read-only database login for the Adam run report (password as a secret file, or plain; see [conflicts](#conflicts-recorded)). | `tools/adam-report/src/db.ts`; `tools/adam-run/src/adapters.ts` |
| `GELDAR_GLASS_PG_DB`, `GELDAR_GLASS_PG_PORT`, `GELDAR_GLASS_PG_PASSWORD_FILE` | Database login `adam-run` and `./geldar.ps1 glass` use. | `tools/adam-run`; `geldar.ps1` line 606 |
| `GELDAR_GLASS_HOST`, `GELDAR_GLASS_PORT` | The local Glass server address. | `tools/glass-ctl` |
| `KINO_URL` | The page the screenshot tool opens. | `tools/kino-shot/src/args.ts` |
| `REGISTER_PEPPER_FILE` | Secret file, as for the register service. | `tools/mcp-tokens` |
| `PGDATABASE`, `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD` | Standard libpq names; `geldar.ps1 db` sets them for its own process, `tools/migrate` reads `PGDATABASE`. | `geldar.ps1`; `tools/migrate` |
| `GELDAR_IT` | `1` also runs the integration tests that need a running shard. | `CLAUDE.md`; `geldar.ps1` lines 552 to 554 |
| `GELDAR_ADMIN_PG_PASSWORD_FILE` | Secret file: the superuser password for the `admin` one-shot. | `compose/colo.yml` line 668 |

`GELDAR_MCP_TOKEN` is a name Geldar writes, not one it reads: `mcp-tokens token mint` and `token rotate` write a player's token into a file as this variable for the player's harness (`tools/mcp-tokens/src/tokens.ts` line 25; see [CLI tools](cli-tools.md#mcp-tokens)).

## Conflicts recorded

Recorded, not resolved (persona rule 8).

1. **A plain password variable.** `tools/adam-report/src/db.ts` lines 154 to 166 accept `GELDAR_REPORT_DB_PASSWORD` as well as the `_FILE` form (`tools/adam-run/src/adapters.ts` line 263 passes only the `_FILE` form). `tools/repo-checks/src/colo-services.test.ts` lines 93 to 98 require every `PASSWORD` or `TOKEN` variable to be a `*_FILE` path only for the Colo `golem-body` and `animus` services; the MCP, Glass, register and admin password variables are checked one by one as file paths (lines 204, 211, 255, 308, 547). No test covers the tools.
2. **Register database variables.** `threshold/register/.env.example` names `REGISTER_DB_URL_FILE` and no `REGISTER_DB_PASSWORD_FILE`; `compose/colo.yml` sets `REGISTER_DB_PASSWORD_FILE` and the Postgres parts and no URL file. The code reads both, URL first (`threshold/register/src/db-url.ts` line 4).
3. **Register example port.** `threshold/register/.env.example` names `REGISTER_HOST` as loopback; `compose/colo.yml` sets the container-internal bind and publishes a different host port (decision 0150). Not an error; the two describe different runs.
4. **Register secret names.** `deploy/compose.secrets.yml` repoints GitHub and Discord client secrets that no compose service reads; the code and `compose/colo.yml` use only the Microsoft client secret (see [compose stacks](compose-stacks.md#conflicts-recorded) item 2).
