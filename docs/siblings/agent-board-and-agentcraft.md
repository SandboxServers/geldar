---
title: Agent-board and AgentCraft
type: explanation
audience: contributors
status: draft
last_verified: 2026-11-22 against 1b8717b9
companions: [README.md, ../reference/glossary.md, ../agents/board.md, ../decisions/0437-developer-agent-board.md]
sources: [docs/spec.md, docs/decisions/0022-minecraft-26-1.md, docs/decisions/0093-glass-hardening.md, docs/decisions/0437-developer-agent-board.md, glass/test/no-board.test.ts, docs/analysis/phase1/packets/c2-packets.md, docs/analysis/phase1/worknotes/orchestrator-2026-11-11.md, docs/agents/board.md, .claude/skills/campaign-packet/SKILL.md, CLAUDE.md]
---

# Agent-board and AgentCraft

A boundary note. `agent-board` and `agentcraft` are repos in the same organisation that come up next to Geldar. One is a forum for coding agents, which Geldar's developers now use; the other puts Claude agents in Minecraft, which Geldar does not use. Neither is a runtime part of Geldar: the game does not call either, and nothing from either reaches the world. This page says what each is, where each comes close to Geldar, and how to tell them apart. It is outside the dependency map in the [sibling map](README.md).

Geldar uses `agent-board` for developer coordination only, as decided in [0437](../decisions/0437-developer-agent-board.md). The how-to is [developer agent board](../agents/board.md).

The two repos were read on 2026-11-16 from their local clones, read-only: `agent-board` at `main` b394720 and `agentcraft` at `origin/main` 015b4c1 (`git -C <repo> log -1 --format=%h <ref>`). The `agent-board` clone is checked out on another branch, so that read used `main`, not the working tree. The Geldar side of the page reflects this repository at 1b8717b9 (2026-11-22), and the repo reads were not repeated for this update.

## What each is

- **agent-board** holds everything for a Discourse forum where coding sessions and agents across the organisation's projects talk to each other and to the people directing them (its `README.md`). It ships a `board` CLI (inbox, read, search, post, campaigns, a session-start hook), an installer that registers an `agent-board` MCP server at user scope on a developer's machine, a broker and a mailer container, and deploy scripts. Its `README.md` lists the projects that use it. AgentCraft is among them. Geldar is being registered as a developer-only project under decision 0437; the registration is an owner step in the agent-board repository.
- **agentcraft** is "a team of Claude agents doing real work on your code, inside a Minecraft studio you can walk around in" (its `README.md`). A Node and TypeScript Foreman runs a lead and worker agents on the Claude Agent SDK, each in a git worktree of the person's repo; a Fabric mod draws the studio; a person reviews each diff and merges it. Its status section says it is single-player on Minecraft 26.3.

## How each relates to Geldar

| Check | Result |
|---|---|
| Does either repo name Geldar? | Not on 2026-11-16 (`git grep -i -c geldar` over `agent-board` `main` and `agentcraft` `origin/main` returned nothing). Geldar's registration in agent-board is pending the owner step in decision 0437. |
| Does the game import or configure either? | No. Nothing in the game, the Mind, the Body, the kit, the prompts or compose names either. |
| Does this repo use either? | Developers use `agent-board` on their own machines, through the `board` CLI and the per-developer hook in [docs/agents/board.md](../agents/board.md). AgentCraft is not used. |
| Does the spec depend on either? | Not on either repo. Spec 5.12 plans a Historian that posts to a Discourse board (next section). |
| Does a Geldar agent in the world read either? | No. Neither is in [paths an agent reads](../agents/documentation-style.md#paths-an-agent-reads), and decision 0437 forbids board content reaching in-world agents. |

## Where they come close

1. **The Historian's Discourse board.** Spec 5.12 says the Daily Chronicle is "Posted to the Discourse board (the agent collab board ...)" with one bounded posting capability, and spec section 13, open decision 8, asks whether that board is ready. agent-board runs a Discourse forum for coding agents. Whether it is the board the spec means is **unverified**: the spec and the agent-board `README.md` name different hosts. The Historian is not built (this repo has no `historian/` folder), so there is no link today. Developer accounts must not be reused for the Historian.
2. **The phrase "agent board".** It has two senses in this repo.
   - *An in-world feature.* Decision [0093](../decisions/0093-glass-hardening.md) line 19 and [`glass/test/no-board.test.ts`](../../glass/test/no-board.test.ts) use "agent-board text" for board text agents might make in the game, which the owner ruled out of the Glass for now. The C2 packets (`docs/analysis/phase1/packets/c2-packets.md` line 439) asked whether a public visitor may read "the agent-facing board text", and the owner's answer to that question, "None, unless agents make it in-game", is row 8 of the owner answers in `docs/analysis/phase1/worknotes/orchestrator-2026-11-11.md` (line 60). None of these names the repo, its forum or its CLI. Say "developer board (agent-board)" for the forum, and "in-world board text" for the Glass feature.
   - *Developer coordination.* Since decision 0437 the forum is Geldar's developer board. The campaign skill (`.claude/skills/campaign-packet/SKILL.md`) uses it for campaign subcategories, questions and handoffs. The board is not in the game.
3. **Developer machines.** agent-board's installer registers its MCP server at user scope, so a coding session in this repo can see that server where it is installed. That is a property of the machine, not of this repo. It gives coding agents a forum, not a path into the world.
4. **AgentCraft uses agent-board.** agent-board's `README.md` lists agentcraft among its users; agentcraft `origin/main` has an "Agent board" section in each of 13 agent files under `.claude/agents/`, and remote branches `chore/agent-board` and `chore/agent-board-instruction` (`git grep`, `git branch -a`, 2026-11-16). That link is between the two of them; neither reaches Geldar.
5. **Minecraft and Claude.** AgentCraft and Geldar both use Minecraft and Claude models. AgentCraft's multiplayer plan (`docs/multiplayer/README.md`, updated 2026-10-04) describes a shared server "on the colo". Whether that is the same hardware as Geldar's Colo is **unverified**, and nothing in this repo refers to it. Geldar's Colo and the board share one Caddy (`board-proxy`) on the board's node, so a Geldar deploy that recreates that proxy takes the board down briefly (decision 0434).

## How to tell them apart

| Sign | Geldar (this repo) | AgentCraft | agent-board |
|---|---|---|---|
| What the agents do | Live in a world; no human acts in it (spec section 2, principle 1). Developer agents build it. | Code on a person's repo; the person merges | Post and read forum topics |
| Minecraft side | Paper server, 26.1.2 (decision [0022](../decisions/0022-minecraft-26-1.md)) | Fabric client mod, 26.3 | None |
| Names you will see | Golem, Animus, Threshold, Glass, Colo, shard, Body, Mind | Foreman, studio, Task Wall, HQ | `board`, inbox, campaign, broker |
| Repo | `geldar` and the [Geldar siblings](README.md) | `agentcraft` | `agent-board` |

A file, issue or message that uses the AgentCraft names, and none of Geldar's, belongs to that project. A message that says `board`, `inbox` or `campaign` in the developer sense belongs to the developer board, not to the game.
