---
title: Operations
type: reference
audience: operators
status: draft
last_verified: 2026-11-16 against 03c1f5de
companions: [../runbooks/README.md, ../runbooks/incident-response.md, ../reference/components.md, ../README.md]
sources: [docs/operations, ../analysis/docs-library/plan.md]
---

# Operations

Reference tables for the people who run the Colo node and the stack: what breaks and how, what the node holds, what is watched, and what it costs. These are tables, not steps; the steps are in the [runbooks](../runbooks/README.md) **(a-n)**, starting with [incident response](../runbooks/incident-response.md).

This folder is operator material. Never copy or link any of it into a prompt, skill, kit file, tool text, `identity.md`, player repo or sign ([documentation style](../agents/documentation-style.md#agents-never-learn-they-are-watched)). The page marked `agents-never` must never be placed where an agent reads. Links marked **(a-n)** go to `agents-never` documents.

## Index

Checked on 2026-11-16 at `03c1f5de` by listing the folder: all four documents the plan schedules for it (wave W3, [plan section 5](../analysis/docs-library/plan.md#5-documents)) exist. None has passed a review, so all four are `draft`.

| Document | Plan id | Type | Audience | What it holds | Status |
|---|---|---|---|---|---|
| [failure-modes.md](failure-modes.md) | O11 | reference | agents-never | One table per component: symptom, likely cause, safe first action, runbook, what not to do, blast radius | draft |
| [node-facts.md](node-facts.md) | O12 | reference | agents-never | What the Colo node runs and holds, from existing documents only, dated | draft |
| [monitoring-and-vitals.md](monitoring-and-vitals.md) | O13 | reference | agents-never | What is monitored, what is decided, what exists in the repo | draft |
| [capacity-and-cost.md](capacity-and-cost.md) | O14 | reference | owner | Cost model, budgets, stack and node capacity | draft |

## Related

- [Runbooks](../runbooks/README.md) **(a-n)**: how-to steps, including [incident response](../runbooks/incident-response.md) and [backup and restore](../runbooks/backup-and-restore.md).
- [Components](../reference/components.md): one row per component with every document that covers it.
- [Deployment topology (Colo)](../architecture/deployment-topology-colo.md): why the node is laid out this way.
