# 0225: The Body logs the time since rest; the server's bed refusal lines become facts

- Status: Proposed (implementer; owner to accept)
- Date: 2026-11-14
- Amends: the sleep refusal text in `golem/src/actions/sleep.ts` (decision 0224 item 4 keeps its shape); adds `golem/src/actions/sleep-refusal.ts`; adds a Body log line in `golem/src/body/rest-stat.ts` (committed in cf6423ee)

## Context

In 90 minutes, 98 of 181 sleep refusals were phantoms: the bed check named a hostile that the server did not count, and the same agents retried. About 40 sleep refusals a day show only "the bed could not be used", which tells the agent nothing it can act on. No way existed to measure how often a phantom refusal is exposed, because the Body did not record how long the bot had gone since it last rested.

The server does send the reason. When it refuses a bed it sends an action-bar line whose translation key names the cause. The Body's Mineflayer wrapper turns the refusal into a generic error, so the reason is lost before the agent sees it.

Probe evidence, live 26.1.2: `block.minecraft.bed.no_sleep` and `block.minecraft.bed.not_safe` were captured from the server's action-bar lines. The other three keys (`.obstructed`, `.occupied`, `.too_far_away`) were read from the 26.1 `language.json`, not captured live.

## Decision

(a) The Body logs the ticks since rest to the operator diagnostic log, every five minutes and 2 s after a sleep. The value is the statistic in category 8, stat 4 (ticks since rest). This is 26.1.x only; the ids are pinned to the 26.1.x registry order. Committed in cf6423ee.

(b) The five bed keys become plain facts. The Body records the last `block.minecraft.bed.*` key sent as a game-info line after each refused `bot.sleep`, and reads its text as follows. The agent reads these texts:

| Key | Agent-visible text | Reason |
| --- | --- | --- |
| `block.minecraft.bed.no_sleep` | `it is not night` | `not_possible` |
| `block.minecraft.bed.not_safe`, no counted hostile in the bed box | `the server says there are monsters nearby; none in view` | `not_possible` |
| `block.minecraft.bed.not_safe`, a counted hostile in the bed box | the named-hostile text of decision 0215 (unchanged) | `not_possible` |
| `block.minecraft.bed.too_far_away` | `the bed is too far away` | `out_of_reach` |
| `block.minecraft.bed.occupied` | `the bed is occupied` | `blocked` |
| `block.minecraft.bed.obstructed` | `the bed is obstructed` | `blocked` |
| any other `block.minecraft.bed.*` key | `the bed could not be used` (unchanged) | `blocked` |
| no key seen | `the bed could not be used` (unchanged) | `blocked` |

When a generic refusal arrives, the Body waits up to 300 ms x `timeScale` for one. The key, when seen, is recorded in the action log's `raw` record as `bed_key`. The loop's rules of decision 0224 are unchanged: `not_possible` ends the loop, `blocked` tries the next bed, and the failure text stays within 160 characters with `; ended at X, Y, Z`.

## Consequences

- Ticks since rest is a log line only. Whether agents should see it is a policy question for the owner and is not part of this decision.
- The bed key facts reach the agent through the failure text. A loop that ends with blocked beds reports the last bed's text, and its failure carries the last refused bed's `raw` record as its `raw`, so `bed_key` reaches the action log for the occupied, obstructed and unknown keys too. The key kept is the last refused bed's: an earlier bed's key is not kept when a later refusal has no key.
- The ids and the statistics reply were confirmed live on 26.1.2 (probe 2): category 8, and ids 1 to 4 rose together; only id 4 fell, from 248 to 7, after the bot slept through the night. Id 4 is the time since rest.
- The ids are pinned to 26.1.x registry order. A later version that reorders the statistics must change the ids with a new decision.
- The three keys read from `language.json` (`.obstructed`, `.occupied`, `.too_far_away`) are not confirmed by a live capture; the first live refusal of each shows them in the log.
