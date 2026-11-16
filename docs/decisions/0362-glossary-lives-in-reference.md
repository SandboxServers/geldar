# 0362. The glossary lives at `docs/reference/glossary.md`; `docs/glossary.md` is a pointer

- Status: Proposed (owner to accept)
- Date: 2026-11-16
- Spec: sections 2a (names) and 3 (glossary). It does not change them. Records plan document F05 of the docs-library plan (`docs/analysis/docs-library/plan.md` sections 4 and 5). Evidence read at 03c1f5de.

## Decision

1. **One glossary.** The project glossary is [reference/glossary.md](../reference/glossary.md), a reference document for contributors. New terms go there and nowhere else.
2. **A pointer at the old path.** `docs/glossary.md` stays as a pointer page titled "Glossary (moved)". It defines no term. It maps each former term to its section in the new glossary and lists the former entries that were corrected. It is not removed, so existing links keep working.
3. **The spec keeps its own definitions.** Spec sections 2a and 3 remain the spec's definitions. Where code, spec and a decision use a term differently, the glossary records all three and does not choose one (persona rule 8).

## Why

- A glossary is reference material, and reference lives in `docs/reference/` (the Diataxis table in [documentation style](../agents/documentation-style.md#document-types-and-where-they-live)).
- The old page was wrong in one place. It said no code enforced the owner cap, but `sql/0006_owner_cap_trigger.sql` does (plan finding F-2). The new glossary corrects this, with evidence.
- At 03c1f5de, links still point at the old path. `README.md` line 50 links `docs/glossary.md`, and `.github/ISSUE_TEMPLATE/question.md` line 7 names it. Removing the page would break those links.

## Consequences

- The [doc-update map](../agents/doc-update-map.md) already sends new component names to `reference/glossary.md`. That is the row "A component added, split or retired".
- `README.md` and the issue template could link the new path directly. That is a small follow-up. The pointer makes it optional.
- Removing the pointer later needs a new record, and only after nothing links to it.
