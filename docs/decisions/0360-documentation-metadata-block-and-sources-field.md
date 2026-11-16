# 0360. The documentation metadata block and the optional `sources:` field

- Status: Proposed (owner to accept)
- Date: 2026-11-16
- Spec: none. Records plan decisions D4 and D5 of the docs-library plan (`docs/analysis/docs-library/plan.md` section 12). Evidence read at 03c1f5de.

## Decision

1. **The block.** Every new document under `docs/`, except `docs/spec.md`, the decision records and `docs/analysis/`, starts with the metadata block in [documentation style](../agents/documentation-style.md#metadata-block): `title`, `type`, `audience`, `status`, `last_verified`, `companions` and `sources`.
2. **`sources:` is optional in the block, and required whenever the document cites files.** It is left out only when the document cites none, such as an index of planned documents or a pointer page. It holds a comma-separated list of paths. Each path is repo-relative or relative to the document (starting `./` or `../`). A folder is allowed. Prose, section numbers, globs and "decision NNNN" are not paths and do not go in the list.
3. **`status: verified` comes only from a review.** A reviewer must pass the document against the commit in `last_verified`. A writer's own check never sets it ([doc verification](../agents/doc-verification.md#verify-one-document), step 8).
4. **Decision records carry no metadata block.** That includes new ones. Plan decision D4 names "the 180 decision records". This record proposes that D4 also covers records written after it, so every record keeps the format in the [decisions index](README.md).
5. **The persona edit is the owner's.** Adding `sources:` to the persona's copy of the block (`.claude/agents/documentation-writer.md`) is the owner's change, as D5 says. Until the owner makes it, the style document is the rule.

## Why

- The owner approved D5 ("add an optional `sources:` field") and D4 ("no metadata on the decision records") on 2026-11-16 (plan section 12). The plan's approval was never written up as a decision record. This record is that write-up.
- The staleness sweep needs a list it can read by machine. The sweep in [doc verification](../agents/doc-verification.md#staleness-sweep) diffs the `sources:` paths since the `last_verified` commit. It skips a document with no list and warns on an entry that is not a path.
- Today the rule lives in two places that disagree. At 03c1f5de the persona's metadata block (lines 34 to 45) has no `sources:` line. `docs/agents/documentation-style.md` line 29 has one, and line 43 says the persona edit is the owner's.
- A record is never rewritten ([decisions index](README.md), line 5). A `last_verified` field on a record could therefore never be updated, so it would go stale.

## Consequences

- Owner: edit the persona's metadata block to add `sources:`. Until then, the persona and the style document differ on purpose.
- No gate reads metadata today (see the [doc-update map](../agents/doc-update-map.md#not-gated)). Decision [0365](0365-docs-gates-after-the-freeze.md) proposes a metadata linter.
- `docs/decisions/README.md` itself has no metadata block at 03c1f5de, although D4 puts metadata on the index. Adding one is a follow-up. The decision-index and decision-rows gates read only table rows whose first cell is a link (`tools/repo-checks/src/decision-index.ts` line 14, `decision-rows.ts` line 12), so a front-matter block would not trip them.
- The exception for `docs/runbooks/open-signup.md` stays as written in the style document. Its gate fails on long path-like runs, so it cites the `../decisions` folder instead of the record files.
