# Wave 5 Adam smoke, first run (orchestrator, 8B life ag_adam_02, 2026-11-09)

`adam-smoke.live.test.ts` failed after 90 s: `saw thoughts: G951X2 no_plan no-call`, no intents. Evidence from the run (process logs in the test output and the Postgres rows):

- 22:09:41.87 lantern-local started ("serving qwen3:32b, qwen3:8b to ws://127.0.0.1:7410/..."): BEFORE the Mind's Thinker hub existed (animus started 22:09:42.3, Body 22:09:44.1). `./geldar.ps1 adam up` starts Body, animus, lantern-local in that order, but the live test starts lantern first.
- No `thought`, no suppressed wakeup and no journal row appeared for the Mind's own `mind_start` wake (animus logged `mind_started` at 22:09:42.4 and nothing else for 47 s). Hypothesis: the loop's first snapshot request went out before the Body's MindLinkServer was listening (the Body logged `body_started` at 22:09:44.1) and nothing retried it, so the start wake was lost silently.
- 22:10:29.7 the Body's own `no_plan` wake (45 s after restart with nothing to resume) reached the Mind: a `thoughts` row with the rendered prompt, `credits_reserved 1`, `effort minimal`, empty `thinker_id`, empty `latency_ms`, empty `raw_output`, and the `thought` event `outcome: model_error`, `latency_ms: 0`: the model client failed at once, most likely `no_thinker` (lantern's reconnect backoff after the hub was missing at its first attempt had grown past the hub's start: attempts at about +1, +3, +7, +15, +31 s, the next at +61 s).
- Not the cause (checked): Ollama (2 s cold, 0.2 to 1.7 s warm, the real decode schema answers in 1.6 s directly), the hub's Origin rule (Node's global WebSocket sends no Origin).

Findings to fix (owner of each): 
1. (Mind, animus) At start, the `mind_start` wake must survive an unready Body: retry the snapshot request with backoff for up to about 60 s before giving up, and record the outcome (a thought row or a suppressed-wakeup row with a reason) either way; never lose a wake silently.
2. (Mind) A `no_thinker` model error must not instantly end the cycle: wait for a Thinker to connect (bounded, for example 20 s) and retry once; only then the fallback. Journal the error code in the thoughts row (`provider_usage` or a field) and log it in the `thought` log line (`outcome`, `error_code`).
3. (lantern-local) Reconnect backoff: start at 250 ms, cap at 5 s (jitter), so a late hub is found within seconds; log each connect, hello, welcome and close with the reason.
4. (live test, adam-stack.ts) Start the processes in the same order as `./geldar.ps1 adam up` (Body, animus, lantern-local) and wait for the Thinker hub to report a connected Thinker (a log line `thinker_connected` from animus) before measuring the 90 s.
5. (animus) Log `thinker_connected` / `thinker_disconnected` (model names) and the thought outcome with the error code.
6. (lantern-local IT test) `ollama.it.test.ts` needs a test timeout of at least 180 s (cold model load), not the default 5 s.
