---
title: Reference index
type: reference
audience: contributors
status: draft
last_verified: 2026-11-16 against cd4499da
companions: [../README.md, glossary.md, repo-layout.md, spec-section-map.md]
---

# Reference

Reference docs are complete and dry: every option, field, path and term, with no tutorial or argument in them. Read them to look something up. For why a thing is built the way it is, read the concepts, architecture and decision docs; for steps, read the runbooks.

## Written

| Doc | What it covers | Audience | Status |
|---|---|---|---|
| [glossary.md](glossary.md) | Every term the spec, code and decisions use, where it lives in code, and the conflicts between them (replaces `docs/glossary.md`, which is now a pointer). | contributors | draft |
| [repo-layout.md](repo-layout.md) | Every top-level folder and workspace package: purpose, README, language, files, test and build. | contributors | draft |
| [spec-section-map.md](spec-section-map.md) | Spec section to components, code, planned doc and decisions. | contributors | draft |

## Planned in this folder

From the documentation plan (2026-11-16). None of these exist yet; links resolve once they are written. "agents-never" docs are operator material and must never be placed where an agent reads.

| ID | Doc | Covers | Audience | Wave | Status |
|---|---|---|---|---|---|
| R01 | [components.md](components.md) | One row per component, with links to every doc | contributors | W2 | planned |
| R02 | [contract-schemas.md](contract-schemas.md) | `contract/schemas`, generated from the file list | contributors | W2 | planned |
| R03 | [nats-subjects.md](nats-subjects.md) | `contract/src/subjects.ts` | contributors | W2 | planned |
| R04 | [database-schema.md](database-schema.md) | `sql/` migrations, grants, functions, triggers | operators | W2 | planned |
| R05 | [mcp-tools.md](mcp-tools.md) | `threshold/mcp` tool registry, spec Appendix K | open: owner decision (see note) | W2 | planned |
| R06 | [register-service.md](register-service.md) | `threshold/register` routes, sessions, consents | operators | W2 | planned |
| R07 | [golem-body.md](golem-body.md) | `golem/src`: actions, perception, body, Adam | contributors | W2 | planned |
| R08 | [animus-mind.md](animus-mind.md) | `animus/src`: ports, loop, memory, Thinker | contributors | W2 | planned |
| R09 | [player-core.md](player-core.md) | `player-core/src` | contributors | W2 | planned |
| R10 | [psyche-engine.md](psyche-engine.md) | `psyche/`, decision 0281 | contributors | W2 | planned |
| R11 | [prompt-templates.md](prompt-templates.md) | `prompts/` (thought, reflection, body-api) | agents-never | W2 | planned |
| R12 | [shard-config.md](shard-config.md) | `shards/*.yaml`, `envs/environment.schema.json` | operators | W2 | planned |
| R13 | [environment-variables.md](environment-variables.md) | Variable names only, from the `.env.example` files and schema | operators | W2 | planned |
| R14 | [compose-stacks.md](compose-stacks.md) | `compose/*.yml`, services, overlays | operators | W2 | planned |
| R15 | [deploy-scripts.md](deploy-scripts.md) | `deploy/*.sh`, `common.sh`, `release.env.example` | operators | W2 | planned |
| R16 | [geldar-core-plugin.md](geldar-core-plugin.md) | `plugin/core` features | contributors | W2 | planned |
| R17 | [velocity-identity-plugin.md](velocity-identity-plugin.md) | `plugin/velocity-identity`, `compose/velocity` | operators | W2 | planned |
| R18 | [third-party-plugins.md](third-party-plugins.md) | `plugins/bluemap`, `chunky`, `coreprotect` | operators | W2 | planned |
| R19 | [glass-and-kino.md](glass-and-kino.md) | `glass/src`, Kino | agents-never | W2 | planned |
| R20 | [eventsink.md](eventsink.md) | `eventsink/`, decision 0041 | contributors | W2 | planned |
| R21 | [lantern-thinker-protocol.md](lantern-thinker-protocol.md) | Spec Appendix H, `lantern-local`, the Thinker token | contributors | W2 | planned |
| R22 | [supervisor-and-body-helper.md](supervisor-and-body-helper.md) | `supervisor/src`, `body-helper/` | operators | W2 | planned |
| R23 | [cli-tools.md](cli-tools.md) | `tools/*` (14) and `geldar.ps1` | contributors | W2 | planned |
| R24 | [repo-checks.md](repo-checks.md) | `tools/repo-checks/src` gates | contributors | W2 | planned |
| R25 | [ci-workflows.md](ci-workflows.md) | `.github/workflows` (6) | contributors | W2 | planned |
| R26 | [skills-and-agents.md](skills-and-agents.md) | `.claude/skills`, `.claude/agents` | contributors | W2 | planned |
| R27 | [admin-service.md](admin-service.md) | Compose admin service, `deploy/colo-admin.sh` | operators | W2 | planned |
| H06 | [decisions-by-topic.md](decisions-by-topic.md) | The decisions index regrouped by component | contributors | W5 | planned |

Note on R05: the plan data gave it audience `players`, which the [documentation style](../agents/documentation-style.md#audience-labels) reserves for the public legal texts and the player guide. The plan now marks the audience "open: owner decision"; the owner decides before the doc is written.

## Written in other folders

The W0 documents that live next to the material they cover. [`docs/glossary.md`](../glossary.md) is now a pointer to [glossary.md](glossary.md) here.

| ID | Doc | Type | Audience | Wave | Status |
|---|---|---|---|---|---|
| F02 | [doc-update-map](../agents/doc-update-map.md) | reference | contributors | W0 | draft |
| F03 | [documentation-style](../agents/documentation-style.md) | reference | contributors | W0 | draft |
| F04 | [doc-verification](../agents/doc-verification.md) | how-to (listed here because it ships with F02 and F03) | contributors | W0 | draft |
| F06 | [runbooks index](../runbooks/README.md) | reference | agents-never | W0 | draft |

## Reference docs planned in other folders

These are reference-type docs that live next to the material they index.

| ID | Doc | Audience | Wave | Status |
|---|---|---|---|---|
| F01 | [docs index](../README.md) (rewrite) | contributors | W0 | planned (orchestrator) |
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
