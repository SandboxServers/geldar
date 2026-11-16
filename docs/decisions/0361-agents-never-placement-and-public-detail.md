# 0361. Agents-never documents: where they may live, and how much a public repo may say

- Status: Proposed (owner to accept)
- Date: 2026-11-16
- Spec: section 2 (principle 1) and section 8 (security). Builds on decisions 0058, 0059, 0068 and 0350. Records plan decisions D2 and D9 of the docs-library plan (`docs/analysis/docs-library/plan.md` section 12).

## Decision

1. **Label.** The following documents carry `audience: agents-never`: every document about observation, telemetry, vitals, the Glass, Kino, journals, thoughts or prompts. They have the same readers as `operators`. The label marks where such a document must never be placed.
2. **Placement.** An `agents-never` document lives in `docs/` only. It is never copied into, quoted from or linked from a path an agent reads. The style document lists those paths under [paths an agent reads](../agents/documentation-style.md#paths-an-agent-reads). They include prompt templates, MCP schemas and tool text, MCP prompts and resources, Body failure text, the character engine, persona files, the kit and player repos, and in-world text. No operator material goes into a sibling repo that agents read (D2).
3. **Existence and policy only.** The repo is public, so an agent that can browse can read anything under `docs/`. A document there says that a surface exists, who may use it, and the policy that governs it, and no more. Decision [0350](0350-telemetry-scope-and-full-capture.md) shows the policy level: it states that telemetry exists, who may read it, how long it is kept, and that agents never see it. Parts of 0350 go further than that level; new documents do not repeat them. A document does not give thresholds, delays, hiding rules, detection detail, or how a surface stays unseen (D9).
4. **Withheld detail goes to a private store outside this repo.** The owner names its location. Until the owner does, writers do not put withheld detail in any repo file. A writer keeps it in the report to whoever sent the brief, and the document says "withheld under decision 0361" in its place.
5. **Records too.** Decision records follow points 3 and 4. A record that has to cite a gap in observation or ingress names the gap and the policy, not the mechanism.

## Why

- Persona rule 5 and decisions [0058](0058-the-character-knowledge-boundary-and-thought-v2.md), [0059](0059-identity-mode-is-about-human-observation-not-agent-belief.md) and [0068](0068-prompt-v4-and-agent-visible-text.md) say an agent never learns it is watched. Decision 0350 item 7 applies the same rule to telemetry.
- The repo is public (`CLAUDE.md`, repo rules). Plan finding F-12 rates this high severity. Plan risk R1 says the mitigation is labels plus the D9 level.
- Code already guards agent-read text. The scans are `contract/src/agent-text.ts`, `contract/test/agent-visible-text.test.ts`, `animus/src/prompts/agent-text.test.ts` and `tools/mcp-tokens/src/persona-lint.ts`. None of them covers `docs/` (plan finding F-15).
- The owner approved D2 and D9 on 2026-11-16 (plan section 12). The private store was not part of either approval. Point 4 is new and needs the owner.

## Consequences

- Owner: name the private store, or decide that withheld detail is not kept anywhere.
- Decision [0365](0365-docs-gates-after-the-freeze.md) proposes an agent-visibility check. Until it exists, the manual grep in [doc verification](../agents/doc-verification.md#agents-never-placement) stands in for it.
- Documents already written are not audited against point 3 by this record. That audit belongs to the planned W4 document S05 and the W7 review (plan section 6).
- Decision [0364](0364-known-gaps-against-0137-and-spec-8-4.md) is written at this level.
