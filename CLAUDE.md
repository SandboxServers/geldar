# Geldar: a vivarium for AI agents, built on Minecraft

The design is [docs/spec.md](docs/spec.md). Current work is Phase 0 ("Adam", spec section 10), run as the campaign in [docs/analysis/phase0/](docs/analysis/phase0/): read its `RESUME.md` first. This file is the core every session loads; [AGENTS.md](AGENTS.md) has the same rules for every harness plus the campaign procedure.

## Repo rules

- **The spec is the scope.** Build what the spec and the current packet say. An idea outside them goes in [docs/ideas.md](docs/ideas.md), not in code. When the spec is wrong or silent, settle it in a record under [docs/decisions/](docs/decisions/) and say so in the PR.
- **Change the contract, never the generated code.** Schemas live in `contract/`; regenerate and commit the output. CI fails when generated code is out of date.
- **Pin exact versions**: npm packages (`saveExact` is on), Gradle dependencies, Docker images (by digest), GitHub Actions (by commit SHA), Paper build, Node (`.nvmrc`). Only versions at least two weeks old.
- **Prompt changes go in `prompts/` with a version bump.** Every thought records the template version it used (spec Appendix D), so never edit a released template in place.
- **A behavior change needs a test that fails when the change is reverted.** Check that it does before you call it done.
- **Files: soft cap 500 lines, hard cap 700** (code and config; Markdown and generated code are exempt). Split along natural seams; no `utils.ts` or `helpers.ts` dumping grounds. `pnpm check:repo` enforces the hard cap.
- **LF line endings everywhere** (`.gitattributes`), except `*.bat`/`*.cmd`.
- **No secrets, IPs or account names in the repo.** It is public. `.env` files are gitignored; commit a `.env.example`.
- **Principle 1 holds in code too:** nothing we build lets a human act inside the world (spec section 2).

## Commands

```powershell
./geldar.ps1 check                 # everything CI runs: biome, typecheck, vitest, repo checks, contract drift, compose config, gradle
./geldar.ps1 shard up phase0       # the spec's `make shard ... up`
./geldar.ps1 bench                 # body benchmark
```

pnpm workspace, Node 22 (`.nvmrc`), TypeScript, Biome, Vitest. Windows with PowerShell 7 is the main dev platform; CI runs on Linux.

## Skills, agents and memory

- Skills in `.claude/skills/`: `ship-pr` (branch to merged PR), `campaign-packet` (run Phase 0 as packets), `run-shard` (bring the stack up and check health), `body-bench` (run the benchmark and record numbers). Load the matching one before that kind of work.
- Agents in `.claude/agents/`: `packet-coder` implements one packet, `packet-reviewer` reviews it read-only. These Geldar copies override the global ones of the same name.
- Project memory is committed in `.claude/agent-memory/main-session/`. Grep it before researching a topic; add what you learn with the change that taught it.
