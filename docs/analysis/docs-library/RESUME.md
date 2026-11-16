---
title: Docs library resume
type: how-to
audience: owner
status: draft
last_verified: 2026-11-16 against 3f07a4be
companions: [plan.md, ../../agents/README.md, ../../README.md, ../../history/campaign-index.md]
sources: [docs/analysis/docs-library/plan.md, docs, docs/decisions/README.md, docs/decisions/0360-documentation-metadata-block-and-sources-field.md, docs/decisions/0364-known-gap-public-overlay-against-0137.md, docs/decisions/0365-docs-gates-after-the-freeze.md, docs/decisions/0366-open-spec-5-14-watched-wording-versus-0059.md, deploy/genesis/config-bundle.list, sql]
---

# Docs library: resume here

**Goal.** A complete, current documentation library for Geldar, pinned to one commit while development is frozen ([plan.md](plan.md)).

**Scope (owner, 2026-11-16).** Everything: waves W0 to W7, priorities P1 to P3, 89 documents (decision D11, option D).

**Where it stands (2026-11-16).** All 89 planned documents exist. W0 to W6 are merged on `main` (PRs #557 to #563). W7, the closing verification and reconciliation, is finished in the working tree: two closing reviews and a fix pass; it waits for the orchestrator's commit. Every document is `status: draft`: none is marked `verified` yet.

## Status

PR numbers and merge commits from `git log --merges` and `gh pr view` on 2026-11-16.

| Wave | Documents | Status (2026-11-16) |
|---|---|---|
| W0 | F01-F08: [docs index](../../README.md), [update map](../../agents/doc-update-map.md), [style](../../agents/documentation-style.md), [verification](../../agents/doc-verification.md), [glossary](../../reference/glossary.md), [runbooks index](../../runbooks/README.md) and metadata on the 19 runbooks, [repo layout](../../reference/repo-layout.md), [spec map](../../reference/spec-section-map.md); plan.md and this RESUME | Reviewed (0 blockers, 6 majors, 15 minors), fixed. **Merged, PR #557** (`a8882d8d`) |
| W1 | C01-C11 in [`concepts/`](../../concepts/README.md), A01-A08 in [`architecture/`](../../architecture/README.md), both indexes | **Merged, PR #558** (`21eea720`) |
| W2 | R01-R27 in [`reference/`](../../reference/README.md), with the W1/W2 index and map close | **Merged, PR #559** (`03c1f5de`) |
| W3 | O01-O10 runbooks, O11-O14 in [`operations/`](../../operations/README.md), the W3 runbook body pass, decisions 0360-0366 | Review W3-a (read-only, about 90 checks) and fix pass ([runbooks index](../../runbooks/README.md#new-runbooks-o01-to-o10-wave-w3)). **Merged, PR #560** (`9f1fd270`) |
| W4 | S01-S06 in [`security/`](../../security/README.md) | **Merged, PR #561** (`be4f3104`) |
| W5 | H01-H05 in [`history/`](../../history/README.md), H06 [decisions by topic](../../reference/decisions-by-topic.md) | Review and fixes ([history index](../../history/README.md)). **Merged, PR #562** (`716c08e4`) |
| W6 | X01-X04 in [`siblings/`](../../siblings/README.md), G01-G04 in [`guides/`](../../guides/README.md), G05 metadata on the [player guide](../../players/README.md) | One review pass and fixes ([guides index](../../guides/README.md)). **Merged, PR #563** (`02e9ee34`, 2026-11-16 10:21 UTC) |
| W7 | Whole-library close: indexes, update map and rules reconciled; staleness, link, metadata and forbidden-content scans; metadata on `threat-model.md` | Two closing reviews: safety (3 blockers, 12 majors, 15 minors) and accuracy (0 blockers, 6 majors, 8 minors); one fix pass with the coordinator's rulings. **Finished in the working tree**, not committed (2026-11-16). Results: [verification report](verification-report.md) |

The per-document table (path, type, audience, sources, priority) is [plan.md section 5](plan.md#5-documents).

## Figures re-measured at 02e9ee34 (2026-11-16, with the W7 working tree)

Commands are the [re-derive lists](../../agents/doc-verification.md#re-derive-lists) blocks unless named. They replace the figures the earlier waves quoted.

| Figure | Value | Was |
|---|---|---|
| Decision records (`git ls-files docs/decisions`) | 187, highest 0366 | 180, highest 0352 |
| Index rows whose status starts "Proposed" | 46 | 40 |
| Runbooks | 29 (30 files with the index) | 19 |
| Markdown files under `docs/` outside `decisions/` and `analysis/` | 123 with `reference/telemetry-package.md` (W7), all linked from the update map | 122 |
| Workspace entries in `pnpm-workspace.yaml` | 14 packages plus `tools/*` (`telemetry` added by PR #551) | 13 plus `tools/*` |
| `docs/analysis/` | 14 areas, 336 tracked files (337 with the untracked verification report), 10 `RESUME.md` | 13, 333, 9 |
| Broken relative links in `docs/` | 29 in 16 files, all in campaign files under `docs/analysis/`; 0 elsewhere; 0 broken anchors | 29 in 16 files, at cd4499da |
| Migrations, prompt files, workflows, tools, repo-check modules and tests | 44; 18 files under `prompts/`; 6; 14; 19 and 51 | unchanged |

## How to continue

1. Read [plan.md](plan.md) sections 1, 5, 12 and 13, then the three rule documents in [docs/agents/](../../agents/README.md).
2. The two W7 closing reviews and their fix pass are done (2026-11-16); the items they left outside the library's own files are listed under "Left for the coordinator" below.
3. Merge W7. Then run the [staleness sweep](../../agents/doc-verification.md#staleness-sweep) against the merge commit and set `last_verified` on each document that still holds.
4. Set `status: verified` only on documents a reviewer has passed against their `last_verified` commit. No document has that yet.
5. After the freeze: the owner items below, then the coder packets of decision [0365](../../decisions/0365-docs-gates-after-the-freeze.md) (link checker, metadata linter, agent-visibility check, generated lists).
6. From then on the library is kept current by the [doc-update map](../../agents/doc-update-map.md) in each PR, not by waves.

## Rules

- Markdown only. No code, config, tests, prompts or contracts; a needed change is a report item.
- Never edit `docs/spec.md`; write a decision record instead (ask the orchestrator for a number).
- No secrets, account names, personal names, session labels, host names or IP addresses (`127.0.0.1` is fine).
- Nothing an agent reads may say it is watched; `agents-never` documents stay at spec level (D9, decision 0361).
- Every claim cites evidence with a date; never copy a figure unchecked ([plan.md section 13](plan.md#13-corrections-to-the-plan-data) shows why).
- No node, VM, database or world reads (D8). No commits or PRs by writers; the orchestrator commits.
- LF endings; metadata block on every new document; update the section index and the update map in the same change.

## Open for the owner

Owner-only. Nothing here is decided by the library.

1. **Spec 5.14 "Watched" wording versus decision 0059.** The spec row and the decision disagree on what agents are told. Stated with citations, no recommendation, in decision [0366](../../decisions/0366-open-spec-5-14-watched-wording-versus-0059.md) (Open, owner decision).
2. **The owner's first name in the spec.** `docs/spec.md` names the owner by first name on about 25 lines (25 at cd4499da, finding F-16). Only the owner edits the spec.
3. **Known gap of decision [0364](../../decisions/0364-known-gap-public-overlay-against-0137.md).** `compose/colo-public.yml` publishes the bot ingress, against decision 0137; the stop rule in the Phase 1 RESUME holds until packet C2-02c merges. The record was retitled and renamed in W7.
4. **Accept or change the documentation decisions.** [0360](../../decisions/0360-documentation-metadata-block-and-sources-field.md) to [0365](../../decisions/0365-docs-gates-after-the-freeze.md) are Proposed (owner to accept); 0366 is Open (item 1). The brief listed 0360-0366 as Proposed; the index says 0366 is Open (`docs/decisions/README.md`, 2026-11-16).
5. **Persona file.** `.claude/agents/documentation-writer.md` needs the `sources:` field in its metadata block (plan D5, decision 0360) and the `agents-never` audience label; editing it is the owner's change.
6. **Private store for withheld detail.** Decision 0361 point 4 sends observation detail to a private store whose location the owner names. Until then it goes only into writers' reports.
7. **Decision 0135 formatting.** Its header runs together on one line and its title names providers the record later removed ([superseded and reversed](../../history/superseded-and-reversed.md), item 7). Records are never rewritten; a correcting record or an owner-approved format fix is the owner's call.
8. **Earlier items still open.** D6 (a decision-number block for documentation rules) and D12 (who reviews) defaults to confirm; D7 is now proposed as decision 0365. R05 ([mcp-tools](../../reference/mcp-tools.md)) audience, written as `contributors`. Component owner roles no file names ([components](../../reference/components.md#gaps-this-page-records)). F-8: the root README says Kino is "coming soon".
9. **Outside this repo, for the coordinator.** A sibling repo needs a content review; the coordinator has the detail. This library does not edit sibling repos (plan D2).
10. **Records still Proposed.** 46 index rows start "Proposed", many already in code ([superseded and reversed](../../history/superseded-and-reversed.md)); item 4 covers only 0360 to 0365. Accepting or changing each is the owner's call.
11. **Session labels in records.** Seventeen records and 16 rows of `decisions/README.md` name a coordinator session ([decisions by topic, gap 3](../../reference/decisions-by-topic.md#gaps-this-page-records)). Records are not the library's to edit; item 7 covers only 0135.
12. **Audience labels set against the brief or changed in W7.** `docs/ideas.md` and [telemetry-package](../../reference/telemetry-package.md) were labelled `agents-never` against the brief; in W7 five more were relabelled `agents-never` after the safety review: [failure-modes](../../operations/failure-modes.md), [node-facts](../../operations/node-facts.md), [database-schema](../../reference/database-schema.md), [geldar-core-plugin](../../reference/geldar-core-plugin.md) and [animus-mind](../../reference/animus-mind.md). The owner or the orchestrator can change any of them. Still an owner call: `register-service`, `admin-service`, `environment-variables`, `nats-subjects`, `nats-topology`, `contract-schemas`, `cli-tools`, `compose-stacks` and the `incident-response` runbook carry a few observation rows under a non-`agents-never` label (relabel, or cut the rows).
13. **No decision governs player-core** as primary or secondary ([decisions by topic, gap 4](../../reference/decisions-by-topic.md#gaps-this-page-records)).

### Code follow-ups for packets after the freeze

Report items, not writer work. Each needs a packet and a coder.

- **Docs gates (D7, decision 0365):** link checker, metadata linter, agent-visibility placement check, generated lists.
- **Stale package READMEs:** `animus/README.md` still reads as a skeleton (finding F-4); `supervisor/` and `body-helper/` have no README ([update map](../../agents/doc-update-map.md), checked 2026-11-16).
- **Stale code comments** listed in the W3 to W6 writers' reports to the orchestrator (not in this repo; unverified here).
- **Mock image publish job guard** in `.github/workflows/mcp-mock-image.yml` (from the writers' reports; unverified here).
- **Velocity strings in the `run-shard` skill** (`.claude/skills/run-shard/SKILL.md`; from the writers' reports; unverified here).
- **`deploy/genesis/config-bundle.list` omits seven migrations:** 0040, 0052, 0060, 0061, 0062, 0063 and 0065 (`comm` of `git ls-files 'sql/0*.sql'` against the list, 2026-11-16 at 3f07a4be).
- From W0, still open: an alias in the body-helper node env file; `threshold/register` `package.json` and README still say GitHub and Discord; `threshold/mcp/README.md` says `owner_cap_owner` is not read by `owner add`.

## Debt after W7

Documentation debt found while reconciling the indexes on 2026-11-16. Each is a writer task for after the merge.

- **Closed in W7 (2026-11-16):** the `telemetry/` package has its reference page, [telemetry-package](../../reference/telemetry-package.md) (a-n), and a row in [repo-layout](../../reference/repo-layout.md); `docs/threat-model.md` `sources:` now lists repo-relative `docs/decisions/...` paths (the sweep gives no warning); `docs/ideas.md` has a metadata block (labelled `agents-never`: its rows are Kino ideas). Results: [verification report](verification-report.md).
- **40 documents are stale by the sweep** at 3f07a4be: 10 because a code or config source changed (all from PR #551, the telemetry package), 30 because a document they cite changed in a later wave ([verification report](verification-report.md#3-staleness-sweep)). Re-verify after the W6 and W7 merge (step 3 of How to continue).
- **29 broken links in campaign files** under `docs/analysis/` (finding F-6). Working notes; fix when the campaign next edits them.
- **The glossary's two explanation sections** ("Owner cap in detail", "Conflicts recorded") belong in an explanation document (W0 review m12).
- **Inline `(a-n)` marks for the five documents relabelled in W7.** The section indexes and `docs/README.md` mark them; inline links from other pages do not yet.
- **A symptom-first entry to [failure-modes](../../operations/failure-modes.md)** (accuracy review m8): a short "if you see X, start at section Y" table.
- **Pins after the merge.** `docs/README.md` and this file pin `3f07a4be`; the post-merge sweep (step 3) re-pins them.

### Left for the coordinator (files the library did not write)

The closing reviews found these in pre-existing runbooks, records and the threat model. The coordinator ruled (2026-11-16) that the library does not edit them; each is the coordinator's or the owner's.

- `runbooks/kino.md`: observation detail beyond the level of decision 0361, and an in-world handle in an example (safety review B1, M4, M10).
- `runbooks/skins.md`, `runbooks/progress-metrics.md`: in-world agent handles; `skins.md` also names the signed skins file and node paths (M4, M5).
- `runbooks/body-helper-node-steps.md`, `nats-auth-inplace.md`, `glass-aliases.md`, `colo-deploy.md`, `node-only-config.md`: node paths and secret locations (M5); `nats-auth-inplace.md` and `node-only-config.md` item 5 also record the live NATS drift per user (M6).
- `runbooks/glass-aliases.md`, `runbooks/map-chat-panel.md`: observation detail beyond the level of decision 0361 (M9).
- `runbooks/merge-queue.md`: the repository path in `gh api` lines (m12).
- `runbooks/block-owner.md` lines 50 to 70 and `runbooks/chunky.md` lines 21 to 30: config keys and commands with no evidence in the repo (accuracy review M6, m5).
- `docs/threat-model.md`: missing-control statements (M7) and an unreviewed Phase 0 body; the library changed only its metadata and the MCP tool count.
- `docs/ideas.md`: "enforced by the relay" in the Kino row (m11).
- Decisions 0075, 0100, 0101, 0334 and other pre-existing records and their index rows: observation detail and session labels (item 11 above).
- `docs/analysis/phase1/RESUME.md` line 29 and two Phase 1 worknotes: a private config file path and edge setup detail.
- **Pins left at earlier commits.** Most reference pages are pinned at `1b114276`, three W0 pages at `cd4499da`; the post-merge sweep (step 3 above) moves them.
