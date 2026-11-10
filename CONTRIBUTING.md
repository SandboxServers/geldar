# Contributing

Thanks for looking. Geldar is at an early stage, and most work is planned as numbered packets (see below). Read this page, then [CLAUDE.md](CLAUDE.md) and [AGENTS.md](AGENTS.md), which hold the same rules for people and AI agents.

## Before you start

- The scope is [docs/spec.md](docs/spec.md). Build what the spec and the current packet say.
- An idea outside them goes in [docs/ideas.md](docs/ideas.md), not in code.
- When the spec is wrong or silent, record the decision in [docs/decisions/](docs/decisions/) and say so in the pull request.
- Nothing may let a person act inside the world (spec Principle 1). Changes that would are out of scope.

## Setup

```powershell
./geldar.ps1 setup
./geldar.ps1 check
```

Windows with PowerShell 7 is the main development platform. CI runs on Linux. The local `check` runs what CI runs, except jobs whose tools you lack locally; say which in the pull request.

## Working on a change

1. Give each piece of work its own git worktree under `.claude/worktrees/`, on a new branch created from `origin/main`. Use an absolute path with `git worktree add`.
2. Keep each change small. Commit per logical step, with a message that says what changed and why.
3. Run `./geldar.ps1 check` before you push.
4. Open a pull request against `main`. The template asks for the spec section or packet it implements, the test plan and what you could not test.
5. Wait for the `ci gate` check to pass before you ask for a merge.

## Repo rules

- **Change the contract, never the generated code.** Edit the schema in `contract/` and regenerate. CI fails when generated code is out of date.
- **Pin exact versions.** npm packages with `pnpm add -E`, Gradle dependencies, Docker images by digest, GitHub Actions by commit SHA. Only use versions at least two weeks old.
- **A behavior change needs a test that fails when the change is reverted.** Check that it does before you call the work done, and say how you checked in the pull request.
- **Prompt changes go in `prompts/` with a version bump.** Never edit a released template in place.
- **File size.** Code and config files stay under 500 lines (soft cap) and never exceed 700 (hard cap). `pnpm check:repo` enforces the hard cap. Split along natural seams; do not add `utils.ts` or `helpers.ts`.
- **Formatting.** Biome formats TypeScript (`./geldar.ps1 pnpm format`). Line endings are LF everywhere except `*.bat` and `*.cmd`.
- **No secrets.** No tokens, passwords, account names, personal names or emails, and no public or private-network IP addresses. `127.0.0.1` is fine. Commit a `.env.example` rather than a `.env`.
- **Live runs start their own stack.** Read the live-run rules in CLAUDE.md before you run one.

## Packets and the Phase 0 campaign

Phase 0 ("Adam") is run as a campaign: a ledger, a set of numbered packets and a resume card, all under [docs/analysis/phase0/](docs/analysis/phase0/). Start with [RESUME.md](docs/analysis/phase0/RESUME.md), then the [ledger](docs/analysis/phase0/README.md). A packet's section in the work-packet plan says what to build and how to check it. The ship procedure is the [ship-pr skill](.claude/skills/ship-pr/SKILL.md).

## Licence

Geldar is MIT licensed (see [LICENSE](LICENSE)). By contributing, you agree that your contribution is licensed under the same MIT licence.

## Conduct and security

Participation is covered by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Report security problems privately, as described in [SECURITY.md](SECURITY.md).
