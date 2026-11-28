# AN-50c: presenter rows for container_taken and fight_seen

Closes AN-50b finding 3, using the sentences decision 0391 approved in `contract/src/observation.ts`. No new wording; `contract/` is untouched; no producer is turned on (the `observations` Body option stays absent).

Note: the code is in `threshold/mcp` and `threshold/mcp-mock`, not `golem/**`.

## Change

- `threshold/mcp/src/events/handlers/observation.ts`: sets `observationKind` for `fight_seen` and `container_taken` too, and passes `target` to `observationSentence`.
- `threshold/mcp/src/events/present-handlers/observation.ts`: those two kinds present a line with no `actor` (the sentences are actor-free, decision 0391); the line carries `item` and `count` for a take.
- `threshold/mcp-mock/src/sim/events.ts`: `observationKind` type widened.
- Tests: `handlers/observation.test.ts` (sentence, a/an, no actor, no key) and `leakage.test.ts` (visible and hidden present a name-free, leak-free line; the old "present no line" cases replaced).

## Revert-check

| Revert | Result |
|---|---|
| `handlers/observation.ts` restored to main | 3 failed: both leakage cases and `presents the approved actor-free sentence` |
| `present-handlers/observation.ts` restored to main (actor drop) | 2 failed: the visible-name leakage case and `presents the approved actor-free sentence` |

Full `threshold/mcp` vitest with the change: 145 files passed, 1315 tests passed, 58 skipped. `tsc --noEmit` clean in `threshold/mcp` and `threshold/mcp-mock`; `biome check threshold` no errors.
