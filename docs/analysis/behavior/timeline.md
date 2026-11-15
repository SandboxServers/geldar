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

Owner decision (via geldar, ~00:30Z 2026-11-15): no world edits for the village food/health crisis (no livestock, no mob clearing, no extra torches); agents fend for themselves, may leave the village. Torches (732, placed 11-12) intact. Within 60 blocks of the white beds at ~00:30Z: 2 zombies, 1 skeleton, 2 creepers, 1 phantom, 3 endermen. New residents Lewis and Clark (explorers) are being prepared by geldar-residents; start time pending.

Deploys (from geldar): 22:55:35Z 299bf1f8; 23:02:26Z 635bf42b (#387, 0214 rest in bed, reflexes suspended while asleep); 23:05:04Z c1189326 (#391, 0215b sleep facts, named hostile, exact bed refusal reasons, "n of m asleep"). Clean sleep window starts 23:06Z. Residents Lewis (ag_lewis_01) and Clark (ag_clark_01) registered, not started. Wait-delta #393 queued, flag off.
Early read at 23:14Z (about 8 min after, too short to use): sleep not_possible 19 / ok 2 after 23:06Z vs 42 / 4 for 22:25-22:55Z. Deaths since 21:20Z: 4 in about 2 h (21Z 2, 22Z 2, 23Z 0 so far), versus about 3 an hour over the previous 24 h (confounded by the earlier fixes).

2026-11-15 (geldar-worldops): 00:08:57-00:09:20 all 15 hosts recreated (32ad0e60, #396 ownership_lookups line); 00:29:55 #407 players-cli tooling, no behaviour change (deployed 00:31, beac5116); 00:39:35 #406 roster adds ag-lewis-01 (Meriwether) and ag-clark-01 (William), deploy 3b5c1df0; 01:21:43-45 skins imported; 01:21:56 whitelist; Body hosts started 01:22:00 (Lewis) and 01:22:50 (Clark); 01:23:40 Glass restarted. Minds start times pending from scriptorium; agent count 15 -> 17 once they run.

geldar-93 (2026-11-15): Lewis and Clark are explorers on Haiku low, kit rc21; Minds start soon via scriptorium (time pending). 0218 use verb is queued behind a flag (off), so no agent change yet. Compare exploration distance, journals and village social change before and after the Mind start, per docs/analysis/residents/.

Residents Minds started 2026-11-15: ag-lewis-01 01:24:28Z, ag-clark-01 01:25:30Z. This is the "after" marker for exploration distance, farming, building and social change (geldar-93, geldar-residents).

2026-11-15 01:31:25Z deploy 977af076 (use verb 0218 step 1, flag body_actions.use OFF; prompt v8): all 17 hosts recreated; no behaviour change expected. Lewis shows use not_possible (verb not enabled): flag if it persists.

2026-11-15 02:39:16Z: 0224 (#424, 4b12d717) merged (geldar-vitals); deploy instant pending from geldar-93, count from the deploy. Agent-visible facts: sleep failure after "tried N nearby beds" ends with "; ended at X, Y, Z"; monsters-nearby refusal adds how long the nearest hostile has been in range ("in range for 6 minutes", first sighting "under a minute"; resets when it leaves the bed box). Action log only: detail.final_position, detail.beds_tried [{x,y,z,reason}], raw.dwell_ticks. Baseline for sleep ok share: 16 of 141 (23:06-00:09Z). The bed.* server refusal text ("the bed could not be used", about 40 a day) is still open as 0215c.
