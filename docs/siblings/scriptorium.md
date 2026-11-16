---
title: Scriptorium
type: explanation
audience: contributors
status: draft
last_verified: 2026-11-16 against 283d5d2d
companions: [README.md, infra-lantern-template.md, ../concepts/sovereign-players.md, ../runbooks/mcp-tokens.md, ../reference/spec-section-map.md, ../reference/glossary.md]
sources: [docs/spec.md, docs/concepts/sovereign-players.md, docs/agents/documentation-style.md, docs/decisions/0004-phase0-repo-layout.md, docs/decisions/0033-mock-wake-and-interest-vocabulary.md, docs/decisions/0034-mock-result-shapes-and-untrusted-text.md, docs/decisions/0035-mcp-tool-schema-shapes.md, docs/decisions/0036-launcher-workspace-named-volume.md, docs/decisions/0042-path-rule-case-folded-identity-prefix.md, docs/decisions/0044-malicious-book-corpus-world-side.md, docs/decisions/0045-live-malicious-book-check-is-local-only.md, docs/decisions/0046-scripted-stub-cli-stands-in-for-the-vendor-cli-in-ci.md, docs/decisions/0053-public-mcp-through-an-outbound-tunnel-deferred.md, docs/decisions/0060-persona-size-limits.md, docs/decisions/0185-per-turn-record-for-kit-minds.md, docs/decisions/0186-character-sheet-assumed-answers.md, docs/decisions/0281-psyche-package-boundary.md, psyche/README.md, threshold/mcp/src/tools/wait.ts, .github/workflows/mcp-mock-image.yml, tools/mcp-tokens/src/persona-export.ts]
---

# Scriptorium

`geldar-scriptorium` is the sibling repo that builds the kit for sovereign players: people who run a Geldar agent as a session of a vendor's CLI on their own subscription, with the agent's memory in its own git repo ([sovereign players](../concepts/sovereign-players.md)). This page explains what the repo makes, how its parts fit, how a player built with it reaches this repo, and where its documents and this repo's disagree. It is a summary written here under plan decision D2; it quotes no kit, template, skill or identity text, because agents read those files.

All sibling facts below come from the clone's remote-tracking `origin/main` at **8c4d1ff** (2026-11-15), read on 2026-11-16 with `git -C geldar-scriptorium show origin/main:<path>`, unless another ref is named. The clone itself is checked out on `docs/scriptorium-campaign` (30a3c1a, 2026-11-08), and `git status` there shows untracked top-level folders (`.agents/`, `.claude/`, `.codex/`, `packages/`, `tools/`, `node_modules/`) and untracked documents under `docs/`. Its working tree is neither `main` nor a clean branch, so it is not used as a source. Nothing was fetched.

## What it makes

The repo's `README.md` and `docs/architecture.md` name three outputs, released together as one tag `kit-vX.Y.Z` (`docs/release.md`):

| Output | Built from | Published as |
|---|---|---|
| The template: the player-facing files of a player repo | `template/` (with `template-src/` as its source notes) | Commits to `geldar-player-template`, one per release; nobody edits that repo by hand |
| The kit image: the companion MCP servers, the bundle verifier, the egress proxy and the pinned vendor CLI | `packages/`, `image/` | A container image, signed, pinned by digest in each player's `player.json` |
| The launcher `geldar-play`, in bash and PowerShell with the same verbs | `launcher/` | Signed release assets |

Since wave 14 the repo also builds a **persistent player**: a compose group per player (`image/compose/player.yml`) with a supervisor that runs sessions, a keeper that pushes accepted history, and two egress proxies (scriptorium `docs/analysis/scriptorium/RESUME.md`, packages `supervisor` and `keeper`). A `fleet/` folder holds the scripts that place such groups on a Linux VM (`fleet/README.md`).

The kit supports Claude Code by default and, since the repo's own decision `docs/decisions/0001-chatgpt-subscription-provider.md` (2026-11-13), a ChatGPT subscription provider for persistent players. The Codex CLI stays refused (`launcher/README.md`, "`--cli codex` remains refused").

## Packages

`origin/main` has eight workspace packages under `packages/`. Each is `private` at version 0.1.0 (`package.json` of each).

| Package | Binary | What it does (from its README or `package.json` description) |
|---|---|---|
| `path-rule` | none | The one path rule, the session modes `play` and `setup`, and the noreply git identity, shared by the next three so they cannot drift |
| `memory` | `geldar-memory` | A read-only MCP server with one tool, `recall`, for the character's own memory files; results are capped at 16384 bytes |
| `git` | `geldar-git` | The only writer of commits: an MCP server with one tool, `commit_memory`, using git plumbing so hooks and filters never run |
| `verify` | `geldar-verify` | The host's gate on a session bundle: size, ref, fast-forward, path and identity checks, with stable reason ids. Also summarises a CLI transcript for cost and turns |
| `stub-cli` | `claude` (stub) | A scripted stand-in for the vendor CLI in CI; never shipped (decision [0046](../decisions/0046-scripted-stub-cli-stands-in-for-the-vendor-cli-in-ci.md)) |
| `chatgpt` | none listed | The ChatGPT subscription provider ("Subscription-backed Geldar minds through Sign in with ChatGPT"); no README |
| `keeper` | `geldar-keeper`, `geldar-keeper-connect` | The persistent player's push loop: fetches the workspace history, runs `geldar-verify`, pushes fast-forward only, and holds on any refusal. The second binary is its SSH `ProxyCommand` helper |
| `supervisor` | `geldar-supervisor` | "The run loop inside the player container"; no README |

The integration branch `scriptorium/hw0` (673d756, 2026-11-15) adds four more: `mind-loop`, `local`, `psyche` and `instinct`. They belong to the harness campaign below and are not on `main`.

Tools outside `packages/`: `tools/repo-checks` (repo gates and the CI scope rules), `tools/release` (launcher packaging and template publishing), `tools/live-check` (rules and evaluation for the owner-run live check) and the task runner `scriptorium.ps1` (`setup`, `pnpm`, `check`).

## How a sovereign player reaches Geldar

```mermaid
sequenceDiagram
  participant P as Person (Patron)
  participant L as geldar-play
  participant S as Session container<br/>(vendor CLI, memory and git servers)
  participant X as Egress proxy
  participant M as Geldar MCP<br/>(threshold/mcp, this repo)
  participant G as geldar-verify
  participant R as Player repo
  P->>L: new, then setup (or a seeded persona), then play
  L->>S: workspace in a named volume, kit exported read-only
  S->>X: every outbound request
  X->>M: world tool calls, bearer token for one player
  Note over M: actions go to a Body in the Colo
  S-->>L: session ends; commits made by geldar-git
  L->>G: bundle checked with no network
  G-->>L: accept or reject with a reason id
  L->>R: push the verified commit, then fast-forward on the host
```

1. **Make the player.** `geldar-play new <id>` creates `player-<id>` from the template; `setup` runs a one-time session that writes the birth commit. An owner can instead pass `--persona-dir` with an `identity.md` and `goals.md`, which makes a player already born (`launcher/README.md`). This repo's `tools/mcp-tokens` exports those two files ([`persona-export.ts`](../../tools/mcp-tokens/src/persona-export.ts); size limits in decision [0060](../decisions/0060-persona-size-limits.md)).
2. **Give it a door.** The player's `player.json` holds the world's MCP URL and the kit pins; the world token reaches the session only through the environment (`docs/onboarding.md`, "Token files"). Operators mint tokens here ([MCP tokens runbook](../runbooks/mcp-tokens.md) **(a-n)**, an `agents-never` document: never link it from a path an agent reads).
3. **Play.** The session container has an internal network with no DNS; a proxy allows only the vendor's API and the world's host and port (`docs/architecture.md`; `launcher/README.md`, "The world values"). The world is this repo's MCP server, which forwards actions to a Body in the Colo ([sovereign players](../concepts/sovereign-players.md#how-it-is-built)).
4. **Save.** At the end, `geldar-git` has made the commits, a network-less container bundles them, `geldar-verify` checks them against the path rule and the start commit, and only then does the host push. The workspace is a named Docker volume, never a bind mount (decision [0036](../decisions/0036-launcher-workspace-named-volume.md)). The identity file cannot be replaced, even through a case-folded prefix (decision [0042](../decisions/0042-path-rule-case-folded-identity-prefix.md)).

Settings come in layers: managed settings in the image deny shell and web tools and reads outside the workspace; the template's project settings allow the world, memory and git tools and edits under `memory/` and `skills/`; mode files for `play` and `setup` lock the identity file or the world tools (`docs/architecture.md`, "Settings layers"). The gate re-checks the same path rule, so a settings mistake is caught twice.

## Interfaces to this repo

| Interface | This repo | Scriptorium | Evidence |
|---|---|---|---|
| World MCP | `threshold/mcp`: tools, prompts and resources for one player per URL | Every session's world tools | [sovereign players](../concepts/sovereign-players.md); decisions [0033](../decisions/0033-mock-wake-and-interest-vocabulary.md), [0034](../decisions/0034-mock-result-shapes-and-untrusted-text.md), [0035](../decisions/0035-mcp-tool-schema-shapes.md) |
| Mock world in CI | `threshold/mcp-mock`, pushed as an image by `.github/workflows/mcp-mock-image.yml` | `tests/e2e/world.ts` line 27 pins the image by digest; `tests/e2e/malicious-world.test.ts` uses its malicious scenarios | Decisions [0044](../decisions/0044-malicious-book-corpus-world-side.md), [0046](../decisions/0046-scripted-stub-cli-stands-in-for-the-vendor-cli-in-ci.md) |
| Live malicious-book check | The world-side corpus | `tools/live-check`, run by the owner locally, never in CI | Decision [0045](../decisions/0045-live-malicious-book-check-is-local-only.md) |
| Dev world on the host | MCP `Host` validation accepts the Docker host alias and loopback on the dev port | The launcher's `GELDAR_DEV_MCP_URL` seam | Decision [0053](../decisions/0053-public-mcp-through-an-outbound-tunnel-deferred.md) point 3; `launcher/README.md` |
| `wait` cap | `MAX_WAIT_SECONDS = 240`, commented as "the Scriptorium constraint" | Sessions call `wait` | [`wait.ts`](../../threshold/mcp/src/tools/wait.ts) lines 26 and 27 |
| Psyche mirror | `psyche/src`, released as `psyche-v<version>` with a tree hash | `packages/psyche` and its mirror test, on `scriptorium/hw0` only | `psyche/README.md` line 3; decision [0281](../decisions/0281-psyche-package-boundary.md) |
| Persona files | `tools/mcp-tokens` persona export | `geldar-play new --persona-dir` | Decision [0060](../decisions/0060-persona-size-limits.md) |
| Register and fleet | `threshold/register` writes roster rows | The fleet campaign plans a `deploy-player` dispatch from the registration side | Scriptorium `docs/analysis/fleet/README.md`, design rule 7. Not built: no such caller in `threshold/register` (`git grep`, 2026-11-16) |
| Decisions | Scriptorium decisions that touch the spec are filed in this repo's `docs/decisions/` | Scriptorium `CLAUDE.md` repo rules; `docs/decisions.md` | The status lines of decisions 0036, 0042 and 0046 say each was supplied or requested by the Scriptorium orchestrator and filed by this repo's orchestrator |

There is no NATS link and no import of this repo's contract package (`git grep` over scriptorium, 2026-11-16; see the [sibling map](README.md#interfaces-in-detail)).

## Build, test and release, as its docs say

- **Toolchain.** pnpm workspace, Node 22 from `.nvmrc`, TypeScript, Biome, Vitest; `./scriptorium.ps1 setup` then `./scriptorium.ps1 check` (scriptorium `CLAUDE.md`, `README.md`). Same pinning, line-cap and LF rules as this repo.
- **CI.** `.github/workflows/ci.yml` scopes jobs by changed paths and fails open; one required check, `ci gate` (`docs/ci.md`). Linux-only tests can run in a container (`docs/linux-tests.md`).
- **Release.** `release.yml` runs on a `kit-v*` tag: build and push the image, sign it, make an SBOM, scan it, sign the launcher, then publish the template as one commit naming the release triple; `publish-template.yml` then makes the matching release in the template repo (`docs/release.md`). A separate `image-scan.yml` exists.
- **Upgrades.** A player never gets a release pushed into its repo; `geldar-play upgrade` opens a pull request the owner merges, and memory is never touched (`docs/release.md`).
- **Tags.** The clone has 22 tags, newest `kit-v0.1.0-rc22`; none is a stable release (`git -C geldar-scriptorium tag`, 2026-11-16).

## Its documents

| Area | Files |
|---|---|
| Top level | `README.md`, `CLAUDE.md`, `AGENTS.md`, `SECURITY.md` |
| `docs/` | `architecture.md`, `onboarding.md` (owner and developer setup), `troubleshooting.md` (every launcher message), `release.md`, `ci.md`, `linux-tests.md`, `threat-model.md`, `launcher-hardening.md` (the H-NN checklist), `chatgpt.md`, `clients.md`, `decisions.md`, `decisions/0001-chatgpt-subscription-provider.md` |
| Component READMEs | `launcher/`, `image/`, `image/proxy/`, `fleet/`, `template-src/`, and six of the eight packages |
| The player guide | `template/README.md`, published with the template |
| `docs/analysis/` (46 files) | `scriptorium/`: the kit campaign ledger, wave packets 3 to 14, a resume card and 15 worknotes, including a numbered decision log (`worknotes/overnight-decisions.md`). `harness/`: a planning ledger, written 2026-11-14, for one Mind across Claude, ChatGPT and local models, with character sheets. `fleet/`: player hosts on a Linux VM |

## Agent-read surfaces

The template reaches an agent's session: every file is copied into a player repo (spec 5.15.4; [paths an agent reads](../agents/documentation-style.md#paths-an-agent-reads)). The image settings and the tool text in `packages/` reach it too; that is inferred from the architecture above, not checked file by file, and the paths-an-agent-reads table does not list them yet ([sibling map, debt](README.md#debt)). The repo's own `CLAUDE.md` forbids developer notes in `template/`. The tests `tests/template/knowledge-boundary.test.ts` and `tests/template/tool-skill-scan.ts` exist on `origin/main`; their contents are not summarised here. Everything else in the repo, `docs/analysis/` included, is for developers and the owner, and is public.

## Known gaps

1. **Stale architecture page.** `docs/architecture.md` lists "The five packages"; `origin/main` has eight.
2. **Stale client table.** `docs/clients.md` (last checked 2026-11-08) has no ChatGPT row; `README.md` and `docs/chatgpt.md` describe ChatGPT as supported for persistent players.
3. **Two packages without a README:** `chatgpt` and `supervisor`.
4. **Resume card behind its tags.** `docs/analysis/scriptorium/RESUME.md` gives state as of 2026-11-12 with `kit-v0.1.0-rc11`; tags run to rc22.
5. **Harness campaign not on `main`.** `mind-loop`, `local`, `psyche` and `instinct` exist only on `scriptorium/hw0` and feature branches; the psyche mirror this repo's `psyche/README.md` describes is therefore not in a released kit (inferred from the refs above).
6. **Fleet trigger unbuilt** on this repo's side (interfaces table).

## Conflicts recorded

Three numbering schemes meet here. Geldar records are numbered files in this repo's `docs/decisions/`. Scriptorium's own records are `docs/decisions/0001-...` in its repo. "Scriptorium decision 78" is a row in its worknote decision log (`docs/analysis/scriptorium/worknotes/overnight-decisions.md`), not a record.

1. **Geldar records 0007 to 0016 that Scriptorium cites.** Scriptorium `docs/decisions.md` links ten records, 0007 to 0016, in this repo's `main`. None exists on `main` here at 283d5d2d (`ls docs/decisions` jumps from 0006 to 0020). They exist on the unmerged branch `docs/scriptorium-decisions` (first commit 950e394a, 2026-11-08; `git merge-base --is-ancestor 950e394a HEAD` fails). Decision [0036](../decisions/0036-launcher-workspace-named-volume.md) cites "decision 0011" from that set. Its other docs cite records from the same set as "geldar 0008", "0011", "0013" or "0015" (`docs/release.md`, `launcher/README.md`, `docs/onboarding.md`, `docs/architecture.md`).
2. **Player repos public or private.** Spec 5.15.4: a player repo is private while the player lives, by default. Scriptorium `docs/onboarding.md`, "Repository visibility": `new` makes the repo public unless `--private` is given, citing geldar decision 0013, which is not on `main` here (conflict 1).
3. **Where Scriptorium lives.** Spec 2a names Scriptorium as `geldar-player-template` and spec 6.6 lists no `geldar-scriptorium`. The kit is developed in `geldar-scriptorium` and published to the template (its `README.md`). Its `CLAUDE.md` (line 7) and `docs/decisions.md` (line 12) cite geldar decision 0014 for this, also not on `main` here.
4. **The in-house Mind.** Scriptorium `docs/analysis/harness/README.md` records an owner ruling of 2026-11-14 that the in-house Mind (`animus/`) "is abandoned" and the kit is the one Mind. Decision [0185](../decisions/0185-per-turn-record-for-kit-minds.md) line 10 calls that Mind "frozen". No record on `main` here retires `animus/`; decision [0186](../decisions/0186-character-sheet-assumed-answers.md) cites "scriptorium decision 78" (a worknote row, see above) for the delegation.
5. **Authentication wording.** Scriptorium `docs/architecture.md` says the mock's OAuth "is stubbed by a per-player bearer token" and a later switch to the real server changes only `player.json` and the allowlist. In this repo static bearer tokens are the production design, not a stub (decision 0054, recorded in [sovereign players, conflict 1](../concepts/sovereign-players.md#conflicts-recorded)).

## Unverified

- Whether the remote-tracking refs match GitHub today: nothing was fetched.
- Whether the release workflow's signing and scans ran for each tag: the workflows were read, not their runs.
