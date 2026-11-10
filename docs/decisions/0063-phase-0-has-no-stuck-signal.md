# 0063. Phase 0 has no `stuck` signal; the exit runs measure whether intents complete

- Status: Accepted provisionally (orchestrator, owner may revise)
- Date: 2026-11-10
- Spec: 5.3.1 (intents: `wake_on`, `limits`, `preconditions`), 5.3.2 (the attention controller: fallback wakeup), the operations section's "An agent is stuck" paragraph (about line 1456); decisions 0061, 0062
- Finding: AD-11, `docs/analysis/phase0/worknotes/wave5-review-1-AD.md` item 11

## Context

AD-11 says the `stuck` effort signal can never fire, and asks for a Body watchdog or a recorded decision. The spec's definition (operations section, about line 1456) is a repeat detector: the same action repeating with the position unchanged for 10 minutes, a `stuck` event in the next snapshot with the repeat count, and a Body restart after three cycles. The question behind it is whether an intent can make no progress without the Mind hearing about it.

The `stuck` field is still unfed. `golem/src/snapshot.ts:20,140` passes an optional `stuck` through to the snapshot, and no caller in `golem/src` sets it outside the bench runner. The Mind reads it in two places: `animus/src/loop/effort.ts:55` (an effort reason) and `animus/src/prompts/render-snapshot.ts:150-152` (the text "Your body noticed it repeats itself"). Both are dead in practice. The line that AD-11 cites (`server.ts:154-168`) has since changed; it now peeks the events (`golem/src/mind-link/server.ts:160`) and never sets `stuck`.

## What already protects the Body in Phase 0

Checked in the code at `wave6-main` (eba101b), excluding tests:

1. **Intent limits.** `golem/src/body/limits.ts:51-54` (`LimitTracker.exceeded`) returns `max_world_ticks` or `max_block_operations`. `golem/src/body/executor.ts:249-253` (`onTick`) ends the intent as `failed` with wake reason `limit_reached` (`golem/src/body/wake.ts:16`). The expiry is set when the intent is installed (`golem/src/body/executor-intent.ts:69`). A resumed run is capped to the original expiry (`golem/src/body/restart.ts:244`). Thoughts are rejected above the shard cap (`animus/src/validate/thought-output.ts:80-84`; cap 240000 in `shards/phase0.yaml:8`).
2. **Preconditions.** Checked at start (`golem/src/body/executor-intent.ts:109-113`; an unknown name fails too) and, when `precondition_failed` is in `wake_on`, on every tick (`golem/src/body/executor.ts:347-349`). Both end the intent and wake the Mind.
3. **Wake conditions.** `golem/src/body/wake-conditions.ts` wakes only for the intent's `wake_on` set. `golem/src/body/wake.ts:2-22` adds four reasons the Body raises itself: `reflex_danger`, `action_failed`, `limit_reached`, `no_plan`. The watch runs each tick (`golem/src/body/executor.ts:270-274`, `343-352`).
4. **Reflex wait.** `golem/src/body/executor-action.ts:8-22` waits at most 10 s (scaled) for a busy reflex; a stuck reflex is logged, not killed.
5. **Single move stall.** `golem/src/actions/pathing.ts:7-12,138-151` settles a move as `blocked` when the bot moves less than 0.75 blocks for 600 world ticks. This is per move, not per intent.
6. **Blocked path.** Decision log item 33 (`docs/analysis/phase0/overnight-decisions.md`) says a blocked program fails `blocked` and wakes the Mind. I did not re-read `golem/src/body/reflexes/blocked-path.ts` for this decision.
7. **Mind's idle watchdog.** `animus/src/attention/controller.ts:105` (default 60 s), armed with no intent and no thought in flight (`:243-249`), wakes `idle`. After an intent ends, `settleIdle` waits 250 ms (`:104`, `:260-267`).
8. **Fallback wakeup.** `animus/src/attention/controller.ts:273-281` adds a `fallback` candidate after `fallback_wakeup_ticks` while an intent is active (`shards/phase0.yaml:24`, 6000 ticks, converted to wall time by the tick rate). It is armed on install (`:238`) and after each thought (`:143`). This is the only time-based wake for a running intent; it is subject to the 20 s minimum spacing (`shards/phase0.yaml:24`).
9. **Thought deadline.** `shards/phase0.yaml:58` (`deadline_s: 25`), parsed at `animus/src/config.ts:284`, asserted at `animus/src/loop/thinking-loop.test.ts:112`. It bounds a thought, not an intent. What the Mind does at expiry was not checked for this decision.

Not found: any no-progress check in the executor. `executor.ts` `watch()` tests only `wake_on` and preconditions. `LimitTracker` counts ticks and block operations, not progress. No repeat detector, no `stuck` event, and no Body restart for repetition exist in `golem/src` or `animus/src`.

## Decision

1. Phase 0 has no `stuck` signal. The `stuck` field stays optional and unfed; the effort reason and the prompt line stay as they are.
2. The Phase 0 exit runs measure whether intents complete. An intent that hits its limit ends with `limit_reached`; an intent that completes, is interrupted, or fails for another reason ends with its own outcome.
3. If a run shows an intent making no progress without ending, that is a finding, and it reopens this decision.
4. The watchdog (repeat detection with a Body restart, spec 10-minute rule) is a Phase 1 item. So is the read-only NATS consumer that decision 0061 names.

## Trigger to reopen

Reopen this decision, and open a finding, if either happens in any Phase 0 run:

- An intent runs longer than its `limits.max_world_ticks` plus 600 world ticks, measured from the tick it was installed to the tick it ended in the run's Body log or journal. The limit check in `onTick` should prevent this; if it does not, the Body is not observing ticks.
- Two consecutive runs each contain an intent that never ended (no end record before the run stops).

## Consequences

- W6-14's run documents must count intents that end with `limit_reached` in a separate line of the report, not in the general `failed` count. Each run reports: intents completed, intents interrupted by a wake (by reason), intents ended by `limit_reached`, other failures, and intents that never ended.
- The run documents must state, for each run, whether either trigger above was met. "None" is a valid answer and must be written.
- `shards/phase0.yaml`, the snapshot `stuck` field, and the prompt text are unchanged by this decision.
- Phase 1 gets two items: the watchdog (repeat detection, Body restart) and the read-only NATS consumer named in decision 0061.
- Decision 0061 is not edited. This record stands on its own.
