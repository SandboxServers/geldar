---
title: History index
type: reference
audience: contributors
status: draft
last_verified: 2026-11-16 against dc07e3fa
companions: [../README.md, ../decisions/README.md, ../reference/decisions-by-topic.md, ../concepts/time-shards-and-phases.md, ../analysis/docs-library/plan.md]
sources: [docs/history, docs/analysis, docs/decisions, docs/analysis/docs-library/plan.md]
---

# History index

How Geldar got where it is: the campaigns under `docs/analysis/`, the two phases so far, and the decisions in time order. These pages read the campaign files and decision records; they do not replace them. The campaign files stay where they are: "Keep `docs/analysis/`; add an index (H01)" ([plan.md](../analysis/docs-library/plan.md) section 11).

Every page here is a draft until a reviewer passes it ([documentation style](../agents/documentation-style.md#metadata-block)).

## Pages

The "State" column was checked against the folder on 2026-11-16 (`ls docs/history docs/reference/decisions-by-topic.md`, run after the W5 review fixes): all six pages exist.

| ID | Page | Type | Audience | What it covers | State |
|---|---|---|---|---|---|
| H01 | [campaign-index.md](campaign-index.md) | Reference | contributors | Every area under `docs/analysis/`: purpose, owner role, decision block, dates, status, successor, decisions; where the `RESUME.md` files disagree | Written, draft |
| H02 | [phase0-summary.md](phase0-summary.md) | Explanation | owner | Phase 0 ("Adam"): the spec's aim, the waves, the benchmark runs, the exit criteria and why they were waived, what carried on | Written, draft |
| H03 | [phase1-summary.md](phase1-summary.md) | Explanation | owner | Phase 1 as the colo-first shard: the plan, the waves, the state at the resume card, what is open | Written, draft |
| H04 | [decision-timeline.md](decision-timeline.md) | Explanation | owner | The decision records in date order, grouped by phase and week, with a topic tag each | Written, draft |
| H05 | [superseded-and-reversed.md](superseded-and-reversed.md) | Explanation | contributors | Decisions that were superseded, amended, reversed or made temporary; the status vocabulary; Proposed records already in code | Written, draft |
| H06 | [../reference/decisions-by-topic.md](../reference/decisions-by-topic.md) | Reference | contributors | The decisions index regrouped by component. Lives in `reference/`, not here | Written, draft |

## Where to start

- **New to the project's past:** the [campaign index](campaign-index.md), then the two phase summaries.
- **Why a rule exists:** the [decision timeline](decision-timeline.md) or [decisions by topic](../reference/decisions-by-topic.md), then the record itself in the [decisions index](../decisions/README.md).
- **Whether a record is still the rule:** [superseded and reversed](superseded-and-reversed.md).
- **What a phase is and how phases exit:** [time, shards and phases](../concepts/time-shards-and-phases.md).
- **When a human acted in the world:** [world-operations exceptions](../concepts/world-operations-exceptions.md).

## Keeping these pages current

- A campaign opening or closing updates the [campaign index](campaign-index.md) (the [doc-update map](../agents/doc-update-map.md) row "A campaign opens or closes").
- A phase closing gets its own summary page here and a row in this table.
- Re-run the commands each page quotes before changing a figure.
