# 0062. No settled-credits value reaches the reflection in Phase 0; E-8 is deferred

- Status: Accepted provisionally (orchestrator, owner may revise)
- Date: 2026-11-10
- Spec: 5.3.4 and 5.7 (admission: one credit budget per life, a reflection costs two); decisions 0059, 0061
- Finding: wave 5 review round 1, E-8 (trigger skip reasons are silent; `creditsSettled` is always 2)

## Context

The review asked for the reflection's `creditsSettled` to come from admission, and for the trigger's skip reasons to reach the journal. The admission port (`animus/src/ports/admission.ts`) gives a reservation a read-only `cost` and two calls, `settle()` and `release()`, and `settle()` returns nothing. `ReflectionTrigger` calls `settle()` once a run completes, and `release()` only when the run throws. The `run` callback receives the due event, the tick and the buffers, not the reservation. So the reflection writer has no settled value to read, and `creditsSettled: REFLECTION_COST` is the amount the reservation was made for.

## Decision

1. Phase 0 keeps the charge as it is: a completed reflection settles its reserved cost (2 credits); only a thrown error releases it. The journal's `creditsSettled` therefore stays `REFLECTION_COST` for a completed reflection. This is a reading of the current policy, not a measured value.
2. The gap that remains is a policy question, not a missing input: `settle()` runs for every completed model call, including a failed model outcome, so a failed reflection is charged. The thinking loop releases a failed call (`creditsSettled` 0). Whether a failed reflection should do the same is for the owner to decide before Phase 1.
3. The skip reasons from `ReflectionTrigger.handle` (`busy`, `not_admitted`, `already_slept`, `other_life`) stay as they are in Phase 0. They are observability, not accounting, and do not change what Adam does. They are a candidate for the Phase 1 observability work.
4. No code changes for E-8 in wave 6.

## Consequences

- E-8 is closed as deferred, not fixed. Its finding stays open in `docs/analysis/phase0/worknotes/w6-01.md`.
- Making `settle()` return the settled amount, or passing the reservation to `run`, is a port change; it is for the packet that decides point 2.
- The journal keeps reporting 2 for a completed reflection, which is the correct value under the current charge.
