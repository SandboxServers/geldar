---
title: Reference index
type: reference
audience: contributors
status: draft
last_verified: 2026-11-16 against 3f07a4be
companions: [../README.md, components.md, glossary.md, repo-layout.md, spec-section-map.md, decisions-by-topic.md, ../concepts/README.md, ../architecture/README.md, ../runbooks/README.md]
sources: [docs/reference, docs/analysis/docs-library/plan.md]
---

# Reference

Reference docs are complete and dry: every option, field, path and term, with no tutorial or argument in them. Read them to look something up. For why a thing is built the way it is, read the [concepts](../concepts/README.md), [architecture](../architecture/README.md) and [decision](../decisions/README.md) docs; for steps, read the [runbooks](../runbooks/README.md) **(a-n)**; for a first walkthrough, the [guides](../guides/README.md).

Start with [components](components.md): one row per component, with a link to every document that covers it.

Links and rows marked **(a-n)**, or with audience `agents-never`, are operator material. Never copy, quote or link them from anything an agent in the world reads ([documentation style](../agents/documentation-style.md#agents-never-learn-they-are-watched)).

## Documents in this folder

Every file in this folder on 2026-11-16 at 3f07a4be: 31 documents and this index (`git ls-files docs/reference`), plus [telemetry-package.md](telemetry-package.md), added in W7 and not yet committed (32 documents on disk). The Type, Audience, Status and Pinned columns are read from each file's metadata block by script, not typed by hand; "Pinned" is the commit in its `last_verified`. Status `draft` means no reviewer has marked the doc `verified`; each had one wave review and its fixes ([RESUME](../analysis/docs-library/RESUME.md)).

| ID | Doc | What it covers | Type | Audience | Status | Pinned |
|---|---|---|---|---|---|---|
| F05 | [glossary.md](glossary.md) | Every term the spec, code and decisions use, where it lives in code, and the conflicts between them (`docs/glossary.md` is now a pointer here) | reference | contributors | draft | `cd4499da` |
| F07 | [repo-layout.md](repo-layout.md) | Every top-level folder and workspace package: purpose, README, language, files, test and build | reference | contributors | draft | `cd4499da` |
| F08 | [spec-section-map.md](spec-section-map.md) | Spec section to components, code, docs and decisions | reference | contributors | draft | `cd4499da` |
| R01 | [components.md](components.md) | One row per component: owner role, README, every doc, the lifecycle from design to retirement, 1-hop neighbours | reference | contributors | draft | `3f07a4be` |
| R02 | [contract-schemas.md](contract-schemas.md) | Every schema in `contract/schemas`, the generator and the drift check | reference | contributors | draft | `1b114276` |
| R03 | [nats-subjects.md](nats-subjects.md) | Subject builders in `contract/src/subjects.ts`, who publishes and subscribes, streams and KV buckets | reference | contributors | draft | `1b114276` |
| R04 | [database-schema.md](database-schema.md) | The 44 migrations in `sql/`: tables, roles, grants, functions, triggers, retention and erasure | reference | agents-never | draft | `1b114276` |
| R05 | [mcp-tools.md](mcp-tools.md) | Every tool, resource and prompt of `threshold/mcp` and `threshold/mcp-mock`; budgets, limits, errors | reference | contributors | draft | `1b114276` |
| R06 | [register-service.md](register-service.md) | `threshold/register`: routes, sign-in, sessions, consent, owner API, deletion and export | reference | operators | draft | `1b114276` |
| R07 | [golem-body.md](golem-body.md) | `golem/`: actions, runtime, reflexes, perception, interfaces, benchmark | reference | contributors | draft | `1b114276` |
| R08 | [animus-mind.md](animus-mind.md) | removed, see [0430](../decisions/0430-remove-animus.md) | reference | agents-never | draft | `1b114276` |
| R09 | [player-core.md](player-core.md) | `player-core/`: modules, Mind event types, allow-lists | reference | contributors | draft | `1b114276` |
| R10 | [psyche-engine.md](psyche-engine.md) | `psyche/`: modules, users, the rules of decision 0281, release record | reference | contributors | draft | `1b114276` |
| R11 | [prompt-templates.md](prompt-templates.md) **(a-n)** | `prompts/`: kinds, file layout, every version, how a version is released | reference | agents-never | draft | `1b114276` |
| R12 | [shard-config.md](shard-config.md) | Every key of `shards/*.yaml` and `envs/environment.schema.json` | reference | operators | draft | `1b114276` |
| R13 | [environment-variables.md](environment-variables.md) | Variable names only, per service, from the examples, compose and code | reference | operators | draft | `1b114276` |
| R14 | [compose-stacks.md](compose-stacks.md) | Every compose file, its services, overlays, ports and gates | reference | operators | draft | `1b114276` |
| R15 | [deploy-scripts.md](deploy-scripts.md) | Every script and data file under `deploy/` | reference | operators | draft | `1b114276` |
| R16 | [geldar-core-plugin.md](geldar-core-plugin.md) | `plugin/core`: features, commands, configuration, interfaces, lifecycle | reference | agents-never | draft | `1b114276` |
| R17 | [velocity-identity-plugin.md](velocity-identity-plugin.md) | `plugin/velocity-identity` and `compose/velocity/velocity.toml` | reference | operators | draft | `1b114276` |
| R18 | [third-party-plugins.md](third-party-plugins.md) | BlueMap, Chunky and CoreProtect: pins, delivery, configuration | reference | operators | draft | `1b114276` |
| R19 | [glass-and-kino.md](glass-and-kino.md) **(a-n)** | `glass/`: routes, read-only guarantees, data sources, at spec level | reference | agents-never | draft | `1b114276` |
| R20 | [eventsink.md](eventsink.md) | `eventsink/`: stream, tables, message handling, proficiency, lifecycle | reference | contributors | draft | `1b114276` |
| R21 | [lantern-thinker-protocol.md](lantern-thinker-protocol.md) | Spec Appendix H, the Thinker hub in `animus` and the client `lantern-local` | reference | contributors | draft | `1b114276` |
| R22 | [supervisor-and-body-helper.md](supervisor-and-body-helper.md) | `supervisor/` and `body-helper/`: control surface, quotas, verbs, install | reference | operators | draft | `1b114276` |
| R23 | [cli-tools.md](cli-tools.md) | `geldar.ps1` and the 14 tool packages | reference | contributors | draft | `1b114276` |
| R24 | [repo-checks.md](repo-checks.md) | Every gate in `tools/repo-checks`, its data files and tests | reference | contributors | draft | `1b114276` |
| R25 | [ci-workflows.md](ci-workflows.md) | The six workflows in `.github/workflows` | reference | contributors | draft | `1b114276` |
| R26 | [skills-and-agents.md](skills-and-agents.md) | `.claude/skills`, `.claude/agents` and project memory | reference | contributors | draft | `1b114276` |
| R27 | [admin-service.md](admin-service.md) | The Colo one-shot admin container and its wrapper | reference | operators | draft | `1b114276` |
| H06 | [decisions-by-topic.md](decisions-by-topic.md) | Every decision record grouped by the component it mostly governs; observation and telemetry rows by title only | reference | contributors | draft | `dc07e3fa` |
| W7 | [telemetry-package.md](telemetry-package.md) **(a-n)** | `telemetry/` (`@geldar/telemetry`): exports, configuration names, importers, tests, build; decisions 0350 to 0352 at policy level | reference | agents-never | draft | `3f07a4be` |

Re-derive the type, audience and status columns with the metadata scan in [doc verification](../agents/doc-verification.md#metadata-present); the figures in "What it covers" (44 migrations, 14 tool packages, six workflows) were re-counted at 3f07a4be with the [re-derive commands](../agents/doc-verification.md#re-derive-lists).

**Note on R05.** The plan data gave it audience `players`, which the [documentation style](../agents/documentation-style.md#audience-labels) reserves for `docs/players/README.md` and the legal texts. The writer used `contributors` until the owner decides ([plan.md](../analysis/docs-library/plan.md) row R05).

**Telemetry package.** The `telemetry/` workspace package (`@geldar/telemetry`, merged in PR #551 after the W0 pin) has its reference page, [telemetry-package](telemetry-package.md) **(a-n)**, since W7 (2026-11-16). [repo-layout.md](repo-layout.md) lists it in a row measured at `3f07a4be`; the rest of that page is still pinned at `cd4499da`. The [library RESUME](../analysis/docs-library/RESUME.md#debt-after-w7) records what remains.

## Reference-type docs in other folders

Indexes and tables that live next to the material they cover.

| Doc | Type | Audience |
|---|---|---|
| [docs index](../README.md) | reference | contributors |
| [doc-update map](../agents/doc-update-map.md) | reference | contributors |
| [documentation style](../agents/documentation-style.md) | reference | contributors |
| [runbooks index](../runbooks/README.md) **(a-n)** | reference | agents-never |
| [concepts index](../concepts/README.md), [architecture index](../architecture/README.md), [guides index](../guides/README.md) | reference | contributors |
| [operations](../operations/README.md): [failure-modes](../operations/failure-modes.md) **(a-n)**, [node-facts](../operations/node-facts.md) **(a-n)** | reference | agents-never |
| [monitoring-and-vitals](../operations/monitoring-and-vitals.md) **(a-n)** | reference | agents-never |
| [capacity-and-cost](../operations/capacity-and-cost.md) | reference | owner |
| [security index](../security/README.md), [secrets-by-role](../security/secrets-by-role.md), [authn-authz-map](../security/authn-authz-map.md) | reference | operators |
| [history index](../history/README.md), [campaign-index](../history/campaign-index.md) | reference | contributors |
| [siblings index](../siblings/README.md), [infra, lantern and template repos](../siblings/infra-lantern-template.md) | reference | contributors |
| [decisions index](../decisions/README.md) | index (no metadata block) | contributors |
