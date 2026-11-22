# BLD-fix3b: review round 3 test fixes (I3, I4, N3)

Tests only; no production change. Base for this pass: a2dd9846 (building/integration).

## I3: bed look per direction

`golem/src/actions/place.test.ts` gained one case per direction (east, south, west, north). Each
case leaves ground under the one free cell beside the bot, so `freeBeside` picks that step, and
checks the bed look yaw through `lookVector(yaw, 0)`: its x and z equal the step. The old
formula `Math.atan2(-step.x, step.z)` agrees with the new one for east and west, so only the
north and south cases catch it. Revert-check: with the old formula in `place.ts` line 188, the
south and north cases fail; `place.ts` restored, diff empty.

## I4: metrics hand-off

- `golem/src/body/create-body-building.test.ts`: a plan cell counts on the `metrics` the Body was
  given (revert of `create-body.ts` lane wiring, line 226: fails). Flag off: no plan metric.
- `golem/src/body/create-body-seen.test.ts`: a seen flush counts on the `metrics` the Body was
  given (revert of seen wiring, line 305: fails).
- `golem/src/adam/adam-body-metrics.test.ts` (new file; `adam-body.test.ts` left at 620 lines):
  restart receives the env metrics object by identity, and none when the env has none (revert of
  `adam-body.ts` restart options, line 206: fails).

## N3: main-level call path

Accepted, not tested. `main()` in `golem/src/adam/main.ts` and `seedAllBuckets` in
`golem/src/seed-buckets.ts` call their helpers inline, and `main()` runs the connection set-up
with no seam. Testing the one-line call needs an extraction or a large mock of the connection
set-up, which is more than a test-only packet. The helpers' own tests still fail when their
bodies are reverted, and the live compose seed exercises the call.
