# FX-METRICS-RACE: the push-only telemetry stop race

## Symptom

CI failed once, not locally, in `golem/src/metrics.test.ts`, `startGolemTelemetry: push only`,
test "after stop, no further push arrives": `AssertionError: expected 2 to be 1`. A push reached
the fake receiver after `stop()` had returned.

## Root cause

All three push-only exporters (`golem/src/metrics.ts`, `threshold/mcp/src/metrics.ts`,
`eventsink/src/metrics.ts`) share one shape. Their `stop()` was a synchronous `clearInterval`.
It stopped future ticks but did not wait for a push already in flight. The timer callback and the
first push are fire-and-forget (`void pushMetrics(...)`), so a request started before `stop()` could
reach the receiver after `stop()` returned. The test's count was read right after `stop()`, so it
could see one post where a second was on its way.

The eventsink test carried a comment acknowledging this ("A push already in flight when stop() is
called may still land; wait it out") and papered over it with a fixed 30 ms sleep. That is why it
was flaky rather than always failing.

## Fix

Each exporter's `startTelemetry` (eventsink: `eventsinkTelemetry`) now tracks in-flight pushes:

- `push()` returns early when `stopped` is set, then starts the push and adds it to an `inFlight`
  set, removing it on settle.
- `stop()` sets `stopped`, clears the timer, and awaits `Promise.allSettled` over the set. It
  returns a promise, so callers await it. Golem's Body entry (`golem/src/adam/main.ts`), eventsink's
  shutdown (`eventsink/src/main.ts`) and the threshold closer (already async) await it.

Semantics after the fix: once `await stop()` resolves, no push is in flight and no push starts.

No shared helper was introduced; each package keeps its own copy, as the packet asked.

## Tests

- Golem: the existing "after stop" test now awaits `stop()`. A new regression test holds the
  receiver's answer open (a gate), calls `stop()`, asserts it has not resolved, releases the gate,
  asserts it resolves, and asserts no push starts or arrives afterwards.
- Threshold and eventsink: the same regression test, with a held fetch (threshold) or a gated
  receiver (eventsink). The eventsink fixed-sleep workaround is replaced by an await.
- eventsink `main.test.ts`: awaits the `stop()` it calls.

## Revert evidence

Each behavioural fix was committed first. Then the single line
`await Promise.allSettled([...inFlight]);` was mutated to `void Promise.allSettled([...inFlight]);`
(the racy behaviour: `stop()` resolves at once). The regression test failed in each package with
`AssertionError: expected true to be false`. The file was restored from a scratchpad backup and
`git diff --stat` was empty.

The `if (stopped) return;` guard was not reverted separately. Because `clearInterval` already
prevents later timer callbacks, the guard has no observable effect today. It is kept because the
packet asked for it and it covers any future caller of `push` that is not a timer.

## Loop results

Each changed test file was run 20 times with `pnpm -C <package> exec vitest run <file>`:

- golem `src/metrics.test.ts`: 20/20
- threshold/mcp `src/metrics.test.ts`: 20/20
- eventsink `src/metrics.test.ts`: 20/20
- eventsink `src/main.test.ts`: 20/20

## Gates

- Golem metrics 20/20 and adam tests 17/17; threshold metrics and main 28/28 and metrics 17/17;
  eventsink full suite 95 passed, 2 skipped (pre-existing skips).
- Typecheck (`tsc -p . --noEmit`) passes in golem, threshold/mcp and eventsink.
- `biome ci` passes on every touched file.
- `./geldar.ps1 pnpm check:repo` passes. Its warnings are pre-existing and none name a touched file.
- `git merge-tree --write-tree origin/main HEAD` exits 0 with no conflicts.

## Known limit

`stop()` now waits for an in-flight push, and `fetch` has no timeout here. A receiver that never
answers would delay Body or sink shutdown until the transport gives up. The packet chose await over
abort. A bounded wait (for example `AbortSignal.timeout`) would be a separate change, and it was not
made in this packet.
