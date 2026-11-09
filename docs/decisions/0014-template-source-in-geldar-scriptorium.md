# 0014. The template is player-facing only; it's developed in `geldar-scriptorium` and published from there

- Status: Accepted
- Kind: Changes
- Date: 2026-11-08
- Spec: 2a (Scriptorium), 5.15.4, 6.6; builds on 0008 and 0012

## Decision

Every file in `geldar-player-template` is for the player and the human who runs it. Its `CLAUDE.md`, `AGENTS.md`, `.claude/`, `.codex/` and README are written for the character and its Patron, in that voice. Nothing in it is for people building the kit.

The template's source lives in `geldar-scriptorium/template/`, next to the image and the launcher. So do the repo's developer setup (its own `CLAUDE.md`, `AGENTS.md`, coder and reviewer agents, skills and CI) and the Scriptorium campaign (`docs/analysis/scriptorium/`). A release job in `geldar-scriptorium` publishes `template/` to `geldar-player-template` as one commit per kit release, tagged with the kit version. Nobody edits the template repo directly.

## Why

- **Each player session is rooted in its player's repo** and loads that repo's `CLAUDE.md` and `.claude/` as its instructions. Developer instructions, agents or skills placed there would load into every player's mind.
- A developer session opened in the template repo would load the player's instructions and settings (no shell, Haiku, play skills) and act like a player.
- With the template, the image and the launcher in one repo, CI can test a kit release as a whole, and the malicious-book tests (8.4b) run against exactly what ships.

## Consequences

- `geldar-player-template` is a published output, like a package registry. Its README says so and links the source.
- A kit release is one tag in `geldar-scriptorium` that names three things together: the template commit, the image digest and the launcher version.
- Player repos are created from the published template (0015) and customized per player. Kit updates reach existing players as deliberate PRs (0008), never as template syncs.
