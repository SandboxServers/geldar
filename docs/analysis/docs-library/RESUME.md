---
title: Docs library resume
type: how-to
audience: owner
status: draft
last_verified: 2026-11-16 against 1b114276
companions: [plan.md, ../../agents/README.md]
sources: [docs/analysis/docs-library/plan.md, docs/concepts, docs/architecture, docs/reference]
---

# Docs library: resume here

**Goal.** A complete, current documentation library for Geldar, pinned to one commit while development is frozen ([plan.md](plan.md)).

**Scope (owner, 2026-11-16).** Everything: waves W0 to W7, priorities P1 to P3, 89 documents (decision D11, option D). This replaced the earlier scope of W0 plus the P1 documents of W1 and W2.

## Status

| Wave | Documents | Status (2026-11-16) |
|---|---|---|
| W0 | F01 `docs/README.md`, F02 update map, F03 style, F04 verification, `docs/agents/README.md`, F05 glossary, F06 runbooks index and metadata on the 19 runbooks, F07 repo layout, F08 spec map, `docs/reference/README.md`, plan.md, this RESUME | Written, reviewed (0 blockers, 6 majors, 15 minors), fixes applied, **committed at 1b114276**. All `status: draft` until the owner accepts the W0 review (D12) |
| W1 | C01-C11 in [`docs/concepts/`](../../concepts/README.md), A01-A08 in [`docs/architecture/`](../../architecture/README.md), both section indexes | All 19 written, pinned to 1b114276, `status: draft`. **Review running** (read-only Sonnet reviewers). Not committed |
| W2 | R01-R27 in [`docs/reference/`](../../reference/README.md) | All 27 written, pinned to 1b114276, `status: draft`. R02-R27: **review running**. R01 [components](../../reference/components.md) was written after the reviewers started and is **not in their scope: it needs its own review**. Not committed |
| W1/W2 close | Indexes and map: `docs/README.md` (By section, Start here), `docs/reference/README.md`, the architecture index table, the [doc-update map](../../agents/doc-update-map.md) (W1 and W2 docs moved to "Update now"; rows added for `shards/`, `envs/`, telemetry, eventsink, the Mind packages and new document gates) | Written 2026-11-16; reviewed with R01. Not committed |
| W3 | O01-O14 (runbooks and `docs/operations/`) | **Next** after the W1/W2 fixes. Not started. Inputs: the failure, retirement and runbook cells of [components](../../reference/components.md), which link O01, O02, O05, O06 and O09 to O13 as planned |
| W4 | S01-S06 (`docs/security/`) | Not started. Needs the W2 interface docs (written) |
| W5 | H01-H06 (`docs/history/`, H06 `reference/decisions-by-topic.md`) | Not started |
| W6 | X01-X04, G01-G05 | Not started |
| W7 | Whole-library verification and review | Not started |

Pending reviews on 2026-11-16: the W1 and W2 reviews (running); a review of R01 and the W1/W2 close files listed above (not started). Set `status: verified` only after a reviewer passes a document.

The per-document table (path, type, audience, sources, priority) is [plan.md section 5](plan.md#5-documents).

## How to continue

1. Read [plan.md](plan.md) sections 1, 5, 12 and 13, then the three rule documents in [docs/agents/](../../agents/README.md).
2. Collect the W1 and W2 review findings, fix them, and review R01 and the close files. Then run W3 (all waves are funded, D11 option D). Each writer owns named files only. Update this table when a document changes status.
3. At the wave boundary, run a reviewer over the wave with the [review checklist](../../agents/doc-verification.md#review-checklist). Fix the findings. Set `status: verified` only on documents the reviewer has passed.
4. Start the next wave. Cross-link to later documents by relative path and mark them *planned*.
5. W7 runs the staleness sweep, link scan, forbidden-content scans and an index and update-map audit over everything.

## Models

Writers run on Opus 5.5 at high effort; a reviewer on Sonnet 5.5 at high effort runs once per wave boundary; the owner reviews W0 and S05 only (D12).

## Rules

- Markdown only. No code, config, tests, prompts or contracts; a needed change is a report item.
- Never edit `docs/spec.md`; write a decision record instead (ask the orchestrator for a number).
- No secrets, account names, personal names or IP addresses (`127.0.0.1` is fine).
- Nothing an agent reads may say it is watched; `agents-never` documents stay at spec level (D9).
- Every claim cites evidence with a date; never copy a figure unchecked ([plan.md section 13](plan.md#13-corrections-to-the-plan-data) shows why).
- No node, VM, database or world reads (D8). No commits or PRs by writers; the orchestrator commits.
- LF endings; metadata block on every new document; update the section index in the same change.

## Open for the owner

- D6, D7 and D12 defaults to confirm.
- R05 (`reference/mcp-tools.md`) audience: written as `contributors`; the owner decides whether that stands.
- Component owner roles that no file names (MCP mock, Chunky, CoreProtect, most tools): see [components](../../reference/components.md#gaps-this-page-records).
- F-8 (Kino "coming soon" in the root README); F-16 (the owner's first name on 25 lines of the spec).
- Accept the W0 review and its fixes (the owner reviews W0, D12).

## Carried to later waves

- W3 body pass: host and session labels in runbook bodies (review finding m5: `body-helper-node-steps.md`, `node-only-config.md`, and the coordinator labels listed in the review's rulings table).
- Before W7: the glossary's two explanation sections ("Owner cap in detail", "Conflicts recorded") belong in an explanation document (review finding m12).
- Coder follow-ups (report items, not writer work): the node alias in `deploy/body-helper-node.env` line 1; four runbooks lack a final newline; `threshold/register` `package.json` and README still say GitHub and Discord; `threshold/mcp/README.md` says `owner_cap_owner` is not read by `owner add`.
