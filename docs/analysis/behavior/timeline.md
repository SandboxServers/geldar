# Behaviour timeline (UTC, 2026-11-14)

Source: cd.log, geldar-worldops notes, change-windows memory addenda 17-22. Every deploy recreates all player hosts (~20 s drop).

| UTC | What | Ref | Expected effect |
|---|---|---|---|
| 16:11 | Body batch 2: give, reflex backoff, sleep budget, idle_stuck | #352 | fewer repeated reflex loops |
| 16:54 | Paper restart: graves, BlueMap skins, CoreProtect | #350/#351 | none on play |
| 18:26 | Body window B: upward dig, idle_stuck slot hold, sleep hard stop | #357 | fewer ledge/pit waits |
| 18:30 | Paper restart: speech bubbles, proximity chat (32 blocks) | #360/#362, 0197/0198 | far speech no longer heard |
| ~19:10 | gamerule players_sleeping_percentage 100 -> 50 | owner | night can pass with half asleep |
| 20:10-20:56 | six deploys; #363 (unstick budget, goto escalation) in 1f84676b | 0210 | fewer unstick/goto stalls; clean window 20:57-21:15 |
| 21:15 and 21:19 | deploys 3df6c808, 094788b3 (contents not yet noted) | | window after 21:19 is confounded |

Windows: 20:57-21:15Z is the last clean window. Ask owners for the content of 21:15/21:19.
