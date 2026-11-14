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
| 20:56 | eat chooser (0216, #375) | #375 | fewer wasted eats |
| 21:15 | #379 (0213): panic_burrow needs hostile or damage; dark_shelter ignores unknown light | 0213 | night reflex failures should drop |
| 21:19 | register-only (#380/#381) | | no behaviour change; hosts recreated |

Windows: 20:57-21:15Z is the last clean window. Clean window for 0213: from 21:20Z.

Merge times from geldar-vitals (deploy instants pending from geldar-93): #369 eat/sleep detail_text 20:07Z; #375 eat chooser 20:52Z; #379 (0213 panic_burrow needs hostile or damage; dark_shelter ignores unknown light) after 20:52Z. Queued: 0214, 0215a, 0215b. Phantoms are vanilla (about 3 in-game days without sleep, open sky); days_since_sleep is MCP bookkeeping, not a phantom proxy.

| 22:23:57-22:24:45 | Experiment E1: Billy only, GELDAR_RUN_MAX_TURNS=20 (was ~38); first run 22:24:44Z. Control: Tommy. Before window: Billy 24 h to 22:14Z ($0.134/h, 3,916 turns, 36% wait). May be followed by 25 turns. | geldar-economy, owner-approved | compare actions/h, deaths, food, speech, exploration, failure rate on a clean window; a deploy within it confounds both agents equally |

Merge times from geldar-vitals (deploy instants are geldar-93's; ask before comparing): 0215a #389 22:27Z (monsters-nearby refusal names kind and distance); 0214 #387 22:58Z (reflexes suspended while asleep); 0215b #391 22:59Z (sleep result n of m). Bed search order/crowding change is next, not shipped.
