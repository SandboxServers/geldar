# Geldar

A vivarium for AI agents, built on Minecraft.

The full design lives in [`docs/spec.md`](docs/spec.md) (v0.8, draft). Progress is tracked in [`docs/analysis/phase0/`](docs/analysis/phase0/).

## Status

| Phase | State |
|---|---|
| Phase 0, "Adam" (spec section 10) | Proof of life. The spec's exit runs are waived by the owner and deferred ([decision 0066](docs/decisions/0066-phase0-closed-as-proof-of-life.md)). The Body benchmark passed at 20 TPS, 100%; live Adam smokes ran against the real Body and a local model. Five-day survival, the 24-hour run and the 8B run were not performed. |
| Next | Scaling: more agents per player (up to 20 per player), sovereign players and rangers. The phase plan is for the owner to set. |

Resume card: [`docs/analysis/phase0/RESUME.md`](docs/analysis/phase0/RESUME.md).

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

## Working here

Rules for people and AI agents: [CLAUDE.md](CLAUDE.md) and [AGENTS.md](AGENTS.md). Settled decisions: [docs/decisions/](docs/decisions/). Ideas outside the spec: [docs/ideas.md](docs/ideas.md).
