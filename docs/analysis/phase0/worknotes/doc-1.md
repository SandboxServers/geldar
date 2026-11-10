# DOC-1: public-facing docs and GitHub files

Branch `docs/public-polish`, from `origin/main`. Docs and config only; no code changed.

## What changed

- `LICENSE`: MIT, copyright line `Copyright (c) 2026 SandboxServers`. The holder is a default taken from the owner's direction; change the one line if it differs.
- `README.md`: rewritten for a public reader. Tagline, what and why, status with a phase table (Phase 0 in progress, the rest planned), principles, an ASCII architecture sketch, a Windows quickstart, the layout map, docs index, contributing pointer, MIT licence section with the third-party sentence. The `glass/` line was removed because that directory does not exist yet (campaign wave 6).
- `docs/README.md`: docs index.
- `docs/glossary.md`: public terms, each checked against the spec, the decisions or the code. Glass is marked as not built.
- `CONTRIBUTING.md`: worktrees, checks, repo rules, file caps, LF, secrets, packets and the Phase 0 campaign pointer, MIT contribution line.
- `SECURITY.md`: private reporting through GitHub's Security tab. In scope: MCP front door, identity gate, Geldar-Core, compose stack, secrets, Glass once built.
- `CODE_OF_CONDUCT.md`: Contributor Covenant 2.1, enforcement contact set to the maintainers via GitHub private reporting.
- `.github/ISSUE_TEMPLATE/`: `bug.md`, `feature.md` (points at `docs/ideas.md`), `question.md`, `config.yml` (blank issues disabled, security contact link).
- Not changed: `.github/pull_request_template.md` (already covers the rules), `.github/dependabot.yml` (exists), no CODEOWNERS (no team or owner handle exists in the repo).

## Owner decisions needed

(a) Licence: decided MIT (owner direction). Remaining: confirm the copyright holder line. Dependency licence scan not yet done (Paper, Velocity, Mineflayer and npm packages).

(b) Repository description and topics (proposed, not set):
- Description: `A vivarium for AI agents, built on Minecraft: persistent agents with bodies and minds, observed, never played by people.`
- Topics: `minecraft`, `ai-agents`, `mineflayer`, `paper`, `velocity`, `nats`, `postgres`, `mcp`, `simulation`, `typescript`

(c) Social preview image: none exists. Needs an image the owner chooses.

(d) Discussions: recommended off until there is a user base; issues and the security tab are enough for now.

(e) Could not verify or left open:
- Private vulnerability reporting must be enabled in the repository settings for SECURITY.md to work.
- Badges: none added. The CI badge needs the repository URL (which names the organisation), so it is left for the owner to add.
- Contact link to `docs/` in `ISSUE_TEMPLATE/config.yml`: needs the repository URL; left out.
- The brief named an `ops` docs folder; none exists. Ops procedures are the `.claude/skills/` files, linked from `docs/README.md`.
- The live-smoke claim in the README (sovereign-player MCP against the real Body) is taken from the merged live-4 and live-5 work (PR #29, PR #30, `docs/mcp-live` commits). RESUME.md at the time said no live step had run; the owner should confirm before publishing.
- `docs/spec.md` and the campaign docs name the owner in prose (for example "Steven's colocation rack"). They are public once the repo is. Not edited (spec must not be edited by this packet); owner to decide whether to scrub them.
