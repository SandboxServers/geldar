# 0190: Body batch 2: give steps back further, reflex backoff holds, sleep has a budget

- Status: Accepted (no separate owner ruling)
- Date: 2026-11-14

## Context

Live runs of the Body (the golem) showed three ways a Body action wasted time or gave up without saying why:

- `give` refused 52 times as "too close to toss". The step back tried 5 spots (straight back, 45 and 90 degrees either side), all at the body's height, and the refusal did not say what had blocked it. A recipient 1.0 to 1.5 blocks away was refused outright although a toss lands past a recipient that far away.
- 150 `give` runs failed "not in sight" with no further detail, so the Mind could not tell a recipient that had left from one behind a wall.
- `dark_shelter` ran 660 times and `panic_burrow` 1422 times, mostly with "no suitable block". Each refusal was followed at once by another try, and a `dark_shelter` try reset its own backoff whenever the set of hostile mobs changed or the Body moved more than 2 blocks, so a Body that kept meeting the same mob at night retried without a pause.
- `sleep` ran 30 times into its 40 s action timeout: the bed loop walked to each nearby bed in turn with no limit on the whole loop, so the Body's own timeout ended the action without telling the Mind how many beds had been tried.
- `mind-link` silently dropped a snapshot that could not be built or failed validation, so a missing snapshot left no line in the log.

## Decision

1. Give steps back from more angles and says why it cannot.
   - The step back tries the turns 0, 45, -45, 90, -90, 135, -135 and 180 degrees around the recipient, each at 2, 2.5 and 3 blocks, and at the body's height, one block up and one block down.
   - A toss is thrown when the recipient is at least 1.0 blocks away once the step back has been tried (was 1.5). Closer than 1.0 the Body does not throw.
   - A refusal names the fact that blocked it: "no standable cell within 3 blocks to step back to", or "the Body could not walk to any of K standable cells to step back to".
   - Log: `give_stepback_failed` with `tried` (K) and `gap` (blocks), once per failed step back.
2. Reflexes hold their backoff.
   - `panic_burrow` starts or doubles its pause on every non-handled run (abandoned or failed), not only on an abandoned run. The pause is 20 s, doubling to a 5 minute cap. Its detail says `; backing off Ns`. The dawn `leave` is not paused: its failures return before the pause is set, so they are retried on the 200-tick cooldown, with no `backing off` suffix.
   - `dark_shelter` waits for the shared panic pause (`burrowPaused`) and no longer resets its backoff when the hostile set changes or the Body moves more than 2 blocks. A light above the dark limit still resets it, and a handled run still clears it.
   - Log: the detail of each refusal carries `backing off Ns`; one line per step, not per skipped tick.
3. Sleep has a 30 s budget for the whole bed loop (scaled by the time scale). The loop checks the budget before each bed and stops; the result says how many beds it tried: `tried K nearby beds, all occupied or blocked; last: ...` when every bed was tried, or `tried K of N nearby beds; the search time ran out; last: ...` when the budget stopped the loop first. A walk or sleep already in progress is cut at a hard stop of 35 s (scaled by the time scale), and the result uses the same `tried K of N ...; the search time ran out; last: ...` text with the real count. The walk to a bed stalls after 300 world ticks, not 600. An external cancel still returns `cancelled`. The 40 s action timeout no longer ends a sleep. Mineflayer's own `bot.sleep` gives up after 3 s, so a sleep that never settles is not the usual case: the walk cut (300 stall ticks) is the real fix for the stall, and the hard stop only guards a sleep that hangs.
4. Logs: `snapshot_unanswered reason=build_failed error=...` and `snapshot_unanswered reason=invalid errors=...` now say why a snapshot is not sent (`mind-link/server.ts`).

## Why

- The 1.0 gate rests on a simulation of the toss, not a live measurement. A toss at 40 degrees down rests the item 1.4 to 2.0 blocks from the giver; at a 1.0 gap the simulated item lands inside the recipient's pickup box in 83 to 97% of tosses (and partly in the giver's box at the closer end). The old 1.5 gate refused tosses that the simulation says would reach the recipient, and the wider set of step-back spots makes the step back succeed where the straight-back spot is blocked.
- A backoff that resets on any change of the mob set never builds up under a steady threat, so the reflex retries every few ticks. A shared pause stops `dark_shelter` from retrying a burrow that `panic_burrow` has just refused.
- A budget on the bed loop turns a 40 s timeout with no fact into a failure the Mind can read.

## Consequences

- Tests: `give-spot.test.ts`, `give-toss.test.ts`, `shelter.test.ts`, `panic-burrow.test.ts`, `unstick.test.ts`, `sleep.test.ts`, `server.test.ts` assert the new behaviour.
- `unstick.ts`, `hazard-escape.ts`, `escape-ladder.ts`, `pathing.ts` and `path-rules.ts` are unchanged (PR #345 owns them).
- Not changed: the "no such agent in sight" text (the Mind cannot be given a distance to an agent it cannot see).
- Live numbers are from the runs above; the effect on those counts is not yet measured.
- Open, live check: a give at 1.0 to 1.2 blocks, level and one up or down, that the recipient picks up.
- Open, owner question: the panic pause is set by time only, not by position, and its length does not decay; the owner has not ruled on a low-health bypass or on a reset after a long move.
