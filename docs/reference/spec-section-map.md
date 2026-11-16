---
title: Spec section map
type: reference
audience: contributors
status: draft
last_verified: 2026-11-16 against cd4499da
companions: [../spec.md, glossary.md, repo-layout.md, README.md, ../decisions/README.md, decisions-by-topic.md]
sources: [docs/spec.md, docs/decisions]
---

# Spec section map

For each section of [the spec](../spec.md): the components that implement it, where their code is, the doc that explains or describes it, and the decision records that amend or settle it. Use it to find the code behind a spec section, or the decisions to read before you trust a section's text. The spec is never edited ([decision 0073](../decisions/0073-spec-is-never-edited.md)); decisions amend it.

## How this map was built

- **Sources**: the metadata lists the spec and the decisions folder; the code paths in the table come from `git ls-files` and `git grep` over the source folders.
- **Headings**: `grep -n '^#' docs/spec.md` on commit `cd4499da`, 2026-11-16. The spec is 2135 lines (`wc -l`). Lines starting with `#` inside the spec's code blocks (compose file comments in 6.5, the kit files in Appendix J) are not sections and are left out.
- **Decisions**: each record's `Spec:` header, extracted with grep on 2026-11-16. 124 of the 180 records state one: 121 as a line starting `- Spec:`, and 3 inline (0135, whose header items are joined on its first line, and 0350 and 0351, which write `Spec:` without the list dash). 7 of the 124 say the record has no spec section (0132, 0186, 0220, 0280, 0281, 0282, 0339). The other 56 records have no `Spec:` header, so they are not mapped here; the [decisions by topic](decisions-by-topic.md) page places them. Records 0360 to 0366 came after this count (2026-11-16, re-read at 02e9ee34): 0364 is listed under 8.4 and 0366 under 5.14; 0361 names sections 2 and 8 as a whole; 0360, 0363 and 0365 name no section; 0362 names 2a and 3 without changing them. A decision is listed under each section its `Spec:` line names; a decision that names only a parent section (for example "5.3") is listed there, not under every subsection.
- **Code**: paths from `git ls-files`. "Spec only" means `git grep` over the source folders found no implementation.
- **Planned docs**: paths from the documentation plan (wave W0 to W6). All 98 relative links on this page resolved on 2026-11-16 (checked with a link script at `3f07a4be`). Docs marked "agents-never" are operator material.

## Map

| Spec section | Components | Code | Planned doc | Decisions |
|---|---|---|---|---|
| 1 Plain-English summary | whole system | n/a | [what-is-geldar](../concepts/what-is-geldar.md) | none |
| 2 Principles | whole system; world operations | Principle 1 holds across packages (`CLAUDE.md`) | [principles-in-practice](../concepts/principles-in-practice.md), [world-operations-exceptions](../concepts/world-operations-exceptions.md) | 0048, 0058, 0072, 0075, 0077, 0135, 0137, 0144, 0156, 0166, 0185, 0350, 0351 |
| 2a Names | product names | package names in `*/package.json` | [glossary](glossary.md) | 0166 |
| 3 Glossary | n/a | n/a | [glossary](glossary.md) | none |
| 4.1 The split: colo and patrons | Colo, Thinkers | `compose/colo.yml`, `lantern-local/` | [system-overview](../architecture/system-overview.md) | none |
| 4.2 Diagram | whole system | n/a | [system-overview](../architecture/system-overview.md) | none |
| 4.3 Data flow for one thought | Body, Mind, Thinker, events | `golem/`, `player-core/`, `animus/`, `eventsink/` | [data-flow-events](../architecture/data-flow-events.md), [trace-one-action](../guides/trace-one-action.md) | none |
| 4.4 The Allocator | Allocator | Spec only | [system-overview](../architecture/system-overview.md) | none |
| 5.1 World Server | Paper, Velocity, Geldar-Core, third-party plugins | `compose/paper/`, `compose/velocity/`, `plugin/`, `plugins/`, `shards/phase0.yaml` | [compose-stacks](compose-stacks.md), [geldar-core-plugin](geldar-core-plugin.md), [third-party-plugins](third-party-plugins.md), [shard-config](shard-config.md) | 0005, 0021, 0022, 0024, 0029, 0040, 0050 |
| 5.2 Body Layer | Golem, player-core | `golem/src/` (actions, perception, body, reflexes), `player-core/src/link/` | [body-and-mind](../concepts/body-and-mind.md), [golem-body](golem-body.md) | 0006, 0022, 0030, 0032, 0037, 0039, 0043, 0047, 0048, 0141, 0142, 0154, 0156, 0199 |
| 5.3 Mind Layer | Animus, player-core | `animus/src/`, `player-core/src/` | [body-and-mind](../concepts/body-and-mind.md), [animus-mind](animus-mind.md), [player-core](player-core.md) | 0043, 0047, 0050, 0064, 0068, 0069, 0260 |
| 5.3.1 Durable intents | Animus, Golem | `contract/schemas/thought.schema.json`, `intent-event.schema.json`; `golem/src/body/` | [animus-mind](animus-mind.md) | 0033, 0063, 0064, 0065, 0066, 0143 |
| 5.3.2 The attention controller | Animus, player-core | `player-core/src/attention/`, `animus/src/attention/`; `contract/src/subjects.ts` | [animus-mind](animus-mind.md), [nats-subjects](nats-subjects.md) | 0025, 0033, 0063, 0065, 0067, 0143 |
| 5.3.3 Spend reasoning by decision | Animus, model pins | `shards/phase0.yaml` model pins | [animus-mind](animus-mind.md) | 0051, 0060, 0157 |
| 5.3.4 The thinking loop | Animus, player-core | `player-core/src/loop/`, `player-core/src/validate/` | [animus-mind](animus-mind.md) | 0049, 0062 |
| 5.4 Memory | Animus | `animus/src/memory/` | [character-and-memory](../concepts/character-and-memory.md), [animus-mind](animus-mind.md) | 0074 |
| 5.5 Skills and Books | Golem, database | `golem/src/books/`; `skills`, `skill_library`, `books` tables (`sql/0001_init.sql`) | [golem-body](golem-body.md), [database-schema](database-schema.md) | 0048, 0146 |
| 5.6 Model Pool | lantern-local, Animus Thinker hub | `lantern-local/src/`, `animus/src/thinker/` | [lantern-thinker-protocol](lantern-thinker-protocol.md) | 0049, 0050 |
| 5.7 Metabolism (Thinking Budget) | MCP budget | `threshold/mcp/src/budget/` | [economy-and-budgets](../concepts/economy-and-budgets.md), [mcp-tools](mcp-tools.md) | 0057, 0062, 0079 |
| 5.8 Communication | Geldar-Core speech and proximity | `plugin/core/.../speech/`, `.../proximity/`; `contract/schemas/speech-event.schema.json`, `heard-muffled-event.schema.json` | [geldar-core-plugin](geldar-core-plugin.md) | 0146, 0199 |
| 5.9 Life Cycle | Register, database, life registry | `threshold/register/`; `sql/0023_death_count.sql`, `0039`, `0040` (account deletion); `golem/src/registry.ts` | [life-cycle-of-a-life](../concepts/life-cycle-of-a-life.md), [retire-an-agent](../runbooks/retire-an-agent.md) | 0051, 0065, 0144, 0146 |
| 5.10 Governance | Moot Stone | Spec only | none planned | none |
| 5.11 Code Sandbox | Skill sandbox | Spec only (no sandbox found in `golem/src/`) | none planned | none |
| 5.12 The Historian | Historian | Spec only | none planned | none |
| 5.13 The Observatory | Glass, Kino, BlueMap | `glass/`, `plugins/bluemap/`, `plugin/core/.../kino/`, `.../lakitu/` | [observation-and-privacy](../concepts/observation-and-privacy.md) (agents-never), [glass-and-kino](glass-and-kino.md) (agents-never) | 0166 |
| 5.14 Shards and Time | shard config, environments, tick rate | `shards/`, `envs/`, `golem/src/bench/` | [time-shards-and-phases](../concepts/time-shards-and-phases.md), [shard-config](shard-config.md) | 0038, 0047, 0059, 0366 |
| 5.15 Sovereign Players | MCP, Register, player host | `threshold/mcp/`, `threshold/register/`, `tools/players-cli/`, `supervisor/`, `body-helper/` | [sovereign-players](../concepts/sovereign-players.md), [mcp-tools](mcp-tools.md), [register-service](register-service.md) | 0036, 0053, 0055, 0056, 0059, 0060, 0090, 0091, 0093, 0135, 0151, 0152, 0153, 0155, 0162, 0171, 0172, 0261, 0262 |
| 5.15.1 The compliance rule | MCP harness list | harness field in `tools/mcp-tokens` | [sovereign-players](../concepts/sovereign-players.md) | 0044, 0045, 0046, 0052, 0180 |
| 5.15.2 Architecture | MCP presence | `threshold/mcp/src/presence.ts`; `contract/schemas/presence-record.schema.json` | [sovereign-players](../concepts/sovereign-players.md) | none |
| 5.15.3 The Geldar MCP server | MCP tools | `threshold/mcp/src/tools/`; `contract/schemas/mcp-*.schema.json` | [mcp-tools](mcp-tools.md) | 0033, 0034, 0035, 0054, 0069, 0135, 0143 |
| 5.15.4 The Player Repo | kit (sibling repo) | Not in this repo | [scriptorium](../siblings/scriptorium.md) | none |
| 5.15.5 Starter kit and onboarding | kit, MCP tokens, roster | `tools/mcp-tokens/`; `sql/0024_mcp_roster.sql` | [scriptorium](../siblings/scriptorium.md), [mcp-tools](mcp-tools.md) | 0068, 0108 |
| 5.15.6 One human, many players | owner cap, owner keys | `sql/0006_owner_cap_trigger.sql`, `sql/0011`; `tools/mcp-tokens/src/owners.ts`; `sql/0026`, `0035` | [register-service](register-service.md), [glossary: owner cap](glossary.md#owner-cap-in-detail) | 0052, 0057, 0089, 0135, 0152, 0170, 0173, 0261 |
| 5.15.7 Running cheap | kit | Not in this repo | [scriptorium](../siblings/scriptorium.md) | none |
| 5.15.8 Humans and Principle 1 | MCP, Register | `threshold/` | [principles-in-practice](../concepts/principles-in-practice.md) | none |
| 5.15.9 What we can and can't verify | MCP | `threshold/mcp/` | [sovereign-players](../concepts/sovereign-players.md) | none |
| 6.1 Colo: internal zone | Colo stack, Mind placement | `compose/colo.yml`, `shards/colo-mind.yaml` | [deployment-topology-colo](../architecture/deployment-topology-colo.md) | 0070, 0078, 0083, 0131 |
| 6.2 Colo: DMZ zone | public edge, Caddy | `deploy/caddy/`, `compose/colo-public.yml` | [network-and-trust-zones](../architecture/network-and-trust-zones.md) | 0070, 0071, 0094, 0096 |
| 6.3 Patron side: Thinkers | lantern-local | `lantern-local/` | [lantern-thinker-protocol](lantern-thinker-protocol.md) | 0078, 0083 |
| 6.4 Networking | compose networks, Caddy, tunnel | `compose/*.yml`, `compose/cloudflared/`, `deploy/caddy/` | [network-and-trust-zones](../architecture/network-and-trust-zones.md) | 0071, 0094, 0096 |
| 6.5 Containers | images, NATS accounts | `*/Dockerfile*`, `compose/nats-auth*.yml` | [compose-stacks](compose-stacks.md), [nats-topology](../architecture/nats-topology.md) | 0021, 0067, 0080, 0087 |
| 6.6 Repositories | workspace layout | `pnpm-workspace.yaml` | [repo-layout](repo-layout.md), [siblings index](../siblings/README.md) | 0004 |
| 6.7 Secrets | secret files | `deploy/gen-secrets.sh`, `deploy/compose.secrets.yml`, `./geldar.ps1 shard secrets` | [secrets-by-role](../security/secrets-by-role.md), [rotate-secrets-by-role](../runbooks/rotate-secrets-by-role.md) | 0021 |
| 6.8 Backups | backups (deferred), pre-deploy dump | `contract/schemas/checkpoint-manifest.schema.json` (unused until the backup packet, per its description); `deploy/colo-cd.sh` writes a pre-deploy SQL dump (lines 390 to 391) | [backup-and-restore](../runbooks/backup-and-restore.md) | 0076, 0130 |
| 7 Observability | events, eventsink, Glass, telemetry | `contract/schemas/event.schema.json`, `eventsink/`, `glass/` | [data-flow-events](../architecture/data-flow-events.md), [telemetry-pipeline](../architecture/telemetry-pipeline.md) (agents-never), [monitoring-and-vitals](../operations/monitoring-and-vitals.md) (agents-never) | 0020, 0026, 0027, 0041, 0042, 0067, 0072, 0075, 0350, 0351, 0352 |
| 8 Security (8.1 to 8.3) | whole system | n/a | [security index](../security/README.md); existing [threat-model](../threat-model.md) | 0044 |
| 8.4 Human identity: watchers and ghosts | Velocity spectator proxy, Glass access | `plugin/velocity-identity/`, `compose/velocity/` | [authn-authz-map](../security/authn-authz-map.md) | 0040, 0071, 0075, 0077, 0092, 0137, 0364 |
| 8.4b Sovereign players: OAuth, scopes | MCP tokens | `threshold/mcp/src/store/` | [authn-authz-map](../security/authn-authz-map.md) | none (0054 replaces OAuth, cited under 5.15.3) |
| 8.5 Application-layer controls | MCP, Register | `threshold/` | [authn-authz-map](../security/authn-authz-map.md) | none |
| 8.6 Host hardening | Colo node | `compose/colo.yml` limits, `deploy/` | [deployment-topology-colo](../architecture/deployment-topology-colo.md) | 0080, 0082 |
| 8.7 Supply chain | pins, Dependabot | `pnpm-workspace.yaml`, `.github/dependabot.yml`, `plugin/gradle/` | [supply-chain](../security/supply-chain.md) | 0005 |
| 8.8 Logging, detection, response | logs, incident handling | n/a | [incident-response](../runbooks/incident-response.md) | none |
| 8.9 Assurance | external port scan | `tools/portscan/` | [authn-authz-map](../security/authn-authz-map.md) | 0094, 0150 |
| 8.10 What this does not protect against | n/a | n/a | [security index](../security/README.md) | none |
| 9 Cost Model | capacity and cost | Spec only | [capacity-and-cost](../operations/capacity-and-cost.md) | none |
| 10 Rollout Plan (Phase 0 to 5) | phases | `docs/analysis/phase0/`, `docs/analysis/phase1/` | [phase0-summary](../history/phase0-summary.md), [phase1-summary](../history/phase1-summary.md) | 0002, 0020, 0021, 0038, 0061, 0066, 0070, 0076, 0078, 0080, 0082, 0087, 0130, 0131, 0188 |
| 11 Runbook | operations | `docs/runbooks/` | [runbooks index](../runbooks/README.md), [incident-response](../runbooks/incident-response.md) | 0003, 0063, 0064 |
| 12 Risks | n/a | n/a | none planned | none |
| 13 Open Decisions | decision records | `docs/decisions/` | [decision-timeline](../history/decision-timeline.md) | 0001, 0002, 0006, 0024, 0073, 0083, 0084 |
| Appendix A Perception Snapshot Schema | contract | `contract/schemas/snapshot.schema.json` | [contract-schemas](contract-schemas.md) | 0001, 0025 |
| Appendix B Prompt Templates | prompts | `prompts/` | [prompt-templates](prompt-templates.md) (agents-never) | 0058 |
| Appendix C Thought Output Schema | contract | `contract/schemas/thought.schema.json` | [contract-schemas](contract-schemas.md) | 0001, 0030, 0031 |
| Appendix D Database Schema | database | `sql/` | [database-schema](database-schema.md) | 0001, 0020, 0023, 0025, 0026, 0027, 0041, 0043, 0051, 0055, 0056, 0058, 0185 |
| Appendix E `shard.yaml` | shard config | `shards/`, `contract/schemas/shard-config.schema.json` | [shard-config](shard-config.md) | 0028, 0051 |
| Appendix F Geldar-Core Plugin | Geldar-Core, Velocity identity | `plugin/core/`, `plugin/velocity-identity/` | [geldar-core-plugin](geldar-core-plugin.md), [velocity-identity-plugin](velocity-identity-plugin.md) | 0021, 0040, 0041, 0092 |
| Appendix G Hypotheses | n/a | n/a | none planned | none |
| Appendix H Gateway Protocol | Thinker protocol | `contract/src/thinker-token.ts`, `contract/schemas/thinker-frame.schema.json`, `lantern-local/` | [lantern-thinker-protocol](lantern-thinker-protocol.md) | 0001, 0028, 0049 |
| Appendix I Enrollment Flow | Thinker enrollment | Spec only | [lantern-thinker-protocol](lantern-thinker-protocol.md) | none |
| Appendix J Player Repo Starter Kit | kit (sibling repo) | Not in this repo | [scriptorium](../siblings/scriptorium.md) | none |
| Appendix K Geldar MCP Tool Schemas | MCP tools | `contract/schemas/mcp-*.schema.json` | [mcp-tools](mcp-tools.md) | 0033, 0034, 0055 |
| Appendix L Review Disposition | history | n/a | [decision-timeline](../history/decision-timeline.md) | none |

## Known gaps in this map

- 56 decision records carry no `Spec:` header and are not mapped (for example 0088, 0095, 0100, 0101, 0133, 0134, 0136, 0138 to 0140, 0147 to 0149, 0160, 0164, 0167 to 0169, 0181 to 0184, 0187, 0190 to 0198, 0210 to 0219, 0221 to 0226, 0250, 0310, 0330 to 0338, 0341). Many are Body behaviour rulings (5.2) and Observatory rulings (5.13) by title; that placement is inferred from titles only and is not in the table.
- Some records name spec text by line number or by a phrase instead of a section (for example 0068, 0070, 0074, 0145, 0154, 0163, 0165). Those were placed by the section they also name, or left to the [decisions by topic](decisions-by-topic.md).
- The table of contents in the spec (line 16) lists sections; this map follows the headings, not the table of contents.
