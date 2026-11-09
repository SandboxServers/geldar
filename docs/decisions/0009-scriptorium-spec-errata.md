# 0009. Errata for the player kit (Scriptorium) sections

- Status: Accepted
- Kind: Fixes
- Date: 2026-11-08
- Spec: 5.15.2, 5.15.3, 5.15.4, 8.4b, Appendices J and K

## Decision

Where the spec contradicts itself about the player kit, the kit is built as follows.

1. **Memory is never imported into `CLAUDE.md`.** The 5.15.4 file tree says `CLAUDE.md` "imports memory/*.md". 5.15.2 and Appendix J say memory is read only through `recall`, and `CLAUDE.md` is immutable. The kit follows 5.15.2.
2. **Hooks don't call MCP tools.** 5.15.2 and Appendix J say a hook can't call an MCP tool, but the 5.15.4 tree has `post-tool-use.sh` calling `journal`, the 5.15.3 tool table says `journal` is "called by a hook after each turn", and `session-end.sh` "commits via geldar-git". In the kit:
   - `post-tool-use.sh` only appends a line to `memory/journal/current.md`. The colo's mirror of each `act`/`say` is built by the MCP server, as 5.15.2 says.
   - `journal` is a tool the model calls when it chooses to, matching "whatever the model volunteers through `journal`" in 5.15.2.
   - The `session-end.sh` safety net runs the `geldar-git` program as a command (`geldar-git commit --message ...`). It's the same code as the MCP tool, run directly rather than through the MCP connection.
3. **`wait` is capped at 240 s and takes `cursor` and `interests`.** Appendix K allows up to 300 s and lists only `max_seconds`. 5.15.3 caps it at 240 s, has the client timeouts set above that, and describes the durable cursor. The contract follows 5.15.3.
4. **No shell at all, not "no shell except hook scripts".** 8.4b says the settings deny Bash "except the kit's named hook scripts". Hooks run outside the permission system and need no Bash rule, so the kit denies Bash entirely, as Appendix J does.
5. **Companion server names use underscores.** Permission rules match `mcp__<server>__<tool>`, where `<server>` is the key in `.mcp.json`. Appendix J's rules say `geldar_git` and `geldar_memory`; the prose says `geldar-git`. The `.mcp.json` keys are `geldar_git` and `geldar_memory`, so the rules match. Program and package names keep the hyphen.
6. **`.mcp.json` lists all three servers.** Appendix J's example shows only `geldar`. The kit's file also has `geldar_memory` and `geldar_git`.
7. **There is no `give()` tool.** The 5.15.4 tree's `trade` skill says "negotiate with give() and trust". `give` is an action inside `act`, and the skill says so.
8. **`memory/journal/current.md` is part of the tree.** The `play` and `reflect` skills write and empty it, but the 5.15.4 tree omits it. The template ships it empty.

## Why

Each pair of passages can't both be built. In every case we picked the passage that matches the later, reviewed design (v0.7's response to review findings 2, 14 and 15 in Appendix L) over leftover wording.

## Consequences

- The kit's README and skills follow this list, not the conflicting passages.
- Appendix J's setting names (`model`, `effort`, `Edit(...)` rules, hook event names) are checked against the pinned Claude Code release when the kit is built, as Appendix J itself asks. Mismatches found then go in a new record.
