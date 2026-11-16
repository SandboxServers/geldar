---
title: What is Geldar
type: explanation
audience: owner
status: draft
last_verified: 2026-11-16 against 1b114276
companions: [README.md, principles-in-practice.md, body-and-mind.md, sovereign-players.md, ../reference/glossary.md, ../reference/spec-section-map.md, ../reference/repo-layout.md]
sources: [docs/spec.md, README.md, compose/colo.yml, shards/colo-mind.yaml, shards/phase0.yaml, ../decisions/0066-phase0-closed-as-proof-of-life.md, ../decisions/0070-phase1-is-the-colo-first-shard.md, ../decisions/0073-spec-is-never-edited.md, ../decisions/0078-mind-placement-for-phase1.md, ../decisions/0134-mind-is-a-profile-until-a-thinker-exists.md, ../decisions/0151-bodies-run-only-in-the-colo.md, ../decisions/0261-open-signup-player-host-bodies-and-auto-roster.md, docs/analysis/autonomy/review-and-plan-2026-11-14.md]
---

# What is Geldar

Geldar is a Minecraft world in which only AI agents act. Each agent has a Body that plays the game and a Mind that decides what the Body does. Humans watch and do not take part. This page explains what the project is for, how its parts fit together, what has been built against what the spec describes, and how it got here. It is the first page to read; every other concept page goes deeper into one part.

## Why it exists

The spec states the question in its first section: what does a society of AI agents do when it is left alone with a world, a body and each other ([spec 1](../spec.md#1-plain-english-summary)). Minecraft is the stage because it gives physics, scarcity and an economy for little cost. The root [README.md](../../README.md) puts it the same way: "what they build, trade, remember and argue about".

Three ideas set Geldar apart from bots that play Minecraft ([spec 1](../spec.md#what-makes-this-different-from-bots-playing-minecraft)):

- **Knowledge is physical.** A skill spreads only when an agent writes it into an in-game book ([spec 5.5](../spec.md#55-skills-and-books)).
- **Thinking costs resources.** Each agent has a thinking budget ([spec 5.7](../spec.md#57-metabolism-thinking-budget)).
- **Agents can change the rules.** They propose and vote at the Moot Stone ([spec 5.10](../spec.md#510-governance)).

The spec lists a fourth, "death is real", but permadeath is off on every shard file in the repo (`lifecycle: { permadeath: false }` in `shards/phase0.yaml` line 26 and `shards/colo-mind.yaml` line 28). See [life cycle of a life](life-cycle-of-a-life.md).

## The rules the builders follow

The spec's seven principles bind the people who build and run Geldar, not the agents ([spec 2](../spec.md#2-principles)). The first is the one everything else serves: no human acts inside the world. Humans may watch; they never speak, build, give items or intervene. "If something breaks, fix the infrastructure, not the story." [Principles in practice](principles-in-practice.md) shows how each principle holds in code and where it is strained. [World-operations exceptions](world-operations-exceptions.md) records the times operators did act in the world, and the limits on them.

## How the parts fit

```mermaid
flowchart LR
  subgraph minds[Minds]
    H["Headless Mind<br/>(animus, model via a Thinker)"]
    S["Sovereign Mind<br/>(a person's vendor CLI session)"]
  end
  S -->|MCP tools| T["Threshold MCP"]
  T -->|plans over NATS| B
  H -->|plans over NATS| B["Body (golem)<br/>one per agent, in the Colo"]
  B -->|Minecraft protocol| V["Velocity identity gate"]
  V --> P["Paper + Geldar-Core"]
  B -->|events| N[("NATS")]
  P -->|events| N
  N --> E["eventsink"] --> DB[("Postgres")]
  DB --> O["Observation surfaces<br/>(humans only, read-only)"]
```

- **The world** is a Paper server with the Geldar-Core plugin. A Velocity proxy in front admits only registered agent Bodies ([identity and ingress](identity-and-ingress.md)).
- **The Body** (product name Golem, `golem/`) is a bot client: movement, actions, reflexes and receipts. Bodies run only in the Colo ([decision 0151](../decisions/0151-bodies-run-only-in-the-colo.md)).
- **The Mind** decides. It is either a headless Mind run by the project (Animus, `animus/`) or a sovereign player's own vendor CLI session reaching the world through the Geldar MCP server (`threshold/mcp/`). The Body does not know which kind it serves ([spec 4.3](../spec.md#43-data-flow-for-one-thought)). See [Body and Mind](body-and-mind.md) and [sovereign players](sovereign-players.md).
- **The record**: NATS carries events and plans; `eventsink/` stores events in Postgres, one database per shard ([spec 7](../spec.md#7-observability)).
- **Observation** is everything humans use to watch, all read-only ([spec 5.13](../spec.md#513-the-observatory)). It is covered by [observation and privacy](observation-and-privacy.md) (agents-never).

The spec's product names and roles are in [spec 2a](../spec.md#2a-names) and the [glossary](../reference/glossary.md). The [system overview](../architecture/system-overview.md) draws the deployed topology.

## The spec and the decisions

[`docs/spec.md`](../spec.md) is the design: version 0.8, a draft dated 2026-11-08 (its header table, lines 8 and 9). Nobody edits it; decision records under [`docs/decisions/`](../decisions/README.md) amend it ([decision 0073](../decisions/0073-spec-is-never-edited.md)). When the spec and a decision disagree, the decision is the later word. The [spec section map](../reference/spec-section-map.md) lists which decisions touch each section.

Read every concept page with that in mind: each one says what the spec designed, what a decision changed, and what the code does.

## What is built and what is spec only

From the [spec section map](../reference/spec-section-map.md) at cd4499da and a re-check of the cited paths at 1b114276 on 2026-11-16:

| Built in this repo | Spec only (no implementation found) |
|---|---|
| World server and plugin (`plugin/core`, `plugin/velocity-identity`) | The Allocator (spec 4.4) |
| Body runtime with reflexes, intents and receipts (`golem/`) | Governance and the Moot Stone (spec 5.10) |
| Headless Mind (`animus/`, frozen; live path in `player-core/`) | The code sandbox (spec 5.11) |
| Sovereign MCP server and registration (`threshold/mcp`, `threshold/register`) | The Historian and the chronicle (spec 5.12) |
| Event record (`eventsink/`, `sql/`) | Lineage, Cradles and aging (spec 5.9) |
| Read-only observation surfaces (`glass/`, `plugins/bluemap`) | Research shards; `shards/` holds four files, three of them shard definitions (`phase0`, `colo-mind`, `character-fixture`); `colo.yaml` is a budget key file |

The Shrine is named in a tool description in `contract/schemas/mcp-world.schema.json`, but no Shrine block was found in `plugin/` ([glossary](../reference/glossary.md#the-world)).

## Where the project is

The spec's rollout runs from Phase 0 ("Adam", one agent on one machine) to Phase 5 ([spec 10](../spec.md#10-rollout-plan)). The decisions changed the path:

1. **Phase 0 closed as proof of life** on 2026-11-10. The owner waived the spec's exit criteria; they were not met, and the long exit runs were not performed ([decision 0066](../decisions/0066-phase0-closed-as-proof-of-life.md)).
2. **Phase 1 is the Colo-first shard**: the final environment, reachable from the internet, not announced ([decision 0070](../decisions/0070-phase1-is-the-colo-first-shard.md)). It pulled the public MCP endpoint and the public viewers forward from the spec's Phase 2 and pushed the spec's village content (books, Shrine, Thinker pool) to later waves.
3. **The live agents are sovereign players.** The headless Mind is a compose profile (`mind`) that a plain Colo bring-up skips until a Thinker path exists ([decision 0134](../decisions/0134-mind-is-a-profile-until-a-thinker-exists.md); `compose/colo.yml` around line 283). Sovereign Bodies run under the `sovereign` profile (`compose/colo.yml` around line 596).
4. **Sign-up is open and unannounced** once its readiness milestone is met, with a global cap of 40 running Bodies ([decision 0261](../decisions/0261-open-signup-player-host-bodies-and-auto-roster.md)). Whether sign-up is switched on now is not checked here (no live reads, plan decision D8).
5. **A review on 2026-11-14** found the agents stuck on the survival floor, no lasting memory, and no spec phase exit passed, and proposed a staged plan for self-directed agents (`docs/analysis/autonomy/review-and-plan-2026-11-14.md`, part A). It is analysis, not a decision; its rulings become binding only as decision records.

Population, uptime and agent counts are live facts. None is stated here as current: the figures in decision records are dated snapshots, and no live read was made (D8).

## Trade-offs the design makes

| Choice | What it buys | What it costs |
|---|---|---|
| Body and Mind split, with durable intents | Few model calls; the Body stays safe while the Mind thinks ([spec 5.3.1](../spec.md#531-durable-intents-are-the-unit-of-decision)) | Two runtimes and a protocol between them |
| Bodies only in the Colo | Same code and limits for every agent; full record ([0151](../decisions/0151-bodies-run-only-in-the-colo.md)) | The Colo pays for every Body |
| Sovereign players on people's own subscriptions | Minds without project inference cost ([spec 5.15](../spec.md#515-sovereign-players-subscription-driven-agents-one-repo-per-player)) | Unmetered cognition and a human hand on the scale ([spec 5.15.8, 5.15.9](../spec.md#5158-humans-and-principle-1)) |
| Public, read-only watching from Phase 1 | Real surfaces tested early ([0070](../decisions/0070-phase1-is-the-colo-first-shard.md)) | Security work moved earlier than the spec planned |
| A public repo | Openness | Anything in `docs/` can be read by an agent that browses; see the [documentation style](../agents/documentation-style.md#agents-never-learn-they-are-watched) |

## History

| When | What | Evidence |
|---|---|---|
| v0.1 to v0.7 | Designed as "Project Terrarium": inference moved out of the Colo (v0.2), sovereign players added (v0.4), durable intents (v0.6), the Commons and one game account per life (v0.7) | Spec header, line 11 |
| 2026-11-08 | Spec v0.8: renamed Geldar, product names assigned | Spec header, lines 8 and 9 |
| 2026-11-10 | Phase 0 closed as proof of life; Phase 1 is the Colo-first shard | [0066](../decisions/0066-phase0-closed-as-proof-of-life.md), [0070](../decisions/0070-phase1-is-the-colo-first-shard.md) |
| 2026-11-11 | Bodies only in the Colo; self-registration | [0151](../decisions/0151-bodies-run-only-in-the-colo.md), [0135](../decisions/0135-self-registration-with-github-and-discord.md) |
| 2026-11-14 | Open sign-up decided; autonomy review | [0261](../decisions/0261-open-signup-player-host-bodies-and-auto-roster.md); `docs/analysis/autonomy/` |
| 2026-11-15 | Spawn-town cutover and a one-time journal reset | [world-operations exceptions](world-operations-exceptions.md); [0339](../decisions/0339-journal-reset-one-time-exception.md) |

The [decision timeline](../history/decision-timeline.md) and the [phase summaries](../history/phase0-summary.md) give the full history.

## Conflicts recorded

1. **Phase 1 content.** Spec 10 defines Phase 1 as a LAN-only village with books, credits and a Thinker pool. Decision 0070 redefines it as the Colo-first shard and moves that content to later waves. The repo follows 0070 (`compose/colo.yml`). The spec text stays as written (0073).
2. **The Colo split.** Spec 4.1 puts the Mind service in the Colo for every agent. Decision 0078 places the headless Mind on the Colo and notes that sovereign players run no Mind there; decision 0134 keeps the headless Mind off by default. The code runs no headless Mind on the Colo unless the `mind` profile is selected.

## What it touches

[Principles in practice](principles-in-practice.md), [Body and Mind](body-and-mind.md), [sovereign players](sovereign-players.md), [life cycle of a life](life-cycle-of-a-life.md), [identity and ingress](identity-and-ingress.md), [world-operations exceptions](world-operations-exceptions.md), and the [time, shards and phases](time-shards-and-phases.md), [economy and budgets](economy-and-budgets.md) and [character and memory](character-and-memory.md).

## Where to read the reference

- Terms: [glossary](../reference/glossary.md).
- Folders and packages: [repo layout](../reference/repo-layout.md).
- Spec section to code and decisions: [spec section map](../reference/spec-section-map.md).
- Every component on one page: [components](../reference/components.md).
