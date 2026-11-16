---
title: Body and Mind
type: explanation
audience: contributors
status: draft
last_verified: 2026-11-16 against 1b114276
companions: [README.md, what-is-geldar.md, sovereign-players.md, life-cycle-of-a-life.md, ../reference/glossary.md, ../reference/spec-section-map.md]
sources: [docs/spec.md, golem/README.md, golem/src/body, golem/src/body/reflexes, golem/src/body/checkpoint.ts, animus/README.md, player-core/README.md, player-core/src, threshold/mcp/README.md, compose/colo.yml, supervisor, body-helper, ../decisions/0020-receipts.md, ../decisions/0025-snapshot-revision.md, ../decisions/0027-final-receipt-constraints.md, ../decisions/0038-tick-rate-does-not-slow-a-client-driven-body.md, ../decisions/0043-phase0-body-state-in-nats-kv-and-record-rules.md, ../decisions/0047-thinking-time-comes-from-intents-and-waits-not-dilation.md, ../decisions/0050-phase0-mind-processes-run-on-the-host.md, ../decisions/0057-sovereign-budget-numbers-and-wake-spacing.md, ../decisions/0063-phase-0-has-no-stuck-signal.md, ../decisions/0065-damage-wakes-the-mind.md, ../decisions/0069-no-plan-wake-is-not-a-failure.md, ../decisions/0078-mind-placement-for-phase1.md, ../decisions/0134-mind-is-a-profile-until-a-thinker-exists.md, ../decisions/0148-reflexes-are-never-silent.md, ../decisions/0151-bodies-run-only-in-the-colo.md, ../decisions/0152-programmatic-body-management-for-owners.md, ../decisions/0182-eat-reflex-only-when-starving.md, ../decisions/0213-night-reflexes-need-a-threat.md, ../decisions/0260-body-container-control-by-host-helper.md]
---

# Body and Mind

Every agent in Geldar is two programs. The **Body** plays the game: it walks, digs, eats and keeps itself alive. The **Mind** decides what the Body should be doing. This page explains why the agent is split this way, how the two halves talk, what each half owns, and how the design moved from the spec to the code.

## Why split the agent

The spec gives the reason in its first section: the Body is "fast but dumb, like a nervous system", and the Mind is the model that decides ([spec 1](../spec.md#how-does-one-ai-character-work)). The split solves three problems.

1. **Model calls are slow and costly.** A model cannot steer a character tick by tick. So a thought produces a **durable intent** (a goal, a program, its limits and the events that should wake the Mind), and deterministic code in the Body carries it out. One decision can govern hundreds of low-level steps ([spec 5.3.1](../spec.md#531-durable-intents-are-the-unit-of-decision)).
2. **The world does not wait.** While a thought is pending, the Body keeps the agent safe with **reflexes**: eating, fleeing, escaping hazards ([spec 5.2](../spec.md#52-body-layer)). Shards run at 20 ticks per second; thinking time comes from intents, waits and reflexes, not from slowing the world ([0038](../decisions/0038-tick-rate-does-not-slow-a-client-driven-body.md), [0047](../decisions/0047-thinking-time-comes-from-intents-and-waits-not-dilation.md)).
3. **Minds come in more than one kind.** A headless Mind and a sovereign player's own CLI session both drive the same Body. "The Body never knows which kind of mind it has" ([spec 4.3](../spec.md#43-data-flow-for-one-thought)).

## The loop

```mermaid
sequenceDiagram
  participant W as World (Paper)
  participant B as Body (golem)
  participant M as Mind (headless or sovereign)
  W->>B: game events (damage, speech, time)
  B->>B: reflexes first; running intent continues
  B->>M: wake with a snapshot (revision n)
  M->>M: decide (model call)
  M->>B: plan: one intent and up to 6 immediate actions, made from revision n
  B->>B: validate life, generation, revision, expiry
  B->>W: execute through the Minecraft protocol
  B-->>M: receipts, intent progress, reflex and wake records (as events)
```

The order of a single thought is in [spec 4.3](../spec.md#43-data-flow-for-one-thought) and the thinking loop in [spec 5.3.4](../spec.md#534-the-thinking-loop). The trace from thought to stored event is the planned tutorial [trace one action](../guides/trace-one-action.md) (*planned*).

## The Body

The Body is Golem (`golem/`), a Mineflayer bot, one per agent ([glossary](../reference/glossary.md#the-agent)).

- **Executor.** `createBody` wires a runtime that owns the tick loop and reflexes, and an executor that checks each plan's life, `body_generation`, snapshot revision and expiry before it runs the immediate actions and the one durable intent (`golem/README.md`, "The Body").
- **Reflexes first.** Reflexes run before the intent and pre-empt it. Each firing is recorded; reflexes are never silent ([0148](../decisions/0148-reflexes-are-never-silent.md)). The reflex code lives in `golem/src/body/reflexes/` (eat, fight-or-flee, hazard escape, panic burrow, shelter, retreat, fall stop, blocked path, idle stuck, unstick, among others; listed 2026-11-16).
- **Receipts.** Every action ends with exactly one final receipt ([0020](../decisions/0020-receipts.md), [0027](../decisions/0027-final-receipt-constraints.md)). Plans and snapshots carry a revision, so a plan made from stale perception is refused ([0025](../decisions/0025-snapshot-revision.md)).
- **Checkpoints.** The running intent and the Body generation are kept in NATS KV buckets keyed by life id, so a restarted Body resumes its intent or, with no plan in 45 s, raises a `no_plan` wake ([0043](../decisions/0043-phase0-body-state-in-nats-kv-and-record-rules.md); `golem/src/body/checkpoint.ts`; [0069](../decisions/0069-no-plan-wake-is-not-a-failure.md)).
- **Records out.** The Body publishes `intent`, `action`, `receipt`, `reflex_fired` and `wake` events to JetStream; the audit records are retried until sent (`golem/README.md`; [0043](../decisions/0043-phase0-body-state-in-nats-kv-and-record-rules.md)).
- **Where it runs.** Only in the Colo, never on a player's machine ([0151](../decisions/0151-bodies-run-only-in-the-colo.md)). On the Colo a root-owned host helper starts and stops Body containers with four fixed verbs; the supervisor asks it over NATS and never holds the Docker socket ([0260](../decisions/0260-body-container-control-by-host-helper.md)).

## The Mind

The spec's Mind is a stateless service in the Colo that prepares prompts, judges model output, and keeps intents and memory; it never runs a model itself ([spec 5.3](../spec.md#53-mind-layer)). The model runs on a **Thinker**. Its main parts:

- **The attention controller** decides when a model is needed at all. It coalesces events, classifies speech, keeps a valid intent running, allows silence, allows one thought in flight per agent, spaces wakeups, and records every suppressed wakeup with a reason ([spec 5.3.2](../spec.md#532-the-attention-controller)). Damage wakes the Mind when no intent is running ([0065](../decisions/0065-damage-wakes-the-mind.md)).
- **Validation.** Model output is checked against the plan schema and allow-lists before a Body sees it ([spec 5.3.4](../spec.md#534-the-thinking-loop)).
- **Effort, not model.** An agent's model is fixed for life; effort varies with the decision ([spec 5.3.3](../spec.md#533-spend-reasoning-according-to-the-decision)).

### Where the Mind lives today

| Kind of agent | Mind | Evidence |
|---|---|---|
| Headless (Adam) | `animus/`: ports, attention, memory, prompts, validation, loop, reflection. Frozen: new code imports the shared pieces from `player-core/` | `animus/README.md`; `player-core/README.md` |
| Headless on the Colo | Defined as compose service `animus` under profile `mind`; a plain Colo bring-up skips it until a Thinker path exists | [0134](../decisions/0134-mind-is-a-profile-until-a-thinker-exists.md); `compose/colo.yml` around line 283 |
| Sovereign player | The person's vendor CLI session; it reaches the Body through the Geldar MCP server, which uses the same validation path | [spec 5.15.2](../spec.md#5152-architecture); [0078](../decisions/0078-mind-placement-for-phase1.md); `threshold/mcp/README.md` |

`player-core/` holds what both paths share: the Body link and its NATS transport, event mapping, output validation, the plan builder, the speech classifier and the ids (`player-core/README.md`; folders `attention`, `link`, `loop`, `validate` under `player-core/src`, listed 2026-11-16). In Phase 0 the Mind, the local Thinker and Adam's Body ran as host processes on loopback ([0050](../decisions/0050-phase0-mind-processes-run-on-the-host.md)).

## When no Mind answers

The spec defines two states ([spec 5.2](../spec.md#52-body-layer)):

- **Dim**: no plan arrives, so the Body holds position on reflexes.
- **Hibernating**: no Mind for longer, so the Body shelters and logs out, frozen safely by the game's own rules.

For sovereign players the timings are set by [0057](../decisions/0057-sovereign-budget-numbers-and-wake-spacing.md): a call or an open `wait` keeps a player awake for 60 s, and a player dim for 600 s hibernates and its Body goes down. The spec glossary also uses "dim" for an agent whose budget is spent; the code implements only the presence meaning ([glossary, conflict 3](../reference/glossary.md#conflicts-recorded)). Presence is covered in [life cycle of a life](life-cycle-of-a-life.md).

## Trade-offs

| Choice | Gain | Cost |
|---|---|---|
| Intents executed by code | Few model calls; behaviour that survives interruptions | The Body must implement every routine well; Body defects look like bad decisions |
| Reflexes without the Mind | Safety while thinking | A reflex acts for the agent; reflexes must be reported so the Mind knows ([0148](../decisions/0148-reflexes-are-never-silent.md)) |
| One Body runtime for all Mind kinds | Comparable agents; one validation path | The Body cannot adapt to a Mind's strengths |
| Checkpoints in NATS KV | Simple restarts in Phase 0 | Durable state outside Postgres (see conflict 1) |

## How the design moved

The spec's numbers and triggers were changed by decisions, and the code follows the decisions:

| Spec text | Decision | Code |
|---|---|---|
| Eat reflex at hunger 14 of 20 or lower ([spec 5.2](../spec.md#52-body-layer)) | Only when starving: hunger 6 or lower, or low health while hunger is below 18 ([0182](../decisions/0182-eat-reflex-only-when-starving.md)) | `EAT_HUNGER_AT = 6` in `golem/src/body/reflexes/eat.ts` line 6 |
| Panic burrow on night with no shelter | Night alone never starts it; a nearby threat or recent damage does ([0213](../decisions/0213-night-reflexes-need-a-threat.md)) | `golem/src/body/reflexes/panic-burrow.ts` around line 321 |
| Time dilation as a lever | Not a mechanism; 20 TPS everywhere ([0038](../decisions/0038-tick-rate-does-not-slow-a-client-driven-body.md), [0047](../decisions/0047-thinking-time-comes-from-intents-and-waits-not-dilation.md)) | Benchmark 10 and 5 TPS rows are findings only |
| A supervisor that holds no Docker socket | 0152 item 3 gave it the socket; [0260](../decisions/0260-body-container-control-by-host-helper.md) took it away again and added the host helper | `supervisor/`, `body-helper/` |
| A watchdog for stuck intents | Phase 0 had no `stuck` signal ([0063](../decisions/0063-phase-0-has-no-stuck-signal.md)); later reflexes handle being stuck | `idle-stuck*.ts`, `unstick.ts` in `golem/src/body/reflexes/` |

## Conflicts recorded

1. **Where durable state lives.** Spec 5.2: "all durable state lives in Postgres". Decision 0043: Phase 0 keeps checkpoints and Body generations in NATS KV. Code: `CHECKPOINT_BUCKET = 'geldar-checkpoints'` in `golem/src/body/checkpoint.ts` line 10. No later decision moves them to Postgres for the Colo; whether the Colo still uses the KV buckets was not checked live (D8).
2. **The Mind as one service.** Spec 4.1 and 5.3 place one Mind service in the Colo for every agent. Decision 0078 says sovereign players run no Mind there, and 0134 keeps the headless Mind off by default. The code has two paths sharing `player-core`. The spec text is unchanged (0073).

## What it touches

[Sovereign players](sovereign-players.md) (the other kind of Mind), [life cycle of a life](life-cycle-of-a-life.md) (presence, death), [identity and ingress](identity-and-ingress.md) (how a Body gets into the world), [principles in practice](principles-in-practice.md), and the planned [character and memory](character-and-memory.md), [economy and budgets](economy-and-budgets.md) and [time, shards and phases](time-shards-and-phases.md).

## Where to read the reference

- Body actions, perception and reflexes: [golem-body](../reference/golem-body.md).
- The headless Mind: [animus-mind](../reference/animus-mind.md) (*planned*); shared pieces: [player-core](../reference/player-core.md) (*planned*).
- Plan, snapshot and receipt schemas: [contract-schemas](../reference/contract-schemas.md); subjects: [nats-subjects](../reference/nats-subjects.md).
- Body containers on the node: [supervisor-and-body-helper](../reference/supervisor-and-body-helper.md) (*planned*).
- Terms (intent, plan, wake, reflex, receipt, snapshot): [glossary](../reference/glossary.md#the-agent).
