# 0363. The doc-update map is a review duty, and the documentation-writer agent keeps it

- Status: Proposed (owner to accept)
- Date: 2026-11-16
- Spec: none. Records plan section 11 of the docs-library plan (`docs/analysis/docs-library/plan.md`): adopt the update map, and add the update-map duty to the persona. Evidence read at 03c1f5de.

## Decision

1. **The map is the list.** [docs/agents/doc-update-map.md](../agents/doc-update-map.md) lists which documents a change must update. A change that alters behaviour, an interface, configuration, file layout, a build step or a procedure carries the matching document update in the same PR. If the author has not updated a document, they name it as debt in the PR (map lines 15 and 20).
2. **Reviewers enforce it.** Whoever reviews a PR, a packet or a wave checks the change against the map. That may be the packet-reviewer agent, a wave reviewer or the owner. The reviewer reports each missing update as a finding. No gate does this. Decision [0365](0365-docs-gates-after-the-freeze.md) gates links and metadata, not the map.
3. **The documentation-writer agent keeps the map.** It adds a row for each new kind of change. It moves a planned document to "Update now" once the document exists. It updates the gates table when a test that reads documents is added or changed. It re-checks the map with [doc verification](../agents/doc-verification.md) and dates the result.

## Why

- The map says most of it is not gated and that reviewers enforce it (line 15). Nothing yet asks the reviewers to do so. At 03c1f5de, `.claude/agents/packet-reviewer.md` checks spec drift and repo rules but does not name the map or `docs/`. The `ship-pr` skill names decision records only (`.claude/skills/ship-pr/SKILL.md` line 28).
- Plan section 11 adopts the map from the Cimmeria model as "the biggest drift guard" and adapts the persona to carry the duty. Plan risk R4 (documents drift once development resumes) names the map as the mitigation.
- The persona already tells the writer to add each new document to the map (`.claude/agents/documentation-writer.md` line 55). Keeping the map itself is the step this record adds.

## Consequences

- Follow-up for the owner or the orchestrator: add a map check to the packet-reviewer checklist and to the `ship-pr` skill. This record does not edit those files. A documentation writer edits Markdown under `docs/` only.
- When a reviewer finds a missing update, the fix goes to the documentation-writer agent or to the PR's author. The reviewer does not make the fix.
- A stale map is itself a finding at the W7 review (plan section 6).
