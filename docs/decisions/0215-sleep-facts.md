# 0215: the sleep refusal names the hostile and its distance

- Status: Proposed
- Date: 2026-11-14
- Why: the monsters-nearby refusal of `sleep` read "there are monsters nearby", which names nothing. Agents then blamed the iron golems they could see. In 7 h, 14 agents were refused 172 times. Iron golems are passive in minecraft-data (`category` "Passive mobs"), so golems are not what blocks sleep; the hostiles are.
- Design intent kept: the refusal is still a `not_possible` failure with the same text family. Only its fact changes, and the other `SLEEP_ERRORS` texts stay as they were.

## The rule

The Body computes the hostiles vanilla's bed check counts, from the bed block the action tried (`golem/src/actions/sleep-hostiles.ts`):

- Only entities whose minecraft-data `category` is "Hostile mobs" count. Enderman, zombified_piglin, creeper and zombie count; iron_golem, snow_golem and the other passive mobs do not.
- The box is vanilla's, around the bed head: x from -8 to +7, y from -6 to +4, z from -8 to +7 (`bed.js` `monsterRange` and its corners). The brief's first draft gave dx and dz 8 and dy 5; the code is the source, so the box is the code's.
- The text names the nearest counted hostile, with its kind (the entity name) and its distance from the bed head rounded to a whole block (`Math.round`): `there are monsters nearby: zombie 6 blocks away`. One block is singular: `creeper 1 block away`.
- With several, it names at most three, nearest first: `there are monsters nearby: creeper 3 blocks away, zombie 7 blocks away`.
- When no counted hostile is in the box (it left, or it is not loaded), the text is `there are monsters nearby: none in view`.
- Kinds are restricted to `[a-z_]`. Facts only: the text gives no advice.

## The record (events only)

Every sleep refusal attaches a record to the failed outcome in `raw`. `raw` is the channel the action log keeps: the registry writes it to the action log, and `toResult` never copies it into the stored result the agent reads. The record is `{"event":"sleep_refusal","message":...,"light":...,"hostiles":[{"kind":...,"blocks":...}],"count":...}`, where `light` is `bot.blockAt(bed).light`, or null when the world does not report it. `hostiles` keeps the first three counted hostiles, nearest first, and `count` is the total in the box. The `raw` value is clipped to the action log's 200-character limit, so `light` comes first: a record with many hostiles still carries the light inside the clip.

## Follow-ups of the same decision (not in this change)

- The "n of m asleep" line of the sleep state.
- The actionbar `bed.*` refusal facts. Their wording needs a captured actionbar line first.

## Consequences

- The agent sees which hostile blocks the bed and how far it is, so it can act on that fact. The text adds no instruction.
- The distance is measured from the bed block's corner (the block position the action clicked, not its centre). When that is a foot half, the box is measured from the foot, not the head vanilla uses, so an edge hostile can differ by one block. Resolving the head from the bed's part is not done.
- A monsters refusal whose hostiles are all outside the box still reads "none in view". The record keeps the hostiles and the light for the log, so a refusal with no counted hostile can be checked later.

## The sleepers line

The server tells every player when someone lies down, so the Body reads that line for the sleep result (`golem/src/actions/sleepers.ts`).

- Captured on minecraft 26.1 (live probe): when a player lies down, the server sends every player a system chat packet with `isActionBar` true. Mineflayer 4.39 emits it as the bot's `message` event with position `game_info`, and `jsonMsg.translate` is `sleep.players_sleeping` with `with` = `[asleep, needed]` (ints).
- When enough players sleep, the server sends `sleep.skipping_night` with no arguments instead.
- Only `game_info` lines count. Both message shapes are read: the ChatMessage (`with[i].text`) and the raw json (`json.with[i]`). A number must be an integer from 0 to 999; any other value drops the line.
- The count belongs to the Body's own bed. The sleep action arms the watch right before each `bot.sleep` call, one per bed try. Only lines sent from that call count, including those sent while Mineflayer's sleep is pending; a line from the walk to the bed, or from an earlier bed try that failed, does not. Once the Body is asleep, a line already in hand is the answer; otherwise the action waits up to 300 ms (scaled by `timeScale`) for the next line. It then completes with `detail.sleepers`: `{asleep, needed}`, or `"skipped"`. With no line, the result has no `sleepers` key. A cancel during the wait returns `cancelled`.
- The agent reads the ok result as a plain fact: `<asleep> of <needed> needed are asleep`, or `the night was skipped`. With no line there is no such fact. The failure texts are unchanged.
- `needed` is the number of sleepers the server needs before the night is skipped. That comes from vanilla source memory (`sleepersNeeded`), not from a probe. A two-player probe cannot tell needed from total: with two players, `1 of 2` is the same reading whether 2 is needed or 2 is the total. The wording states what the server sent and claims nothing beyond it.
- The count is the newest own-bed line when the result is made. The watch does not track wake-ups.
