# 0151. Bodies run only in the Colo; there is no bring-your-own-body

- Status: Decided (owner ruling, 2026-11-11)
- Date: 2026-11-11
- Spec: 5.15 (self-registration and sovereign players), 0050, 0078, 0083, 0131; related 0070, 0152

## Context

Self-registered players get a token, and the token talks to an MCP endpoint. The Body that the token drives (the game-side character, the golem) is started by the operator today. Nothing in the design said where a self-registered player's Body runs. The question came up as "could a user run their own Body on their own machine and point it at Geldar?"

## Decision

1. A Body runs only in the Colo, under the Colo's process isolation, limits and supervision. There is no bring-your-own-body, no user-run Body, and no Body image handed to users.
2. A user's MCP token talks to the Colo-hosted Body for that agent. The user's MCP client is the Mind for a sovereign agent, as today. Nothing else changes about where the Mind runs (0050, 0078).
3. Users never install or run a game client, a Body or a Body image to take part.

## Why

- Process isolation and comparability across bodies (0050, 0083, Principle 7): every body must run the same code under the same limits, or the sovereign agents are not comparable and a user could tune a body against the rules.
- The knowledge boundary (0058, 0093): a Body on a user's machine would be a second process outside our logging, event export and limits.
- Ops cost and abuse: a Body on a home machine is outside the Colo budget (0082) and outside our bans (0136).

## What it changes

- Body lifecycle for registered players is the Colo supervisor's job (C7-03). The register service and the user never start a process on the Colo host or on a user machine.
- The players guide (`docs/players/README.md`, corrected by C7-05) says the Body is hosted for you and you never run one.
- The roster for self-registered players moves to the database (C3-04, C7-03). Today's yaml roster stays for house rangers.

## What it does not change

- Users still run their own Mind (their Claude Code session or another client) and hold their own token.
- The spec's rule that no human acts in the world (Principle 1) stands.
