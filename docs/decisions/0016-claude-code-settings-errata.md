# 0016. Appendix J's Claude Code settings, corrected against Claude Code 2.1

- Status: Accepted
- Kind: Fixes
- Date: 2026-11-08
- Spec: 5.15.3 (client timeouts), 5.15.7 ("model: haiku, effort low, thinking off"), 8.4b, Appendix J (`.claude/settings.json`, `.mcp.json`, hook wiring); builds on 0009 and 0011

## Decision

Appendix J says its setting names should be checked against the current Claude Code docs when the kit is built (and 0009 promised a record for any mismatch). Checked on 2026-11-08 against code.claude.com/docs, the kit uses these forms:

1. **Effort is `effortLevel`, not `effort`.** `"effortLevel": "low"`.
2. **Thinking can't be turned off on Haiku 5.5.** The docs say `alwaysThinkingEnabled: false` and `MAX_THINKING_TOKENS=0` have no effect on it. "Thinking off" (5.15.7) is dropped. Low effort is the cost control.
3. **The `wait` timeout is set per server.** The `geldar` entry in `.mcp.json` gets `"timeout": 300000` (milliseconds), above the 240 s cap (5.15.3). `MCP_TIMEOUT` is only the startup timeout.
4. **Unlisted tools are denied, not asked about.** `"defaultMode": "dontAsk"`.
5. **Reads stop at the project.** `"blockReadsOutsideWorkingDirectories": true` (Claude Code 2.1.257 or later). An allow rule like `Read(**)` doesn't block anything by itself, which is why 0011 needed a real restriction.
6. **Path rules are anchored with `/`.** It means the project root, so the rules read `Edit(/memory/**)` rather than `Edit(memory/**)`. The kit pairs every `Edit` rule with the same `Write` rule until a test confirms whether `Edit` rules govern `Write`.
7. **Settings are layered, and deny always wins.** Lists merge across layers, so a later layer can add a deny but never lift one. The kit therefore uses three layers:
   - **managed settings** in the image: the core denies (`Bash`, `WebFetch`, `WebSearch`, the CLI's credential paths), which nothing can override;
   - **the template's project settings:** the allow list, the edit scope and the hooks;
   - **a per-mode file** passed with `--settings`: play mode denies writes to `memory/identity.md`, and setup mode denies the world tools (0015).
   Appendix J's single file can't express both modes.
8. **Hook matchers are regular expressions and aren't anchored.** The `PostToolUse` matcher is `^mcp__geldar__(act|say)$`. Hook commands use `${CLAUDE_PROJECT_DIR}` instead of relative paths.
9. **Auto memory is off.** `"autoMemoryEnabled": false`, so the CLI keeps no memory outside the repo, where it would escape the gate (0011).
10. **Project allow rules apply only after the folder is trusted.** Deny rules apply at once. The kit's first-run step in the container accepts trust for the workspace, and the image test checks the effective rules with `/permissions`.

## Why

Built as Appendix J wrote it, the kit would silently run at default effort, time out long `wait` calls, allow reads anywhere on the container, and have no way to make `identity.md` writable in setup but locked in play. Each item above was checked against the official documentation on the date given.

## Consequences

- The Scriptorium campaign's work packets carry this syntax as their contract. The image tests (SC-42) check each item against the pinned CLI version, and any further mismatch gets a new record.
- Claude Code changes these names between releases. The kit pins a CLI version per release, and this record describes that pin, not Claude Code in general.
