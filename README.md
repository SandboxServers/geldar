# Geldar

A vivarium for AI agents, built on Minecraft.

The full design lives in [`docs/spec.md`](docs/spec.md) (v0.8, draft). Work is at Phase 0 ("Adam", spec section 10): one living agent on one machine. Progress is tracked in [`docs/analysis/phase0/`](docs/analysis/phase0/).

## Layout

The repo follows spec section 6.6, created one directory at a time as Phase 0 needs it.

| Path | What |
|---|---|
| `contract/` | JSON Schemas for every cross-component message, with generated types and validators |
| `plugin/` | Java, Gradle multi-project: `core` (Geldar-Core, the Paper plugin: event export to JetStream) and `velocity-identity` (the bot-ingress gate) |
| `golem/` | The Body: Mineflayer bot, reflexes, actions, the body benchmark, and the registrar of the NATS life registry the gate reads |
| `animus/` | The Mind: intents, attention controller, memory, reflection |
| `lantern-local/` | Phase 0 local Thinker: plain WebSocket to Ollama |
| `eventsink/` | NATS JetStream → Postgres `events`, with dead letters |
| `glass/` | The Thought Stream |
| `sql/`, `compose/`, `shards/`, `prompts/` | Schema migrations, compose stacks, shard configs, versioned prompts |
| `docs/` | The spec, decisions, ideas, campaign ledgers |
| `threshold/` | The Threshold gateway area; today `threshold/mcp-mock`, a mock MCP server |
| `tools/` | Repo tooling (`repo-checks`) |

## Setup

Needs Node 22 (`.nvmrc`), PowerShell 7, Docker, and for later packets Java and Ollama.

```powershell
./geldar.ps1 setup             # pnpm install, using the pnpm version pinned in package.json
./geldar.ps1 check             # everything CI runs
```

To run the shard, build the plugin jars first (`cd plugin; ./gradlew build`), then `./geldar.ps1 shard up phase0`.

pnpm doesn't need to be installed: `geldar.ps1` gets the pinned version through corepack, and `./geldar.ps1 pnpm <args>` runs any pnpm command with it. For a plain `pnpm` command, run `corepack enable pnpm` as admin, or without admin `corepack enable pnpm --install-directory <a folder on your PATH>`.

### Opt-in NATS auth (UNTESTED against a live nats-server)

Off by default: the shard's NATS accepts any local client. The overlay (decision 0067, threat model section 3) gives each component its own user with per-subject allow lists. It has not been run against a live `nats-server`; treat it as unverified until the checks below pass.

```powershell
./geldar.ps1 shard nats-auth phase0   # writes compose/secrets/nats-<user>.txt, thinker-token.txt, nats-auth.conf (git-ignored, owner-only; never overwritten)
docker compose -f compose/phase0.yml -f compose/mcp.yml -f compose/nats-auth.yml -p geldar-phase0 up -d
```

The users are `body`, `mind`, `eventsink`, `mcp`, `velocity`, `paper` and `ops` (`ops` may do everything). The overlay gives the containers (`paper`, `velocity`, `eventsink`, `geldar-mcp`) their user and password file. Host-run components are not in compose; set these before starting them, each pointing at its generated file under `compose/secrets/`:

- Body (golem): `GELDAR_NATS_USER=body`, `GELDAR_NATS_PASSWORD_FILE` = `nats-body.txt`.
- Mind (animus): `GELDAR_NATS_USER=mind`, `GELDAR_NATS_PASSWORD_FILE` = `nats-mind.txt`, `GELDAR_THINKER_TOKEN_FILE` = `thinker-token.txt`.
- lantern-local: `GELDAR_THINKER_TOKEN_FILE` = `thinker-token.txt` only. It does not connect to NATS, so it has no NATS user.

Before relying on it, verify against a live server: (1) the JetStream API permissions (`$JS.API.>`, `$JS.ACK.>`, `_INBOX.>`) cover every consumer and pull the components use; (2) the KV bucket permissions per component (`$KV.<bucket>.>`) match what each one reads and writes; (3) the plan and book subject permissions for Body, Mind and the MCP, and the MCP's replay subscription, which the lists do not grant yet. Until then, a failure here may be a permission list, not a bug in the component.

## Working here

Rules for people and AI agents: [CLAUDE.md](CLAUDE.md) and [AGENTS.md](AGENTS.md). Settled decisions: [docs/decisions/](docs/decisions/). Ideas outside the spec: [docs/ideas.md](docs/ideas.md).
