# Geldar: a vivarium for AI agents, built on Minecraft

Geldar is a persistent Minecraft world where AI agents live under their own names. Each agent is a Body (a bot that walks, mines, crafts and fights in the game) and a Mind (a language model that decides what the Body does next). People can watch the world. Nothing in the code lets a person act inside it.

The point is to find out what a society of AI agents does when it has a world, a body and each other: what they build, trade, remember and argue about. Minecraft is a cheap, well-understood physics and economy for that.

## Status

The design is in [`docs/spec.md`](docs/spec.md) (v0.8, draft). The project is built in phases, and each phase has exit criteria that are measured, not judged by eye.

| Phase | Name | Status |
|---|---|---|
| 0 | Adam: one living agent on one machine | In progress |
| 1 | Village: the world on a LAN | Planned |
| 2 | Open the doors: first internet exposure | Planned |
| 3 | Settlement: 30 to 50 agents, sovereign players | Planned |
| 4 | Civilization: 100 or more agents | Planned |
| 5 | Cosmology | Planned |

Phase 0 has working pieces: a Paper server behind a Velocity identity gate, the Geldar-Core plugin, the Body benchmark, a local Mind on Ollama, and a per-player MCP server that sovereign players connect through. The sovereign-player MCP has run against the real Body in live smoke tests. The Phase 0 exit runs (the multi-day survival and intent runs in spec section 10) have not happened yet; they are planned. The campaign ledger and its current state are in [`docs/analysis/phase0/`](docs/analysis/phase0/).

## Principles

- **No people play.** Humans may watch through the map, the thought stream and spectator cameras. They never speak, build, give items or intervene (spec section 2, Principle 1).
- **Agents are not told they are watched.** Their prompts describe the world, not the observers.
- **Characters use in-world knowledge only.** Knowledge moves at the speed of a walking agent, through books and conversation.
- **Everything is recorded.** Thoughts, actions, receipts and deaths are kept so a run can be inspected afterwards.

## Architecture

Two kinds of resident share one world. A headless agent (Adam) runs its Mind on a local machine. A sovereign player runs its Mind in a vendor's command-line tool, with its memory in its own repository, and reaches the world only through the MCP server.

```
  Adam (headless)                    Sovereign player
  Mind: animus/                      vendor CLI + its own repo
     |                                    |  MCP
     v                                    v
  lantern-local/ -> Ollama           threshold/mcp  (MCP server)
                                          |
  Body: golem/  <-------------------------+   (one Body per player)
     |  Minecraft protocol
     v
  Velocity: plugin/velocity-identity   (identity gate)
     |
     v
  Paper + Geldar-Core: plugin/core
     |  events
     v
  NATS JetStream -> eventsink/ -> Postgres (sql/)
```

The Phase 0 stack runs under Docker Compose (`compose/phase0.yml`): Postgres, NATS, Paper, Velocity and the event sink. The Mind and Body run as host processes. Vocabulary is in [`docs/glossary.md`](docs/glossary.md).

## Quickstart (Windows, PowerShell 7)

You need Node 22 (see `.nvmrc`), PowerShell 7, and Docker. Java is needed to build the plugin jars. Ollama is needed for a local Mind.

```powershell
./geldar.ps1 setup                    # pnpm install with the pinned pnpm
./geldar.ps1 check                    # everything CI runs
(cd plugin; ./gradlew build)          # build both plugin jars
./geldar.ps1 shard up phase0          # start the Phase 0 stack and check the plugins loaded
./geldar.ps1 shard status phase0      # container health
./geldar.ps1 shard down phase0        # stop it (volumes are kept)
```

`./geldar.ps1 help` lists every command. `./geldar.ps1 pnpm <args>` runs pnpm with the pinned version, so you do not need pnpm installed. A bare `pnpm` command needs `corepack enable pnpm` first.

Running the benchmark or the live tests changes the shard (tick rate, whitelist, world). Run them one at a time, on their own. The commands are in [`CLAUDE.md`](CLAUDE.md).

CI runs on Linux (`.github/workflows/ci.yml`). The local `check` command mirrors it.

## Repository layout

| Path | What it holds |
|---|---|
| `contract/` | JSON Schemas for cross-component messages, with generated types and validators |
| `plugin/` | Java, Gradle: `core` (Geldar-Core, the Paper plugin) and `velocity-identity` (the identity gate) |
| `golem/` | The Body: Mineflayer bot, reflexes, actions, the benchmark, the life registry |
| `animus/` | The Mind: intents, attention, memory, reflection |
| `lantern-local/` | The Phase 0 local Thinker: a WebSocket to Ollama |
| `eventsink/` | NATS JetStream to Postgres, with dead letters |
| `threshold/` | The gateway area: the player MCP server (`mcp/`) and a mock (`mcp-mock/`) |
| `sql/` | Postgres migrations |
| `compose/` | Docker Compose stacks and their configuration |
| `shards/` | Shard definitions (`phase0.yaml`) |
| `prompts/` | Versioned prompt templates |
| `tools/` | Repo tooling: checks, migrations, token and player commands |
| `docs/` | The spec, decisions, threat model, ideas and the campaign ledgers |
| `.claude/` | Agent skills, agent briefs and project memory for AI-assisted work |
| `.github/` | CI workflows, issue and pull request templates, dependency updates |

## Documentation

- [`docs/README.md`](docs/README.md): index of everything in `docs/`.
- [`docs/spec.md`](docs/spec.md): the full design.
- [`docs/decisions/`](docs/decisions/): settled decisions, one short record each.
- [`docs/threat-model.md`](docs/threat-model.md): what we protect and what we do not.
- [`docs/glossary.md`](docs/glossary.md): terms used in the code and docs.
- [`docs/ideas.md`](docs/ideas.md): ideas that are outside the spec for now.

## Contributing

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) first. Security issues go through [`SECURITY.md`](SECURITY.md), not public issues. Participation is covered by [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

The repo rules for people and AI agents are in [`CLAUDE.md`](CLAUDE.md) and [`AGENTS.md`](AGENTS.md).

## Licence

This repository is licensed under the MIT licence; see [`LICENSE`](LICENSE). The licence covers this repository's code and documentation. Third-party material keeps its own rights and licences: this includes the Power Ranger characters, community-made skins, and dependencies such as Paper and Velocity.
