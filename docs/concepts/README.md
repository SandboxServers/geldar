---
title: Concepts index
type: reference
audience: contributors
status: draft
last_verified: 2026-11-16 against 1b114276
companions: [../README.md, ../reference/README.md, ../reference/glossary.md, ../analysis/docs-library/plan.md]
sources: [docs/analysis/docs-library/plan.md, docs/agents/documentation-style.md]
---

# Concepts

Concept pages explain why Geldar is built the way it is: the design, the trade-offs, and the decisions that changed it. Each one says what the spec designed, what a decision record changed, and what the code does, and records where they disagree. Read them to understand; for every field and option, read the [reference](../reference/README.md); for steps, read the [runbooks](../runbooks/README.md).

Start with [what is Geldar](what-is-geldar.md), then [principles in practice](principles-in-practice.md). The rest can be read in any order.

## Pages

The plan IDs are those of the [documentation plan](../analysis/docs-library/plan.md#5-documents) (wave W1). "agents-never" pages are operator material: never copy, quote or link them from anything an agent in the world reads ([documentation style](../agents/documentation-style.md#agents-never-learn-they-are-watched)).

| ID | Page | Explains | Audience | Status |
|---|---|---|---|---|
| C01 | [What is Geldar](what-is-geldar.md) | The project's purpose, its parts, what is built against the spec, and where it stands | owner | draft |
| C02 | [Principles in practice](principles-in-practice.md) | The spec's seven principles, how code and decisions keep each, and where each is strained | contributors | draft |
| C03 | [Body and Mind](body-and-mind.md) | Why every agent is two programs, durable intents, reflexes, and where each Mind kind runs | contributors | draft |
| C04 | [Sovereign players](sovereign-players.md) | Agents whose Mind is a person's own CLI session: compliance, tokens, sign-up, presence, and what they cost the experiment | contributors | draft |
| C05 | [Life cycle of a life](life-cycle-of-a-life.md) | Birth, presence, death with permadeath off, retirement and erasure of one life | contributors | draft |
| C06 | [Identity and ingress](identity-and-ingress.md) | How a Body gets into the world as the life it claims, the two checks, and the identifiers one agent carries | contributors | draft |
| C07 | [Time, shards and phases](time-shards-and-phases.md) | Shards, the fixed tick rate and three clocks, and the rollout phases as planned and as run | owner | draft |
| C08 | [Economy and budgets](economy-and-budgets.md) | Why thinking costs something, the spec's ledgers, and the suspended act budget | owner | draft |
| C09 | [Character and memory](character-and-memory.md) | What an agent may know, what it remembers, and the character sheet | agents-never | draft |
| C10 | [Observation and privacy](observation-and-privacy.md) | The surfaces humans watch through, at spec level | agents-never | draft |
| C11 | [World-operations exceptions](world-operations-exceptions.md) | Principle 1, and the bounded, one-time cases where operators acted in the world | owner | draft |

All eleven pages exist in the working tree on 2026-11-16 (checked with a folder listing). C07 to C10 were written by other writers in the same wave; their rows here are taken from their metadata blocks. Status `draft` means no reviewer has passed the page yet ([doc verification](../agents/doc-verification.md#verify-one-document)).

## Related sections

- [Architecture](../architecture/system-overview.md): how the parts are deployed and connected.
- [Reference](../reference/README.md): the glossary, repo layout and spec section map, and the component references.
- [Decisions](../decisions/README.md): the records that amend the spec; the [spec section map](../reference/spec-section-map.md) links each section to its concept page.
