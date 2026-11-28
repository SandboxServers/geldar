# 0457. Spine test shard: two control worlds and two memory worlds before any pass claim

- Status: Accepted (owner ruling 2026-11-28 relayed via geldar-69)
- Date: 2026-11-27
- Spec: none. `docs/spec.md` is not touched.
- Source: `docs/analysis/sheet/memory-spine-design.md`, section 5, question Q7, and section 3.
- Related: 0289 item 5 (the first test-shard run is scripted, then real agents), the held-live ruling of 2026-11-15, the review's E11 on noise.

## Decision

1. **Two control worlds and two memory worlds** before any pass claim. One world per arm is one observation.
2. **The control arm runs the kit at the pre-spine tag,** with the same seeds as the memory arm (design section 3.1).
3. **The pass bar is fixed before the run.** The bar's values are not set here; the design says they are the owner's, and they stay open until the owner sets them in the test-shard plan.

## Why

A single world per arm cannot separate the memory feature from noise. Fixing the bar before the run stops the result from choosing the bar.

## Consequences

- No pass claim is made from a single memory world or a single control world.
- The test-shard plan must carry the bar before any run starts.
- This record does not activate any run. The held-live ruling still stands.
