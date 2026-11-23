---
title: Your first hour as a contributor
type: tutorial
audience: contributors
status: draft
last_verified: 2026-11-16 against 283d5d2d
companions: [README.md, first-shard-on-your-machine.md, trace-one-action.md, ../reference/cli-tools.md, ../reference/repo-layout.md, ../reference/components.md, ../reference/ci-workflows.md, ../agents/doc-update-map.md, ../agents/documentation-style.md]
sources: [CLAUDE.md, AGENTS.md, CONTRIBUTING.md, geldar.ps1, package.json, .nvmrc, .github/workflows/ci.yml, .github/pull_request_template.md, .claude/skills/ship-pr/SKILL.md, plugin/README.md, plugin/core/build.gradle.kts, docs/agents/doc-update-map.md, docs/agents/documentation-style.md, docs/reference/repo-layout.md, docs/reference/ci-workflows.md, .claude/agent-memory/main-session/reference_windows_toolchain_2026_11_08.md]
---

# Your first hour as a contributor

In this tutorial you go from a fresh clone of Geldar to a small change that passes the local checks and is ready to become a pull request. You will set up the toolchain, find your way around the repo, learn which documents a change must update, run the fast check and know what the full check does and does not cover.

You need no running game server for any of it. Bringing up the stack is the next tutorial, [your first shard](first-shard-on-your-machine.md).

**How this page was checked.** Every read-only command below was run on 2026-11-16 on Windows with PowerShell 7, first at `db33805c` and again at `283d5d2d`, and its output is quoted. Commands that install, build, commit or push were not run for this page; each says so. The documentation freeze in force that day allows no commits and no starts.

## What you need

- **PowerShell 7.** The task runner `geldar.ps1` runs on it, on Windows and Linux (its header, line 8), and every command in this tutorial is PowerShell.
- **Git.**
- **Node 22.23.2**, the version in `.nvmrc`. `package.json` allows `>=22.23.2 <23`.
- **No global pnpm.** `package.json` pins `pnpm@12.15.0` in `packageManager`. When `pnpm` is not on your PATH, `geldar.ps1` puts a corepack shim for that version in `node_modules/.corepack-bin` and uses it for the run (`geldar.ps1` lines 42 to 54). On Windows this avoids `corepack enable`, which needs admin rights when Node lives under Program Files (`.claude/agent-memory/main-session/reference_windows_toolchain_2026_11_08.md`).
- **Only for the full check:** Docker with Compose v2 and a JDK 25. The full check validates the compose files with `docker compose config` and builds the two Java plugins, whose Gradle toolchain is Java 25 (`plugin/core/build.gradle.kts` line 7; `plugin/README.md` line 3). You can do everything up to step 7 without them.

## 1. Read the three rule files

Open these in order.

1. `CLAUDE.md`: the repo rules and the command list. Every session, human or agent, works from it.
2. `CONTRIBUTING.md`: the same rules for people, plus how a change becomes a pull request.
3. `docs/spec.md`, sections 1 to 4: what Geldar is and how it fits together. The spec is the scope: you build what the spec and the current work packet say. An idea outside them goes in `docs/ideas.md`, not in code (`CLAUDE.md`, "Repo rules").

Two rules surprise newcomers:

- **Principle 1.** Nothing you build may let a human act inside the world (spec section 2; `CONTRIBUTING.md`, "Before you start").
- **The spec is never edited to fit the code.** When the spec is wrong or silent, the fix is a decision record under `docs/decisions/` ([add a decision record](../runbooks/add-a-decision-record.md)).

## 2. Get your own worktree

Each piece of work gets its own git worktree on a new branch from `origin/main` (`.claude/skills/ship-pr/SKILL.md` section 1; `CONTRIBUTING.md`, "Working on a change"). Use an absolute path; the skill's Windows notes explain why.

```powershell
git fetch origin
git worktree add <absolute path to the repo>\.claude\worktrees\<name> -b docs/<slug> origin/main
cd <absolute path to the repo>\.claude\worktrees\<name>
```

Branch names start `docs/`, `fix/`, `feat/` or `chore/`; campaign packets use `phase0/<packet>-<slug>`. Never commit to `main`; it is protected.

*Not run for this page:* creating a branch and a worktree is outside the freeze.

## 3. Check the toolchain

From the root of your worktree:

```powershell
node --version
./geldar.ps1 pnpm --version
```

Expected output, as run on 2026-11-16:

```text
v22.23.2
12.15.0
```

If `node` prints another major version, install 22.23.2 first. If the second command fails with a corepack error, read the corepack block at the top of `geldar.ps1` (lines 42 to 54); it names the shim folder it tried to create.

## 4. Install the workspace

```powershell
./geldar.ps1 setup
```

This runs `pnpm install --frozen-lockfile` (`geldar.ps1` line 650). It prints a step header and then pnpm's own install output:

```text
==> pnpm install
```

The lockfile is frozen: if `pnpm-lock.yaml` disagrees with a `package.json`, the install fails instead of rewriting the lockfile. New dependencies are pinned exactly and must be at least two weeks old (`CLAUDE.md`, "Pin exact versions").

*Not run for this page:* the worktree used to write it was already installed.

## 5. Find your way around

The workspace is a pnpm monorepo of TypeScript packages, one Java Gradle project and the compose and SQL files that run them. The parts you meet first:

- `golem/` is the Body: the Minecraft bot, its actions, reflexes and the body benchmark.
- `animus/` and `player-core/` are the Mind. `player-core` holds the live player path; `animus` keeps the thinking loop and forwards older imports to `player-core`.
- `eventsink/` copies the event stream from NATS into Postgres.
- `plugin/` holds the two Java plugins: Geldar-Core for Paper and the identity gate for Velocity.
- `contract/` holds the JSON Schemas every package shares and the code generated from them. Change the schema, never the generated file (`CLAUDE.md`).
- `compose/` holds the Docker Compose stacks; `sql/` the Postgres migrations; `prompts/` the versioned prompt templates.
- `glass/` is the Thought Stream for human viewers; `threshold/` holds the MCP server and the sign-up service for sovereign players.
- `tools/` holds the CLIs behind `geldar.ps1` and the repo gates.
- `docs/` holds the spec, the decisions, the runbooks and this library.

Every folder, with its README, language, test command and build, is in [repo layout](../reference/repo-layout.md). One row per running component, with its owner and documents, is in [components](../reference/components.md). Every `geldar.ps1` verb is in [CLI tools](../reference/cli-tools.md).

## 6. Make a small change and find its documents

Pick something small for your first change: a wrong sentence in a README, a missing link in a runbook, a test name that misleads. If you have nothing yet, practise with a change you will throw away: add one sentence to the end of `CONTRIBUTING.md`, save it, and run

```powershell
git diff --stat
```

Git's summary should name one file, `CONTRIBUTING.md`, with `1 file changed, 1 insertion(+)`. Keep the change until the end of step 7, then undo it with `git restore CONTRIBUTING.md`.

*Not run for this page:* the practice edit was not made, because the freeze allows no edits outside the documentation being written.

Before you edit, look the change up in the [doc-update map](../agents/doc-update-map.md). It answers "if I change X, which documents must change in the same pull request?" Two worked examples, from the map's table:

- You change a failure message in `golem/src/actions/`. The map's `golem/src` row sends you to `golem/README.md`, the [golem-body](../reference/golem-body.md) reference, the [body-and-mind](../concepts/body-and-mind.md) concept and [failure-modes](../operations/failure-modes.md). It also warns that Body failure text is read by agents in the world.
- You add a document under `docs/`. The map's last rows send you to its section `README.md` index and to [docs/README.md](../README.md).

That warning matters. Some text in this repo is read by agents playing in the world: prompts, MCP tool text, Body failure text, persona files. Such text must never tell an agent it is watched. Documents about observation carry `audience: agents-never` and are never linked from those paths. The list of agent-read paths is in the [documentation style](../agents/documentation-style.md#paths-an-agent-reads) rules; read it before you touch any of them.

For a documentation change, also follow the [style rules](../agents/documentation-style.md): the metadata block, one document type per page, evidence for every claim.

## 7. Run the fast checks

For a documentation change, the gate that reads every file is the repo check. Run it:

```powershell
./geldar.ps1 pnpm check:repo
```

On 2026-11-16 at `283d5d2d`, with this library's uncommitted pages in the tree, it took about 3 seconds and ended like this (warnings trimmed):

```text
warning: tools/mcp-tokens/src/cli.ts has 545 lines (cap 500)
info: compose/colo.yml has 746 lines, exempt from the line cap (cap 900): ...
repo checks: ok
```

A `warning:` line is a file over the 500-line soft cap; it does not fail the run. `info:` lines name the files with a listed exemption. Anything else that fails prints its reason and the run exits non-zero. The gates it runs (line endings, control characters, IP literals, MCP-token shapes, the decision index and others) are listed in [repo checks](../reference/repo-checks.md).

For a code change, run the tests of the package you touched, then typecheck and lint:

```powershell
./geldar.ps1 pnpm test player-core
./geldar.ps1 pnpm typecheck
./geldar.ps1 pnpm lint
```

The test run filters one Vitest run to a path (`CLAUDE.md`, "Commands"). On 2026-11-16 at `283d5d2d` the first command ended with:

```text
 Test Files  5 passed (5)
      Tests  38 passed (38)
```

*Typecheck and lint were not run for this page.* They cover the whole workspace.

A behaviour change needs a test that fails when the change is reverted. Revert your change, run the test, watch it fail, then restore the change (`CLAUDE.md`, "Repo rules").

You now have a green local check on your change (or on the practice edit, which you can now undo with `git restore CONTRIBUTING.md`). That is the working result of this tutorial.

## 8. Know what the full check covers

Before you push a code change, run the full local check:

```powershell
./geldar.ps1 check
```

It runs, in order and stopping at the first failure (`Invoke-Check`, `geldar.ps1` lines 143 to 191): a read of `shards/colo.yaml`, Biome lint, typecheck, every Vitest test, the repo checks, the generated-code drift check, `docker compose config` on every stack and on each overlay merge, and the Gradle build of both plugins. Each step prints a `==> <step>` header, and a green run ends with `All checks passed.`

*Not run for this page.* It builds the plugins and runs the whole test suite; only the fast checks of step 7 were run. If your machine lacks Docker or a JDK, the run stops at the first compose or Gradle step: run the fast checks, push, and let CI run the rest.

The full check is **not** everything CI runs. CI (`.github/workflows/ci.yml`) has seven jobs. Besides what `check` runs, CI also:

- applies every migration to a real Postgres and runs the `sql/test/check-schema*.sql` scripts (job `sql`);
- builds the eventsink and MCP images (job `images`);
- runs the `*.it.test.ts` integration tests against a real Postgres, NATS and eventsink (job `integration`);
- validates the public Caddy site files and runs the Caddy adapt test (job `compose`);
- runs `geldar.ps1 pnpm --version` on Linux (job `typescript`).

So a green local `check` does not prove a migration, a Dockerfile or an integration path. Say in your pull request what you could not run. The full job list is in [CI workflows](../reference/ci-workflows.md#compared-with-geldarps1-check); see also conflict 1 below.

## 9. Ship it

The `ship-pr` skill (`.claude/skills/ship-pr/SKILL.md`) is the procedure from worktree to merged pull request. In outline:

1. Before you push: the check passes, a behaviour change has its revert-proof test, contract changes are regenerated, versions are pinned, and a settled open question has a decision record.
2. Push the branch and open the pull request against `main`. Its body follows `.github/pull_request_template.md`: what changed and why, the test plan, docs and decisions, related work.
3. Wait for CI with one blocking call, `gh pr checks <PR> --watch --fail-fast`; never poll in a loop. CI is green when `ci gate`, the one check `main` requires, passes.
4. Get a review from someone (or an agent) who did not write the change.
5. Ask for a human approval in the developer Discord channel once CI is green and the review says ship, and wait for a rostered reviewer's reaction with `node tools/discord-bridge/wait-approval.mjs <message ID> --pr <PR>` (decision [0445](../decisions/0445-human-approval-in-discord-before-merge.md)). Merge only when `ci gate` is green, the review says ship, the PR has that approval for its current head and the owner asked for the merge. Never use `--admin` around a red check.
6. Remove your worktree after the merge. Check `git -C <worktree> status --short` first: `git worktree remove --force` discards anything uncommitted.

*Not run for this page:* nothing was pushed or merged.

## Conflicts recorded

1. **Does `check` run everything CI runs?** `CLAUDE.md` ("everything CI runs"), the `geldar.ps1` usage text ("Every check CI runs, in CI's order", line 12) and [repo layout](../reference/repo-layout.md) ("Everything CI runs") say yes. `CONTRIBUTING.md` and the `ship-pr` skill say it runs what CI runs "except jobs whose tools you lack locally". The `ci.yml` header (lines 5 and 6) says CI mirrors `check` "except the `sql` job". The code says neither: `Invoke-Check` never runs the `sql`, `images` or `integration` jobs, `deploy/caddy/validate.sh`, the Caddy adapt test or the Linux `pnpm --version` step, whatever tools you have. [CI workflows](../reference/ci-workflows.md#conflicts-recorded) records the same gap as its conflict 2. This page follows the code. Fixing the usage text and the rule files is a follow-up for their owners.

## Where to go next

- Bring up the local stack: [your first shard](first-shard-on-your-machine.md).
- Follow one action from a thought to the database: [trace one action](trace-one-action.md) **(a-n)**. Links marked **(a-n)** go to `agents-never` documents: never copy, quote or link them from a path an agent reads ([documentation style](../agents/documentation-style.md#agents-never-learn-they-are-watched)).
- The design in one page: [system overview](../architecture/system-overview.md).
- Every `geldar.ps1` command and option: [CLI tools](../reference/cli-tools.md).
