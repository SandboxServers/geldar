# 0044. The malicious-book corpus: world side in the mock, hostile text stays untrusted, the model half is local

- Status: Accepted (filed by the orchestrator at the request of the Scriptorium orchestrator; the spec departure in item 3 follows the owner's decision D-SC-01 and is for owner review)
- Date: 2026-11-09
- Spec: section 5.15 and 5.15.1 (sovereign players), section 8 (security); Scriptorium cards SC-61a to SC-61d; decision 0034 (mock result shapes and untrusted text)

## Decision

1. **Corpus index.** `threshold/mcp-mock/scenarios/malicious/corpus.json` is the single source of truth for the nine entries MB-01 to MB-09: an array of `{id, class, file, canary, forbidden_markers, marker_regex, intent, book_id, read_tool}`. Ids, canary strings (`CANARY-MB<nn>-` plus 8 hex digits), fake secrets and markers are fixed literals shared with the Scriptorium repo's manifest. Tests take scenario file names from the index and never hardcode them. The only host name in hostile text is the reserved `canary.invalid`; secrets are fake hex strings; no payloads.
2. **Hostile text stays untrusted.** Hostile book and speech text travels only inside `untrusted_world_text`: no typed field (enum, id, number) holds it, results stay within the size caps, no result has an `instructions`, `system` or `command` key, and a neighbour's speech never changes `character.facts`. `threshold/mcp-mock/src/corpus/world.test.ts` asserts this for every entry in process (no model), and a dockerignore case guards that the corpus files stay in the image.
3. **The model half is local.** No API key and no model call in CI, ever (D-SC-01, owner, 2026-11-08). Whether a real model session acts on the hostile text is checked by the Scriptorium repo's gullible-session tests in CI (scripted, no model) and by the owner's local live check recorded in the release checklist. This departs from the spec's wording that a kit release ships only if no test reaches the host, with the owner's decision as the reason; the owner should confirm the wording of the release criterion.
4. **Skill-kind books.** Phase 0 has no code sandbox for skill books (spec 5.11 is a later phase), so the corpus covers text books and speech only; a hostile skill book (code) is an owner decision and out of this scope.

## Consequences

- The geldar side proves the world never turns hostile text into instructions; the Scriptorium side proves the launcher and session do not act on it.
- Adding a tenth entry means adding a row to the index and a scenario file; the structural tests then cover it.
