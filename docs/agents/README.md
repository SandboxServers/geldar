---
title: Documentation rules
type: reference
audience: contributors
status: draft
last_verified: 2026-11-16 against 3f07a4be
companions: [../README.md, ../security/agent-visibility-rules.md, ../analysis/docs-library/plan.md]
sources: [.claude/agents/documentation-writer.md, docs/agents, docs/decisions/0360-documentation-metadata-block-and-sources-field.md, docs/decisions/0363-doc-update-map-is-a-review-duty.md]
---

# Documentation rules

How documents in `docs/` are written, kept current and checked. Read these before you write or review a document, and before you open a PR that changes behaviour.

| Document | Type | Use it to |
|---|---|---|
| [discord-workflow.md](discord-workflow.md) | reference | Communicate in the developer channel and verify a review given by Discord reaction. |
| [documentation-style.md](documentation-style.md) | reference | Write a document: the metadata block and when `sources:` is required, the four types and their folders (history and mixed folders included), audience labels and the `players` exception, the agents-never rule and the paths agents read, voice, evidence, what never goes in a document. |
| [doc-update-map.md](doc-update-map.md) | reference | Find which documents a change must update, whether a gate enforces it or review does, and which gates read documents. Every document in `docs/` outside `decisions/` and `analysis/` has a row. |
| [doc-verification.md](doc-verification.md) | how-to | Verify a document, sweep for stale ones, scan links, metadata fields, update-map coverage and agent-read placement, re-derive cited lists, and run the review checklist. |

The operator-side companion is [agent-visibility rules](../security/agent-visibility-rules.md) **(a-n)**: the longer list of places an agent reads and the checks before a document is placed. Keep its path table and placement scan in step with the style document and doc verification.

The rules are being written down as decision records [0360](../decisions/0360-documentation-metadata-block-and-sources-field.md) to [0363](../decisions/0363-doc-update-map-is-a-review-duty.md) and [0365](../decisions/0365-docs-gates-after-the-freeze.md), all Proposed on 2026-11-16 (owner to accept).

The documentation-writer persona is [`.claude/agents/documentation-writer.md`](../../.claude/agents/documentation-writer.md). The library plan and its progress are in [docs/analysis/docs-library/](../analysis/docs-library/) ([plan.md](../analysis/docs-library/plan.md), [RESUME.md](../analysis/docs-library/RESUME.md)).
