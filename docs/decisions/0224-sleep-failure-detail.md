# 0224: Sleep failures state the final position and the beds tried; the monsters refusal names the dwell

- Status: Proposed (implementer; owner to accept)
- Date: 2026-11-14
- Amends: the sleep failure detail in `golem/src/actions/sleep.ts`; the monsters refusal text of decision 0215

## Context

In the ops diagnosis, failed sleep walks ended at positions the action result did not state. In 90 minutes, 98 of 181 sleep refusals were for a phantom 4 blocks away, and the same agents retried it. The refusal named the hostile and its distance but not how long it had been in range.

## Decision

1. Every failure that the bed loop returns (the tried-N failures, the budget and hard-stop failures, a bed refusal returned straight from the loop, and the no-bed and not-night failures) carries two keys in `detail`:
   - `final_position`: `{x, y, z}`, the bot's position at the end, each axis rounded to one decimal place.
   - `beds_tried`: `[{x, y, z, reason}]`, one entry per bed the loop tried, in the order tried. `x, y, z` are the integer coordinates of the bed block the bed's last attempt used (the other half after an out_of_reach). `reason` is the fact text the refusal or walk gave. Beds not tried are absent; the list is empty when no bed was tried.
   - The `raw` refusal record is kept.
2. On a monsters refusal, the Body records per bot, by entity id, the world age (`bot.time.age`) when the hostile was first seen in the bed box. Each monsters refusal records new ids, and drops the ids that are not in its box, so a hostile that leaves the box starts again when it returns. The nearest counted hostile's dwell is added to the text of the nearest named hostile only: `there are monsters nearby: phantom 4 blocks away, in range for 6 minutes`. Minutes are whole ticks divided by 1200; under one minute the text says `under a minute`, which includes the first sighting. The raw record gains `dwell_ticks`.
3. The bed order (nearest first) and the loop's stop rule are unchanged: a monsters refusal ends the loop at the first bed.
4. The agent reads the failure `message`, not `detail`: the executor sends only the message to the Mind, capped at 160 characters. The tried-beds failures (all occupied or blocked, search time ran out, and the hard-stop cut) end their message with `; ended at X, Y, Z`, the bot's position in whole blocks. When the whole would pass 160 characters, the last bed's text is cut first and ends in `...`; the head and the position are kept. The action log keeps the full `beds_tried` list and `final_position` in `detail`.

## Consequences

- The agent sees the position and the failure text through the message only; `beds_tried` and `final_position` are for the action log, and the contract is not changed by this record.
- The dwell is a count of world ticks the bot saw the entity in the box, not the time the entity was in the world; it resets when the entity id is absent from a monsters refusal's box.
- Only the nearest of the up to three named hostiles carries the phrase; the others do not.
- The dwell map is held per bot in a module-level WeakMap, so a dropped bot releases it.
