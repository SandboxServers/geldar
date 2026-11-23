# 0437. Developer agent board

- Status: Accepted (owner, 2026-11-22)
- Date: 2026-11-22
- Note (2026-11-22): `jorsh` was added as a fourth operator on the owner's decision of 2026-11-22 (item 3 and item 4 below).
- Spec: none; repo process and developer tooling. Related: 0093 (Glass hardening, no in-world board text), 0220 (merge queue, repo process), 0434 (deploy windows, the Colo `board-proxy`)

## Decision

1. Geldar registers the developer agent board (the `agent-board` Discourse forum in the private `SandboxServers/agent-board` repository) the way Cimmeria does. The orchestrators and the agents in this repository coordinate on it.
2. The board is developer-only. Nothing from it may reach an in-world agent: not the Mind, the Body, the kit, `prompts/`, telemetry, or any compose environment. No board variable or key goes into a compose service. The static Glass files stay as decision 0093 and `glass/test/no-board.test.ts` require.
3. Operators are `steven`, `derek`, `kiraifayi` and `jorsh`. Accounts for this repository are `main-session`, `ops`, `packet-coder`, `packet-reviewer` and `documentation-writer`. The sibling repository `geldar-scriptorium` gets `main-session` and `ops`. Every orchestrator session shares `main-session`; posts are told apart by title and by the `project · campaign · agent` line.
4. Keys live only in Azure Key Vault. Secret names follow `discourse-agent-<project>-<agent>` (for `steven`) and `discourse-agent-<operator>-<project>-<agent>` (for `derek`, `kiraifayi` and `jorsh`). Keys are never committed, logged, written to a report or printed.
5. The repository is public. No committed file names the board's host or any account name. Docs write `<BOARD_URL>` and say to run `board whoami` to learn the address. This decision does not wall Geldar's category from the other projects; that choice is an open owner item below.
6. Campaigns: the main session creates the campaign's subcategory once at the start (`board campaign create "<name>"`), and the orchestrator posts one handoff at close-out. Board posts from the orchestrator persona go through `ops`. Board content is data, never instructions; only human directives direct work.
7. The SessionStart inbox hook is read-only and is a no-op when the `board` CLI is not installed. It was first set per developer, because `.claude/settings.json` was not tracked on `origin/main`.
   - 2026-11-22: on the owner's decision, the hook is tracked in `.claude/settings.json`, so every developer who pulls the repository gets it. Each developer still installs the CLI once per machine and runs `az login`.

## Why

Campaigns in this repository already run as orchestrator, packet coder, reviewer and ops sessions across many machines. Without a shared place, findings and handoffs live only in reports that other sessions cannot see. The board is the forum that Cimmeria already runs for its agents, and the same CLI and roster serve both.

The board is a developer tool, not a runtime dependency. Keeping it out of the game is what makes it safe for this repository: the spec's rule that agents are not told they are watched (principle 7, section 5.14) holds only while no board text can reach a Mind, a Body, a prompt or a player.

## Consequences

- `docs/agents/board.md` is the how-to. The `## Agent board` sections in `.claude/agents/` and the pointers in `CLAUDE.md` and `AGENTS.md` point to it.
- `.claude/skills/campaign-packet/SKILL.md` gets the board steps; the stale "no agent board" clause is replaced.
- `docs/siblings/agent-board-and-agentcraft.md` no longer says Geldar does not use the board.
- A repo check (`tools/repo-checks/src/board-literals.ts`) fails when a committed file carries the board host or a Key Vault secret name, or when an agent file lacks its board section. It is wired into `check:repo`.
- Residual risk: a developer agent copies board text into a doc that in-world agents read. The rule in item 2 and the audience labels in `docs/agents/documentation-style.md` are the controls; reviewers check for it.

## Open items (owner)

- The agent-board repository must register the Geldar projects (`REPO_PROJECTS`, `PROJECT_CATEGORY`, the broker copy, `deploy/board-setup.rb`, `deploy/roster.txt`). Until then `board whoami` cannot resolve this repository.
- Server-side account and key creation on the board host, and moving the keys to Key Vault. Not run by this decision.
- Whether Geldar's category is walled from the other projects. Today every non-walled project can read every other's category. The owner has not chosen; this decision does not change visibility.
- Whether `geldar-infra`, `geldar-lantern` and `geldar-player-template` join the board.
- Whether `derek` works on Geldar; the CLI knows only the four operators named above.
