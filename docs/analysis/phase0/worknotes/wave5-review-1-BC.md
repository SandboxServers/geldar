# Wave 5 review, round 1: areas B (Thinker protocol) and C (prompts and world text)

Reviewer verdict: ship after fixes; 0 blockers, 3 major, 11 minor. Paths are relative to the repo root.

## Major (fix before the wave closes)
1. Warm-up loads every pinned model on every connect attempt (`lantern-local/src/thinker.ts:120-162`, `main.ts:22`): the 8B warm-up can evict the 32B (23.5 of 24.5 GB used), and dial retries thrash 22 GB swaps. Fix: warm only the run tier (or the strong model last), once per process or after about half of keep_alive; test that a failed dial does not re-warm.
2. The reflection prompt keeps only 511 characters of the day digest (`animus/src/prompts/library.ts:232-237`, `world-text.ts:21,70-72,107`): one field through `stableJson` with the 512 cap. Fix: one `day_digest` line per digest line, or a larger cap for that kind; test with a 6 KB digest.
3. No prompt-size budget, and the cut order drops the newest lines first (`world-text.ts:112`, `library.ts:168-181`, `lantern-local/src/ollama.ts:106`, `golem/src/voice/ears.ts:9,82-86`): 50 lines of 256 CJK or `<` characters can overflow `num_ctx` 8192 and every thought errors with `context overflow`; with more than 120 lines the `wake_speech` line is cut first. Fix: a character/token budget in the renderer, `wake_speech` and `plan` first, drop the oldest `heard` first; hostile-volume test.

## Minor
4. An honest `error{timeout}` from lantern is always refused as `late` and counted as an anomaly (`lantern-local/src/thinker.ts:320-323`, `animus/src/thinker/jobs.ts:77-85`); fix: accept up to deadline + grace or abort earlier; interop test.
5. The hub's connection-limit branch has no `error` listener on the refused socket (`animus/src/thinker/hub.ts:123-127`): a malformed frame on the 9th socket can crash the Mind; the limit has no test; the cap counts un-welcomed sockets.
6. Advertised `max_tokens` 1024 is below what the Mind sends (1200) and is never enforced (`lantern-local/src/thinker.ts:6`, `animus/src/thinker/session.ts:113-128,253`).
7. The digest pin is checked once at start only (`lantern-local/src/main.ts:12`).
8. The lantern README and the packet card disagree with the code on backoff (250 ms to 5 s) and omit the warm-up.
9. The world-text escape set omits some invisible code points (U+061C, U+180E, variation selectors, tag characters U+E0000 to E007F) (`world-text.ts:51-60`).
10. Memory-derived text (beliefs, memories, goals) is not inside the quoted section and the v1 template does not say so (`render-memory.ts`, `prompts/thought/v1.md:4`); needs `thought/v2.md`; the validator remains the control.
11. Validator bounds are not read from the shard config (`animus/src/main.ts:204`, `validate/bounds.ts:44-47`).
12. The `response_format` size limit counts UTF-16 units, not bytes (`contract/src/index.ts:150`).
13. Hostile property names flow into log lines unbounded (`animus/src/thinker/session.ts:210`, `lantern-local/src/thinker.ts:243`).
14. Template immutability is not pinned by any test (`animus/src/prompts/library.test.ts:57-62`).

## Unverified
- Ollama eviction in 1 (inferred); token counts in 3 (estimated); forged plans on NATS: the Body validates the full Thought schema but the Phase 0 allow-list is enforced only in the Mind (area D to check); `LocalThinker.stop()` while connecting may send hello after stop.
