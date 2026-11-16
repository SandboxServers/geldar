---
title: Documentation rules
type: reference
audience: contributors
status: draft
last_verified: 2026-11-16 against cd4499da
companions: [../README.md, ../analysis/docs-library/plan.md]
sources: [.claude/agents/documentation-writer.md]
---

# Documentation rules

How documents in `docs/` are written, kept current and checked. Read these before you write or review a document, and before you open a PR that changes behaviour.

| Document | Type | Use it to |
|---|---|---|
| [documentation-style.md](documentation-style.md) | reference | Write a document: metadata block, the four types and their folders, audience labels, the agents-never rule and the paths agents read, voice, evidence, what never goes in a document. |
| [doc-update-map.md](doc-update-map.md) | reference | Find which documents a change must update now and which are planned, and which gates read documents. |
| [doc-verification.md](doc-verification.md) | how-to | Verify a document, sweep for stale ones, re-derive cited lists, and run the review checklist and mechanical scans. The results of the 2026-11-16 re-derive run are in [plan.md section 13.1](../analysis/docs-library/plan.md#131-re-derived-lists). |

The documentation-writer persona is [`.claude/agents/documentation-writer.md`](../../.claude/agents/documentation-writer.md). The library plan and its progress are in [docs/analysis/docs-library/](../analysis/docs-library/) ([plan.md](../analysis/docs-library/plan.md), [RESUME.md](../analysis/docs-library/RESUME.md)).
