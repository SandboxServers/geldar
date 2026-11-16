# 0365. Documentation gates to build after the freeze

- Status: Proposed (owner to accept)
- Date: 2026-11-16
- Spec: none. Records plan decision D7 of the docs-library plan (`docs/analysis/docs-library/plan.md` section 12, "plan default, to confirm"). Evidence read at 03c1f5de.

## Decision

This is a proposal. The owner approves it, and approves each packet. Once development resumes, the orchestrator dispatches each gate below as a small coder packet in `tools/repo-checks`. Each packet carries a test that fails when its change is reverted (`CLAUDE.md`). A documentation writer does not write them.

1. **Link checker.** Every relative link in `docs/**/*.md` must resolve to a file, ignoring code spans and fenced blocks. A link to a document the plan schedules but has not written passes only through a list of planned paths. That list empties as documents land.
2. **Metadata linter.** Every document that [0360](0360-documentation-metadata-block-and-sources-field.md) covers has the block, with valid values. That means one `type`, one `audience` and `last_verified` in the form `YYYY-MM-DD against <sha>`, with a commit that exists. Every `sources:` entry must be a path that exists.
3. **Agent-visibility check.** No path an agent reads may link to or name a document under `docs/` ([0361](0361-agents-never-placement-and-public-detail.md), point 2). The check starts from the manual grep in [doc verification](../agents/doc-verification.md#agents-never-placement) and covers the paths that grep names. The D9 level of point 3 still needs a reviewer: no pattern can judge it.
4. **Generated lists.** The lists that documents cite get generated, with a drift check, as the contract code already is. That covers contract schemas, NATS subjects, migrations and prompt files. Until then, the lists stay hand-written with a re-derive command ([doc verification](../agents/doc-verification.md#re-derive-lists)).
5. **Decision status match (candidate).** Each decision record's `Status` line must match the Status cell of its row in the [decisions index](README.md).

## Why

- None of these is gated today. The [doc-update map](../agents/doc-update-map.md#not-gated) says no check reads document metadata, relative links, the section indexes, the map or audience labels.
- Broken links are measured. The scan found 881 relative links in `docs/` with 29 broken, in 16 files, on 2026-11-16 at cd4499da (plan finding F-6).
- Plan section 11 adopts "a Markdown lint and a link check in CI" and generated lists from the Cimmeria model, "only after the owner approves a coder packet".
- Item 5 is new and not in D7. At 03c1f5de, the two decision gates do not compare statuses. `decision-index.ts` checks that each record has a row and each row has a record. `decision-rows.ts` checks number order and repeats. The status vocabulary already varies (plan finding F-5).

## Consequences

- The owner chooses which of the five to build, and when.
- Until then, the manual scans in [doc verification](../agents/doc-verification.md#mechanical-scans) stand in for gates 1 to 3. Review stands in for item 5.
- The doc-update map stays a review duty ([0363](0363-doc-update-map-is-a-review-duty.md)). No gate here checks it.
- Each gate, once built, gets a row in the map's gates table and in the [repo-checks](../reference/repo-checks.md) reference.
