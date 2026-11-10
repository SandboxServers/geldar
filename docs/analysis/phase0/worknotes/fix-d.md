# Fix packet D: Mind loop and attention controller

Branch `fix/d-mind-loop` from `wave6-main`. Review findings in `animus/src` (decision 0065, W6-24 cycle bounds).

## Items

| # | Finding | Status | Commit |
|---|---------|--------|--------|
| 1 | Damage candidate opens a second thought after a Body `unexpected_damage` wake or during an in-flight thought | done (test + spacing fix) | 5169f66, dd69f8e |
| 2 | `ended` (after death) not checked in speech, wake, intent handlers or the settle timer | done (guard in handle, settle timer) | 75d412f |
| 3 | Memory retrieve timeout aborts the cycle (wake lost) | pending | - |
| 4 | Plan submit and memory load not bounded (inFlight stuck) | pending | - |
| 5 | Hung journal write after a valid completion discards the thought | pending | - |
| 6 | Aborted cycle records no suppressed_wakeups row | pending | - |
| 7 | `thought_started` log outside try (unhandled rejection, inFlight stuck) | pending | - |
| 8 | Memory timeout logged as reason `error` instead of `memory` | pending | - |
| 9 | lantern-local warmOrder warms every pin when run_tier unset | done (warms only keepWarmSet names) | see git log |
| 10 | Owner tuning item: shards/phase0.yaml mind deadline_s 25 vs 600 tokens on the 32B | recorded (owner item, shard unchanged) | - |

## Owner tuning items

- Item 10: `shards/phase0.yaml` sets the mind `deadline_s` to 25. A 600-token completion on the 32B may not finish in 25 s. The shard value is not changed here. The 32B run should measure it and the owner should decide.

## Decisions

- Item 1, damage while a thought is in flight: the damage candidate is dropped (recorded `coalesced_in_flight`), not held. The review asked for suppression. A hit during a long thought is therefore not re-raised after settle; the idle watchdog is the only follow-up.
