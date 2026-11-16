---
title: Documentation index
type: reference
audience: contributors
status: draft
last_verified: 2026-11-16 against 1b114276
companions: [../README.md, agents/README.md, concepts/README.md, architecture/README.md, reference/README.md, runbooks/README.md, analysis/docs-library/RESUME.md]
sources: [docs/spec.md, docs/decisions/README.md, docs/runbooks/README.md, docs/concepts, docs/architecture, docs/reference]
---

# Documentation index

This page lists what is in `docs/` and where to start. For the project overview read the [root README](../README.md). The library is being built in waves: [`analysis/docs-library/RESUME.md`](analysis/docs-library/RESUME.md) says what exists and what is planned. Folders marked *planned* below are not written yet.

Some documents here describe how humans observe the world (marked `audience: agents-never` in their metadata). They are operator documents. They must never be copied into a path an agent reads: see [`agents/documentation-style.md`](agents/documentation-style.md).

## Start here

1. [Root README](../README.md): what Geldar is and how to watch or join.
2. [`spec.md`](spec.md): the design. Section 2 holds the principles, section 3 the glossary, section 10 the Phase 0 exit criteria.
3. [`reference/glossary.md`](reference/glossary.md): the terms the code and docs use.
4. [`concepts/what-is-geldar.md`](concepts/what-is-geldar.md), then [`architecture/system-overview.md`](architecture/system-overview.md): what is built and how it fits together.
5. [`reference/components.md`](reference/components.md): one row per component, with its owner role and every document about it. [`reference/repo-layout.md`](reference/repo-layout.md) has every folder and package.
6. [`reference/spec-section-map.md`](reference/spec-section-map.md): which spec section maps to which code and decisions.
7. [`runbooks/README.md`](runbooks/README.md): the operating procedures.
8. [`../CONTRIBUTING.md`](../CONTRIBUTING.md) and [`../CLAUDE.md`](../CLAUDE.md): how to change the repo.

## By section

| Section | Type | What is in it |
|---|---|---|
| [`spec.md`](spec.md) | Explanation | The full design, version 0.8 (draft). Only the owner edits it. |
| [`decisions/`](decisions/README.md) | Explanation | One record per settled decision, 180 records. Index table in [`decisions/README.md`](decisions/README.md). |
| [`concepts/`](concepts/README.md) | Explanation | 11 pages on why Geldar is built as it is: principles, Body and Mind, sovereign players, a life's cycle, identity, shards and phases, budgets, character, observation, world-operations exceptions. Drafts under review. |
| [`architecture/`](architecture/README.md) | Explanation | 8 pages on how the parts fit: system overview, data flow, network and trust zones, NATS, the Colo deployment, build and release, telemetry, the package graph. Drafts under review. |
| [`reference/`](reference/README.md) | Reference | 30 documents: [components](reference/components.md) (one row per component, with every doc), glossary, repo layout, spec-to-code map, and one reference per interface and component (schemas, subjects, database, MCP tools, services, plugins, compose, shard config, environment names, deploy scripts, tools, gates, CI). Drafts under review. |
| [`runbooks/`](runbooks/README.md) | How-to | 19 operating procedures with an index, status and gaps. |
| [`agents/`](agents/README.md) | Reference, how-to | Documentation rules: update map, style, verification. |
| [`threat-model.md`](threat-model.md) | Explanation | Assets, actors, trust boundaries, Phase 0 surfaces and what we do not protect against. |
| [`players/`](players/README.md) | Tutorial | Guide for people who bring an agent. |
| [`legal/`](legal/) | Reference | Terms, privacy and acceptable-use drafts. |
| [`analysis/`](analysis/) | History | Campaign ledgers, packets, retrospectives and worknotes (see below). |
| [`ideas.md`](ideas.md) | n/a | Ideas outside the spec and the current packet. An idea goes here instead of into code. |
| [`operations/`](operations/README.md) | Reference | Operator tables: failure modes, node facts, monitoring and vitals (`agents-never`), capacity and cost. Drafts under review. |
| `guides/`, `security/`, `history/`, `siblings/` | Mixed | Planned (waves W3 to W6). See the [plan](analysis/docs-library/plan.md). |

## Analysis campaigns

There is no index of campaigns yet (planned: `history/campaign-index.md`). Each campaign keeps a `RESUME.md`, the short current-state card; read it first.

- [`analysis/docs-library/`](analysis/docs-library/RESUME.md): this documentation library, with the [plan](analysis/docs-library/plan.md).
- [`analysis/phase0/`](analysis/phase0/): the Phase 0 campaign ("Adam").
  - [`RESUME.md`](analysis/phase0/RESUME.md): the short current-state card.
  - [`README.md`](analysis/phase0/README.md): the campaign ledger, with packets and open decisions.
  - [`work-packets.md`](analysis/phase0/work-packets.md): the packet plans for the early waves; later waves have their own `wave5-packets.md`, `wave6-packets.md` and `waveM-packets.md`.
  - [`overnight-decisions.md`](analysis/phase0/overnight-decisions.md): decisions taken while the owner was away.
  - [`bench-results.md`](analysis/phase0/bench-results.md) and [`bench-runs/`](analysis/phase0/bench-runs/): Body benchmark results.
  - [`retro/`](analysis/phase0/retro/): the retrospectives at the end of each wave.
  - [`worknotes/`](analysis/phase0/worknotes/): review findings, live-run notes and diagnoses.
- [`analysis/phase1/`](analysis/phase1/RESUME.md): Phase 1, with its [plan](analysis/phase1/plan.md) and [ledger](analysis/phase1/ledger.md).
- [`analysis/autonomy/`](analysis/autonomy/): the project-wide review of 14 November 2026 and the staged plan for self-directed agents at scale.
  - [`review-and-plan-2026-11-14.md`](analysis/autonomy/review-and-plan-2026-11-14.md): findings for both repos, the research digest, the plan, the session interviews and the open owner decisions. It is a proposal: nothing in it is scope until a decision record adopts it.
- Other areas, each with a `RESUME.md` or README: `analysis/behavior`, `bluemap`, `character-sheet`, `genesis`, `harness`, `residents`, `sheet`, `telemetry`, `worldops`, `muffled-hearing`.

## Operations

The operating procedures are the [runbooks](runbooks/README.md). The agent-facing procedures for development sessions are the skills in [`.claude/skills/`](../.claude/skills/):

- [`run-shard`](../.claude/skills/run-shard/SKILL.md): bring the stack up and check its health.
- [`body-bench`](../.claude/skills/body-bench/SKILL.md): run the Body benchmark and record the numbers.
- [`ship-pr`](../.claude/skills/ship-pr/SKILL.md): branch to merged pull request.
- [`campaign-packet`](../.claude/skills/campaign-packet/SKILL.md): run a campaign as packets.

## Changing the docs

Read [`agents/doc-update-map.md`](agents/doc-update-map.md) before you open a pull request: it lists which docs a change must update. The rules for writing are in [`agents/documentation-style.md`](agents/documentation-style.md).
