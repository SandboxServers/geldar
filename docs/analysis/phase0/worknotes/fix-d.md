# Fix packet D: Mind loop and attention controller

Branch `fix/d-mind-loop` from `wave6-main`. Review findings in `animus/src` (decision 0065, W6-24 cycle bounds).

## Items

| # | Finding | Status | Commit |
|---|---------|--------|--------|
| 1 | Damage candidate opens a second thought after a Body `unexpected_damage` wake or during an in-flight thought | done (test + spacing fix) | 5169f66, dd69f8e |
| 2 | `ended` (after death) not checked in speech, wake, intent handlers or the settle timer | done (guard in handle, settle timer) | 75d412f |
| 3 | Memory retrieve timeout aborts the cycle (wake lost) | done (retrieve bounds its own awaits, returns [] on timeout; outer bound removed) | 52f0350 |
| 4 | Plan submit and memory load not bounded (inFlight stuck) | done (plan send bounded as `plan_submit`, outcome `fallback_hold`; profile load bounded) | 65f1b8d |
| 5 | Hung journal write after a valid completion discards the thought | done (counted as a journal error; the plan is still sent) | 02ad39a |
| 6 | Aborted cycle records no suppressed_wakeups row | done (recordLostWake on CycleAborted, bounded and swallowed) | 03a44f3 |
| 7 | `thought_started` log outside try (unhandled rejection, inFlight stuck) | done (log moved inside the try) | 4c41fc5 |
| 8 | Memory timeout logged as reason `error` instead of `memory` | done (withinLimit throws CycleAborted('memory')) | bc3022d |
| 9 | lantern-local warmOrder warms every pin when run_tier unset | done (warms only keepWarmSet names) | see git log |
| 10 | Owner tuning item: shards/phase0.yaml mind deadline_s 25 vs 600 tokens on the 32B | recorded (owner item, shard unchanged) | - |

## Owner tuning items

- Item 10: `shards/phase0.yaml` sets the mind `deadline_s` to 25. A 600-token completion on the 32B may not finish in 25 s. The shard value is not changed here. The 32B run should measure it and the owner should decide.

## Decisions

- Item 1, damage while a thought is in flight: the damage candidate is dropped (recorded `coalesced_in_flight`), not held. The review asked for suppression. A hit during a long thought is therefore not re-raised after settle; the idle watchdog is the only follow-up. Recorded in decision 0065, point 5.

## Results of items 3 to 8

- Each item has one commit with a test that was run against a one-line or two-line revert of its change (the test failed, the file was restored, the tree was clean).
- Item 3: the retrieve bound is per await (embed, then search), so a hung embedder degrades to no memories and the cycle still plans. Test flipped to expect `planned` and no `cycle_aborted`.
- Item 4: `plan_submit` maps to outcome `fallback_hold` (the Body never got the plan); every other abort still maps to `model_error`. `SubmitContext` gained `stepMs`. The profile load is wrapped in `bounded` inside `withinLimit`.
- Item 5: a rejected write was already counted; a hung write now is too. Test flipped: `planned`, one journal error, one plan sent.
- Item 6: the `suppressed_wakeups` row for an aborted cycle uses the existing `snapshot_unavailable` reason, because `recordLostWake` has a fixed reason. An aborted memory or journal step therefore records that reason too. A follow-up could pass the abort reason through.
- Item 7: a throwing log sink on `thought_started` now still settles the thought (`settled: model_error`).
- Item 8: `withinLimit` now rejects with `CycleAborted('memory')`; its test checks the class and reason, not the old message.
