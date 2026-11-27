---
title: Glossary
type: reference
audience: contributors
status: draft
last_verified: 2026-11-16 against cd4499da
companions: [../spec.md, ../glossary.md, repo-layout.md, spec-section-map.md, README.md]
sources: [docs/spec.md, docs/glossary.md, contract/src/subjects.ts, contract/schemas/common.schema.json, contract/schemas/presence-record.schema.json, golem/src/registry.ts, sql/0002_sovereign_mcp.sql, sql/0006_owner_cap_trigger.sql, sql/0010_register_definer_functions.sql, sql/0011_register_signup_function.sql, sql/0013_register_daily_owner_cap.sql, sql/0014_kino_access.sql, sql/0060_turn_records.sql, tools/mcp-tokens/src/owners.ts, threshold/mcp/src/store/pg-tokens.ts, shards/phase0.yaml, shards/colo-mind.yaml, docs/decisions]
---

# Glossary

Terms as Geldar's spec, code and decision records use them. Each entry gives a one-line meaning, where the term lives in the code (when it does), and the record or doc that settles it. The spec's own definitions are in [spec section 2a (names)](../spec.md#2a-names) and [section 3 (glossary)](../spec.md#3-glossary); this page extends them with the words the code added and records where code and spec disagree.

How to read the "In code" column: a path means the term is implemented there. "Spec only" means a search of the source folders (`git grep`, 2026-11-16, commit `cd4499da`) found no implementation. Inferred facts are marked as such.

Sources beyond the metadata list: spec sections 2, 2a, 3 and 5.15.6; the `docs/glossary.md` text as it stood at `cd4499da` (now a pointer to this page); and the `description` field of each package's `package.json`.

Groups: [The world](#the-world), [People and ownership](#people-and-ownership), [The agent](#the-agent), [Identity and access](#identity-and-access), [Observation](#observation), [Services and packages](#services-and-packages), [Data and messages](#data-and-messages), [Work and process](#work-and-process). Contested terms are listed in [Conflicts recorded](#conflicts-recorded).

## The world

| Term | Meaning | In code | See |
|---|---|---|---|
| **Vivarium** | The kind of thing Geldar is: a living enclosure for agents to live in and be observed. Geldar is the name, vivarium the noun. | n/a | [spec 2a](../spec.md#2a-names) |
| **Geldar** | The project, the world, the CLI, the package scope `@geldar/*`, the repo and the hostnames. | `package.json` (workspace root) | [spec 2a](../spec.md#2a-names) |
| **Shard** | One complete world: server, agents and database. Shards run side by side as separate experiments, one database each. | `shards/*.yaml`; `contract/schemas/shard-config.schema.json` | [spec 3](../spec.md#3-glossary), 5.14; [decision 0026](../decisions/0026-one-database-per-shard.md) |
| **phase0 shard** | The Phase 0 shard, configured by `shards/phase0.yaml` and started from `compose/phase0.yml`. | `shards/phase0.yaml` | [decision 0002](../decisions/0002-phase0-host-and-models.md) |
| **Colo** | The hosted environment that runs the world and the Mind (spec 4.1). Its stack is `compose/colo.yml`. | `compose/colo.yml`, `shards/colo.yaml`, `shards/colo-mind.yaml`, `deploy/` | spec 4.1, 6.1; [decision 0070](../decisions/0070-phase1-is-the-colo-first-shard.md) |
| **Node** | The machine the Colo stack runs on, in decision records and runbooks. Its facts are not recorded here. | `deploy/` scripts run there | [decision 0084](../decisions/0084-colo-deploy-by-pull-with-a-project-scoped-script.md) |
| **Research shard** | A shard that is headless only, with pinned models and pre-registered hypotheses. | Spec only | [spec 2](../spec.md#2-principles), principle 7 |
| **The Commons** | The exhibition shard, open to sovereign players and their humans. | Spec only | [spec 2](../spec.md#2-principles), principle 7 |
| **Watched / Unwatched** | Whether humans may observe a shard (`identity_mode`). | `identity_mode` in `shards/phase0.yaml` and `shards/colo-mind.yaml` | spec 5.14; [decision 0059](../decisions/0059-identity-mode-is-about-human-observation-not-agent-belief.md) |
| **Hallona** | The informal lore name of the control shard. | Spec only | [spec 2a](../spec.md#2a-names) |
| **Tick** | Minecraft's heartbeat, 20 per second on every shard. | `golem/src/bench` varies the tick rate for the benchmark | [spec 3](../spec.md#3-glossary), 5.14; [decision 0038](../decisions/0038-tick-rate-does-not-slow-a-client-driven-body.md) |
| **Shrine** | A block where agents offer items for more thinking budget. | Named in the `OfferInput` description in `contract/schemas/mcp-world.schema.json`; no Shrine block found in `plugin/` | [spec 3](../spec.md#3-glossary), 5.7 |
| **Moot Stone** | The in-world place where agents vote. | Spec only (governance, spec 5.10) | spec 5.10, 5.15.6 |
| **Cradle** | An in-world place name. | Spec only | [spec 2a](../spec.md#2a-names) |
| **Gravestone** | The stone and sign the world places at a death position, recorded as owned by the system. | `plugin/core/src/main/java/dev/geldar/core/GraveBackfill.java` and `GeldarCore.java` | [decision 0195](../decisions/0195-gravestones-owned-by-system.md) (Proposed) |
| **Block owner** | Who placed a block, answered from CoreProtect's log by Geldar-Core. | `plugin/core/.../blockowner/`; `contract/schemas/block-owner.schema.json` | [decision 0165](../decisions/0165-block-owner-subjects.md); [runbook](../runbooks/block-owner.md) |
| **Muffled hearing** | Walls absorb speech; a listener past the effective distance gets a muffled notice instead of the words. | `hearingSubject` in `contract/src/subjects.ts`; `contract/schemas/heard-muffled-event.schema.json` | [decision 0199](../decisions/0199-muffled-hearing.md) (Proposed) |
| **Maintenance notice** | A server-wide notice published before planned work on the world. | `plugin/core/.../maintenance/`; `golem/src/publish-maintenance-notice.ts`; `compose/colo-notice.yml` | [runbook](../runbooks/maintenance-notice.md) |

## People and ownership

| Term | Meaning | In code | See |
|---|---|---|---|
| **Owner** | A human who owns sovereign players. One owner row per signed-in identity. Owners never act in the world. | Table `mcp_owners` (`sql/0002_sovereign_mcp.sql`) | spec 5.15.6; [decision 0135](../decisions/0135-self-registration-with-github-and-discord.md) |
| **Player** | Used two ways. Spec and code: an agent (`mcp_players`, `player_id`, "sovereign player"). The old glossary: the human owner. Prefer **Owner** for the human. | Table `mcp_players` (`sql/0002_sovereign_mcp.sql`) | [Conflicts recorded](#conflicts-recorded), item 2 |
| **Owner cap** | The most non-retired sovereign players one owner may hold on a shard. Default 3, the operator's own 20, stored per owner and **enforced by a database trigger** since migration 0006. | `mcp_owners.player_cap`; trigger `mcp_players_owner_cap` running `mcp_enforce_owner_cap()` (`sql/0006`, `sql/0011`) | [Owner cap in detail](#owner-cap-in-detail); [decision 0052](../decisions/0052-per-owner-sovereign-player-cap-raised-to-20.md) |
| **Lifetime creation cap** | At most 10 players created per owner through the register service, retired ones included. | `register_create_player` (`sql/0010_register_definer_functions.sql`) | [decision 0135](../decisions/0135-self-registration-with-github-and-discord.md), ruling R36, R41 |
| **Patron** | A person who donates compute by running a Thinker. | Spec only | [spec 3](../spec.md#3-glossary), 6.3 |
| **Ghost** | A human spectator account: invisible, silent, cannot interact. | Spec term; spectator admission is in `plugin/velocity-identity/` and `compose/velocity/` (inferred from decision 0092) | [spec 3](../spec.md#3-glossary), 8.4; [decision 0092](../decisions/0092-velocity-spectator-whitelist.md) |
| **Operator** | The person who runs a shard and its node. In Phase 0 and 1 this is the owner of the project. | `deploy/colo-admin.sh`, `tools/mcp-tokens` | [decision 0052](../decisions/0052-per-owner-sovereign-player-cap-raised-to-20.md) |
| **Co-owner** | Sam. Rules on cognition work (memory spine, sheets, harness) and on releases: rollout order, release gates, tags. | Decision records | [decision 0431](../decisions/0431-corrections-to-0391-0393-release-tags-by-bot.md) |

## The agent

| Term | Meaning | In code | See |
|---|---|---|---|
| **Agent** | One resident with a name and a life. Exactly one Body and one Mind; only agents act in the world. | Life ids in `contract/schemas/common.schema.json` | [spec 3](../spec.md#3-glossary) |
| **Headless agent** | An agent with no owner, whose Mind runs on a machine the project runs. Adam is one. | `lantern-local/` | spec 5.3; [decision 0050](../decisions/0050-phase0-mind-processes-run-on-the-host.md) |
| **Sovereign player** (sovereign agent) | An agent whose Mind is a person's own session of a vendor CLI, with memory in its own repo. It reaches the world only through the Geldar MCP. | `threshold/mcp/`; tables `mcp_players`, `mcp_tokens` | [spec 3](../spec.md#3-glossary), 5.15 |
| **Adam** | The first headless agent; the Phase 0 subject. On the Colo, its Body runs under the compose profile `adam`. | `golem/src/adam/`, `tools/adam-cli`, `tools/adam-run`, `tools/adam-report` | [decision 0051](../decisions/0051-adam-identity-and-model-pins.md), [0212](../decisions/0212-golem-body-is-a-profile-adam.md) |
| **Rangers** | The first group of six sovereign players, run by the operator under the owner cap of 20. | `tools/players-cli` (`./geldar.ps1 players`) | [decision 0052](../decisions/0052-per-owner-sovereign-player-cap-raised-to-20.md) |
| **Body** | The bot process logged into the server as a player. It moves, digs, fights, eats and runs reflexes. Product name Golem. | `golem/` | [spec 3](../spec.md#3-glossary), 5.2 |
| **Mind** | The service that builds prompts, calls a model and returns decisions. The live Mind is the scriptorium (Claude-driven, outside this repo); the in-repo Mind was removed, see [decision 0430](../decisions/0430-remove-animus.md). | `player-core/` (shared Mind pieces) | [spec 3](../spec.md#3-glossary), 5.3 |
| **Model** | A language model. One Mind uses one model for the life of the agent. | Model pins in `shards/phase0.yaml` | [spec 3](../spec.md#3-glossary), 5.3.3; [decision 0051](../decisions/0051-adam-identity-and-model-pins.md) |
| **Thinker** | The software that runs a model for a Mind. It holds no agent state and never touches the database or the game. | `lantern-local/` (local Thinker on Ollama) | [spec 3](../spec.md#3-glossary), Appendix H |
| **Lantern** | The Thinker bundle a Patron runs. Phase 0 has a local version. | `lantern-local/` | [spec 2a](../spec.md#2a-names); [decision 0050](../decisions/0050-phase0-mind-processes-run-on-the-host.md) |
| **Harness** | Whatever program drives a model's loop. For sovereign players it is always the vendor's own CLI. | Harness names in `mcp_players` rows (`tools/mcp-tokens`) | [spec 3](../spec.md#3-glossary), 5.15.1 |
| **Intent** | A durable goal the Mind sets for the Body. It runs to completion or is interrupted without a model call per step. | `contract/schemas/thought.schema.json`, `intent-event.schema.json` | spec 5.3.1 |
| **Plan** | The message that carries a Mind's intent and actions to a Body. | `planSubject` in `contract/src/subjects.ts`; `contract/schemas/plan.schema.json` | spec 5.3.2 |
| **Thought** | One call from a Mind to a model: perception in, decisions out. It records the template version it used. | `contract/schemas/thought.schema.json`, `thought-event.schema.json`; templates in `prompts/thought/` | [spec 3](../spec.md#3-glossary), Appendix D |
| **Wake** | The event that makes the Mind think again (damage, a finished intent, a timer). | `contract/schemas/wake-event.schema.json` | spec 5.3.2; [decisions 0065](../decisions/0065-damage-wakes-the-mind.md), [0069](../decisions/0069-no-plan-wake-is-not-a-failure.md) |
| **Reflex** | An action the Body takes without asking the Mind, such as eating when starving. Reflexes always emit an event. | `golem/src/body/reflexes/`; `contract/schemas/reflex-fired-event.schema.json` | [spec 3](../spec.md#3-glossary); [decision 0148](../decisions/0148-reflexes-are-never-silent.md) |
| **Receipt** | The record of one action: what was asked, what the world did, the outcome. Every action ends with exactly one final receipt. | `contract/schemas/receipt.schema.json` | [decision 0020](../decisions/0020-receipts.md), [0027](../decisions/0027-final-receipt-constraints.md) |
| **Snapshot** | The Body's perception of its surroundings, versioned by a revision number. | `snapshotSubject` in `contract/src/subjects.ts`; `contract/schemas/snapshot.schema.json` | spec Appendix A; [decision 0025](../decisions/0025-snapshot-revision.md) |
| **Play view** | The snapshot as the MCP presents it to a sovereign player. | `threshold/mcp/src/play-view.ts`, `play-view/` | [decision 0162](../decisions/0162-perception-vertical-reach-edible.md) |
| **Journal** | The agent's own running notes. For a sovereign player it is also mirrored by the MCP. Journals are append-only. | `sql/0007_journals_append_only.sql` | spec 5.15; [decision 0339](../decisions/0339-journal-reset-one-time-exception.md) (one-time exception) |
| **Skill** | A reusable piece of code an agent has written. | Tables in `sql/0001_init.sql` (`skills`, `skill_library`) | [spec 3](../spec.md#3-glossary), 5.5; [decision 0023](../decisions/0023-skill-foreign-keys.md) |
| **Book** | An in-game written book; the only way skills spread. | `bookSubject` in `contract/src/subjects.ts`; `golem/src/books/` | [spec 3](../spec.md#3-glossary), 5.5 |
| **Credits** | The unit of thinking budget; about one standard thought each. | `threshold/mcp/src/budget/` | spec 5.7; [decisions 0057](../decisions/0057-sovereign-budget-numbers-and-wake-spacing.md), [0079](../decisions/0079-credit-numbers-and-charge-rules.md) |
| **Presence** | A sovereign life's state: `awake`, `dim` or `hibernating`, and whether its Body should be up. | `PRESENCE_BUCKET` (`geldar-presence`) in `contract/src/subjects.ts`; `contract/schemas/presence-record.schema.json`; `threshold/mcp/src/presence.ts` | spec 5.15.2, 5.15.6 |
| **Dim** | Spec glossary: an agent whose budget is spent. Code and spec 5.15.6: the presence state after the call lease lapses. | `presence-record.schema.json` (`state`) | [Conflicts recorded](#conflicts-recorded), item 3 |
| **Hibernating** | No Mind is available, so the Body shelters and logs out until one returns. | `presence-record.schema.json` (`state`, `desired_body: down`) | [spec 3](../spec.md#3-glossary), 5.15.6 |
| **Character sheet** | An agent's innate scores (1 to 5), adopted once per life. | `contract/schemas/character-sheet.schema.json`; `psyche/src/sheet.ts`; `sql/0050_character_sheet_xp.sql` | [decisions 0186](../decisions/0186-character-sheet-assumed-answers.md), [0282](../decisions/0282-sheet-erasure-covers-dead-lives.md) |
| **Proficiency** | Experience in seven domains (combat, farming, mining, building, crafting, exploring, social). | `psyche/src/proficiency.ts`; `contract/schemas/proficiency-*.schema.json` | [decision 0280](../decisions/0280-proficiency-contract-and-state-subjects.md) |

## Identity and access

| Term | Meaning | In code | See |
|---|---|---|---|
| **Life** | One agent's registered identity and lifecycle, from birth to death. | Life id pattern in `contract/schemas/common.schema.json` | spec 5.9; [decision 0051](../decisions/0051-adam-identity-and-model-pins.md) |
| **Life id** | The id of a life, `ag_<name>_<NN>` (underscores). Used in NATS subjects. | `LIFE_ID` in `contract/src/subjects.ts`; `LifeId` in `common.schema.json` | [Conflicts recorded](#conflicts-recorded), item 5 |
| **Player id** | The id of a sovereign player, `ag-<name>-<NN>` (hyphens). Used in MCP URLs `/p/<player_id>`. | `golem/src/players/player-config.ts`; `tools/mcp-tokens/src/players.ts`; `threshold/register/src/account.ts` | [decision 0054](../decisions/0054-static-hashed-per-player-bearer-tokens.md) |
| **Life registry** | The NATS KV bucket `geldar-life-registry` of usernames allowed through the bot ingress. Golem writes it; the Velocity gate reads it and fails closed. | `REGISTRY_BUCKET` in `golem/src/registry.ts`; `plugin/velocity-identity/` | [decision 0040](../decisions/0040-bot-ingress-registry-in-nats-kv.md) |
| **Velocity identity** (gate) | The Velocity proxy plugin that admits only registered bot usernames. | `plugin/velocity-identity/` | [decisions 0021](../decisions/0021-velocity-from-phase0.md), [0040](../decisions/0040-bot-ingress-registry-in-nats-kv.md) |
| **Spectator proxy** | A Velocity proxy that is the only Minecraft surface for humans: Microsoft-authenticated, whitelisted, spectator mode only. | `compose/velocity/`; `plugin/velocity-identity/` | [spec 3](../spec.md#3-glossary), 8.4; [decision 0137](../decisions/0137-public-spectator-proxy-is-separate-and-online.md) |
| **Threshold** | The one door into the world: the Thinker job gateway and the player MCP server. In this repo the folder holds the MCP, its mock and the register service. | `threshold/mcp`, `threshold/mcp-mock`, `threshold/register` | [spec 2a](../spec.md#2a-names) |
| **Gateway** | The internet-facing API the Colo exposes to Thinkers (mutual TLS). | Spec only; Phase 0 Thinkers use the Mind's loopback socket instead | [spec 3](../spec.md#3-glossary), Appendix H; [decision 0050](../decisions/0050-phase0-mind-processes-run-on-the-host.md) |
| **Geldar MCP** | The Model Context Protocol server that exposes the world to sovereign players as tools. | `threshold/mcp/` (package `@geldar/mcp`) | [spec 3](../spec.md#3-glossary), 5.15.3, Appendix K |
| **MCP mock** | A stand-in for the Threshold MCP server with the real tool contract and a deterministic fake world (`threshold/mcp-mock/README.md`). The production server serves the MCP prompts from it. | `threshold/mcp-mock/` | [decision 0034](../decisions/0034-mock-result-shapes-and-untrusted-text.md) |
| **Player token** | A static Bearer token (`gmcp-` plus 64 hex characters) bound to one player id; only its hash is stored. | `threshold/mcp/src/store/token-hash.ts`; `tools/mcp-tokens` | [decision 0054](../decisions/0054-static-hashed-per-player-bearer-tokens.md); [runbook](../runbooks/mcp-tokens.md) |
| **Owner key** | A key an owner mints from a signed-in session to manage their players' Bodies through the owner API. | `sql/0026_owner_api_keys.sql`, `sql/0035_owner_keys_by_session.sql`; `threshold/register/src/owner-keys-*.ts` | [decision 0173](../decisions/0173-owner-keys-by-session-and-bearer-scope.md) |
| **Register** | The self-registration service: Microsoft personal-account sign-in, then owners, players and tokens. | `threshold/register/` | [decision 0135](../decisions/0135-self-registration-with-github-and-discord.md) (amendment R40); [Conflicts recorded](#conflicts-recorded), item 6 |
| **Roster** | The database list of sovereign player names, one owner per name. | Table `mcp_roster` (`sql/0024_mcp_roster.sql`) | [decision 0108](../decisions/0108-mcp-roster-source-of-truth.md) (Proposed) |
| **Principle 1** | No person acts inside the world; the code must give no way to. | Enforced by design across packages | [spec 2](../spec.md#2-principles) |

## Observation

These terms are named in the spec. Details of how observation works are operator material and stay out of this page (owner decision D9).

| Term | Meaning | In code | See |
|---|---|---|---|
| **The Observatory** | Everything humans use to watch: the map, dashboards, the thought stream, spectators. | Spec name; see Glass | [spec 3](../spec.md#3-glossary), 5.13 |
| **The Glass** | The product name of the Observatory: the human-only, read-only observation layer. | `glass/` (package `@geldar/glass`, "the Thought Stream server") | [spec 2a](../spec.md#2a-names); [decision 0072](../decisions/0072-glass-and-bluemap-are-public.md); [Conflicts recorded](#conflicts-recorded), item 4 |
| **Thought Stream** | The Glass view of agents' thoughts for human viewers. | `glass/src/` | spec 7; [decision 0138](../decisions/0138-thought-visibility.md) |
| **Kino** | The Glass's monitor wall of camera views (decision 0166). | `glass/src/kino/`, `glass/web/kino/`; `plugin/core/.../kino/` | [decisions 0075](../decisions/0075-glass-is-a-lakitu-camera.md), [0166](../decisions/0166-kino-monitor-wall-and-lakitu-camera.md); [runbook](../runbooks/kino.md) |
| **Lakitu** | The Glass's camera (decision 0075); its feed has a contract (decision 0100). | `plugin/core/.../lakitu/`; `contract/schemas/lakitu-feed.schema.json` | [decisions 0075](../decisions/0075-glass-is-a-lakitu-camera.md), [0100](../decisions/0100-lakitu-feed-contract.md) |
| **BlueMap** | The third-party web map of the world. | `plugins/bluemap/` | [decision 0072](../decisions/0072-glass-and-bluemap-are-public.md); [runbook](../runbooks/map-chat-panel.md) |
| **The Historian** | An agent with no body that reads the logs and writes the chronicle. | Spec only (a `historian_role` name appears in a comment in `sql/0001_init.sql`) | [spec 3](../spec.md#3-glossary), 5.12 |
| **Chronicle** | The Historian's output. | Spec only | [spec 2a](../spec.md#2a-names) |
| **Turn record** | A per-turn record for kit Minds (decision 0185). | `sql/0060_turn_records.sql`; `contract/schemas/turn-record-event.schema.json` | [decision 0185](../decisions/0185-per-turn-record-for-kit-minds.md) (Proposed); [Conflicts recorded](#conflicts-recorded), item 8 |

## Services and packages

| Term | Meaning | In code | See |
|---|---|---|---|
| **Golem** | Product name of the Body runtime. | `golem/` (`@geldar/golem`) | [spec 2a](../spec.md#2a-names) |
| **Animus** | Removed, see [decision 0430](../decisions/0430-remove-animus.md). Was the in-repo Mind service. | none | [decision 0430](../decisions/0430-remove-animus.md) || **player-core** | The neutral home of the live player path: Body and Mind links, validation, plan builder, ids. | `player-core/` | `player-core/package.json` description |
| **Psyche** | The character engine (sheet, proficiency, temperament), copied byte for byte into the kit. | `psyche/` | [decision 0281](../decisions/0281-psyche-package-boundary.md) |
| **Scriptorium** | The sovereign-player kit (repo-as-mind template), developed in separate repositories. | Not in this repo | [spec 2a](../spec.md#2a-names), 5.15.4 |
| **Player repo** | The GitHub repo that is a sovereign player's mind; its history is the agent's life. | Not in this repo | [spec 3](../spec.md#3-glossary), 5.15.4 |
| **Geldar-Core** | The Paper plugin that implements the world's own rules. | `plugin/core/` | [spec 2a](../spec.md#2a-names), Appendix F |
| **eventsink** | The service that copies the NATS event stream `GELDAR_EVENTS` into Postgres. | `eventsink/` | [decision 0041](../decisions/0041-event-export-stream-and-sink.md) |
| **Supervisor** | The service that serves a shard's Body control subjects and applies start quotas; it reaches Bodies only through the body helper and holds no Docker socket. | `supervisor/src/main.ts` (read 2026-11-16) | [decisions 0152](../decisions/0152-programmatic-body-management-for-owners.md), [0260](../decisions/0260-body-container-control-by-host-helper.md) |
| **Body helper** | The root-owned host service that starts and stops Body containers on the node, under a global cap. | `body-helper/src/main.ts`, `service.ts` | [decision 0260](../decisions/0260-body-container-control-by-host-helper.md); [runbook](../runbooks/body-helper-node-steps.md) |
| **Contract** | The JSON Schema source of truth for messages; TypeScript is generated from it. | `contract/schemas/`, generated `contract/src/generated/` | [decision 0001](../decisions/0001-contract-json-schema.md) |
| **Genesis environment** | A whole environment described as a value in `envs/<name>.yaml` and validated by a schema. | `envs/`; `tools/genesis-env` | [decision 0188](../decisions/0188-genesis-environment-stamp.md) (Proposed) |

## Data and messages

| Term | Meaning | In code | See |
|---|---|---|---|
| **Event** | One world fact on the NATS stream, `geldar.<shard>.<type>`, stored by eventsink in `events`. | `contract/schemas/event.schema.json`; `eventsink/src/config.ts` | spec 7; [decision 0041](../decisions/0041-event-export-stream-and-sink.md) |
| **Body subject** | A five-token request subject `geldar.<shard>.body.<life_id>.<verb>`, outside the event stream's filter. | `contract/src/subjects.ts` | The header comment of `contract/src/subjects.ts` (lines 1 to 5); [decision 0041](../decisions/0041-event-export-stream-and-sink.md) for the event filter `geldar.*.*` |
| **Checkpoint** | A running intent's saved state, kept in NATS KV in Phase 0. | `CHECKPOINT_BUCKET` (`geldar-checkpoints`) in `golem/src/body/checkpoint.ts` | [decision 0043](../decisions/0043-phase0-body-state-in-nats-kv-and-record-rules.md) |
| **Migration** | A numbered SQL file applied in name order and recorded in `schema_migrations`. | `sql/NNNN_*.sql`; `tools/migrate` | `sql/README.md`; [decision 0056](../decisions/0056-first-migration-runner-and-least-privilege-grants.md) |
| **Prompt template** | A versioned prompt file; a released version is never edited. | `prompts/thought/`, `prompts/reflection/`, `prompts/body-api/` | spec Appendix B, D; `prompts/README.md` |

## Work and process

| Term | Meaning | In code | See |
|---|---|---|---|
| **Phase** | A rollout stage of spec section 10 (Phase 0 "Adam", Phase 1 "Village", and later). | n/a | spec 10; [decisions 0066](../decisions/0066-phase0-closed-as-proof-of-life.md), [0070](../decisions/0070-phase1-is-the-colo-first-shard.md) |
| **Campaign** | A multi-PR effort run as packets, with a ledger and a `RESUME.md`. | `docs/analysis/<area>/` | `.claude/skills/campaign-packet/SKILL.md` |
| **Wave** | A group of packets in a campaign that run in parallel. | n/a | [Phase 0 ledger](../analysis/phase0/README.md) |
| **Packet** | One unit of planned implementation work, with its own branch, worktree and exit checks. | n/a | [Phase 0 ledger](../analysis/phase0/README.md) |
| **Decision record** | A numbered record of a settled decision; it amends the spec without editing it. | `docs/decisions/` | [decisions README](../decisions/README.md); [decision 0073](../decisions/0073-spec-is-never-edited.md) |
| **Ruling (Rnn)** | An owner answer recorded inside a decision record, cited by number. | n/a | e.g. [decision 0135](../decisions/0135-self-registration-with-github-and-discord.md) R40 to R42 |
| **Body benchmark** | The scripted survival benchmark at 20, 10 and 5 TPS. | `golem/src/bench/` (`./geldar.ps1 bench`) | `.claude/skills/body-bench/SKILL.md` |
| **Live lane** | Tests that need a running shard; excluded from `check` and CI. | `golem/vitest.live.config.ts` | `CLAUDE.md` |
| **Merge queue** | GitHub's merge queue on `main`. | `.github/` ruleset | [decision 0220](../decisions/0220-merge-queue-for-main.md) (Proposed); [runbook](../runbooks/merge-queue.md) |

## Owner cap in detail

The old glossary said the owner cap was "config only today; no code enforces it yet". That is not true of the code at `cd4499da`. What the repo shows, checked 2026-11-16:

1. **Configured.** `shards/phase0.yaml` lines 104 to 105 and `shards/colo-mind.yaml` lines 54 to 55 set `owner_cap_default: 3` and `owner_cap_owner: 20`. Spec 5.15.6 sets the default of 3, raisable per person by the operator; decision 0052 raises the operator's own cap to 20.
2. **Stored.** Each owner's cap is `mcp_owners.player_cap`, `DEFAULT 3 CHECK (player_cap BETWEEN 0 AND 100)`; 0002 first set the CHECK at 0 to 50 (`sql/0002_sovereign_mcp.sql` line 17), and 0069 raised it to 100 (decision 0447). Decision 0052 calls the cap "a per-person configuration in the MCP service"; in code the per-person value is this database column.
3. **Set.** `mcp-tokens owner add` takes `owner_cap_default` when no `--cap` is given and refuses a `--cap` above `owner_cap_owner` (`capForOwnerAdd` in `tools/mcp-tokens/src/owners.ts`; decision 0089 item 1). `owner set-cap` and `deploy/colo-admin.sh owner-set-cap` take any value from 0 to 100 as given (`deploy/colo-admin.sh` lines 138 to 145).
4. **Enforced in the database.** Migration 0006 creates `mcp_enforce_owner_cap()` and the trigger `mcp_players_owner_cap` (`BEFORE INSERT OR UPDATE OF status, owner_id ON mcp_players`). It counts the owner's non-retired players under a row lock and refuses an insert or re-activation that would exceed `player_cap` (`sql/0006_owner_cap_trigger.sql`). Migration 0011 replaces the function with a pinned `search_path` (`sql/0011_register_signup_function.sql` lines 39 to 41). `sql/test/check-schema.sql` line 192 fails CI if the trigger is missing.
5. **Enforced at sign-in.** An owner over a lowered cap has every token refused with reason `owner_over_cap` (`threshold/mcp/src/store/pg-tokens.ts` line 374; `threshold/mcp/README.md`).
6. **Related caps.** A lifetime limit of 10 player creations per owner through the register service (`sql/0010`, ruling R36). The daily cap of 10 new owners added by `sql/0013` was removed by `sql/0014` (ruling R41).
7. **Unverified.** Whether migrations 0006 and 0011 are applied on the node's database cannot be checked from the repo, and no live read was made (owner decision D8). Evidence that they are meant to be: `deploy/genesis/config-bundle.list` line 66 ships `sql/0006_owner_cap_trigger.sql`, and `tools/migrate` applies every pending file in order (`sql/README.md`). The check on the node is `schema_migrations` rows `0006` and `0011` and a `pg_trigger` row named `mcp_players_owner_cap`.

## Conflicts recorded

Where code, spec, a decision or an existing doc disagree, all sides are listed. None is resolved here.

1. **Owner cap enforcement.** Old `docs/glossary.md`: config only, not enforced. Code: enforced by trigger (`sql/0006`, `sql/0011`). This page follows the code; see [Owner cap in detail](#owner-cap-in-detail).
2. **Player.** Spec 3 and code: a player is an agent (`mcp_players`, "sovereign player"). Old `docs/glossary.md`: "Player: a human owner". This page uses **Owner** for the human.
3. **Dim.** Spec 3: an agent whose budget is spent. Spec 5.15.6 and `contract/schemas/presence-record.schema.json`: a presence state reached when no call came within the lease. The code implements the presence meaning only (no budget-dim state found).
4. **Glass status.** Old `docs/glossary.md`: "planned for campaign wave 6 and is not built yet". Code: `glass/` exists (170 tracked files on 2026-11-16) and is built as an image by `.github/workflows/colo-images.yml` (job `glass`).
5. **Life id and player id.** Two different patterns name one agent: `ag_<name>_<NN>` (`contract/schemas/common.schema.json`) and `ag-<name>-<NN>`. The player id pattern itself differs between `golem/src/players/player-config.ts` (`^ag-[a-z][a-z0-9-]{0,15}-[0-9]{2,}$`) and `tools/mcp-tokens/src/players.ts` (`^ag-[a-z0-9]+(-[a-z0-9]+)*$`).
6. **Register sign-in providers.** Decision 0135 title and body, `threshold/register/package.json` description and `threshold/register/README.md` line 3: GitHub and Discord. Decision 0135 amendment R40, decision 0261 item 1, `sql/0014_kino_access.sql` and `threshold/register/src/providers.ts`: Microsoft personal accounts only.
7. **`owner_cap_owner` and `owner add`.** `threshold/mcp/README.md` (around line 174): "The owner_cap_owner value (20, decision 0052) is not read by `owner add`". `tools/mcp-tokens/src/owners.ts` and decision 0089: `owner add` reads it as the ceiling for `--cap`. Both agree it is not the default.
8. **Turn record status.** Decision 0185 (Proposed): "nothing is built or switched on". Repo: `sql/0060_turn_records.sql` and `contract/schemas/turn-record-event.schema.json` exist. Whether it is switched on is unverified.
