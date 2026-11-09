## What changed and why

<!-- One paragraph. Name the spec section (docs/spec.md) and, for campaign work, the packet (docs/analysis/<campaign>/work-packets.md). -->

## Test plan

<!-- What you ran and what passed. Say what you could NOT test (live shard, Paper, a model). -->

- [ ] `./geldar.ps1 check` passes locally
- [ ] A behavior change has a test that fails when the change is reverted (I checked), or this PR changes no behavior
- [ ] Contract changes were made in `contract/` and regenerated; no hand edits to generated code
- [ ] New dependencies, images and actions are pinned to exact versions (actions and images by SHA or digest)
- [ ] Prompt changes are in `prompts/` with a version bump

## Docs and decisions

<!-- Docs updated in this PR, or "none" with a reason. A settled open decision gets a record in docs/decisions/. Ideas outside the spec go in docs/ideas.md, not in code. -->

## Related

<!-- closes #NNN, packet ID, decision ID -->
