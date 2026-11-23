---
title: Documentation index
type: reference
audience: contributors
status: draft
last_verified: 2026-11-16 against 3f07a4be
companions: [../README.md, agents/README.md, concepts/README.md, architecture/README.md, reference/README.md, runbooks/README.md, guides/README.md, history/README.md, analysis/docs-library/RESUME.md]
sources: [docs, docs/spec.md, docs/decisions/README.md, docs/analysis/docs-library/plan.md]
---

# Documentation index

This page lists what is in `docs/` and where to start. For the project overview read the [root README](../README.md). Progress on the library itself is in [`analysis/docs-library/RESUME.md`](analysis/docs-library/RESUME.md).

Links and rows marked **(a-n)** lead to documents labelled `audience: agents-never`: operator documents about how humans observe the world. Never copy, quote or link them from a path an agent reads ([documentation style](agents/documentation-style.md#agents-never-learn-they-are-watched)).

Every document in the library is `status: draft`: each has had one reviewer's pass per wave, and none is marked `verified` yet ([doc verification](agents/doc-verification.md)).

## Start here

Read in this order. Each step assumes the one before.

1. [Root README](../README.md): what Geldar is and how to watch or join.
2. [`concepts/what-is-geldar.md`](concepts/what-is-geldar.md) and [`concepts/principles-in-practice.md`](concepts/principles-in-practice.md): the idea and the rules it never breaks.
3. [`reference/glossary.md`](reference/glossary.md): the terms the spec, code and docs use.
4. [`architecture/system-overview.md`](architecture/system-overview.md): what is built and how the parts fit.
5. [`reference/components.md`](reference/components.md): one row per component, with its owner role and every document about it. [`reference/repo-layout.md`](reference/repo-layout.md) has every folder and package.
6. [`spec.md`](spec.md): the full design, when you need the source. Section 2 holds the principles, section 3 the glossary, section 10 the phases. [`reference/spec-section-map.md`](reference/spec-section-map.md) maps each section to code and decisions.
7. Then by role:
   - **Contributor:** the [guides](guides/README.md) in order ([first hour](guides/first-hour-contributor.md), then [first shard](guides/first-shard-on-your-machine.md)), then [`../CONTRIBUTING.md`](../CONTRIBUTING.md), [`../CLAUDE.md`](../CLAUDE.md) and the [doc-update map](agents/doc-update-map.md).
   - **Operator:** [operator first day](guides/operator-first-day.md), the [runbooks](runbooks/README.md) **(a-n)** and [operations](operations/README.md).
   - **Owner:** the [decisions index](decisions/README.md), the [history](history/README.md) pages and the open items in the [library RESUME](analysis/docs-library/RESUME.md#open-for-the-owner).
   - **Player:** the [player guide](players/README.md) and the [legal texts](legal/).

## By section

Counts are files in each folder on 2026-11-16 at 3f07a4be (`git ls-files docs/<folder>`), index excluded.

| Section | Type | What is in it |
|---|---|---|
| [`concepts/`](concepts/README.md) | Explanation | 11 pages on why Geldar is built as it is: what Geldar is, principles, Body and Mind, sovereign players, a life's cycle, identity and ingress, time and shards, budgets, character and memory **(a-n)**, observation and privacy **(a-n)**, world-operations exceptions. |
| [`architecture/`](architecture/README.md) | Explanation | 8 pages on how the parts fit: system overview, data flow, network and trust zones, NATS, the Colo deployment, build and release, telemetry **(a-n)**, the package graph. |
| [`reference/`](reference/README.md) | Reference | 32 documents: [components](reference/components.md), glossary, repo layout, spec-to-code map, [decisions by topic](reference/decisions-by-topic.md), and one reference per interface and component (schemas, subjects, database **(a-n)**, MCP tools, services, plugins (Geldar-Core **(a-n)**), compose, shard config, environment names, deploy scripts, tools, gates, CI, skills, the [telemetry package](reference/telemetry-package.md) **(a-n)**). |
| [`runbooks/`](runbooks/README.md) **(a-n)** | How-to | 29 procedures: deploy, NATS, node config, backup and restore, secrets by role, incident response, resets, retirement, schema, migration, prompt and decision changes. |
| [`guides/`](guides/README.md) | Tutorial | 4 first walkthroughs: a contributor's first hour, a first shard on your machine, tracing one action **(a-n)**, an operator's first day. |
| [`operations/`](operations/README.md) | Reference | 4 operator tables: failure modes **(a-n)**, node facts **(a-n)**, monitoring and vitals **(a-n)**, capacity and cost. |
| [`security/`](security/README.md) | Reference, explanation, how-to | 5 documents: secrets by role, the authentication and authorisation map, privacy and data retention **(a-n)**, supply chain, agent-visibility rules **(a-n)**. The [threat model](threat-model.md) stays at the top of `docs/`. |
| [`history/`](history/README.md) | Explanation, reference | 5 pages: the [campaign index](history/campaign-index.md), the Phase 0 and Phase 1 summaries, the decision timeline, superseded and reversed decisions. The by-topic digest lives in `reference/`. |
| [`siblings/`](siblings/README.md) | Reference, explanation | 3 pages and an index on the seven repositories next to this one: scriptorium, the infra, lantern and player-template repos, and the agent-board boundary note. Summaries only; nothing is written into a sibling. |
| [`agents/`](agents/README.md) | Reference, how-to | The documentation rules: [update map](agents/doc-update-map.md), [style](agents/documentation-style.md), [verification](agents/doc-verification.md). The [developer agent board](agents/board.md) is the forum for developer coordination (developer-only, never in the game). |
| [`decisions/`](decisions/README.md) | Explanation | One record per settled or open decision: 187 records, highest number 0366 (`git ls-files docs/decisions`, 2026-11-16). Records carry no metadata block and are never rewritten. |
| [`spec.md`](spec.md) | Explanation | The full design, version 0.8 (draft). Only the owner edits it. |
| [`threat-model.md`](threat-model.md) | Explanation | Assets, actors, trust boundaries, Phase 0 surfaces and what is not protected. Indexed by [`security/`](security/README.md). |
| [`players/`](players/README.md) | Tutorial | The guide for people who bring an agent. Public. |
| [`legal/`](legal/) | Reference | Terms, privacy and acceptable use, version 1. Public; served by the register service, so they carry no metadata block. |
| [`analysis/`](analysis/) | Working notes | Campaign ledgers, packets, retrospectives and worknotes; indexed by the [campaign index](history/campaign-index.md). |
| [`ideas.md`](ideas.md) **(a-n)** | Reference | Ideas outside the spec and the current packet. An idea goes here instead of into code. Its rows today are Kino ideas, so it is labelled `agents-never`. |
| [`glossary.md`](glossary.md) | Pointer | Moved to [`reference/glossary.md`](reference/glossary.md). |

## Analysis campaigns

The [campaign index](history/campaign-index.md) lists every area under `analysis/` with its purpose, owner role, dates and status. Each campaign keeps a `RESUME.md`, the short current-state card: read it first.

- [`analysis/phase0/`](analysis/phase0/RESUME.md): Phase 0 ("Adam"). Ledger in [`README.md`](analysis/phase0/README.md); benchmark results in [`bench-results.md`](analysis/phase0/bench-results.md); retrospectives in [`retro/`](analysis/phase0/retro/).
- [`analysis/phase1/`](analysis/phase1/RESUME.md): Phase 1, with its [plan](analysis/phase1/plan.md) and [ledger](analysis/phase1/ledger.md).
- [`analysis/docs-library/`](analysis/docs-library/RESUME.md): this documentation library, with its [plan](analysis/docs-library/plan.md).
- [`analysis/autonomy/`](analysis/autonomy/review-and-plan-2026-11-14.md): the project-wide review of 14 November 2026. A proposal: nothing in it is scope until a decision record adopts it.
- Other areas: `behavior`, `bluemap`, `character-sheet`, `genesis`, `harness`, `muffled-hearing`, `residents`, `sheet`, `telemetry`, `worldops`. The campaign index says which are open.

## Development skills

The procedures coding agents follow live in [`.claude/skills/`](../.claude/skills/) and are listed in [skills and agents](reference/skills-and-agents.md): [`run-shard`](../.claude/skills/run-shard/SKILL.md), [`body-bench`](../.claude/skills/body-bench/SKILL.md), [`ship-pr`](../.claude/skills/ship-pr/SKILL.md), [`campaign-packet`](../.claude/skills/campaign-packet/SKILL.md).

## Changing the docs

Read the [doc-update map](agents/doc-update-map.md) before you open a pull request: it lists which documents a change must update. Write with the [documentation style](agents/documentation-style.md) and check with [doc verification](agents/doc-verification.md). Adding, renaming or removing a document updates its section index and this page in the same change.
