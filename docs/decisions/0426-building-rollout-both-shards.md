# 0426. Building rolls out to all 19 agents at once, behind a shard flag; NeoForge is a gated second wave

- Status: Accepted for the Paper rollout (owner ruling 2026-11-22, rulings 7 and 11); the NeoForge wave is gated by open decisions 0387 and 0390
- Date: 2026-11-22
- Spec: section 10 phases; decisions 0387, 0390, 0391 (evidence-first test shard for the sheet work). Memory rules: deploy windows one at a time; colo-images paths restart all Bodies.

## Decision

1. **Paper autonomous shard first, all 19 agents at once after merge.** The owner chose this knowingly. It departs from the evidence-first test-shard approach used for the sheet work. The automated test and the test-shard evidence packet still run as quality steps before the flag is turned on (BLD-28, BLD-29); the owner can accept the result or turn on without it.
2. **A shard flag turns it off.** `body_actions.building` (default off, read like `body_actions.use`, decision 0218) gates the `break` and `plan` verbs in the Body, the `survey` and `plan_check` tools in the MCP and the seen-map recorder. Turning it off is a config change and a restart of the Bodies.
3. **NeoForge second.** The human-directed shard has humans and agents building together, which needs its own design for attributing human and agent edits (BLD-32). Principle 1 applies to the autonomous shard only (0387). The NeoForge human model (0387, 0390) is open, so the whole NeoForge wave is `BlockedDecision` until the owner accepts them.
4. Merges that touch `contract/**`, `golem/**`, `player-core/**`, `threshold/mcp/**`, `eventsink/**` and the other colo-images paths restart the 19 Bodies. The campaign merges in three bundles (windows R1 to R3 in the packet file) and tells the deploy owner before each.

## Consequences

- Rollback: flag off and restart; or revert the bundle and redeploy the previous image. A saved checkpoint with an unknown program ends idle on restart (existing behavior).

## Addendum, 2026-11-22: PR #932 merges as one PR in one window

Owner ruling, 2026-11-22. The decision above is not edited. For PR #932 this addendum replaces consequence 4's three bundles (windows R1 to R3) with a single rollout.

- PR #932 merges whole, as one PR, in one deploy window. It is not split into bundles.
- The PR stays a draft and does not merge until the release owner (Sam) posts the go. The go waits on the 24-hour kit rc23 report and on the `geldar-v0.1.0` and `kit-v0.1.0` tags.
- After that merge, PR #932 is the first change in 0.2.0.
- The NATS role and bucket steps (`docs/analysis/building/RESUME.md`, manual steps 1 and 2) still come before `body_actions.building` is turned on. This addendum does not change them.

## Addendum, 2026-11-22: the hold on PR #932 is lifted

Owner ruling, 2026-11-22. This addendum supersedes the hold sentence in the addendum above ("The PR stays a draft and does not merge until the release owner (Sam) posts the go. The go waits on ..."). That sentence is kept as written and is no longer in force.

- PR #932 may merge once it is ready. It does not wait for the 24-hour kit rc23 report or for the `geldar-v0.1.0` and `kit-v0.1.0` tags.
- The PR stays draft until the final readiness report and the merge-queue owner's own check of the head sha and green CI. The merge-queue owner runs the merge on that exact head and warns the owner about the Body restart first.
- It is still one PR in one deploy window, not split into bundles.
