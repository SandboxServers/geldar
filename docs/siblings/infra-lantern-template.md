---
title: Infra, Lantern, template and experiments repos
type: reference
audience: contributors
status: draft
last_verified: 2026-11-16 against 283d5d2d
companions: [README.md, scriptorium.md, ../concepts/sovereign-players.md, ../reference/glossary.md, ../reference/spec-section-map.md]
sources: [docs/spec.md, docs/decisions/0004-phase0-repo-layout.md, docs/reference/glossary.md, lantern-local, .claude/agent-memory/main-session/reference_sandboxservers_repos_2026_11_08.md, docs/analysis/docs-library/plan.md, docs/analysis/genesis/README.md]
---

# Infra, Lantern, template and experiments repos

Four sibling repos: what each holds, what is empty, and how this repo relates to it. Each was read on 2026-11-16 from its local clone, read-only, with `git -C <repo> log -1 --format=%h <ref>` and `git -C <repo> ls-tree -r -l <ref>`. Nothing was fetched; a remote-tracking ref is as old as the clone's last fetch. The [sibling map](README.md) puts them beside the other three.

## Summary

| Repo | Ref read | Tracked files | Empty? | Agent-read |
|---|---|---|---|---|
| `geldar-infra` | `origin/main` 9f06cd7 (2026-11-08) | 1 (`README.md`, 14 bytes, a title) | Yes on `main`; one document on a branch | No |
| `geldar-lantern` | `origin/main` 77ac776 (2026-11-08) | 1 (`README.md`, 16 bytes, a title) | Yes | No |
| `geldar-player-template` | `origin/main` 88223ba (2026-11-14) | 40 | No | Yes |
| `geldar-experiments` | `origin/main` a8c1b2e (2026-11-08) | 1 (`README.md`, 20 bytes, a title) | Yes | No |

## geldar-infra

| Field | Value |
|---|---|
| Purpose in the spec | Spec 6.6 puts `infra/` (Envoy, Velocity, nftables and step-ca configs) inside this repo. The separate repo is not in the spec. |
| `main` | `README.md` only. |
| Other refs | Branch `docs/release-identity` (bafe5e7, 2026-11-08, also on `origin`) adds `docs/release-identity.md`, 3337 bytes, not merged. |
| What that document covers | How the Scriptorium release workflow gets permission to publish the template without a long-lived secret in GitHub: a GitHub App installed on the template repo only, its credentials held in a cloud secret store, and a federated sign-in for the workflow that may read those two values and nothing else. It cites Scriptorium campaign decision D-SC-02. Names, regions and secret names are left out of this page. |
| Consumer | Scriptorium `.github/workflows/publish-template.yml` (lines 73 to 97 at 8c4d1ff) reads the App's credentials from the secret store. |
| This repo | Has no `infra/` folder (`ls`, 2026-11-16). Decision [0004](../decisions/0004-phase0-repo-layout.md) keeps Phase 0 here and defers whether `infra/` moves out until Phase 2. Nothing here refers to `geldar-infra` outside docs and memory (`git grep geldar-infra`, 2026-11-16). |
| Agent-read | No: in scriptorium `origin/main` only three campaign files under `docs/analysis/scriptorium/` name it, and nothing in the template does (`git grep -i geldar-infra` over both, 2026-11-16). |

## geldar-lantern

| Field | Value |
|---|---|
| Purpose in the spec | Spec 6.6: `lantern/`, "the Patron bundle: Go binary, compose file, README (signed releases)", inside this repo. Spec 2a and the [glossary](../reference/glossary.md) name Lantern as the Thinker bundle a Patron runs. |
| `main` | `README.md` only, a title. |
| Other refs | None (`git branch -a`). |
| This repo | Phase 0 runs a local Thinker in [`lantern-local/`](../../lantern-local) (decision [0004](../decisions/0004-phase0-repo-layout.md); glossary, "Lantern"). Whether `lantern/` moves to its own repo is decided before Phase 2 (decision 0004). |
| Agent-read | No. |

## geldar-player-template

| Field | Value |
|---|---|
| Purpose in the spec | Spec 6.6 and 5.15.4: the GitHub template each sovereign player's repo, `player-<name>`, is created from. Spec 2a names it Scriptorium. |
| How it is filled | Only by Scriptorium releases: each release publishes Scriptorium's `template/` as one commit, and nobody edits this repo by hand (Scriptorium `docs/release.md`). See [scriptorium](scriptorium.md#what-it-makes). |
| `origin/main` | 88223ba, "release kit-v0.1.0-rc20", 2026-11-14. 19 commits. |
| Local `main` | cd7815c, the initial commit (2026-11-08). The clone was never fast-forwarded. |
| Tags | 18, `kit-v0.1.0-rc2` to `kit-v0.1.0-rc20`, with no rc1 or rc6; none stable. Scriptorium's clone has tags to rc22, so the template clone may be behind GitHub (unverified). |
| Files at 88223ba | `README.md` (the guide for the person who runs a player, 7684 bytes); `CLAUDE.md` and `AGENTS.md` (3193 bytes each); `.mcp.json` (three servers: the world server `geldar` over HTTP, and two local kit servers for memory and git); `player.json` (keys: player id, name, shard, MCP URL, harness, declared model, kit version, kit image); `.claude/` with 3 agent files, 4 hook scripts, `settings.json` and 18 skill files; `memory/` with six starter entries, among them `identity.md` and `goals.md`; `skills/README.md`; `.gitattributes` and `.gitignore`. |
| Documents | Its `README.md` is the player guide. This repo's [player guide](../players/README.md) covers sign-up and the world side. |
| This repo | The `.mcp.json` and `player.json` point a player's CLI at this repo's MCP server ([sovereign players](../concepts/sovereign-players.md)). |
| Agent-read | **Yes.** Every file is copied into a player repo and read by the agent's CLI session ([paths an agent reads](../agents/documentation-style.md#paths-an-agent-reads)). This page lists files and keys only and quotes none of them (plan decision D2). |
| Observation terms | A read-only `git grep -i` over `origin/main` for observation and research words on 2026-11-16 found no hits. The word list is not reproduced here (style rule 5). |

## geldar-experiments

| Field | Value |
|---|---|
| Purpose in the spec | None. Spec 6.6 puts `experiments/` under `docs/` in this repo ("this spec, threat model, runbooks, ethics.md, experiments/ ..."). |
| `main` | `README.md` only, a title. |
| Other refs | None. |
| This repo | No `docs/experiments/` folder (`ls`, 2026-11-16). No file outside docs and memory names the repo. |
| Agent-read | No. |

## Conflicts recorded

1. **Layout.** Spec 6.6 puts `infra/` and `lantern/` in this repo; the organisation has empty `geldar-infra` and `geldar-lantern` repos; decision 0004 defers the choice to Phase 2. A third voice: the genesis campaign's owner decision D-GN-09 (2026-11-14, [genesis README](../analysis/genesis/README.md)) keeps the Azure deployment pieces in this repo under `deploy/genesis/azure/` "for now", not in `geldar-infra`. That ruling covers the Azure pieces only and is a campaign row, not a decision record. No record decides the layout as a whole.
2. **"Near-empty."** The [plan](../analysis/docs-library/plan.md#5-documents) row X03 and the repo memory note `reference_sandboxservers_repos_2026_11_08.md` call `geldar-player-template` an empty stub. That was true of its first commit; `origin/main` has 40 files since the releases began.
3. **Template privacy.** Spec 5.15.4 says player repos are private while the player lives by default; the Scriptorium launcher makes them public unless told otherwise ([scriptorium, conflict 2](scriptorium.md#conflicts-recorded)).
