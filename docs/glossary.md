---
title: Glossary (moved)
type: reference
audience: contributors
status: draft
last_verified: 2026-11-16 against cd4499da
companions: [reference/glossary.md, spec.md]
---

# Glossary (moved)

The glossary now lives at [reference/glossary.md](reference/glossary.md). It keeps every term this page used to define, adds the terms the code introduced, and records where code, spec and decisions disagree.

The spec's own definitions stay in [spec section 2a (names)](spec.md#2a-names) and [section 3 (glossary)](spec.md#3-glossary).

## Where each former term went

| Term | Section of the new glossary |
|---|---|
| Vivarium, Shard, Geldar-Core (world rules) | [The world](reference/glossary.md#the-world) |
| Player, Owner cap | [People and ownership](reference/glossary.md#people-and-ownership) |
| Agent, Headless agent, Sovereign agent, Body, Mind, Lantern, Thinker, Intent, Thought, Journal, Receipt, Reflex | [The agent](reference/glossary.md#the-agent) |
| Life, Threshold, Principle 1 | [Identity and access](reference/glossary.md#identity-and-access) |
| Glass | [Observation](reference/glossary.md#observation) |
| Scriptorium, Geldar-Core (plugin) | [Services and packages](reference/glossary.md#services-and-packages) |
| Packet | [Work and process](reference/glossary.md#work-and-process) |

Two former entries were wrong and are corrected there, with evidence:

- **Owner cap**: this page said no code enforces the cap. Migration `sql/0006_owner_cap_trigger.sql` enforces it in the database. See [Owner cap in detail](reference/glossary.md#owner-cap-in-detail).
- **Glass**: this page said the Glass was not built. The `glass/` package exists. See [Conflicts recorded](reference/glossary.md#conflicts-recorded).
