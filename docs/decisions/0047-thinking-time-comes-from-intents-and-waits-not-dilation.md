# 0047. Adam's thinking time comes from intents, waits and reflexes; time dilation is not a Phase 0 mechanism

- Status: Accepted (owner, 2026-11-09, answer to the question raised by decision 0038)
- Date: 2026-11-09
- Spec: 5.14 (time dilation), 5.3 (intents, wake conditions), 5.2 (reflexes); decision 0038; benchmark rows at 10 and 5 TPS

## Decision

1. Shards run at 20 TPS. Adam does not get extra thinking time from `/tick rate`: the Mineflayer client's physics runs on its own 50 ms timer, so a slowed server does not slow the Body (decision 0038).
2. Thinking time comes from the Body's structure: the Mind plans while a long-running intent executes in the Body, the Body keeps itself safe with reflexes (spec 5.2), and `wait` and wake conditions let an intent run without a pending thought.
3. Time dilation is no longer a Phase 0 (or planned) mechanism for giving agents time to think. `/tick rate` may still be used for non-Body purposes (server load experiments), clearly labelled as such.
4. The benchmark's 10 and 5 TPS rows stay in the benchmark as informational findings and are not exit criteria (the gate is the Body benchmark at 20 TPS at 100%): they measure an unslowed client against a slowed server, which no longer matches a design question.

## Consequences

- Spec 5.14's time-dilation text, the timer clock table's dilation notes, and the places that cite dilation as the lever for hardware limits (5.6 and the risk table) need amending: the owner is giving the wording (see the spec-edit review file).
- Wave 5 (the Mind) plans around this: the thinking loop must keep the Body busy with a useful intent and reflexes while a thought is pending, and the attention controller decides wakeups on that basis.
