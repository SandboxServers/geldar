# Repo instructions for every agent

These rules apply to Claude Code, Codex, Copilot and any other harness. Read [CLAUDE.md](CLAUDE.md) first: it holds the repo rules and commands, and they apply to every agent, not only Claude. Then read only what your task needs:

| Before you... | Read |
|---|---|
| design anything | [docs/spec.md](docs/spec.md) (the scope), [docs/decisions/](docs/decisions/) (what is settled), and grep `.claude/agent-memory/` for the topic |
| work on Phase 0 | [docs/analysis/phase0/RESUME.md](docs/analysis/phase0/RESUME.md), then its `README.md` ledger |
| implement a packet | your packet's section of [docs/analysis/phase0/work-packets.md](docs/analysis/phase0/work-packets.md) and [.claude/agents/packet-coder.md](.claude/agents/packet-coder.md) |
| review a packet or PR | [.claude/agents/packet-reviewer.md](.claude/agents/packet-reviewer.md) |
| change a page people look at (Glass, Kino, register) | [.claude/agents/web-designer.md](.claude/agents/web-designer.md), and see the page with `node glass/test/preview.ts` |
| open, update or merge a PR | [.claude/skills/ship-pr/SKILL.md](.claude/skills/ship-pr/SKILL.md) |
| close a wave | `work-packets.md` § Wave close and the [campaign-packet skill](.claude/skills/campaign-packet/SKILL.md) § 6 |
| start the stack or run the benchmark | [.claude/skills/run-shard/SKILL.md](.claude/skills/run-shard/SKILL.md), [.claude/skills/body-bench/SKILL.md](.claude/skills/body-bench/SKILL.md) |

Harnesses without Claude Code's skills or subagents read those files directly: a skill's `SKILL.md` is the procedure, an agent's `.md` is the brief.

## Running a campaign

A campaign is a folder `docs/analysis/<campaign>/` holding a ledger (`README.md`), `work-packets.md` and `RESUME.md`. The full process is the [campaign-packet skill](.claude/skills/campaign-packet/SKILL.md). In short, the session that orchestrates:

1. Reads `RESUME.md` and the ledger before acting, and again after any compaction or resume.
2. Gives each packet its own git worktree under `.claude/worktrees/` and one implementing agent.
3. Has every finished packet reviewed by a fresh, read-only reviewer that did not write it. A `fix` verdict goes to a fresh coder, up to 3 review passes (5 rounds for a batch of parallel packets).
4. Updates the ledger's packet rows and rewrites `RESUME.md` (40 lines at most) at every wave boundary.
5. Ships with the `ship-pr` skill and removes the worktree after merge, copying useful reports to `worknotes/` first (the wave close does the leftovers).

Owner decisions are never guessed: the ledger marks them `BlockedDecision` and the orchestrator asks the owner.

## Live runs

Live cases start their own Mind and Body, so never run `adam up` (or `adam up --help`) before them: `adam up` holds port 7410, the Thinker socket. The live cases are 8B-only. The 32B run is manual: `adam up --model strong` once, with no live cases.

## Writing for people

In PR bodies, issue comments and reports, reference files from the repo root (`docs/spec.md`), never absolute host paths. Keep it short and lead with the outcome.
