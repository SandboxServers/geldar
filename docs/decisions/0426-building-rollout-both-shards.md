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
