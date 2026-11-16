---
title: Reference index
type: reference
audience: contributors
status: draft
last_verified: 2026-11-16 against 1b114276
companions: [../README.md, components.md, glossary.md, repo-layout.md, spec-section-map.md, ../concepts/README.md, ../architecture/README.md]
sources: [docs/reference, docs/analysis/docs-library/plan.md]
---

# Reference

Reference docs are complete and dry: every option, field, path and term, with no tutorial or argument in them. Read them to look something up. For why a thing is built the way it is, read the [concepts](../concepts/README.md), [architecture](../architecture/README.md) and [decision](../decisions/README.md) docs; for steps, read the [runbooks](../runbooks/README.md).

Start with [components](components.md): one row per component, with a link to every document that covers it.

"agents-never" docs are operator material. Never copy, quote or link them from anything an agent in the world reads ([documentation style](../agents/documentation-style.md#agents-never-learn-they-are-watched)).

## Written

Every file in this folder on 2026-11-16 (folder listing: 31 files, this index included). Type, audience and status are each file's metadata block. Status `draft` means no reviewer has passed the doc yet; the W1 and W2 reviews are running ([RESUME](../analysis/docs-library/RESUME.md)).

| ID | Doc | What it covers | Type | Audience | Status | Wave |
|---|---|---|---|---|---|---|
| F05 | [glossary.md](glossary.md) | Every term the spec, code and decisions use, where it lives in code, and the conflicts between them (`docs/glossary.md` is now a pointer here) | reference | contributors | draft | W0 |
| F07 | [repo-layout.md](repo-layout.md) | Every top-level folder and workspace package: purpose, README, language, files, test and build | reference | contributors | draft | W0 |
| F08 | [spec-section-map.md](spec-section-map.md) | Spec section to components, code, docs and decisions | reference | contributors | draft | W0 |
| R01 | [components.md](components.md) | One row per component: owner role, README, every doc, the lifecycle from design to retirement, 1-hop neighbours | reference | contributors | draft | W2 |
| R02 | [contract-schemas.md](contract-schemas.md) | Every schema in `contract/schemas`, the generator and the drift check | reference | contributors | draft | W2 |
| R03 | [nats-subjects.md](nats-subjects.md) | Subject builders in `contract/src/subjects.ts`, who publishes and subscribes, streams and KV buckets | reference | contributors | draft | W2 |
| R04 | [database-schema.md](database-schema.md) | The 44 migrations in `sql/`: tables, roles, grants, functions, triggers, retention and erasure | reference | operators | draft | W2 |
| R05 | [mcp-tools.md](mcp-tools.md) | Every tool, resource and prompt of `threshold/mcp` and `threshold/mcp-mock`; budgets, limits, errors | reference | contributors (owner decision open, see note) | draft | W2 |
| R06 | [register-service.md](register-service.md) | `threshold/register`: routes, sign-in, sessions, consent, owner API, deletion and export | reference | operators | draft | W2 |
| R07 | [golem-body.md](golem-body.md) | `golem/`: actions, runtime, reflexes, perception, interfaces, benchmark | reference | contributors | draft | W2 |
| R08 | [animus-mind.md](animus-mind.md) | `animus/`: what remains after the freeze, ports, data, prompt use | reference | contributors | draft | W2 |
| R09 | [player-core.md](player-core.md) | `player-core/`: modules, Mind event types, allow-lists | reference | contributors | draft | W2 |
| R10 | [psyche-engine.md](psyche-engine.md) | `psyche/`: modules, users, the rules of decision 0281, release record | reference | contributors | draft | W2 |
| R11 | [prompt-templates.md](prompt-templates.md) | `prompts/`: kinds, file layout, every version, how a version is released | reference | agents-never | draft | W2 |
| R12 | [shard-config.md](shard-config.md) | Every key of `shards/*.yaml` and `envs/environment.schema.json` | reference | operators | draft | W2 |
| R13 | [environment-variables.md](environment-variables.md) | Variable names only, per service, from the examples, compose and code | reference | operators | draft | W2 |
| R14 | [compose-stacks.md](compose-stacks.md) | Every compose file, its services, overlays, ports and gates | reference | operators | draft | W2 |
| R15 | [deploy-scripts.md](deploy-scripts.md) | Every script and data file under `deploy/` | reference | operators | draft | W2 |
| R16 | [geldar-core-plugin.md](geldar-core-plugin.md) | `plugin/core`: features, commands, configuration, interfaces, lifecycle | reference | contributors | draft | W2 |
| R17 | [velocity-identity-plugin.md](velocity-identity-plugin.md) | `plugin/velocity-identity` and `compose/velocity/velocity.toml` | reference | operators | draft | W2 |
| R18 | [third-party-plugins.md](third-party-plugins.md) | BlueMap, Chunky and CoreProtect: pins, delivery, configuration | reference | operators | draft | W2 |
| R19 | [glass-and-kino.md](glass-and-kino.md) | `glass/`: routes, read-only guarantees, data sources, at spec level | reference | agents-never | draft | W2 |
| R20 | [eventsink.md](eventsink.md) | `eventsink/`: stream, tables, message handling, proficiency, lifecycle | reference | contributors | draft | W2 |
| R21 | [lantern-thinker-protocol.md](lantern-thinker-protocol.md) | Spec Appendix H, the Thinker hub in `animus` and the client `lantern-local` | reference | contributors | draft | W2 |
| R22 | [supervisor-and-body-helper.md](supervisor-and-body-helper.md) | `supervisor/` and `body-helper/`: control surface, quotas, verbs, install | reference | operators | draft | W2 |
| R23 | [cli-tools.md](cli-tools.md) | `geldar.ps1` and the 14 tool packages | reference | contributors | draft | W2 |
| R24 | [repo-checks.md](repo-checks.md) | Every gate in `tools/repo-checks`, its data files and tests | reference | contributors | draft | W2 |
| R25 | [ci-workflows.md](ci-workflows.md) | The six workflows in `.github/workflows` | reference | contributors | draft | W2 |
| R26 | [skills-and-agents.md](skills-and-agents.md) | `.claude/skills`, `.claude/agents` and project memory | reference | contributors | draft | W2 |
| R27 | [admin-service.md](admin-service.md) | The Colo one-shot admin container and its wrapper | reference | operators | draft | W2 |

Note on R05: the plan data gave it audience `players`, which the [documentation style](../agents/documentation-style.md#audience-labels) reserves for the public legal texts and the player guide. The writer used `contributors` until the owner decides ([plan.md](../analysis/docs-library/plan.md) row R05).

## Planned in this folder

| ID | Doc | Covers | Audience | Wave | Status |
|---|---|---|---|---|---|
| H06 | [decisions-by-topic.md](decisions-by-topic.md) | The decisions index regrouped by component | contributors | W5 | planned; the link resolves once written |

## Written in other folders

Reference-type docs that live next to the material they index.

| ID | Doc | Type | Audience | Wave | Status |
|---|---|---|---|---|---|
| F01 | [docs index](../README.md) | reference | contributors | W0 | draft |
| F02 | [doc-update map](../agents/doc-update-map.md) | reference | contributors | W0 | draft |
| F03 | [documentation style](../agents/documentation-style.md) | reference | contributors | W0 | draft |
| F04 | [doc verification](../agents/doc-verification.md) | how-to (listed here because it ships with F02 and F03) | contributors | W0 | draft |
| F06 | [runbooks index](../runbooks/README.md) | reference | agents-never | W0 | draft |
| none | [concepts index](../concepts/README.md) | reference | contributors | W1 | draft |
| none | [architecture index](../architecture/README.md) | reference | contributors | W1 | draft |

## Reference docs planned in other folders

None of these exist yet; the links resolve once they are written.

| ID | Doc | Audience | Wave | Status |
|---|---|---|---|---|
| O11 | [failure-modes](../operations/failure-modes.md) | operators | W3 | planned |
| O12 | [node-facts](../operations/node-facts.md) | operators | W3 | planned |
| O13 | [monitoring-and-vitals](../operations/monitoring-and-vitals.md) | agents-never | W3 | planned |
| O14 | [capacity-and-cost](../operations/capacity-and-cost.md) | owner | W3 | planned |
| S01 | [security index](../security/README.md) | operators | W4 | planned |
| S02 | [secrets-by-role](../security/secrets-by-role.md) | operators | W4 | planned |
| S06 | [authn-authz-map](../security/authn-authz-map.md) | operators | W4 | planned |
| H01 | [campaign-index](../history/campaign-index.md) | contributors | W5 | planned |
| X01 | [siblings index](../siblings/README.md) | contributors | W6 | planned |
| X03 | [infra, lantern and template repos](../siblings/infra-lantern-template.md) | contributors | W6 | planned |
