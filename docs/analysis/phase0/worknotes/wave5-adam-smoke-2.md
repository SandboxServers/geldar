# Wave 5: Adam smoke, second run (after the start-up fixes), 2026-11-09

## 8B (life ag_adam_02), live cases

- Smoke, chatter (addressed line, hostile corpus) and lifecycle (Body restart, night and reflection): 5 of 5 pass after fixes.
- Thought latency 0.8 to 2.4 s against the 15 s target. First-try validity: one run had the first two thoughts rejected (mind_start, then the corrective retry) before a valid `no_plan` thought; other runs were valid first try. Count it at the retro.
- Fixes found by this run: the start-up robustness set (merged); `intents.thought_id` was never filled (animus now links it, the sink keeps it); the world-text audit did not know `wake_speech` lines (test only, hostile text was always JSON-quoted); live cases waited for a `running` intent that short `travel` programs never show; the sleep case placed half a bed; the prompt does not tell the model how to sleep (proposal: body-api v2 `sleep` wording and a thought v2 nudge, not yet done).

## 32B (life ag_adam_01), `adam up` for about 6 minutes

- Needs `whitelist add ag_adam_01` first (the live cases do it themselves). The Body gives up after one restart on "not whitelisted" and does not retry once whitelisted.
- Cold load: the first two thoughts hit the 25 s job deadline (`timeout`) while Ollama loaded the 22 GB model; the model is on the GPU 100 percent (23.5 of 24.5 GB used).
- Warm: 2.6 s for a 2705-token prompt (80 out), a direct call 1.0 s.
- Action: lantern-local should load and warm every pinned model before it advertises it (a one-token call with keep_alive), so the first job is warm. Small packet in the wave 5 fix round.

## 20 TPS benchmark on commit 35e16c0 (clean tree, recipes discovered through play)

GATE: PASS. All 18 rows 5/5. 20 TPS p50/p95 ms: wood-to-stone-tools 374/18235, food 1661/2637, shelter 561/1067, bed 668/1086, chest 8/236, blocked-path 6132/6440. Raw: `bench-results/20261109T233614Z-35e16c0.json`.
