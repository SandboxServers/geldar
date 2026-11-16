---
title: Documentation library plan
type: explanation
audience: owner
status: draft
last_verified: 2026-11-16 against cd4499da
companions: [RESUME.md, ../../agents/README.md, ../../agents/documentation-style.md, ../../agents/doc-update-map.md, ../../agents/doc-verification.md]
sources: [.claude/agents/documentation-writer.md, docs, sql, prompts, .github/workflows, tools, pnpm-workspace.yaml, compose/colo.yml, animus/README.md, player-core/README.md, docs/glossary.md, docs/README.md, README.md]
---

# Documentation library plan

The plan for Geldar's documentation library, as the owner approved it on 2026-11-16, and the record of why it is shaped this way. Progress lives in [RESUME.md](RESUME.md). The rules the plan set up are in [docs/agents/](../../agents/README.md).

Where a figure below was re-measured for this page, it carries the date and the commit (cd4499da, 2026-11-16). Where it was not, it says "unverified, from the plan of 2026-11-16". [Section 13](#13-corrections-to-the-plan-data) lists the plan figures this re-check changed.

## 1. Scope and approval

- **Goal.** A complete, current library for the owner, operators, contributors and outside players, written while development is frozen so every page can pin one commit.
- **Funding.** All waves W0 to W7 and all priorities P1 to P3 (owner decision D11, option D, 2026-11-16). This replaces the earlier default of W0 plus the P1 documents of W1 and W2.
- **Constraints.** Markdown only. No code, config, prompt or contract change. No read of the node, the VM, the database or the world (D8). The writer never edits `docs/spec.md`.
- **Who.** Writers on Opus 5.5 at high effort; a reviewer on Sonnet 5.5 at high effort at each wave boundary; the owner reviews W0 and S05 only (D12).

## 2. Inventory summary

Measured on 2026-11-16 at cd4499da with `git ls-files` unless marked.

| Area | Measured | Notes |
|---|---|---|
| `docs/spec.md` | 2135 lines (`(Get-Content docs/spec.md).Count` and `git show HEAD:docs/spec.md \| wc -l`) | v0.8 draft per its header (unverified, from the plan). Owner only. |
| `docs/decisions/` | 180 records and a README; highest number 0352 | Index and files agree (the decision-index gate). No metadata blocks (D4). |
| `docs/runbooks/` | 19 files, 178,849 bytes, 1,840 to 22,360 bytes each | Stay in place (D10). |
| `docs/legal/` | 3 files | Gated (decision 0155). |
| `docs/players/` | 1 file | The player guide; gated wording. |
| `docs/analysis/` | 333 files, 3,553,348 bytes, 13 areas (at cd4499da, before `docs-library/` was added; once it is committed the same commands give 14 areas and 10 `RESUME.md` files) | phase0 115, phase1 114, harness 46, residents 28, behavior 8, character-sheet 6, genesis 6, muffled-hearing 3, bluemap 2, telemetry 2, autonomy 1, sheet 1, worldops 1. Nine have a `RESUME.md`. |
| Other `docs/` files | `glossary.md` (41 lines at cd4499da; a 31-line pointer after W0), `ideas.md`, `README.md`, `threat-model.md` | |
| Workspace packages | 13 entries in `pnpm-workspace.yaml` plus `tools/*` | 14 tool directories. |
| `sql/` | 44 migrations | 0001-0027, 0032-0040, 0050-0052, 0060-0063, 0065. |
| `prompts/` | 17 templates and a README | thought v1-v5, reflection v1-v2, body-api v1-v10. |
| `.github/workflows/` | 6 workflows | |
| `.claude/` | 4 skills, 4 agents, 4 agent-memory files | |
| Relative links in `docs/` | 881 checked, 29 broken, in 16 files | File existence only; anchors, code spans and fenced blocks ignored; measured before this wave's new files. |
| Metadata blocks | None at cd4499da | Other W0 writers are adding them to the runbooks. |
| Sibling repos | Seven | Unverified, from the plan of 2026-11-16 (D2: summaries only, in this repo). |

## 3. Findings

Re-checked on 2026-11-16 at cd4499da. The "Re-check" column says what changed.

| ID | Finding | Evidence | Severity | Re-check |
|---|---|---|---|---|
| F-1 | Index stale. `docs/README.md` says "There is no separate ops handbook yet" while `docs/runbooks/` holds 19 files. It also omits runbooks, players and legal. | `docs/README.md`; `git ls-files docs/runbooks` | High | Confirmed. |
| F-2 | Glossary contradicts SQL. The glossary says the owner cap "is config only today; no code enforces it yet". `sql/0006_owner_cap_trigger.sql` creates `mcp_enforce_owner_cap()` and a trigger that executes it. Whether 0006 is applied on the node is unverified. | `docs/glossary.md`; `sql/0006_owner_cap_trigger.sql` | High | Confirmed in the repo; node state unverified (D8). |
| F-3 | Migration number gaps. | `git ls-files sql` | Medium | Corrected: 44 migrations, gaps at 0028-0031, 0041-0049, 0053-0059 and 0064. Not "0001-0027 and 0032". Why the gaps exist is unverified. |
| F-4 | Three accounts of `animus`. Its README describes a P0-21 skeleton; the player-core README says animus is frozen with deprecated stubs; `compose/colo.yml` defines an `animus` service. | `animus/README.md`; `player-core/README.md`; `compose/colo.yml` | Medium | Refined: the colo service sits in profile `mind`, which `shard up colo` and `deploy/colo-up.sh` skip (decision 0134, compose comment). It is defined, not run by default. |
| F-5 | Status vocabulary. The decisions README allows `Accepted` or `Superseded by NNNN`. Records use other wording, and decision 0352 amends 0350 while 0350 stays Accepted. | `docs/decisions/README.md`; records 0350, 0352 | Medium | Corrected: 40 index rows and 35 record files start with "Proposed", not 3. |
| F-6 | Broken relative links. | Link scan in [doc verification](../../agents/doc-verification.md#relative-links) | Medium | Re-measured: 881 links, 29 broken, 16 files. The plan's 922, 69 and 25 came from a different crude script (unverified, from the plan of 2026-11-16). Most remaining breaks are wrong `../` depth in `docs/analysis/phase1/`. |
| F-7 | No metadata anywhere. | First line of each file | Medium | True at cd4499da. W0 writers are fixing it in the working tree. |
| F-8 | Public copy versus implementation. The root README says Kino is "coming soon"; `docs/runbooks/kino.md`, `sql/0014`, `0015`, `0017` to `0020` and `plugin/core` Kino code exist. May be deliberate. | `README.md`; `docs/runbooks/kino.md`; `sql/` | Low | Confirmed. Owner to say whether deliberate. |
| F-9 | Campaign sprawl: 13 analysis areas and no index says which are closed. | `docs/analysis/` | High | Corrected: 9 areas have a `RESUME.md`, not 10. |
| F-10 | Components without a README. | `Test-Path <dir>/README.md` | High | Re-measured: none in `contract`, `threshold` (root), `supervisor`, `body-helper`, `plugin/core`, `plugin/velocity-identity` (both covered by `plugin/README.md`), `plugins`, `compose`, `shards`, `envs`, `tools`, `bench`. `threshold/register` and `threshold/mcp-mock` do have one. Supervisor's purpose is inferred from file names only. |
| F-11 | Duplicates. Bring-up steps exist only in the `run-shard` skill (agent-facing). Deploy facts are split across `deploy/README.md`, `runbooks/colo-deploy.md`, `node-only-config.md` and `nats-auth-inplace.md`. | `.claude/skills/`; `docs/runbooks/`; `deploy/README.md` | Low | Not re-checked in depth. |
| F-12 | Public repo versus agents-never. The repo is public, so any operator document about observation is readable by an agent that can browse. | `CLAUDE.md`; persona rule 5 | High | Unchanged; handled by D9 and the [style rules](../../agents/documentation-style.md#agents-never-learn-they-are-watched). |

New findings from this pass (2026-11-16, cd4499da):

| ID | Finding | Evidence |
|---|---|---|
| F-13 | The gate named `nats-auth-runbook.test.ts` checks `docs/runbooks/body-helper-node-steps.md`, not `nats-auth-inplace.md`. The NATS runbook is only checked for one step, by `deploy/test/install-body-helper-runbook.test.ts`. | both test files |
| F-14 | The spec names MCP prompts `geldar:play`, `geldar:reflect` and `geldar:newborn` (section 5.15.3). They are defined in the mock MCP (`threshold/mcp-mock/src/prompts.ts` lines 17, 22 and 27; tested in `threshold/mcp-mock/src/app.test.ts` lines 186 to 190), and the production server serves them from there: `threshold/mcp/src/resources.ts` imports `listPrompts` and `getPrompt` from `@geldar/mcp-mock`, and `threshold/mcp/src/world-session.ts` lines 161 to 162 answer prompt requests with them. So `threshold/mcp-mock/src` is agent-read text (corrected after the W0 review; the first pass searched `threshold/mcp/src` for the names only). | `docs/spec.md`; `git grep -n 'geldar:play' -- threshold`; `git grep -n prompts -- threshold/mcp/src`, 2026-11-16 |
| F-15 | Agent-visible text is already guarded in code: a marker-word scan over the MCP schemas and `prompts/`, and a persona lint (decisions 0058, 0059, 0068). No equivalent covers `docs/` or sibling repos. | `contract/src/agent-text.ts`; `contract/test/agent-visible-text.test.ts`; `animus/src/prompts/agent-text.test.ts`; `tools/mcp-tokens/src/persona-lint.ts` |
| F-16 | `docs/spec.md` names the owner by first name on 25 lines, from line 10 (the header table) to line 1915, not only in section 5.15.5 (`Select-String -CaseSensitive` on the name, 2026-11-16 at cd4499da). Persona rule 3 forbids account and personal names in the repo; the writer may not edit the spec. Owner to decide. | `docs/spec.md` |
| F-17 | The W0 runbook metadata cites `sources:` relative to the document and, in one file, as "decision NNNN" text. The style doc accepts document-relative paths. `open-signup.md` cannot name a decision file, because `open-signup-runbook.test.ts` fails on any run of 32 or more `[A-Za-z0-9+/_-]` characters; it uses the folder `../decisions` instead, the documented exception in the [style doc](../../agents/documentation-style.md#metadata-block). | `docs/runbooks/open-signup.md`; `tools/repo-checks/src/open-signup-runbook.test.ts` |

## 4. Target tree

```text
docs/
├── README.md            F01 rewrite: numbered "Start here" path, a table per section
├── spec.md              owner only; mapped by F08
├── glossary.md          existing; extended into reference/glossary.md (F05)
├── ideas.md             existing parking lot
├── threat-model.md      existing; stays, gets metadata (D10, S01)
├── agents/              F02 update map, F03 style, F04 verification, README
├── analysis/            existing campaigns; docs-library/ holds this plan
├── architecture/        A01-A08
├── concepts/            C01-C11
├── decisions/           180 records, unchanged (D4)
├── guides/              G01-G04 tutorials
├── history/             H01-H05
├── legal/               existing 3 texts
├── operations/          O11-O14
├── players/             existing guide (G05)
├── reference/           F05, F07, F08, R01-R27, H06
├── runbooks/            19 existing, F06 index, O01-O10
├── security/            S01-S06
└── siblings/            X01-X04
```

## 5. Documents

89 documents. Type counts: 45 reference, 27 explanation, 12 how-to, 5 tutorial. Priorities: 55 P1, 28 P2, 6 P3. Token estimates are the plan's (unverified, from the plan of 2026-11-16).

| ID | Path under `docs/` | Type | Audience | Sources | Component | Priority | Est. tokens | Wave |
|---|---|---|---|---|---|---|---|---|
| F01 | README.md (rewrite) | reference | contributors | docs/README.md, all section indexes | docs | P1 | 2500 | W0 |
| F02 | agents/doc-update-map.md | reference | contributors | Cimmeria model; this plan section 9 | docs | P1 | 5000 | W0 |
| F03 | agents/documentation-style.md | reference | contributors | persona rules, Diataxis table | docs | P1 | 2500 | W0 |
| F04 | agents/doc-verification.md | how-to | contributors | this plan section 10 | docs | P1 | 3000 | W0 |
| F05 | reference/glossary.md (extends docs/glossary.md) | reference | contributors | spec s2a and s3, docs/glossary.md, code | docs | P1 | 6000 | W0 |
| F06 | runbooks/README.md (index, status table, metadata added to the 19 runbooks) | reference | agents-never | docs/runbooks/* | ops | P1 | 3500 | W0 |
| F07 | reference/repo-layout.md | reference | contributors | top-level tree, pnpm-workspace.yaml | repo | P1 | 3500 | W0 |
| F08 | reference/spec-section-map.md | reference | contributors | spec headings, decisions index | spec | P2 | 4000 | W0 |
| C01 | concepts/what-is-geldar.md | explanation | owner | spec s1-s2, README | spec | P1 | 3000 | W1 |
| C02 | concepts/principles-in-practice.md | explanation | contributors | spec s2, decisions on world operations | spec | P1 | 3500 | W1 |
| C03 | concepts/body-and-mind.md | explanation | contributors | spec s5.2-5.3, golem, animus, player-core | golem, animus | P1 | 4000 | W1 |
| C04 | concepts/sovereign-players.md | explanation | contributors | spec s5.15, App. J, scriptorium, player-template | scriptorium | P1 | 4000 | W1 |
| C05 | concepts/life-cycle-of-a-life.md | explanation | contributors | spec s5.9, register, sql, decisions 0040, 0135 | register | P1 | 4000 | W1 |
| C06 | concepts/identity-and-ingress.md | explanation | contributors | velocity-identity, decisions 0021, 0040 | velocity | P1 | 3500 | W1 |
| C07 | concepts/time-shards-and-phases.md | explanation | owner | spec s5.14 and s10, shards/*.yaml | shards | P2 | 3000 | W1 |
| C08 | concepts/economy-and-budgets.md | explanation | owner | spec s5.7, analysis/economy, budget decision | animus | P2 | 3500 | W1 |
| C09 | concepts/character-and-memory.md | explanation | contributors | psyche, analysis/character-sheet, analysis/sheet | psyche | P2 | 3500 | W1 |
| C10 | concepts/observation-and-privacy.md | explanation | agents-never | spec s7-s8, Glass README, decisions 0072, 0075 | glass | P1 | 4000 | W1 |
| C11 | concepts/world-operations-exceptions.md | explanation | owner | spec s2 principle 1, rescission decisions, worldops RESUME | worldops | P1 | 3000 | W1 |
| A01 | architecture/system-overview.md | explanation | contributors | compose/colo.yml, READMEs, spec s4 | all | P1 | 5000 | W1 |
| A02 | architecture/data-flow-events.md | explanation | contributors | contract/src/subjects.ts, eventsink, glass | eventsink | P1 | 4500 | W1 |
| A03 | architecture/network-and-trust-zones.md | explanation | operators | spec s6.4 and s8.1, compose networks, deploy/caddy | deploy | P1 | 4500 | W1 |
| A04 | architecture/nats-topology.md | explanation | operators | compose/nats-auth*.yml, runbooks/nats-auth-inplace.md | nats | P1 | 4500 | W1 |
| A05 | architecture/deployment-topology-colo.md | explanation | operators | compose/colo*.yml, deploy/README.md | deploy | P1 | 4500 | W1 |
| A06 | architecture/build-and-release.md | explanation | contributors | ci.yml, colo-images.yml, plugin-jars.yml, geldar-infra release-identity | ci | P2 | 4000 | W1 |
| A07 | architecture/telemetry-pipeline.md | explanation | agents-never | decisions 0130, 0350-0352, analysis/telemetry | telemetry | P2 | 4000 | W1 |
| A08 | architecture/repo-map-and-dependencies.md | explanation | contributors | this plan section 8, package.json graph | repo | P1 | 4000 | W1 |
| R01 | reference/components.md | reference | contributors | one row per component, links to every doc | all | P1 | 6000 | W2 |
| R02 | reference/contract-schemas.md | reference | contributors | contract/schemas (generate list from files) | contract | P1 | 7000 | W2 |
| R03 | reference/nats-subjects.md | reference | contributors | contract/src/subjects.ts | contract | P1 | 4500 | W2 |
| R04 | reference/database-schema.md | reference | operators | sql/ (44 migrations, 0001 to 0065), grants, functions, triggers | sql | P1 | 8000 | W2 |
| R05 | reference/mcp-tools.md | reference | open: owner decision (the plan data said `players`, which the style reserves for the legal texts and the player guide) | threshold/mcp tool registry, spec App. K | threshold | P1 | 7000 | W2 |
| R06 | reference/register-service.md | reference | operators | threshold/register routes, sessions, consents | register | P1 | 5000 | W2 |
| R07 | reference/golem-body.md | reference | contributors | golem/src (actions, perception, body, adam) | golem | P1 | 8000 | W2 |
| R08 | reference/animus-mind.md | reference | contributors | animus/src ports, loop, memory, thinker | animus | P2 | 5000 | W2 |
| R09 | reference/player-core.md | reference | contributors | player-core/src | player-core | P2 | 3000 | W2 |
| R10 | reference/psyche-engine.md | reference | contributors | psyche/README, decision 0281 | psyche | P2 | 3000 | W2 |
| R11 | reference/prompt-templates.md | reference | agents-never | prompts/ (thought v1-v5, reflection v1-v2, body-api v1-v10) | prompts | P1 | 4000 | W2 |
| R12 | reference/shard-config.md | reference | operators | shards/*.yaml, envs/environment.schema.json | shards | P1 | 4000 | W2 |
| R13 | reference/environment-variables.md (names only) | reference | operators | compose/.env.example, .env.example, schema | compose | P1 | 4500 | W2 |
| R14 | reference/compose-stacks.md | reference | operators | compose/*.yml, services, overlays | compose | P1 | 6000 | W2 |
| R15 | reference/deploy-scripts.md | reference | operators | deploy/*.sh, common.sh, release.env.example | deploy | P1 | 5000 | W2 |
| R16 | reference/geldar-core-plugin.md | reference | contributors | plugin/core (blockowner, kino, lakitu, maintenance, proximity, skins, speech) | plugin | P1 | 7000 | W2 |
| R17 | reference/velocity-identity-plugin.md | reference | operators | plugin/velocity-identity, compose/velocity | plugin | P2 | 3000 | W2 |
| R18 | reference/third-party-plugins.md | reference | operators | plugins/bluemap, chunky, coreprotect | plugins | P3 | 2500 | W2 |
| R19 | reference/glass-and-kino.md | reference | agents-never | glass/src, glass/README, runbooks/kino.md | glass | P1 | 6000 | W2 |
| R20 | reference/eventsink.md | reference | contributors | eventsink/README, decision 0041 | eventsink | P2 | 3000 | W2 |
| R21 | reference/lantern-thinker-protocol.md | reference | contributors | spec App. H, lantern-local, contract thinker-token | lantern-local | P2 | 3500 | W2 |
| R22 | reference/supervisor-and-body-helper.md | reference | operators | supervisor/src, body-helper, runbooks/body-helper-node-steps.md | supervisor | P2 | 4000 | W2 |
| R23 | reference/cli-tools.md | reference | contributors | tools/* (14), geldar.ps1 | tools | P1 | 5000 | W2 |
| R24 | reference/repo-checks.md | reference | contributors | tools/repo-checks/src (19 modules, 51 test files) | ci | P2 | 4500 | W2 |
| R25 | reference/ci-workflows.md | reference | contributors | .github/workflows (6) | ci | P2 | 3000 | W2 |
| R26 | reference/skills-and-agents.md | reference | contributors | .claude/skills, .claude/agents | process | P3 | 2500 | W2 |
| R27 | reference/admin-service.md | reference | operators | compose admin service, deploy/colo-admin.sh, tests | deploy | P2 | 3500 | W2 |
| O01 | runbooks/bring-up-phase0-shard.md | how-to | operators | run-shard skill, compose/phase0.yml | compose | P1 | 2500 | W3 |
| O02 | runbooks/backup-and-restore.md | how-to | operators | spec s6.8; existence of a real procedure unverified | deploy | P1 | 3000 | W3 |
| O03 | runbooks/rotate-secrets-by-role.md | how-to | operators | deploy/gen-secrets.sh, nats-auth runbook (roles only) | deploy | P1 | 3000 | W3 |
| O04 | runbooks/add-a-contract-schema.md | how-to | contributors | contract/scripts, CLAUDE.md rule | contract | P2 | 2500 | W3 |
| O05 | runbooks/add-a-migration.md | how-to | contributors | sql/README, tools/migrate | sql | P2 | 2500 | W3 |
| O06 | runbooks/release-a-prompt-version.md | how-to | contributors | prompts/README, spec App. D | prompts | P2 | 2000 | W3 |
| O07 | runbooks/add-a-decision-record.md | how-to | contributors | docs/decisions/README, repo-checks decision gates | docs | P3 | 1800 | W3 |
| O08 | runbooks/incident-response.md | how-to | operators | spec s8.8 and s11, existing runbooks | ops | P1 | 3500 | W3 |
| O09 | runbooks/world-and-memory-reset.md | how-to | owner | rescission decisions, town cutover notes | worldops | P1 | 3000 | W3 |
| O10 | runbooks/retire-an-agent.md | how-to | operators | account-deletion runbook, register, sql | register | P2 | 2500 | W3 |
| O11 | operations/failure-modes.md | reference | operators | per-component table from W2 docs and runbooks | all | P1 | 6000 | W3 |
| O12 | operations/node-facts.md (existing docs only, dated) | reference | operators | colo-deploy runbook, node-only-config; no live reads | deploy | P2 | 3000 | W3 |
| O13 | operations/monitoring-and-vitals.md | reference | agents-never | decisions 0130, 0350-0352, progress-metrics runbook | telemetry | P1 | 4000 | W3 |
| O14 | operations/capacity-and-cost.md | reference | owner | spec s9, analysis/economy, bench-results | economy | P3 | 3500 | W3 |
| S01 | security/README.md (index; threat-model.md gets metadata, stays put) | reference | operators | docs/threat-model.md, spec s8 | security | P1 | 1500 | W4 |
| S02 | security/secrets-by-role.md | reference | operators | roles only; deploy/gen-secrets.sh, compose.secrets.yml | security | P1 | 3000 | W4 |
| S03 | security/privacy-and-data-retention.md | explanation | owner | docs/legal/*, account-deletion runbook, sql consents | security | P1 | 4000 | W4 |
| S04 | security/supply-chain.md | explanation | contributors | decision 0005, pin-rules, release-age, Dependabot | security | P2 | 3000 | W4 |
| S05 | security/agent-visibility-rules.md | how-to | agents-never | spec s8, persona rule 5; lists paths agents read | security | P1 | 2500 | W4 |
| S06 | security/authn-authz-map.md | reference | operators | register, MCP tokens, NATS users, Velocity gate | security | P1 | 5000 | W4 |
| H01 | history/campaign-index.md | reference | contributors | docs/analysis (13 areas), every RESUME.md | analysis | P1 | 5000 | W5 |
| H02 | history/phase0-summary.md | explanation | owner | analysis/phase0 retro/, bench-results.md | phase0 | P2 | 5000 | W5 |
| H03 | history/phase1-summary.md | explanation | owner | analysis/phase1 plan, RESUME, retrospective | phase1 | P2 | 5000 | W5 |
| H04 | history/decision-timeline.md | explanation | owner | docs/decisions (180), by topic and date | decisions | P1 | 7000 | W5 |
| H05 | history/superseded-and-reversed.md | explanation | contributors | decisions with Superseded, Amended, temporary | decisions | P2 | 3000 | W5 |
| H06 | reference/decisions-by-topic.md | reference | contributors | decisions index regrouped by component | decisions | P1 | 6000 | W5 |
| X01 | siblings/README.md (map of seven sibling repos) | reference | contributors | each sibling README | siblings | P1 | 2500 | W6 |
| X02 | siblings/scriptorium.md | explanation | contributors | geldar-scriptorium README, docs/onboarding, troubleshooting | scriptorium | P1 | 4000 | W6 |
| X03 | siblings/infra-lantern-template.md | reference | contributors | geldar-infra, geldar-lantern, geldar-player-template (all near-empty) | siblings | P3 | 1800 | W6 |
| X04 | siblings/agent-board-and-agentcraft.md | explanation | contributors | agent-board README, agentcraft README (boundary note only) | siblings | P3 | 1800 | W6 |
| G01 | guides/first-hour-contributor.md | tutorial | contributors | CLAUDE.md commands, geldar.ps1 | tools | P1 | 3000 | W6 |
| G02 | guides/first-shard-on-your-machine.md | tutorial | contributors | run-shard skill, compose/phase0.yml | compose | P2 | 3000 | W6 |
| G03 | guides/trace-one-action.md | tutorial | contributors | thought to plan to action to event to Glass | all | P1 | 4500 | W6 |
| G04 | guides/operator-first-day.md | tutorial | operators | runbooks index, node-facts | ops | P2 | 3000 | W6 |
| G05 | players/README.md (metadata added; stays a tutorial for players) | tutorial | players | docs/players/README.md | register | P2 | 800 | W6 |

## 6. Waves

| Wave | Name | Contents | Why this order | Docs | Est. tokens |
|---|---|---|---|---|---|
| W0 | Foundations | Index, style, update map, verification, glossary, metadata on existing runbooks, link repair list | Sets the rules the rest follow | 8 | 30000 |
| W1 | Explanation | Concepts and architecture, with Mermaid diagrams | Needs the W0 style; feeds W2 cross-links | 19 | 74000 |
| W2 | Reference | One reference doc per component and per interface; generated lists where possible | Largest wave; split by component, parallel-safe | 27 | 127500 |
| W3 | Operations | New runbooks, failure modes, node facts from existing docs only | Reads existing runbooks, no live reads | 14 | 42800 |
| W4 | Security and privacy | Secrets by role, privacy, supply chain, agent-visibility rules, authn/authz map | Needs W2 interface docs | 6 | 19000 |
| W5 | History | Campaign index, phase summaries, decision timeline and by-topic digest | Mostly reading, few new claims | 6 | 31000 |
| W6 | Siblings and tutorials | Seven sibling repos, four tutorials, player guide metadata | Tutorials last: they need all links | 9 | 24400 |
| W7 | Verification and review | Link check, evidence check, leak scan, index and update-map audit, staleness labels | Closes the library at a commit | 0 | 0 |

Total estimate: 348,700 output tokens, of which P1 is 242,000 (69%). Every wave closes with a reviewer pass before the next starts.

## 7. Lifecycle template

Every component is covered cradle to grave. The owner field names a campaign or coordinator role, never a person (D3).

| Stage | Where it is documented |
|---|---|
| Purpose and owner | Component row in reference/components.md (R01); technical owner role |
| Design and decisions | Concept or architecture document, plus reference/decisions-by-topic.md (H06) |
| Interfaces and data | Reference document: schemas, subjects, tables, routes, tools |
| Configuration | shard-config (R12), environment-variables, names only (R13), compose-stacks (R14) |
| Build and test | cli-tools (R23), repo-checks (R24), ci-workflows (R25); per-package test command |
| Deploy and rollback | deploy-scripts (R15), deployment-topology (A05), runbooks/colo-deploy.md and a rollback section per component |
| Operate and monitor | Runbooks; monitoring-and-vitals (O13, agents-never) |
| Failure modes | operations/failure-modes.md (O11), one row per component and symptom |
| Security and privacy | security/ documents and the component's trust boundary |
| Retirement or reset | world-and-memory-reset (O09), retire-an-agent (O10), per-component data owner and what is deleted |

## 8. Components and degrees

Components (README presence re-measured 2026-11-16 at cd4499da; purposes from the plan and the READMEs):

| Component | Path | Purpose | README |
|---|---|---|---|
| Contract | `contract/` | JSON Schema source of truth; generated TypeScript (decision 0001) | No |
| Golem (Body) | `golem/` | Bot client, actions, perception, benchmark | Yes |
| Animus (Mind) | `animus/` | Mind loop on ports; frozen, stubs forward to player-core | Yes (reads as a skeleton, F-4) |
| player-core | `player-core/` | Neutral live-player path, imported by threshold and animus | Yes |
| Psyche | `psyche/` | Character engine, mirrored into the Mind kit (decision 0281) | Yes |
| Threshold MCP | `threshold/mcp`, `threshold/mcp-mock` | MCP server for sovereign players; budgets, play view, tools | Yes, both |
| Threshold Register | `threshold/register` | Sign-up, identities, sessions, consents, skins | Yes |
| Glass and Kino | `glass/` | Thought stream, journals, cameras; agents-never | Yes |
| eventsink | `eventsink/` | NATS JetStream to Postgres events (decision 0041) | Yes |
| lantern-local | `lantern-local/` | Local Thinker on Ollama | Yes |
| supervisor | `supervisor/` | Body lifecycle and limits (inferred from file names) | No |
| body-helper | `body-helper/` | Node-side helper for Bodies | No |
| Geldar-Core plugin | `plugin/core` | Paper plugin: block ownership, Kino, Lakitu, maintenance, proximity, skins, speech | Covered by `plugin/README.md` |
| Velocity identity | `plugin/velocity-identity` | Ingress gate reading the NATS life registry | Covered by `plugin/README.md` |
| Third-party plugins | `plugins/` | BlueMap, Chunky, CoreProtect configuration | No |
| Compose and shards | `compose/`, `shards/`, `envs/` | Stacks, overlays, shard configuration | No |
| Deploy | `deploy/` | Colo scripts, Caddy snippets | Yes (and `deploy/caddy/`) |
| Database | `sql/` | 44 migrations | Yes |
| Prompts | `prompts/` | Versioned templates; agents-never | Yes |
| Tools | `tools/` | 14 command-line tools | No |
| CI and repo checks | `.github/`, `tools/repo-checks` | 6 workflows; 19 check modules, 51 test files | No |
| Telemetry | decisions 0130, 0350-0352 | Design only in this repo (decision 0352, option B) | n/a |

The plan also mapped each component's first, second and third degree dependencies. That map is inferred (risk R9) and is not repeated here; each W2 reference document confirms or corrects its own row, and A08 publishes the result.

## 9. Doc-update map

Rendered as [docs/agents/doc-update-map.md](../../agents/doc-update-map.md) (F02). It also lists the gates that read documents.

## 10. Verification

Rendered as [docs/agents/doc-verification.md](../../agents/doc-verification.md) (F04): verifying one document, the staleness sweep over `sources:`, re-deriving lists, mechanical scans and the review checklist. W7 runs all of it over the whole library.

## 11. Model taken from Cimmeria

| Choice | What | Why |
|---|---|---|
| Adopt | One root index with a numbered "Start here" path and a table per section | Geldar's index is flat and stale (F-1). |
| Adopt | `docs/agents/doc-update-map.md` | The biggest drift guard Cimmeria has. |
| Adopt | A README index in every section folder, updated in the same change | Already persona rule 10. |
| Adopt | Explanation docs for cross-cutting design, separate from reference | Geldar keeps design only in decisions and the spec today. |
| Adopt | Generated lists for schemas, subjects and migrations | Only after the owner approves a coder packet (D7); until then hand-written with a re-derive command. |
| Adopt | A Markdown lint and a link check in CI | No link or metadata gate exists (see the [gates table](../../agents/doc-update-map.md#gates-that-read-documents)). |
| Adapt | The documentation-writer persona | Geldar's is stricter (no secrets, agents-never); add the update-map duty. |
| Adapt | Campaign analysis folders as history | Keep `docs/analysis/`; add an index (H01). |
| Do not adopt | Reverse-engineering, protocol, gap-analysis and figure folders; per-crate test inventories; product telemetry rows; regeneration on `main` | Cimmeria-specific, or would rot, or needs workflows Geldar lacks. |

## 12. Risks and owner decisions

### Risks

| ID | Risk | Mitigation |
|---|---|---|
| R1 | A public repo exposes operator documents about observation to any agent that can browse. | Audience labels; no thresholds, delays or hiding rules in new documents (D9). |
| R2 | Scale: about 348,700 output tokens, plus reading. | Waves with review stops. The owner funded all of it (D11, option D). |
| R3 | Figures copied from other documents go stale or were wrong. | Persona rule 7: re-check or mark unverified. Section 13 shows why. |
| R4 | Development resumes and the documents drift again. | The update map and the staleness sweep; the freeze is the cheapest time to pin a commit. |
| R5 | Agents read sibling repos (kit, player template, identity files). | No operator documents in any agent-read repo; sibling summaries live here only (D2). |
| R6 | Secrets, account names or addresses slip into runbooks. | The `no-credentials` and `ip-literals` gates, plus the manual scans in W7. |
| R7 | Node and VM facts cannot be verified while frozen. | Existing documents only, labelled unverified with source and date (D8). |
| R8 | Parallel writers edit `docs/` and collide. | Each writer owns named files; edits to existing documents are small and listed. |
| R9 | Inferred facts: supervisor's purpose, the plugin's use of Postgres, the dependency map. | Marked inferred; each W2 document confirms or corrects from code. |

### Owner decisions

The owner approved the plan on 2026-11-16 with the defaults below for D1 to D5 and D8 to D10, and chose option D for D11 the same day. D6, D7 and D12 carry the plan's default; the approval message did not name them, so they stay open until the owner confirms.

| ID | Question | Decision | Status |
|---|---|---|---|
| D1 | Are agentcraft and agent-board part of this library? | Boundary note only (X04); outside the dependency map. | Approved |
| D2 | Where do sibling-repo documents live? | Summaries only, in this repo; no new operator documents in any agent-read repo. | Approved |
| D3 | Name a technical owner per component? | Yes: a campaign or coordinator role, never a person. | Approved |
| D4 | Metadata on the 180 decision records? | No. Metadata goes on the index and the digests. | Approved |
| D5 | Add an optional `sources:` field to the metadata block? | Yes. Editing the persona file to match is the owner's change. | Approved |
| D6 | Reserve a decision-number block for documentation rules? | Yes, 10 numbers; the block is not yet assigned. | Plan default, to confirm |
| D7 | Coder follow-ups after the freeze: link checker, metadata linter, agent-visibility check, generated lists? | All four as small packets. | Plan default, to confirm |
| D8 | Read-only fact pass on the node and the VM? | Not yet. Existing documents only. | Approved |
| D9 | Should agents-never documents live outside the public repo? | Concepts stay in the repo at spec level, with no thresholds, delays, hiding rules or detection detail. | Approved |
| D10 | Move the 19 runbooks and `threat-model.md`? | Leave in place; add metadata and indexes. | Approved |
| D11 | Budget and stop points | Option D: everything, all waves W0 to W7, all priorities P1 to P3. Options A to C are not recorded in the plan data. | Approved (option D) |
| D12 | Who reviews? | A reviewer agent at each wave boundary (Sonnet 5.5, high effort); the owner reviews W0 and S05 only. | Plan default; reviewer model set by the orchestrator's brief |

## 13. Corrections to the plan data

Figures in the plan data of 2026-11-16 that this re-check changed. Later waves use the corrected figures.

| Plan said | Measured 2026-11-16 at cd4499da |
|---|---|
| `sql/` has 0001-0027 and 0032 (F-3, R04 sources, component table) | 44 migrations up to 0065; R04 covers all of them |
| 3 records still read Proposed (F-5) | 40 index rows, 35 record files |
| 922 links, 69 broken in 25 files (F-6) | 881 links, 29 broken in 16 files (different script; see section 2) |
| 10 areas with a `RESUME.md` (F-9) | 9 |
| The colo compose file runs `animus` (F-4) | Defined under profile `mind`, skipped by default |
| Register has no README (component table) | `threshold/register/README.md` exists |
| About 40 repo-check gate modules (R24) | 19 modules and 51 test files |
| 5 workflows plus Dependabot (working notes) | 6 workflows |
| `docs/analysis/` about 3.2 MB | 3,553,348 bytes |
| `docs/spec.md` is 1643 lines (section 2, first pass of this page) | 2135 lines (`(Get-Content docs/spec.md).Count`; `git show HEAD:docs/spec.md \| wc -l`) |
| `docs/glossary.md` is 30 lines (section 2, first pass) | 41 lines at cd4499da (`(git show HEAD:docs/glossary.md).Count`) |
| The MCP prompts are not found (F-14, first pass) | Defined in `threshold/mcp-mock/src/prompts.ts`; served by the production server through `threshold/mcp/src/resources.ts` and `world-session.ts` |
| The spec names a person in section 5.15.5 (F-16, first pass) | 25 lines, from line 10 to line 1915 |

The "first pass" rows were found by the W0 review on 2026-11-16 and corrected here.

### 13.1 Re-derived lists

The results of the [re-derive commands](../../agents/doc-verification.md#re-derive-lists) on 2026-11-16 at cd4499da, before `docs/analysis/docs-library/` was added. Later runs give different analysis counts (see the note under the table). Moved here from the verification how-to after the W0 review, so the how-to holds steps only.

| List | Result |
|---|---|
| Decision records | 180; highest number 0352 |
| Index rows whose status starts "Proposed" | 40 |
| Runbooks | 19 |
| Migrations | 44: 0001-0027, 0032-0040, 0050-0052, 0060-0063, 0065 |
| Prompt files | 17 templates (thought v1-v5, reflection v1-v2, body-api v1-v10) and a README |
| CI workflows | 6 |
| Tools | 14 directories |
| Repo-check sources | 19 modules, 51 test files |
| Workspace packages | 13 entries plus `tools/*` |
| Analysis | 13 areas, 333 files |
| Campaign RESUME files | 9 |
| Agent-read schemas | `mcp-world`, `mcp-play`, `mcp-common`, `common` (constant `AGENT_SCHEMAS` in `contract/test/agent-visible-text.test.ts`) |

Once `docs/analysis/docs-library/` is committed, the analysis commands give 14 areas, 335 files and 10 `RESUME.md` files. `Get-ChildItem docs/analysis -Directory` counts the folder as soon as it exists on disk; `git ls-files` counts its files only after the commit.
