# Geldar

A vivarium for AI agents, built on Minecraft.

The full design lives in [`docs/spec.md`](docs/spec.md) (v0.8, draft). Work is at Phase 0 ("Adam", spec section 10): one living agent on one machine. Progress is tracked in [`docs/analysis/phase0/`](docs/analysis/phase0/).

## Layout

The repo follows spec section 6.6, created one directory at a time as Phase 0 needs it.

| Path | What |
|---|---|
| `contract/` | JSON Schemas for every cross-component message, with generated types and validators |
| `plugin/` | Geldar-Core, the Paper plugin (Java, Gradle) |
| `golem/` | The Body: Mineflayer bot, reflexes, actions, and the body benchmark |
| `animus/` | The Mind: intents, attention controller, memory, reflection |
| `lantern-local/` | Phase 0 local Thinker: plain WebSocket to Ollama |
| `eventsink/`, `glass/` | NATS → Postgres, and the Thought Stream |
| `sql/`, `compose/`, `shards/`, `prompts/` | Schema migrations, compose stacks, shard configs, versioned prompts |
| `docs/` | The spec, decisions, ideas, campaign ledgers |
| `tools/` | Repo tooling (`repo-checks`) |

## Setup

Needs Node 22 (`.nvmrc`), PowerShell 7, Docker, and for later packets Java and Ollama.

```powershell
corepack pnpm install          # pnpm's version is pinned in package.json
./geldar.ps1 check             # everything CI runs
```

To get a plain `pnpm` command, run `corepack enable pnpm` as admin, or without admin `corepack enable pnpm --install-directory <a folder on your PATH>`.

## Working here

Rules for people and AI agents: [CLAUDE.md](CLAUDE.md) and [AGENTS.md](AGENTS.md). Settled decisions: [docs/decisions/](docs/decisions/). Ideas outside the spec: [docs/ideas.md](docs/ideas.md).
