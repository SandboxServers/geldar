# 0325. The `psyche-v1.1.0` tag is approved

- Status: Accepted (operator ruling, 2026-11-18)
- Date: 2026-11-18
- Spec: none. A campaign record for the character-sheet campaign; `docs/spec.md` is not edited.
- Related: 0281 (psyche package boundary, release record and tag rule); `psyche/RELEASE.json`, `psyche/README.md`, `tools/psyche-release/`

## Context

AN-08a (#458) added `psyche/src/threat.ts` and recorded release 1.1.0 in `psyche/RELEASE.json` (`version` 1.1.0, `engine_version` 1, `tree_hash_algorithm` `geldar-tree-v1`, `tree_hash` `f243f7c233c78f77fcf051b95a38635d84fde318c9a81301fea998b0720182cf`, `tag` `psyche-v1.1.0`). The README rule is that each release is tagged on the merge commit that holds the record, after an owner's approval. Only `psyche-v1.0.0` exists, locally and on the remote (checked 2026-11-18). The kit mirror is pinned to 1.0.0 and lacks `threat.ts`.

## Decision

1. **The tag `psyche-v1.1.0` is approved.**
2. **It points to the tree-hash release:** the main commit that holds `psyche/RELEASE.json` at version 1.1.0 with the tree hash above. That is the merge commit of #458 (`4cff991d`); `psyche/src` and `psyche/RELEASE.json` have not changed on main since (checked at `a8063b0a`). Before tagging, `tools/psyche-release` recomputes the tree hash at that commit and it must equal the recorded one; if not, nothing is tagged and the planner is told.
3. **The tag push needs a credentialed operator or ops.** No coder pushes it. An annotated tag, as `psyche-v1.0.0` is.

## Consequences

- Once the tag is on the remote, a kit re-mirror card (G13 in the verification note) can move the kit to 1.1.0, which W3 to W6 kit cards that need `decideThreat`, `fightFloor` or `fightLimitMs` wait for.
- S10-02 would have made 1.2.0 after this tag; it is inactive under 0327, so no further psyche release is planned in this campaign.
