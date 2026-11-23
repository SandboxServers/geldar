---
title: Skills and agents
type: reference
audience: contributors
status: draft
last_verified: 2026-11-16 against 1b114276
companions: [README.md, repo-layout.md, cli-tools.md, ci-workflows.md, ../agents/documentation-style.md, ../runbooks/merge-queue.md]
sources: [.claude/skills, .claude/agents, .claude/agent-memory/main-session/MEMORY.md, .gitignore, CLAUDE.md, AGENTS.md, .github/workflows/ci.yml, docs/runbooks/merge-queue.md, .github/pull_request_template.md, README.md, docs/analysis/phase0/bench-results.md, docs/spec.md, geldar.ps1, golem/src/bench/cli.ts, golem/src/test-control.test.ts, lantern-local/test/thinker.test.ts, pnpm-lock.yaml, shards/phase0.yaml]
---

# Skills and agents

Every development skill and agent definition under `.claude/`: what it is for, how it is invoked, its frontmatter, the rules it carries and the files it reads or writes. These are tools for the people and coding agents who build Geldar. For the commands they call, see [cli-tools](cli-tools.md); for CI, see [ci-workflows](ci-workflows.md).

## Scope: development only

The skills and agents in `.claude/` are read by development sessions (Claude Code and, through [AGENTS.md](../../AGENTS.md), other harnesses). No agent in the world reads them: they are not prompts, kit files or player-repo files ([documentation style, paths an agent reads](../agents/documentation-style.md#paths-an-agent-reads)). They still sit in a public repo, so they carry no secret, account name or address.

Harnesses without Claude Code's skills or subagents read the files directly: "a skill's `SKILL.md` is the procedure, an agent's `.md` is the brief" (`AGENTS.md` line 15).

## What `.claude/` holds

Measured 2026-11-16 at 1b114276. Re-derive:

```powershell
git ls-files .claude | ForEach-Object { ($_ -split '/')[0..1] -join '/' } | Group-Object | Select-Object Count, Name
```

| Path | Tracked files | What it is | Evidence |
|---|---|---|---|
| `.claude/skills/<name>/SKILL.md` | 4 | Procedures loaded on demand ([skills](#skills)) | `git ls-files .claude/skills` |
| `.claude/agents/<name>.md` | 4 | Subagent definitions ([agents](#agents)) | `git ls-files .claude/agents` |
| `.claude/agent-memory/main-session/` | 4 | Committed project memory: an index (`MEMORY.md`) and dated reference notes | `CLAUDE.md` line 39; `MEMORY.md` |
| `.claude/reports/` | 32 | Packet and wave reports | `.gitignore` lines 25 to 26 |
| `.claude/worktrees/`, `.claude/state/`, `.claude/settings.local.json`, `.claude/kino-shots/` | 0 (ignored) | Local worktrees, session state (for example `active-campaign`), local settings, screenshots | `.gitignore` lines 24, 27, 28, 65 |

`.gitignore` ignores `.claude/reports/*` except `w*.md` (lines 25 to 26). Five tracked reports do not match `w*.md` (`git ls-files -ci --exclude-standard .claude` lists them, for example `p0-13b.md` and `sc-61b.md`); inferred from their names that they were committed before the rule or added with force. `packet-coder.md` line 63 says other report names "stay local; do not `git add -f` them".

## Skills

Re-derive the list: `git ls-files .claude/skills`. Every skill has the frontmatter fields `name` and `description` and nothing else (read 2026-11-16). The description is the trigger text a harness matches against a request. [CLAUDE.md](../../CLAUDE.md) line 37 says to load the matching skill before that kind of work.

| Skill | Purpose (from `description`) | Triggers named in `description` | Lines |
|---|---|---|---|
| `body-bench` | Run the scripted body benchmark against a running shard at 20, 10 and 5 TPS and record success rates and p50/p95 latency | "run the body benchmark", "bench the body", "what's the action success rate", after any change to `golem/` actions or reflexes | 65 |
| `campaign-packet` | Run a multi-PR effort as a campaign of prescriptive work packets: ledger, packets, one `packet-coder` per packet, read-only review loops, `RESUME.md` | "resume Phase 0", "run the next wave", "split this into packets", "dispatch workers", writing or reviewing `work-packets.md`, `RESUME.md`, worknotes or a ledger | 127 |
| `run-shard` | Bring a shard's Compose stack up, check every part is healthy, read logs, take it down | "start the shard", "bring the stack up", "is the shard healthy", "restart Paper", before any live test, benchmark or Adam run | 91 |
| `ship-pr` | Take a change from a fresh worktree to a merged PR and a removed worktree | "open a PR", "ship it", "push this", "wait for CI", "merge #12", "is CI green" | 86 |

Line counts: `(Get-Content <file>).Count`, 2026-11-16 at 1b114276.

### `body-bench`

File: `.claude/skills/body-bench/SKILL.md`.

| Item | Content | Line |
|---|---|---|
| Harness | `golem/src/bench/`; CLI `golem/src/bench/cli.ts`; run with `./geldar.ps1 bench` | 8, 22 to 24 |
| Preconditions | Shard up and healthy (`run-shard`), both plugin jars built; nothing else connected; tree clean and committed | 12 to 14 |
| Flags | `--scenario`, `--tps`, `--runs`, `--max-minutes`, `--record`, `--allow-dirty`, `--note`, `--dry-run`, `--list`, `--restore` (full table in the skill) | 31 to 42 |
| Exit codes | 0 finished run (a failed scenario is a finding), 1 harness error, 2 usage error | 44 |
| Gate line | `GATE: PASS`, `GATE: FAIL (<scenarios>)`, `GATE: INCOMPLETE (truncated)`, `GATE: n/a (no 20 TPS cell ran)`; pass bar is 100% at 20 TPS; 10 and 5 TPS rows are findings only (decision [0038](../decisions/0038-tick-rate-does-not-slow-a-client-driven-body.md)) | 48 |
| Scenarios | `wood-to-stone-tools`, `food`, `shelter`, `bed`, `chest`, `blocked-path`; hidden `goto-smoke` and `bed-clear`, never in `all` or recorded | 52 to 61 |
| Writes | `bench-results/<UTC stamp>-<commit>.json` (gitignored); with `--record`, a copy under `docs/analysis/phase0/bench-runs/` and rows in `docs/analysis/phase0/bench-results.md` | 27, 37, 65 |
| Side effects | Sets the tick rate over RCON, resets the test area, restores 20 TPS on finish or failure | 27 |

The bench mutates the shard; run it alone ([CLAUDE.md](../../CLAUDE.md) commands section).

### `campaign-packet`

File: `.claude/skills/campaign-packet/SKILL.md`.

| Item | Content | Line |
|---|---|---|
| Roles | Main session: ledger, slicing, decisions, worktrees, PRs, merge; `packet-coder`: one packet; fresh `packet-reviewer`: review; fresh `packet-coder`: fix notes | 10 to 16 |
| Campaign folder | `docs/analysis/<campaign>/` with `README.md` (ledger, decisions table, packet table), `work-packets.md`, `RESUME.md` (at most 40 lines), `worknotes/` | 24 to 27 |
| Packet statuses | Ready, BlockedDependency, BlockedDecision, Writing, Review, Done | 24 |
| Packet size | Under about 40k working tokens for a Haiku coder; split above | 33 |
| Coder brief template | Standing rules, worktree, packet section, report path, live lane, budget, commit message with trailers, return line | 59 to 70 |
| Reviewer brief template | Worktree, scope and range, spec, pass N of L (3 single, 5 batch), area, integration branch, report, return line | 78 to 87 |
| Review loops | Packet (on request), wave (default, once at wave end, up to 5 rounds), campaign | 105 to 111 |
| Wave close | Wave test and review; docs sweep; retro; `W<N>-process` packet; ledger; worktree removal | 127 |
| Writes outside the campaign folder | `docs/decisions/` records in the same wave (owner-authorised exception) | 29 |
| Local state | `.claude/state/active-campaign` (gitignored) | 20 |

### `run-shard`

File: `.claude/skills/run-shard/SKILL.md`.

| Item | Content | Line |
|---|---|---|
| Start | `cd plugin; ./gradlew build`, then `./geldar.ps1 shard up phase0`, then `shard status phase0` | 15 to 17 |
| What `shard up` does | `docker compose build`, `up -d --wait`; refuses when a jar is not a file; then requires the `Geldar-Core enabled` and `Geldar identity enabled` log lines | 20 |
| Wave test order | Shard up; live lane in the background; eventsink integration tests with `GELDAR_IT=1`; then the benchmark; one at a time | 28 to 31 |
| Health table | Postgres, pgvector, migrations, NATS JetStream, Paper, Paper behind the proxy, Velocity ingress, RCON, both plugins loaded, events flowing, events and Body records in Postgres, Ollama on the host | 41 to 56 |
| Golem settings | Environment variable names `GELDAR_MC_HOST`, `GELDAR_MC_PORT`, `GELDAR_RCON_PORT`, `GELDAR_RCON_PASSWORD_FILE`, `GELDAR_NATS_URL` (meanings in [environment-variables](environment-variables.md)) | 71 to 73 |
| Adam rules | `adam up` holds port 7410; never before a live case; live cases 8B-only; `adam select` rewrites `shards/phase0.yaml` | 77 to 79 |
| Stop | `./geldar.ps1 shard down phase0` keeps volumes; ask the owner before `docker compose down -v` | 88, 91 |
| Principle 1 | Never fix a problem by acting in the world; RCON test control is for fixtures and ops tooling only (decision [0029](../decisions/0029-rcon-reply-framing.md), spec section 5.1) | 67 |

The skill states its own precedence: "if they differ from the table, the compose file wins" (line 58). Its bring-up steps exist nowhere else in `docs/` yet (plan finding F-11, [plan.md](../analysis/docs-library/plan.md)).

### `ship-pr`

File: `.claude/skills/ship-pr/SKILL.md`.

| Item | Content | Line |
|---|---|---|
| Worktree | `git worktree add <abs path>\.claude\worktrees\<name> -b <branch> origin/main`, then `./geldar.ps1 setup`; packets branch from their wave branch | 12 to 18 |
| Branch names | `phase0/<packet>-<slug>`; otherwise `feat/`, `fix/`, `docs/`, `chore/`; never commit to `main` | 20 |
| Before push | `./geldar.ps1 check` passes; revert-checked test; contract regenerated; exact pins; decision record; memory note | 24 to 29 |
| Open | `git push -u origin <branch>`; `gh pr create --base main` with a body file following `.github/pull_request_template.md` | 34 to 38 |
| CI | `gh pr checks <PR> --watch --fail-fast`, then `--required`; green means `ci gate` passed, the one check `main` requires | 45 to 49 |
| Merge | `gh pr merge <PR> --merge --delete-branch` when `ci gate` is green, review says `ship` and the owner asked; never `--admin` | 57 to 63 |
| Cleanup | `git worktree remove --force` after checking `status --short`; never `git worktree prune` | 68 to 73 |
| Wave PR | Merge `origin/main` into the wave branch; never hand-merge `pnpm-lock.yaml` | 77 to 79 |
| Windows notes | A bare `--` breaks `geldar.ps1` parameter binding; absolute worktree paths; scripted git must not wait on stdin | 83 to 86 |

## Agents

Re-derive the list: `git ls-files .claude/agents`. Frontmatter read from each file on 2026-11-16 at 1b114276; a field the file does not set is shown as "not set".

| Agent | `model` | `effort` | `maxTurns` | `tools` | `omitClaudeMd` | Lines |
|---|---|---|---|---|---|---|
| `documentation-writer` | sonnet | medium | not set | not set | not set | 65 |
| `ops` | haiku | medium | 40 | Read, Grep, Glob, Bash, PowerShell | false | 34 |
| `packet-coder` | haiku | medium | 90 | Read, Edit, Write, Grep, Glob, PowerShell | true | 66 |
| `packet-reviewer` | sonnet | high | 60 | Read, Grep, Glob, PowerShell | true | 39 |

[CLAUDE.md](../../CLAUDE.md) line 38 says these Geldar copies override global agents of the same name.

### `documentation-writer`

File: `.claude/agents/documentation-writer.md`. Added in commit cd4499da.

| Item | Content | Line |
|---|---|---|
| Job | Diataxis-aware writer: reference, runbooks, explanations, tutorials, glossary, decision records, sweeps; Markdown only | 3 |
| Hard rules | Never edit `docs/spec.md`; Markdown only; no secrets, account names or non-loopback IPs; never read the owner's private configuration folder; agents never learn they are watched; Principle 1; evidence; no invention; read-only on the node and VM; LF and the metadata block | 10 to 21 |
| Doc types | Tutorial `docs/guides/`, how-to `docs/runbooks/`, reference `docs/reference/`, explanation `docs/concepts/` and `docs/decisions/` | 23 to 32 |
| Metadata block | `title`, `type`, `audience`, `status`, `last_verified`, `companions` (no `sources:`; see [conflicts](#conflicts-recorded)) | 34 to 47 |
| Return | One line `<task> <done\|blocked\|failed> <commit-sha\|-> <report-path>` when given a report path; otherwise under 15 lines | 63 to 65 |

The full rules as the library applies them are in [documentation style](../agents/documentation-style.md).

### `ops`

File: `.claude/agents/ops.md`.

| Item | Content | Line |
|---|---|---|
| Job | Runs and reports: merges into a named branch, `./geldar.ps1 check`, single tests, live lanes, `bench`, `adam`, `shard`, logs, revert-checks, worktree cleanup | 3, 15 to 20 |
| When named in a brief | Push, `gh pr create`, `gh pr checks --watch`, one rerun of a known flake, `gh pr merge --merge`; named node steps over SSH with a timestamped backup before any node file edit | 22 to 25 |
| Never | Edit repo source, tests, schemas, prompts or docs; rebase, reset, force-push, `git stash`; push to `main`; restart the shared proxy without owner approval; `adam up` on the node; print secrets; run a live test unless briefed | 27 to 32 |
| Secrets in worktrees | Only when briefed, one directory junction to another worktree's git-ignored dev secrets folder, removed with `cmd /c rmdir`; never list or print its files | 19 |
| Return | Per step: command, exit status, lines that matter; last line `ops <done\|blocked\|failed> <what> <sha or ->` | 34 |

### `packet-coder`

File: `.claude/agents/packet-coder.md`.

| Item | Content | Line |
|---|---|---|
| Job | Implement exactly one packet in a given worktree; edit only the named files; commit locally | 3, 11 |
| Never | `git checkout`, `restore`, `reset` or `stash` tracked work; `git push`; `gh pr`; `git worktree prune`; delete a worktree | 19, 62 |
| Revert-check recipe | Six steps: failing test first, commit, back up, mutate one line, confirm the failure, restore from the backup | 22 to 28 |
| Known flaky tests | `golem/src/test-control.test.ts`, `lantern-local/test/thinker.test.ts`: rerun once and report both outcomes | 34 |
| Files | LF, under 700 lines, no `utils.ts` or `helpers.ts`, Biome; `git diff --check` and `./geldar.ps1 pnpm check:repo` before the final commit | 39 to 41 |
| Budget | About 35 tool calls and 70k tokens; stop at 80 turns and report | 52 to 53, 62 |
| Commits | WIP commits squashed to one from a recorded `<base>`; trailers copied verbatim from the brief | 58 to 60 |
| Live lane | Not run unless the brief names the coder as the only live user; otherwise `live: pending` | 51 |
| Return | `<packet> <done\|blocked\|failed> <commit-sha\|-> <report-path>` | 68 |

### `packet-reviewer`

File: `.claude/agents/packet-reviewer.md`.

| Item | Content | Line |
|---|---|---|
| Job | Read-only adversarial review of one packet, wave or PR | 3, 11 |
| Review areas | Correctness, spec drift, tests (theatre tests), contract, repo rules, interaction with code outside the diff | 14 to 19 |
| Checklist | Mutate each new test; geometry on every axis and sign; attempt limits; fails open; fix side effects; YAML with a real parser; hostile inputs; doc claims against what is enforced; `git merge-tree` dry run; server replies; quote trailers | 22 to 33 |
| Writes | The report file only, plus a mutated file it restores with `git checkout -- <path>` | 11, 39 |
| Report | `## Findings`, `## Fix notes`, `## Verdict` (`ship`, `fix` or `decision`) | 39 |
| Return | `<scope> verdict=<ship\|fix\|decision> <report-path>` | 39 |

## Project memory

`.claude/agent-memory/main-session/MEMORY.md` is the index: "Dated, sourced facts from top-level sessions, committed with the change that produced them. ... No IPs, credentials or account names" (line 3). It lists three reference notes at 1b114276 (`git ls-files .claude/agent-memory`). [CLAUDE.md](../../CLAUDE.md) line 39 and [AGENTS.md](../../AGENTS.md) line 7 tell sessions to grep it before researching. Memory held outside the repo by a harness is not part of this reference.

## Conflicts recorded

Recorded, not resolved (persona rule 8).

1. **Merge queue.** `campaign-packet` line 8 says the port has "no `ops` agent, no agent board and no merge queue", and `ship-pr` line 8 says Geldar ships "without its build lane and merge queue". Decision [0220](../decisions/0220-merge-queue-for-main.md) adopts a merge queue for `main`, `ci.yml` lines 1 and 11 add the `merge_group` trigger, and [runbooks/merge-queue.md](../runbooks/merge-queue.md) says the ruleset "is not set in the repo" and is created once the workflow change is on `main`. Whether the ruleset is active on GitHub is unverified (no GitHub read in this pass). Agent board: that "no agent board" clause is superseded by decision [0437](../decisions/0437-developer-agent-board.md), which registers the developer agent board; see [developer agent board](../agents/board.md). The `campaign-packet` skill now carries the board steps.
2. **Who merges.** `campaign-packet` lines 8 and 13 give worktrees, PRs and merges to the main session. `ops.md` lines 16 and 23 and [CLAUDE.md](../../CLAUDE.md) line 38 give merges and runs to the `ops` agent.
3. **Agent list.** [CLAUDE.md](../../CLAUDE.md) line 38 lists `packet-coder`, `packet-reviewer` and `ops`. `.claude/agents/` also holds `documentation-writer.md` (commit cd4499da). AGENTS.md names only `packet-coder` and `packet-reviewer` by file (lines 9 to 10).
4. **Metadata block.** `documentation-writer.md` lines 34 to 44 lists the block without `sources:`; [documentation style](../agents/documentation-style.md#metadata-block) requires it (owner approval 2026-11-16, plan decision D5) and says adding it to the persona is the owner's edit.
5. **Reviewer restore.** `packet-reviewer.md` line 22 restores a mutated file with `git checkout -- <path>`; `packet-coder.md` line 19 forbids `git checkout` on tracked work and restores from a scratchpad backup (line 28); `ops.md` line 29 forbids `git checkout -- <path>` on a file it did not back up. These are different agents with different rules, not a contradiction inside one file; listed because a reader moving between them can confuse them.
6. **Audience label for observation docs.** `documentation-writer.md` line 16 says to mark docs about telemetry, vitals, the Glass, journals, thoughts and prompts `audience: operators`. [Documentation style](../agents/documentation-style.md#audience-labels) labels them `agents-never` (plan decision D9).
7. **"Skills" as an agent-read path.** `documentation-writer.md` line 16 lists "skills" among the paths an agent reads. [Documentation style](../agents/documentation-style.md#paths-an-agent-reads) places kit skills in the sibling repos and player repos on that list, and says the `.claude/` skills are read by coding agents, not agents in the world. This page follows the style doc's reading; the persona text does not say which skills it means.

## Documentation debt

- `ops.md` line 24 names the node's SSH host alias. The persona and [style](../agents/documentation-style.md#what-never-goes-in-a-document) forbid host names in documents; this page does not repeat it. Whether the rule covers `.claude/` files is for the owner; changing the file is not a writer's edit.
- Bring-up and health steps live only in the `run-shard` skill (plan finding F-11). An operator runbook would duplicate them; the plan decides which is the source.
