# Codex campaign adapter proposal

Recommendation: add a small optional process packet, AN-01, before running this campaign through Codex. Mirror the three existing Geldar roles and expose its four existing skills. Keep the Claude workflows working and avoid two drifting copies of the procedures. This planning pass installs nothing.

## Role mapping

These are practical starting configurations, not measured Claude/GPT equivalences. Pilot on one disposable packet, inspect the report quality and total token use, then tune explicitly. A Haiku-sized brief remains prescriptive regardless of which coder runs it.

| Existing Claude role | Existing settings | Proposed Codex role | Proposed model/effort |
|---|---|---|---|
| `packet-coder` | haiku, medium; 90 maxTurns | `.codex/agents/packet-coder.toml` | `gpt-6-luna`, `high` |
| `packet-reviewer` | sonnet, high; 60 maxTurns | `.codex/agents/packet-reviewer.toml` | `gpt-6.1-sol`, `high` |
| `ops` | haiku, medium; 40 maxTurns | `.codex/agents/ops.toml` | `gpt-6-luna`, `medium` |
| Main-session planning/rulings | Opus referenced in campaign procedure | Parent session; no extra role required | `gpt-6.1-sol`, `xhigh` when available |

Codex project agents use standalone TOML files with `name`, `description` and `developer_instructions`; set `model` and `model_reasoning_effort` explicitly. Agent instructions do not create an independent read-only sandbox; permissions inherit from the parent. These schema facts are documented in [OpenAI's Subagents documentation](https://learn.chatgpt.com/docs/agent-configuration/subagents). The role selections above are this plan's recommendations.

Illustrative coder file, to be completed with the accepted Geldar standing rules:

```toml
name = "packet-coder"
description = "Implement one prescriptive Geldar packet in its own worktree; commit locally and report."
model = "gpt-6-luna"
model_reasoning_effort = "high"
developer_instructions = """
Read AGENTS.md, CLAUDE.md, the named packet and the Geldar packet-coder standing rules.
Own only the files the packet names. Other agents may be working; do not revert their edits.
Implement the accepted specification, run its named checks, commit locally and write the report.
Return the required packet status line. Stop for a design gap; do not decide it yourself.
Never push, open a PR, deploy, edit docs/spec.md or operate the live lane without the brief's authority.
"""
```

The example is not sufficient as a production brief. The adapter must preserve progress/base-SHA reporting, faithful revert-checks, bounded continuation, no secret output, exact commit instructions and path ownership. The reviewer preserves its finding/fix-note/verdict report; ops preserves raw command/exit/evidence reporting and stops on source changes or merge conflicts.

## Skill entry points

Codex discovers repository skills under `.agents/skills/<name>/SKILL.md`, with YAML `name` and `description`; optional `agents/openai.yaml` controls UI metadata. Keep procedural content in `SKILL.md` or a referenced maintained body. See [OpenAI's Build skills documentation](https://learn.chatgpt.com/docs/build-skills).

| Codex entry point | Existing procedure |
|---|---|
| `.agents/skills/campaign-packet/SKILL.md` | `.claude/skills/campaign-packet/SKILL.md` |
| `.agents/skills/ship-pr/SKILL.md` | `.claude/skills/ship-pr/SKILL.md` |
| `.agents/skills/run-shard/SKILL.md` | `.claude/skills/run-shard/SKILL.md` |
| `.agents/skills/body-bench/SKILL.md` | `.claude/skills/body-bench/SKILL.md` |

Prefer small Codex wrappers that load the existing procedure plus a narrowly scoped harness adaptation. Use relative links valid from the wrapper and verify them. If procedures later move to a shared neutral directory, move them in a separate reviewed process change, with Claude and Codex wrappers both pointing to the same body. Avoid Windows symlink requirements for normal repository checkout.

Example frontmatter and routing:

```yaml
---
name: campaign-packet
description: Plan and run Geldar campaigns with prescriptive packets, isolated worktrees, fresh reviews and durable ledgers.
---
```

The body names the canonical procedure, explains that Codex uses its subagent roles instead of Claude's Task/AskUserQuestion interfaces, and preserves the standing scope/permission rules. It does not rewrite the user's authorization or turn a new skill into permission to publish.

## Translation gaps to settle

| Claude instruction | Codex treatment |
|---|---|
| YAML `model: haiku/sonnet`, `effort` | Explicit TOML model slug and `model_reasoning_effort`; do not paste Claude frontmatter into a Codex agent |
| `omitClaudeMd: true` | No assumed equivalent; require repository guidance reads and inline critical packet constraints |
| `maxTurns`, tool list, 70k budget | Preserve stopping/report rules in the instructions; verify any actual runtime enforcement separately; never invent unsupported config keys |
| Reviewer is read-only but mutates for a revert-check | Explicitly document the narrowly authorized mutation/restore exception, or have ops perform the exact mutation and reviewer assess evidence; do not claim absolute read-only enforcement |
| Claude-session attribution | Supply truthful, approved harness attribution in dispatch; never attribute a Codex session to Claude by blindly copying old trailers |
| Six agents allowed in Phase 1 docs | Cap at the actual harness limit; this session has four slots total, leaving at most three children |
| Wave-only review in old skill versus per-packet review in current AGENTS | Current user-supplied AGENTS controls; obtain a rule change before weakening review, not after a packet is done |
| Coder instructions forbid reset, then prescribe soft-reset squashing | Resolve in the process ruling; default to no tracked-work reset and retain progress commits unless an explicit, safe squash policy is accepted |
| Skill introduction claims no ops, later repo provides ops | Correct the stale introduction in a separately owned process change; preserve the actual three-role separation |
| Run-shard permits copying secrets; Phase 1 conventions require env variables | Use environment/file-path references under current task authority; do not copy secrets just because an old skill suggests it |

Do not mirror every account/global skill or change user-wide Codex settings. Keep the adapter in Geldar. Discovery/model selection is verified in a fresh session; creating a TOML file does not change roles already loaded into this chat.

## Acceptance

AN-01 is ready only after D-CS-08 chooses the role/model settings, review policy, attribution and canonical-body approach. Its checks parse every file, verify links, confirm discovery/model/effort in a disposable session and exercise report paths, file ownership and stop-on-gap behavior. A textual restriction is a role instruction, not a security boundary. The product campaign can proceed through Claude without this optional adapter.
